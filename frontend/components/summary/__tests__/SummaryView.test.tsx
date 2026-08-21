/**
 * SummaryView routes each SummaryListItem variant to the right component and
 * feeds it the INJECTED formatters. That routing is the only logic SummaryView
 * owns; everything visual belongs to the cards (see summaryCards.test.tsx) or to
 * the device-QA checklist.
 *
 * ⚠️ This file renders `renderSummaryItem` directly and NEVER renders
 * `<SummaryView>` itself. Rendering a FlatList under jest-expo/node HANGS —
 * measured on this tree at `895e42b`: a ScrollView + Text renders in 29ms, while
 * the same harness around a 3-row FlatList never returns and had to be killed at
 * 120s. It hangs synchronously, so jest's 5s testTimeout cannot interrupt it and
 * there is no failure message — just a suite that never finishes. Do not "fix"
 * this file by rendering the component.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-gesture-handler', () => {
  const build = () => {
    const g: Record<string, any> = {};
    [
      'maxDuration', 'maxDistance', 'hitSlop', 'enabled',
      'onBegin', 'onEnd', 'onFinalize', 'requireExternalGestureToFail',
    ].forEach((m) => { g[m] = () => g; });
    return g;
  };
  return {
    Gesture: { Tap: build },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});
jest.mock('react-native-reanimated', () => ({ runOnJS: (fn: any) => fn }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { renderSummaryItem, SummaryItemDeps } from '@/components/summary/SummaryView';
import { buildSummaryListData, SummaryListItem } from '@/utils/summaryListData';
import { PlayerBalance, PreferredPayment } from '@/types/game';
import { GroupedSettlement } from '@/utils/settlementUtils';

const texts = (node: any, out: string[] = []): string[] => {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (node.children) node.children.forEach((c: any) => texts(c, out));
  return out;
};

const usd = (n: number) => `$${n.toFixed(2)}`;
const usdCompact = (n: number) => {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return abs >= 1000 ? `${sign}$${(abs / 1000).toFixed(1)}k` : `${sign}$${abs.toFixed(2)}`;
};

const deps = (over: Partial<SummaryItemDeps> = {}): SummaryItemDeps => ({
  formatAmount: usd,
  formatAmountCompact: usdCompact,
  paymentByName: new Map<string, PreferredPayment>(),
  reduceMotion: true,
  ...over,
});

/** Render one list item through SummaryView's own routing function. */
const item = (it: SummaryListItem, d: SummaryItemDeps = deps()): string[] => {
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(renderSummaryItem(it, d)); });
  return texts(tree.toJSON());
};

const bal = (playerId: string, playerName: string, buyins: number, cashouts: number): PlayerBalance =>
  ({ playerId, playerName, totalBuyins: buyins, totalCashouts: cashouts, netBalance: cashouts - buyins } as PlayerBalance);

const grp = (recipient: string, totalAmount: number): GroupedSettlement => ({
  recipient,
  totalAmount,
  payments: [{ from: 'Bob', amount: totalAmount }],
});

/** buildSummaryListData is the real producer, so the item shapes cannot drift. */
const listOf = (grouped: GroupedSettlement[], balances: PlayerBalance[], isBanker: boolean) =>
  buildSummaryListData({ grouped, balances, isBanker });

describe('renderSummaryItem', () => {
  it('routes a settlement item to SettlementCard, with the FULL formatter', () => {
    const [settlement] = listOf([grp('Ada', 1500)], [], false);
    expect(settlement.type).toBe('settlement');
    // RECEIVES belongs to SettlementCard alone, and 1500 is NOT compacted.
    expect(item(settlement)).toEqual(['Ada', 'RECEIVES', '$1500.00']);
  });

  it('routes a bankerPayout item to BankerPayoutRow, with the FULL formatter', () => {
    const [payout] = listOf([grp('Ada', 1500)], [], true);
    expect(payout.type).toBe('bankerPayout');
    // No RECEIVES label — that is the discriminator between the two cards.
    expect(item(payout)).toEqual(['Ada', '$1500.00']);
  });

  it('routes a balance item to BalanceCard, with the COMPACT formatter', () => {
    const items = listOf([], [bal('p1', 'Ada', 2000, 3500)], false);
    const balance = items.find((i) => i.type === 'balance')!;
    expect(item(balance)).toEqual(['Ada', 'In', '$2.0k', 'Out', '$3.5k', 'Net', '+$1.5k']);
  });

  it('routes a sectionHeader item to the hud header and an empty item to the empty state', () => {
    const items = listOf([], [], false);
    const header = items.find((i) => i.type === 'sectionHeader')!;
    const empty = items.find((i) => i.type === 'empty')!;
    expect(item(header)).toEqual(['FINAL BALANCES']);
    expect(item(empty)).toEqual(['All balanced']);
  });

  it('looks the recipient payment up by name and passes it down', () => {
    const [payout] = listOf([grp('Ada', 70)], [], true);
    const payment: PreferredPayment = { method: 'venmo', handle: 'ada-l' };
    const withPayment = item(payout, deps({ paymentByName: new Map([['Ada', payment]]) }));
    expect(withPayment).toContain('Pay');
    expect(withPayment.join(' ')).toContain('ada-l');
    // ...and no Pay button when the map has no entry for that name.
    expect(item(payout)).not.toContain('Pay');
  });
});

/** Flattened style of the OUTERMOST styled node — depth-first, so it is the root. */
const outerStyle = (it: SummaryListItem): Record<string, any> => {
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(renderSummaryItem(it, deps())); });
  const [outer] = tree.root.findAll((n) => !!n.props?.style);
  return StyleSheet.flatten(outer.props.style) ?? {};
};

describe('the gap above FINAL BALANCES is 32 from every predecessor', () => {
  /**
   * Yoga does NOT collapse adjacent margins, so the rendered gap above the section
   * header is `listSectionHeader.marginTop` PLUS whatever the item above it carries.
   * buildSummaryListData can put three different things there — a settlement card, a
   * banker payout row, or the empty state — and the summary screens' 32pt section gap
   * only holds if all three contribute the same 8.
   *
   * The empty state carries none of its own (summaryStyles.emptyState is padding, not
   * margin); summaryStyles.emptyGap in SummaryView is what supplies it. Without that
   * wrapper the gap renders 24 on a balanced table and on the shared screen's chip
   * filter "nothing to settle" path, and 32 everywhere else — a difference tsc cannot
   * see and no other test in this repo touches.
   */
  const SECTION_GAP = 32;

  const cases: Array<[string, () => SummaryListItem]> = [
    ['a settlement card', () => listOf([grp('Ada', 30)], [], false)[0]],
    ['a banker payout row', () => listOf([grp('Ada', 30)], [], true)[0]],
    ['the empty state', () => listOf([], [], false)[0]],
  ];

  it.each(cases)('%s', (_label, makePredecessor) => {
    const predecessor = makePredecessor();
    const header = listOf([], [], false).find((i) => i.type === 'sectionHeader')!;
    // Both halves asserted, not just the sum: a compensating pair of wrong numbers
    // would still add to 32.
    expect(outerStyle(header).marginTop).toBe(24);
    expect(outerStyle(predecessor).marginBottom).toBe(8);
    expect(outerStyle(header).marginTop + outerStyle(predecessor).marginBottom).toBe(SECTION_GAP);
  });
});
