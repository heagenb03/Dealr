/**
 * Fix B: CurrencyContext builds ONE Intl.NumberFormat per currency, not one per
 * formatAmount() call. At N=50 the active screen calls formatAmount 4x per card
 * (PlayerCardActive.tsx:106 twice, :141, :146) — ~200 constructions per mount
 * before this fix.
 *
 * Counting note: we replace Intl.NumberFormat with a counting wrapper rather than
 * using jest.spyOn, because spying on a constructor invoked with `new` is fiddly
 * and a mechanical failure here would read as a real regression.
 */
import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => ({})),
  updateDoc: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/services/firebaseService', () => ({ db: {} }));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, userDoc: null }),
}));

import { CurrencyProvider, useCurrency } from '@/contexts/CurrencyContext';

const RealNumberFormat = Intl.NumberFormat;
let constructions = 0;

function installCountingIntl() {
  constructions = 0;
  (Intl as any).NumberFormat = function (...args: any[]) {
    constructions += 1;
    return new (RealNumberFormat as any)(...args);
  };
}

function installThrowingIntl() {
  (Intl as any).NumberFormat = function () {
    throw new Error('no Intl in this runtime');
  };
}

afterEach(() => {
  (Intl as any).NumberFormat = RealNumberFormat;
});

let seen: ReturnType<typeof useCurrency> | null = null;
function Probe() {
  seen = useCurrency();
  return null;
}

async function renderProvider(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <CurrencyProvider>
        <Probe />
      </CurrencyProvider>
    );
  });
  return renderer!;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  seen = null;
});

describe('CurrencyContext formatter memoization', () => {
  it('constructs exactly one Intl.NumberFormat for 200 formatAmount calls', async () => {
    installCountingIntl();
    await renderProvider();
    for (let i = 0; i < 200; i += 1) {
      seen!.formatAmount(i);
    }
    expect(constructions).toBe(1);
  });

  it('still formats USD amounts exactly as before', async () => {
    await renderProvider();
    expect(seen!.formatAmount(1234.56)).toBe('$1,234.56');
    expect(seen!.formatAmount(0)).toBe('$0.00');
  });

  it('rebuilds the formatter once when the currency changes, and formats in it', async () => {
    installCountingIntl();
    await renderProvider();
    seen!.formatAmount(1);
    expect(constructions).toBe(1);

    await act(async () => {
      await seen!.setCurrency('JPY');
    });

    const expected = new RealNumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(1234.56);

    seen!.formatAmount(1234.56);
    expect(seen!.formatAmount(1234.56)).toBe(expected);
    expect(constructions).toBe(2);
  });

  it('falls back to symbol + toFixed when Intl.NumberFormat throws at CONSTRUCTION time', async () => {
    // Installed BEFORE render: after Fix B the construction happens during the
    // provider's render, so a mock installed after render would never reach it.
    installThrowingIntl();
    await renderProvider();
    expect(seen!.formatAmount(1234.56)).toBe('$1234.56');
  });
});
