import { PlayerBalance } from '@/types/game';
import { GroupedSettlement } from '@/utils/settlementUtils';
import { buildSummaryListData } from '@/utils/summaryListData';

const bal = (
  playerId: string,
  playerName: string,
  totalBuyins = 100,
  totalCashouts = 100,
): PlayerBalance =>
  ({ playerId, playerName, totalBuyins, totalCashouts, netBalance: totalCashouts - totalBuyins } as PlayerBalance);

const grouped = (recipient: string, totalAmount: number): GroupedSettlement => ({
  recipient,
  totalAmount,
  payments: [{ from: 'Payer', amount: totalAmount }],
});

describe('buildSummaryListData', () => {
  it('emits the balances header and nothing else for an empty game', () => {
    const items = buildSummaryListData({ grouped: [], balances: [], isBanker: false });
    expect(items.map(i => i.type)).toEqual(['empty', 'sectionHeader']);
    expect(items[0]).toMatchObject({ type: 'empty', label: 'All balanced' });
  });

  it('labels the empty settlements state differently in banker mode', () => {
    const items = buildSummaryListData({ grouped: [], balances: [], isBanker: true });
    expect(items[0]).toMatchObject({ type: 'empty', label: 'Nothing to pay out' });
  });

  it('emits settlement items in direct mode', () => {
    const items = buildSummaryListData({
      grouped: [grouped('Ada', 20)],
      balances: [],
      isBanker: false,
    });
    expect(items.map(i => i.type)).toEqual(['settlement', 'sectionHeader']);
    expect(items[0]).toMatchObject({ key: 'settlement-0' });
  });

  it('emits bankerPayout items in banker mode', () => {
    const items = buildSummaryListData({
      grouped: [grouped('Ada', 20), grouped('Bob', 5)],
      balances: [],
      isBanker: true,
    });
    expect(items.slice(0, 2)).toEqual([
      { type: 'bankerPayout', key: 'payout-0', recipient: 'Ada', amount: 20 },
      { type: 'bankerPayout', key: 'payout-1', recipient: 'Bob', amount: 5 },
    ]);
  });

  it('emits one balance item per player, only the last without a gap', () => {
    const items = buildSummaryListData({
      grouped: [],
      balances: [bal('p1', 'Ada'), bal('p2', 'Bob'), bal('p3', 'Cyd')],
      isBanker: false,
    });
    const balances = items.filter(i => i.type === 'balance');
    expect(balances.map(i => i.key)).toEqual(['balance-p1', 'balance-p2', 'balance-p3']);
    expect(balances.map(i => (i as any).isLast)).toEqual([false, false, true]);
  });

  it('hints a non-playing banker and nobody else', () => {
    const items = buildSummaryListData({
      grouped: [],
      balances: [bal('p1', 'Ada', 0, 0), bal('p2', 'Bob', 50, 20)],
      isBanker: true,
      bankerPlayerId: 'p1',
    });
    const balances = items.filter(i => i.type === 'balance') as any[];
    expect(balances.map(b => b.hint)).toEqual(['banker · not playing', undefined]);
  });

  it('does not hint a banker who actually played', () => {
    const items = buildSummaryListData({
      grouped: [],
      balances: [bal('p1', 'Ada', 50, 30)],
      isBanker: true,
      bankerPlayerId: 'p1',
    });
    expect((items.filter(i => i.type === 'balance')[0] as any).hint).toBeUndefined();
  });

  it('does not hint a zero-activity player in direct mode', () => {
    const items = buildSummaryListData({
      grouped: [],
      balances: [bal('p1', 'Ada', 0, 0)],
      isBanker: false,
      bankerPlayerId: 'p1',
    });
    expect((items.filter(i => i.type === 'balance')[0] as any).hint).toBeUndefined();
  });

  it('puts the FINAL BALANCES header between settlements and balances', () => {
    const items = buildSummaryListData({
      grouped: [grouped('Ada', 20)],
      balances: [bal('p1', 'Ada')],
      isBanker: false,
    });
    expect(items.map(i => i.type)).toEqual(['settlement', 'sectionHeader', 'balance']);
    expect(items[1]).toMatchObject({ key: 'header-balances', label: 'FINAL BALANCES' });
  });
});
