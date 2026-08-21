import AsyncStorage from '@react-native-async-storage/async-storage';
import { Game } from '@/types/game';
import { withLegacyPayment, withSynthesizedMethods } from '@/utils/paymentMethods';

const GAMES_KEY = '@cashcage:games';
const ACTIVE_GAME_ID_KEY = '@cashcage:activeGameId';
// Durable record of games whose Firestore write/delete had not been acknowledged.
// SyncService keeps this in step with its in-memory maps; see the comment on
// pendingSaves in syncService.ts for why the in-memory copy alone is not enough.
const PENDING_MUTATIONS_KEY = '@cashcage:pendingMutations';

/**
 * Game ids with an unconfirmed local write (saves) or delete (deletes).
 *
 * uid stamps the owner. GameContext swallows a failed clearAll() on user switch, and
 * these markers drive a Firestore PUSH — without the stamp, a swallowed failure would
 * write the previous account's game into the next account's collection.
 */
export interface PendingMutations {
  uid: string | null;
  saves: string[];
  deletes: string[];
}

export class StorageService {
  static async saveGames(games: Game[]): Promise<void> {
    try {
      // Dual-write the derived legacy preferredPayment so a shipped 2.0.2 client reading
      // this same store still sees the player's default method. Derived here, never stored
      // in memory — see spec §2.
      await AsyncStorage.setItem(GAMES_KEY, JSON.stringify(games.map(withLegacyPayment)));
    } catch (error) {
      console.error('Error saving games:', error);
      throw error;
    }
  }

  static async loadGames(): Promise<Game[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(GAMES_KEY);
      if (!jsonValue) return [];

      const games = JSON.parse(jsonValue);

      // Deserialize Date objects (AsyncStorage stores JSON, dates become strings)
      return games.map((game: any) => ({
        ...game,
        date: new Date(game.date),
        createdAt: new Date(game.createdAt),
        // Spread, don't whitelist. A field-by-field rebuild silently drops any
        // Player field added later (preferredPayment, savedPlayerId), and the
        // stripped result gets written straight back to storage and Firestore.
        players: game.players.map((p: any) => withSynthesizedMethods({
          ...p,
          completedAt: p.completedAt ? new Date(p.completedAt) : undefined,
        })),
        transactions: game.transactions.map((t: any) => ({
          ...t,
          timestamp: new Date(t.timestamp),
        })),
      }));
    } catch (error) {
      console.error('Error loading games:', error);
      return [];
    }
  }

  static async saveActiveGameId(gameId: string | null): Promise<void> {
    try {
      if (gameId === null) {
        await AsyncStorage.removeItem(ACTIVE_GAME_ID_KEY);
      } else {
        await AsyncStorage.setItem(ACTIVE_GAME_ID_KEY, gameId);
      }
    } catch (error) {
      console.error('Error saving active game ID:', error);
      throw error;
    }
  }

  static async loadActiveGameId(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(ACTIVE_GAME_ID_KEY);
    } catch (error) {
      console.error('Error loading active game ID:', error);
      return null;
    }
  }

  /**
   * Read the durable pending-mutation markers. Returns empty lists rather than
   * throwing: a missing or corrupt marker file must not stop the app loading, it
   * just costs cross-restart protection for whatever it was tracking.
   */
  static async loadPendingMutations(): Promise<PendingMutations> {
    try {
      const jsonValue = await AsyncStorage.getItem(PENDING_MUTATIONS_KEY);
      if (!jsonValue) return { uid: null, saves: [], deletes: [] };

      const parsed = JSON.parse(jsonValue);
      const ids = (v: any): string[] => (Array.isArray(v) ? v.filter(id => typeof id === 'string') : []);
      return {
        uid: typeof parsed?.uid === 'string' ? parsed.uid : null,
        saves: ids(parsed?.saves),
        deletes: ids(parsed?.deletes),
      };
    } catch (error) {
      console.error('Error loading pending mutations:', error);
      return { uid: null, saves: [], deletes: [] };
    }
  }

  static async savePendingMutations(pending: PendingMutations): Promise<void> {
    try {
      await AsyncStorage.setItem(PENDING_MUTATIONS_KEY, JSON.stringify(pending));
    } catch (error) {
      console.error('Error saving pending mutations:', error);
      throw error;
    }
  }

  static async clearAll(): Promise<void> {
    try {
      await AsyncStorage.removeItem(GAMES_KEY);
      await AsyncStorage.removeItem(ACTIVE_GAME_ID_KEY);
      // Cleared here, NOT in SyncService.clearPendingMutations(): dropping the
      // in-memory maps alone is what process death looks like, and that case must
      // keep its markers. A user switch is the one place both halves go.
      await AsyncStorage.removeItem(PENDING_MUTATIONS_KEY);
    } catch (error) {
      console.error('Error clearing storage:', error);
      throw error;
    }
  }
}
