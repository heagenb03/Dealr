/**
 * Structural tests for the summary card components extracted out of
 * app/(tabs)/(home)/game/summary.tsx.
 *
 * These assert rendered TEXT and accessibility labels — the things a human would
 * read off the screen. They do NOT and cannot assert layout, spacing or colour;
 * that is what the device-QA checklist beside this plan is for. Do not describe
 * them as proving the extraction is visually identical.
 *
 * Under jest-expo/node, `react-native` resolves to react-native-web and
 * Platform.OS is 'web'. Gesture Handler and Reanimated have no web
 * implementation worth rendering, so both are mocked to pass-throughs — the
 * gestures themselves are device-QA items.
 */
import React from 'react';
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

import BalanceCard from '@/components/summary/BalanceCard';
import SettlementCard from '@/components/summary/SettlementCard';
import SummaryEmptyState from '@/components/summary/SummaryEmptyState';
import SummaryHudHeader from '@/components/summary/SummaryHudHeader';
import { GroupedSettlement } from '@/utils/settlementUtils';
import { PlayerBalance, PreferredPayment } from '@/types/game';

/** Every rendered string, in document order. */
const texts = (node: any, out: string[] = []): string[] => {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (node.children) node.children.forEach((c: any) => texts(c, out));
  return out;
};

/** Every accessibilityLabel on the tree, in document order. */
const a11yLabels = (node: any, out: string[] = []): string[] => {
  if (node == null || typeof node === 'string') return out;
  if (Array.isArray(node)) { node.forEach((n) => a11yLabels(n, out)); return out; }
  const label = node.props?.accessibilityLabel ?? node.props?.['aria-label'];
  if (typeof label === 'string') out.push(label);
  if (node.children) node.children.forEach((c: any) => a11yLabels(c, out));
  return out;
};

const render = (element: React.ReactElement) => {
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(element); });
  return tree.toJSON();
};

/**
 * Stand-in formatters. Deliberately NOT the real ones from utils/currencyFormat —
 * these tests assert that whatever is INJECTED is what renders, so a recognisably
 * fake output is the point. The sign sits outside the symbol, matching how
 * Intl and netBalanceDisplay both place it ("-$3.8k", never "$-3.8k").
 */
const usd = (n: number) => `$${n.toFixed(2)}`;
const usdCompact = (n: number) => {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return abs >= 1000 ? `${sign}$${(abs / 1000).toFixed(1)}k` : `${sign}$${abs.toFixed(2)}`;
};

const balance = (over: Partial<PlayerBalance> = {}): PlayerBalance => ({
  playerId: 'p1',
  playerName: 'Ada',
  totalBuyins: 100,
  totalCashouts: 250,
  netBalance: 150,
  ...over,
} as PlayerBalance);

describe('SummaryHudHeader', () => {
  it('renders the label between two rules', () => {
    expect(texts(render(<SummaryHudHeader label="TOTAL POT" />))).toEqual(['TOTAL POT']);
  });
});

describe('SummaryEmptyState', () => {
  it('renders the label', () => {
    expect(texts(render(<SummaryEmptyState label="All balanced" icon="checkmark-circle-outline" />)))
      .toEqual(['All balanced']);
  });
});

describe('BalanceCard', () => {
  it('renders name, IN / OUT / NET labels and the injected compact amounts', () => {
    const json = render(
      <BalanceCard balance={balance()} reduceMotion={false} formatAmountCompact={usdCompact} />
    );
    expect(texts(json)).toEqual(['Ada', 'In', '$100.00', 'Out', '$250.00', 'Net', '+$150.00']);
  });

  it('formats through the INJECTED formatter, not the signed-in user currency', () => {
    const eur = (n: number) => `${n.toFixed(2)} €`;
    const json = render(
      <BalanceCard balance={balance()} reduceMotion={false} formatAmountCompact={eur} />
    );
    expect(texts(json)).toContain('100.00 €');
    expect(texts(json)).not.toContain('$100.00');
  });

  it('compacts through the injected formatter', () => {
    const json = render(
      <BalanceCard
        balance={balance({ totalBuyins: 5000, totalCashouts: 1200, netBalance: -3800 })}
        reduceMotion={false}
        formatAmountCompact={usdCompact}
      />
    );
    expect(texts(json)).toEqual(['Ada', 'In', '$5.0k', 'Out', '$1.2k', 'Net', '-$3.8k']);
  });

  it('renders the hint beside the name when given one', () => {
    const json = render(
      <BalanceCard
        balance={balance({ totalBuyins: 0, totalCashouts: 0, netBalance: 0 })}
        reduceMotion={false}
        hint="banker · not playing"
        formatAmountCompact={usdCompact}
      />
    );
    expect(texts(json)).toContain('banker · not playing');
  });

  it('speaks the COMPACT net in its accessibility label — WCAG 2.5.3 Label in Name', () => {
    // Deliberate: the card is accessibilityRole="button", so its accessible name
    // must contain its visible text. Do not "fix" this to the exact figure.
    const json = render(
      <BalanceCard
        balance={balance({ totalBuyins: 0, totalCashouts: 1500, netBalance: 1500 })}
        reduceMotion={false}
        formatAmountCompact={usdCompact}
      />
    );
    expect(a11yLabels(json)).toEqual(['Ada, Net: +$1.5k']);
  });
});

const group = (over: Partial<GroupedSettlement> = {}): GroupedSettlement => ({
  recipient: 'Ada',
  totalAmount: 70,
  payments: [{ from: 'Bob', amount: 30 }, { from: 'Carl', amount: 40 }],
  ...over,
});

describe('SettlementCard', () => {
  it('renders the recipient, the RECEIVES label and the injected total, collapsed by default', () => {
    const json = render(
      <SettlementCard groupedSettlement={group()} reduceMotion={false} formatAmount={usd} />
    );
    expect(texts(json)).toEqual(['Ada', 'RECEIVES', '$70.00']);
    // Collapsed: the FROM grid and its payer names must not be in the tree.
    expect(texts(json)).not.toContain('Bob');
  });

  it('formats through the INJECTED formatter', () => {
    const eur = (n: number) => `${n.toFixed(2)} €`;
    const json = render(
      <SettlementCard groupedSettlement={group()} reduceMotion={false} formatAmount={eur} />
    );
    expect(texts(json)).toContain('70.00 €');
  });

  it('renders the payee badge as "method · handle" when the recipient has a handle', () => {
    const payment: PreferredPayment = { method: 'venmo', handle: 'ada-l' };
    const json = render(
      <SettlementCard
        groupedSettlement={group()}
        reduceMotion={false}
        recipientPayment={payment}
        formatAmount={usd}
      />
    );
    expect(texts(json).some((t) => t.includes('·'))).toBe(true);
    expect(texts(json).join(' ')).toContain('ada-l');
  });

  it('renders the method label alone when the recipient has a method but no handle', () => {
    const payment: PreferredPayment = { method: 'cash' };
    const json = render(
      <SettlementCard
        groupedSettlement={group()}
        reduceMotion={false}
        recipientPayment={payment}
        formatAmount={usd}
      />
    );
    expect(texts(json).some((t) => t.includes('·'))).toBe(false);
  });

  it('announces the collapsed/expanded state on the toggle region', () => {
    const json = render(
      <SettlementCard groupedSettlement={group()} reduceMotion={false} formatAmount={usd} />
    );
    expect(a11yLabels(json)).toContain('Ada receives $70.00. Expand payment details.');
  });
});
