import AsyncStorage from '@react-native-async-storage/async-storage';
import { Game } from '@/types/game';
import { withLegacyPayment, withSynthesizedMethods } from '@/utils/paymentMethods';

const GAMES_KEY = '@cashcage:games';
const ACTIVE_GAME_ID_KEY = '@cashcage:activeGameId';

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

  static async clearAll(): Promise<void> {
    try {
      await AsyncStorage.removeItem(GAMES_KEY);
      await AsyncStorage.removeItem(ACTIVE_GAME_ID_KEY);
    } catch (error) {
      console.error('Error clearing storage:', error);
      throw error;
    }
  }
}
