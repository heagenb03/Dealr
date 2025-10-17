import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Game } from '@/types/game';
import { GameService } from '@/services/gameService';
import { StorageService } from '@/services/storageService';

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
  
  useEffect(() => {
    loadGames();
  }, []);
  
  const loadGames = async () => {
    try {
      setLoading(true);
      const loadedGames = await StorageService.loadGames();
      setGames(loadedGames);
      
      const activeGameId = await StorageService.loadActiveGameId();
      if (activeGameId) {
        const active = loadedGames.find(g => g.id === activeGameId);
        setActiveGameState(active || null);
      }
    } catch (error) {
      console.error('Error loading games:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const createGame = async (name: string): Promise<Game> => {
    const newGame = GameService.createGame(name);
    const updatedGames = [...games, newGame];
    setGames(updatedGames);
    await StorageService.saveGames(updatedGames);
    setActiveGameState(newGame);
    await StorageService.saveActiveGameId(newGame.id);
    return newGame;
  };
  
  const setActiveGame = async (gameId: string | null) => {
    const game = gameId ? games.find(g => g.id === gameId) || null : null;
    setActiveGameState(game);
    await StorageService.saveActiveGameId(gameId);
  };
  
  const updateGame = async (updatedGame: Game) => {
    const updatedGames = games.map(g => g.id === updatedGame.id ? updatedGame : g);
    setGames(updatedGames);
    
    if (activeGame?.id === updatedGame.id) {
      setActiveGameState(updatedGame);
    }
    
    await StorageService.saveGames(updatedGames);
  };
  
  const deleteGame = async (gameId: string) => {
    const updatedGames = games.filter(g => g.id !== gameId);
    setGames(updatedGames);
    
    if (activeGame?.id === gameId) {
      setActiveGameState(null);
      await StorageService.saveActiveGameId(null);
    }
    
    await StorageService.saveGames(updatedGames);
  };
  
  const refreshGames = async () => {
    await loadGames();
  };
  
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
        refreshGames
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
