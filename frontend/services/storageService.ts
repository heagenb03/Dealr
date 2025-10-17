import { Game } from '@/types/game';

export class StorageService {
  private static games: Game[] = [];
  private static activeGameId: string | null = null;
  

  static async saveGames(games: Game[]): Promise<void> {
    this.games = games;
  }
  
  static async loadGames(): Promise<Game[]> {
    return this.games;
  }
  
  static async saveActiveGameId(gameId: string | null): Promise<void> {
    this.activeGameId = gameId;
  }
  
  static async loadActiveGameId(): Promise<string | null> {
    return this.activeGameId;
  }
  
  static async clearAll(): Promise<void> {
    this.games = [];
    this.activeGameId = null;
  }
}
