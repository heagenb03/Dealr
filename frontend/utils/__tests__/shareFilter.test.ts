import { chipNamesFromBalances, filterSummaryInputs } from '@/utils/shareFilter';
import { GroupedSettlement } from '@/utils/settlementUtils';
import { PlayerBalance } from '@/types/game';

const bal = (name: string, net: number): PlayerBalance => ({
  playerId: `id-${name}`,
  playerName: name,
  totalBuyins: 100,
  totalCashouts: 100 + net,
  netBalance: net,
});

const balances: PlayerBalance[] = [bal('Ada', 70), bal('Bob', -30), bal('Cal', -40)];

// Ada receives 70: 30 from Bob and 40 from Cal.
const grouped: GroupedSettlement[] = [
  {
    recipient: 'Ada',
    totalAmount: 70,
    payments: [
      { from: 'Bob', amount: 30 },
      { from: 'Cal', amount: 40 },
    ],
  },
  { recipient: 'Bob', totalAmount: 5, payments: [{ from: 'Cal', amount: 5 }] },
];

describe('chipNamesFromBalances', () => {
  it('lists player names in balance order', () => {
    // Deliberately NOT alphabetical: the shared `balances` fixture already is
    // (Ada, Bob, Cal), which lets an implementation that quietly sorts (e.g.
    // `[...new Set(names)].sort()`) pass unnoticed. This fixture pins order
    // to the balances array itself, not the alphabet.
    const unsorted = [bal('Cal', 70), bal('Ada', -30), bal('Bob', -40)];
    expect(chipNamesFromBalances(unsorted)).toEqual(['Cal', 'Ada', 'Bob']);
  });

  it('de-duplicates repeated names, keeping the first occurrence position', () => {
    // Settlements are name-based, so two same-named players are already
    // conflated upstream. Two identical chips would be two identical filters.
    // Interleaved (not adjacent) so this also pins first-occurrence position
    // over e.g. a last-wins dedupe.
    const dupes = [bal('Bob', 10), bal('Ada', -10), bal('Bob', 0)];
    expect(chipNamesFromBalances(dupes)).toEqual(['Bob', 'Ada']);
  });

  it('returns an empty list for no balances', () => {
    expect(chipNamesFromBalances([])).toEqual([]);
  });
});

describe('filterSummaryInputs — no selection', () => {
  it('returns everything unchanged when nothing is selected', () => {
    const out = filterSummaryInputs({ grouped, balances, selectedName: null });
    expect(out.grouped).toEqual(grouped);
    expect(out.balances).toEqual(balances);
  });
});

describe('filterSummaryInputs — selecting a payer', () => {
  const out = () => filterSummaryInputs({ grouped, balances, selectedName: 'Cal' });

  it('keeps every card Cal appears in', () => {
    // Cal pays Ada 40 and Bob 5, so both cards survive.
    expect(out().grouped.map(g => g.recipient)).toEqual(['Ada', 'Bob']);
  });

  it('keeps a matching card WHOLE — rows and total both untouched', () => {
    // THE INVARIANT. totalAmount is a sum over payments; dropping Bob's row
    // without recomputing would print "Ada 70" above a single 40 row.
    const ada = out().grouped.find(g => g.recipient === 'Ada')!;
    expect(ada.totalAmount).toBe(70);
    expect(ada.payments).toEqual([
      { from: 'Bob', amount: 30 },
      { from: 'Cal', amount: 40 },
    ]);
  });

  it('narrows the balances to Cal alone', () => {
    expect(out().balances).toEqual([bal('Cal', -40)]);
  });
});

describe('filterSummaryInputs — selecting a recipient', () => {
  it("keeps the selected player's own card and any card they pay into", () => {
    const out = filterSummaryInputs({ grouped, balances, selectedName: 'Bob' });
    // Bob receives on his own card, and pays 30 into Ada's.
    expect(out.grouped.map(g => g.recipient)).toEqual(['Ada', 'Bob']);
    expect(out.balances).toEqual([bal('Bob', -30)]);
  });
});

describe('filterSummaryInputs — a player with no obligations', () => {
  it('keeps their balance card and shows no settlements', () => {
    const evenBalances = [...balances, bal('Dee', 0)];
    const out = filterSummaryInputs({ grouped, balances: evenBalances, selectedName: 'Dee' });
    expect(out.grouped).toEqual([]);
    expect(out.balances).toEqual([bal('Dee', 0)]);
  });
});

