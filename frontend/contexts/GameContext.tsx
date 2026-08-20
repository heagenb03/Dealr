import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Game } from '@/types/game';
import { GameService } from '@/services/gameService';
import { StorageService } from '@/services/storageService';
import { SyncService } from '@/services/syncService';
import { useAuth } from '@/contexts/AuthContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useGameDefaults } from '@/contexts/GameDefaultsContext';

interface GameContextType {
  games: Game[];
  activeGame: Game | null;
  loading: boolean;
  createGame: (name: string) => Promise<Game>;
  setActiveGame: (gameId: string | null) => void;
  updateGame: (game: Game) => Promise<void>;
  deleteGame: (gameId: string) => Promise<void>;
  refreshGames: () => Promise<void>;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export function GameProvider({ children }: { children: ReactNode }) {
  const [games, setGames] = useState<Game[]>([]);
  const [activeGame, setActiveGameState] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);

  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const { defaultCashUnit, defaultSettlementMode, defaultTolerance, defaultBuyIn } = useGameDefaults();
  const uid = user?.uid ?? null;
  const abortRef = useRef<AbortController | null>(null);
  const prevUidRef = useRef<string | null | undefined>(undefined); // undefined = not yet initialized
  const gamesRef = useRef<Game[]>([]);
  const activeGameRef = useRef<Game | null>(null);
  // Track previous online state so we can detect offline -> online transitions
  const wasOfflineRef = useRef(false);
  // Debounce timer for re-sync on reconnect
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync with state for reading in callbacks
  useEffect(() => { gamesRef.current = games; }, [games]);
  useEffect(() => { activeGameRef.current = activeGame; }, [activeGame]);

  // ---------------------------------------------------------------------------
  // loadGames — reads from AsyncStorage immediately (offline-first), then
  // kicks off a background Firestore sync when signed in. The remote merge
  // result updates the UI transparently via onRemoteUpdate.
  // ---------------------------------------------------------------------------

  const loadGames = useCallback(async (currentUid: string | null, signal?: AbortSignal) => {
    try {
      setLoading(true);

      const localGames = await SyncService.loadGames(currentUid, (mergedGames) => {
        // Background Firestore sync completed — refresh UI with merged data
        setGames(mergedGames);
        setActiveGameState(prev =>
          prev ? (mergedGames.find(g => g.id === prev.id) ?? null) : null,
        );
      }, signal);

      if (signal?.aborted) return;

      setGames(localGames);

      const activeGameId = await StorageService.loadActiveGameId();
      if (activeGameId) {
        const active = localGames.find(g => g.id === activeGameId);
        setActiveGameState(active ?? null);
      }
    } catch (error) {
      if (signal?.aborted) return;
      console.error('GameContext: error loading games', error);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  // Re-load whenever uid changes (sign-in, sign-out, or initial mount).
  // On user switch: clear local storage so the new user starts with a clean
  // slate (the background Firestore sync will populate their actual games).
  // On sign-out: local storage is cleared so the next sign-in sees no stale data.
  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const prevUid = prevUidRef.current;
    prevUidRef.current = uid;

    (async () => {
      // Clear local game data whenever the signed-in user changes.
      // Skip on initial mount (prevUid === undefined) to avoid an unnecessary clear.
      if (prevUid !== undefined && prevUid !== uid) {
        setGames([]);
        setActiveGameState(null);
        SyncService.clearPendingMutations();
        try {
          await StorageService.clearAll();
        } catch (err) {
          console.warn('GameContext: failed to clear storage on user switch', err);
        }
      }

      if (!controller.signal.aborted) {
        loadGames(uid, controller.signal);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [uid, loadGames]);

  // Re-sync from Firestore when connectivity is restored after an offline period.
  // Uses a 2-second debounce to let the connection fully stabilise before fetching.
  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      return;
    }

    // isOnline just became true — only re-sync if we were previously offline
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (uid) {
          loadGames(uid);
        }
      }, 2000);
    }

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [isOnline, uid, loadGames]);

  // ---------------------------------------------------------------------------
  // CRUD operations — update React state immediately, then persist via
  // SyncService (AsyncStorage + fire-and-forget Firestore when signed in).
  // ---------------------------------------------------------------------------

  const createGame = useCallback(async (name: string): Promise<Game> => {
    const newGame = GameService.createGame(name, {
      cashUnit: defaultCashUnit,
      settlementMode: defaultSettlementMode,
      tolerance: defaultTolerance,
      buyIn: defaultBuyIn,
    });
    setGames(prev => [...prev, newGame]);
    await SyncService.saveGame(uid, newGame);
    setActiveGameState(newGame);
    await StorageService.saveActiveGameId(newGame.id);
    return newGame;
  }, [uid, defaultCashUnit, defaultSettlementMode, defaultTolerance, defaultBuyIn]);

  const setActiveGame = useCallback(async (gameId: string | null) => {
    if (gameId) {
      const game = gamesRef.current.find(g => g.id === gameId) ?? null;
      setActiveGameState(game);
    } else {
      setActiveGameState(null);
    }
    await StorageService.saveActiveGameId(gameId);
  }, []);

  const updateGame = useCallback(async (updatedGame: Game) => {
    const freshGame = { ...updatedGame };
    setGames(prev => prev.map(g => (g.id === updatedGame.id ? freshGame : g)));
    setActiveGameState(prev =>
      prev?.id === updatedGame.id ? freshGame : prev,
    );
    await SyncService.saveGame(uid, freshGame);
  }, [uid]);

  const deleteGame = useCallback(async (gameId: string) => {
    // Resolve the share id BEFORE filtering the game out — after that line the
    // game, and its shareId with it, is gone from state. gamesRef rather than
    // the `games` state for the same reason activeGameRef is used below: this
    // file keeps both refs in sync precisely so callbacks can read them without
    // taking a dependency that rebuilds the callback on every game edit.
    const shareId = gamesRef.current.find(g => g.id === gameId)?.shareId;
    setGames(prev => prev.filter(g => g.id !== gameId));
    if (activeGameRef.current?.id === gameId) {
      setActiveGameState(null);
      await StorageService.saveActiveGameId(null);
    }
    await SyncService.deleteGame(uid, gameId, shareId);
  }, [uid]);

  const refreshGames = useCallback(async () => {
    await loadGames(uid);
  }, [uid, loadGames]);

  return (
    <GameContext.Provider
      value={{
        games,
        activeGame,
        loading,
        createGame,
        setActiveGame,
        updateGame,
        deleteGame,
        refreshGames,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (context === undefined) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
}
