import { Player, PlayerBalance } from '@/types/game';
import { buildActiveGameListData } from '@/utils/activeGameListData';

const mkPlayer = (id: string, name: string, completed = false): Player =>
  ({ id, name, ...(completed ? { completedAt: new Date('2026-01-01T00:00:00Z') } : {}) } as Player);

const mkBalance = (playerId: string): PlayerBalance =>
  ({ playerId, playerName: playerId, totalBuyins: 10, totalCashouts: 0, netBalance: -10 } as PlayerBalance);

describe('buildActiveGameListData', () => {
  it('emits the players header and an empty item for no players', () => {
    const items = buildActiveGameListData({ players: [], balances: [] });
    expect(items).toEqual([
      { type: 'sectionHeader', key: 'header-players', label: 'players' },
      { type: 'empty', key: 'empty-players', label: 'No players yet', icon: 'person-outline' },
    ]);
  });

  it('emits one active row keyed by player id', () => {
    const items = buildActiveGameListData({ players: [mkPlayer('p1', 'Ada')], balances: [] });
    expect(items.map(i => [i.type, i.key])).toEqual([
      ['sectionHeader', 'header-players'],
      ['activePlayer', 'p1'],
    ]);
  });

  it('preserves roster order across many active players', () => {
    const items = buildActiveGameListData({
      players: [mkPlayer('p1', 'Ada'), mkPlayer('p2', 'Bob'), mkPlayer('p3', 'Cyd')],
      balances: [],
    });
    expect(items.filter(i => i.type === 'activePlayer').map(i => i.key)).toEqual(['p1', 'p2', 'p3']);
  });

  it('omits the completed header entirely when nobody has cashed out', () => {
    const items = buildActiveGameListData({ players: [mkPlayer('p1', 'Ada')], balances: [] });
    expect(items.some(i => i.key === 'header-completed')).toBe(false);
  });

  it('splits active from completed and orders the sections', () => {
    const items = buildActiveGameListData({
      players: [mkPlayer('p1', 'Ada'), mkPlayer('p2', 'Bob', true), mkPlayer('p3', 'Cyd')],
      balances: [],
    });
    expect(items.map(i => [i.type, i.key])).toEqual([
      ['sectionHeader', 'header-players'],
      ['activePlayer', 'p1'],
      ['activePlayer', 'p3'],
      ['sectionHeader', 'header-completed'],
      ['completedPlayer', 'p2'],
    ]);
  });

  it('emits the empty item when every player has completed', () => {
    const items = buildActiveGameListData({
      players: [mkPlayer('p1', 'Ada', true)],
      balances: [],
    });
    expect(items.map(i => i.type)).toEqual(['sectionHeader', 'empty', 'sectionHeader', 'completedPlayer']);
  });

  it('attaches each player’s balance and leaves it undefined when absent', () => {
    const items = buildActiveGameListData({
      players: [mkPlayer('p1', 'Ada'), mkPlayer('p2', 'Bob')],
      balances: [mkBalance('p1')],
    });
    const rows = items.filter(i => i.type === 'activePlayer') as any[];
    expect(rows[0].balance).toEqual(mkBalance('p1'));
    expect(rows[1].balance).toBeUndefined();
  });

  it('flags the banker only in banker mode', () => {
    const players = [mkPlayer('p1', 'Ada'), mkPlayer('p2', 'Bob')];
    const banker = buildActiveGameListData({
      players,
      balances: [],
      settlementMode: 'banker',
      bankerPlayerId: 'p2',
    });
    expect((banker.filter(i => i.type === 'activePlayer') as any[]).map(r => r.isBanker)).toEqual([false, true]);

    const direct = buildActiveGameListData({
      players,
      balances: [],
      settlementMode: 'direct',
      bankerPlayerId: 'p2',
    });
    expect((direct.filter(i => i.type === 'activePlayer') as any[]).every(r => !r.isBanker)).toBe(true);
  });
});