describe('filterSummaryInputs — unknown selection', () => {
  it('yields an empty view rather than throwing', () => {
    const out = filterSummaryInputs({ grouped, balances, selectedName: 'Nobody' });
    expect(out.grouped).toEqual([]);
    expect(out.balances).toEqual([]);
  });
});

describe('filterSummaryInputs — banker mode', () => {
  // In banker mode every card's single payer is the banker.
  const bankerGrouped: GroupedSettlement[] = [
    { recipient: 'Ada', totalAmount: 40, payments: [{ from: 'Zoe', amount: 40 }] },
    { recipient: 'Bob', totalAmount: 25, payments: [{ from: 'Zoe', amount: 25 }] },
  ];
  const bankerBalances = [bal('Ada', 40), bal('Bob', 25), bal('Zoe', -65)];

  it('shows a payee only their own payout', () => {
    const out = filterSummaryInputs({
      grouped: bankerGrouped,
      balances: bankerBalances,
      selectedName: 'Ada',
    });
    expect(out.grouped.map(g => g.recipient)).toEqual(['Ada']);
  });

  it('shows the banker every payout, because they pay all of them', () => {
    const out = filterSummaryInputs({
      grouped: bankerGrouped,
      balances: bankerBalances,
      selectedName: 'Zoe',
    });
    expect(out.grouped.map(g => g.recipient)).toEqual(['Ada', 'Bob']);
    expect(out.balances).toEqual([bal('Zoe', -65)]);
  });
});

describe('filterSummaryInputs — drops a card the selected player is not part of', () => {
  // Neither test above can distinguish real filtering from a no-op: every
  // GroupedSettlement in the shared `grouped` fixture happens to involve
  // both 'Cal' and 'Bob', so an implementation that just echoed `grouped`
  // back unfiltered would pass them too. This fixture adds a card ('Eve')
  // that the selected player has no part in at all, so dropping it is the
  // only way to pass.
  it('excludes a card that does not involve the selected player', () => {
    const localGrouped: GroupedSettlement[] = [
      { recipient: 'Ada', totalAmount: 40, payments: [{ from: 'Bob', amount: 40 }] },
      { recipient: 'Eve', totalAmount: 15, payments: [{ from: 'Dee', amount: 15 }] },
    ];
    const localBalances = [bal('Ada', 40), bal('Bob', -40), bal('Dee', -15), bal('Eve', 15)];
    const out = filterSummaryInputs({
      grouped: localGrouped,
      balances: localBalances,
      selectedName: 'Bob',
    });
    expect(out.grouped.map(g => g.recipient)).toEqual(['Ada']);
  });
});

describe('filterSummaryInputs — immutability', () => {
  // The naive version of this test ("call the function, then deep-equal the
  // caller's arrays against a pre-call snapshot") passes just as well for a
  // function that mutates nothing because it filters nothing — a no-op is
  // trivially immutable. To actually discriminate, this test proves real
  // filtering happened (a no-op would keep all 3 balances, not narrow to 1)
  // AND that the caller's own array/object references were never touched —
  // via both a deep-equality snapshot comparison and reference identity
  // checks on the elements that survive filtering.
  it('filters without mutating the caller\'s arrays or their element objects', () => {
    const originalAdaGroup = grouped[0];
    const originalBobGroup = grouped[1];
    const originalAdaPayments = originalAdaGroup.payments;
    const groupedCopy = JSON.parse(JSON.stringify(grouped));
    const balancesCopy = JSON.parse(JSON.stringify(balances));

    const out = filterSummaryInputs({ grouped, balances, selectedName: 'Cal' });

    // Proves real filtering happened, so this can't pass on a no-op.
    expect(out.balances).toEqual([bal('Cal', -40)]);

    // Proves the caller's own arrays/objects were not touched by that filtering.
    expect(grouped).toEqual(groupedCopy);
    expect(balances).toEqual(balancesCopy);
    expect(grouped[0]).toBe(originalAdaGroup);
    expect(grouped[1]).toBe(originalBobGroup);
    expect(grouped[0].payments).toBe(originalAdaPayments);
  });
});
