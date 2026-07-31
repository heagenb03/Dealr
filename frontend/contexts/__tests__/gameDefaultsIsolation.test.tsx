/**
 * Regression test for bug-364: account A's default settings applied to account B
 * on the same device.
 *
 * This exercises the PROVIDER, not just the storage helper — it is the test that
 * fails against the pre-fix context and passes after it.
 */
import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// --- mocks -----------------------------------------------------------------
// Firestore writes are irrelevant here; the leak is entirely local.
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => ({})),
  updateDoc: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/services/firebaseService', () => ({ db: {} }));

let mockAuth: { user: { uid: string } | null; userDoc: any } = { user: null, userDoc: null };
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

import { GameDefaultsProvider, useGameDefaults } from '@/contexts/GameDefaultsContext';
import { CurrencyProvider, useCurrency } from '@/contexts/CurrencyContext';

const UID_A = 'uid_a';
const UID_B = 'uid_b';

/** Captures the live context value so assertions can read it after each render. */
let seen: ReturnType<typeof useGameDefaults> | null = null;
function Probe() {
  seen = useGameDefaults();
  return null;
}

async function renderProvider() {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <GameDefaultsProvider>
        <Probe />
      </GameDefaultsProvider>
    );
  });
  return renderer!;
}

/** Re-render in place so provider state persists — this is the no-restart path. */
async function rerender(renderer: ReactTestRenderer) {
  await act(async () => {
    renderer.update(
      <GameDefaultsProvider>
        <Probe />
      </GameDefaultsProvider>
    );
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  seen = null;
  mockAuth = { user: null, userDoc: null };
});

describe('GameDefaultsProvider account isolation (bug-364)', () => {
  it('does not carry A’s default buy-in into B on sign-out -> sign-in (no restart)', async () => {
    // A signs in and sets a default buy-in.
    mockAuth = { user: { uid: UID_A }, userDoc: {} };
    const renderer = await renderProvider();
    await act(async () => {
      await seen!.setDefaultBuyIn(20);
    });
    expect(seen!.defaultBuyIn).toBe(20);

    // A signs out.
    mockAuth = { user: null, userDoc: null };
    await rerender(renderer);
    expect(seen!.defaultBuyIn).toBeUndefined();

    // B signs in on the same device, with no defaultBuyIn of their own.
    mockAuth = { user: { uid: UID_B }, userDoc: {} };
    await rerender(renderer);
    expect(seen!.defaultBuyIn).toBeUndefined();
  });

  it('does not carry A’s default buy-in into B on a COLD START', async () => {
    // A sets the value, then the app is torn down entirely.
    mockAuth = { user: { uid: UID_A }, userDoc: {} };
    const first = await renderProvider();
    await act(async () => {
      await seen!.setDefaultBuyIn(20);
    });
    await act(async () => {
      first.unmount();
    });

    // Fresh launch, B signed in: in-memory state is clean, so only the storage
    // key can leak here. This is the case a state-reset-only fix would miss.
    seen = null;
    mockAuth = { user: { uid: UID_B }, userDoc: {} };
    await renderProvider();
    expect(seen!.defaultBuyIn).toBeUndefined();
  });

  it('still restores B’s OWN value on a cold start with no user doc (offline)', async () => {
    mockAuth = { user: { uid: UID_B }, userDoc: {} };
    const first = await renderProvider();
    await act(async () => {
      await seen!.setDefaultBuyIn(5);
    });
    await act(async () => {
      first.unmount();
    });

    seen = null;
    mockAuth = { user: { uid: UID_B }, userDoc: null }; // offline: no doc
    await renderProvider();
    expect(seen!.defaultBuyIn).toBe(5);
  });

  it('keeps A and B independently set on the same device', async () => {
    mockAuth = { user: { uid: UID_A }, userDoc: {} };
    const renderer = await renderProvider();
    await act(async () => {
      await seen!.setDefaultBuyIn(20);
    });

    mockAuth = { user: { uid: UID_B }, userDoc: {} };
    await rerender(renderer);
    await act(async () => {
      await seen!.setDefaultBuyIn(5);
    });
    expect(seen!.defaultBuyIn).toBe(5);

    mockAuth = { user: { uid: UID_A }, userDoc: {} };
    await rerender(renderer);
    expect(seen!.defaultBuyIn).toBe(20);
  });

  it('leaks nothing across the other three defaults either', async () => {
    mockAuth = { user: { uid: UID_A }, userDoc: {} };
    const renderer = await renderProvider();
    await act(async () => {
      await seen!.setDefaultCashUnit(25);
      await seen!.setDefaultTolerance(10);
      await seen!.setDefaultSettlementMode('banker');
    });

    mockAuth = { user: { uid: UID_B }, userDoc: {} };
    await rerender(renderer);
    expect(seen!.defaultCashUnit).toBeUndefined();
    expect(seen!.defaultTolerance).toBeUndefined();
    expect(seen!.defaultSettlementMode).toBeUndefined();
  });

  it('prefers B’s own user doc over anything cached locally', async () => {
    mockAuth = { user: { uid: UID_A }, userDoc: {} };
    const renderer = await renderProvider();
    await act(async () => {
      await seen!.setDefaultBuyIn(20);
    });

    mockAuth = { user: { uid: UID_B }, userDoc: { defaultBuyIn: 50 } };
    await rerender(renderer);
    expect(seen!.defaultBuyIn).toBe(50);
  });

  // Without this, dropping the legacy keys is NOT lossless. An existing user's
  // first launch after the update can be offline, in which case AuthContext's
  // `unavailable` path leaves userDoc null on a cold start, the legacy key has
  // just been purged, and the namespaced key was never written — the value is
  // gone. It does not self-heal either: coming back online populates userDoc for
  // display but writes nothing locally, so every later offline start reverts.
  it('caches a doc-resolved value locally so it survives an offline cold start', async () => {
    // Value exists ONLY in the user doc — never set through the app on this device.
    mockAuth = { user: { uid: UID_B }, userDoc: { defaultBuyIn: 20 } };
    const first = await renderProvider();
    expect(seen!.defaultBuyIn).toBe(20);
    await act(async () => {
      first.unmount();
    });

    seen = null;
    mockAuth = { user: { uid: UID_B }, userDoc: null }; // offline: no doc at all
    await renderProvider();
    expect(seen!.defaultBuyIn).toBe(20);
  });

  it('caches a doc-resolved 0 (OFF) rather than treating it as nothing to cache', async () => {
    mockAuth = { user: { uid: UID_B }, userDoc: { defaultBuyIn: 0 } };
    const first = await renderProvider();
    await act(async () => {
      first.unmount();
    });

    seen = null;
    mockAuth = { user: { uid: UID_B }, userDoc: null };
    await renderProvider();
    expect(seen!.defaultBuyIn).toBe(0);
  });

  it('does not let the doc write-through clobber a newer local value', async () => {
    mockAuth = { user: { uid: UID_B }, userDoc: { defaultBuyIn: 20 } };
    const renderer = await renderProvider();
    await act(async () => {
      await seen!.setDefaultBuyIn(7); // user changes it while the doc still says 20
    });
    expect(seen!.defaultBuyIn).toBe(7);

    await act(async () => {
      renderer.unmount();
    });
    seen = null;
    mockAuth = { user: { uid: UID_B }, userDoc: null };
    await renderProvider();
    expect(seen!.defaultBuyIn).toBe(7);
  });

  it('preserves an explicit 0 (the OFF switch) from B’s user doc', async () => {
    mockAuth = { user: { uid: UID_A }, userDoc: {} };
    const renderer = await renderProvider();
    await act(async () => {
      await seen!.setDefaultBuyIn(20);
    });

    mockAuth = { user: { uid: UID_B }, userDoc: { defaultBuyIn: 0 } };
    await rerender(renderer);
    expect(seen!.defaultBuyIn).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CurrencyContext carries the identical defect shape, so it gets the identical
// coverage — currency is the most visible of the five, since it reformats every
// amount on screen.
// ---------------------------------------------------------------------------

let seenCurrency: ReturnType<typeof useCurrency> | null = null;
function CurrencyProbe() {
  seenCurrency = useCurrency();
  return null;
}

async function renderCurrency() {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <CurrencyProvider>
        <CurrencyProbe />
      </CurrencyProvider>
    );
  });
  return renderer!;
}

async function rerenderCurrency(renderer: ReactTestRenderer) {
  await act(async () => {
    renderer.update(
      <CurrencyProvider>
        <CurrencyProbe />
      </CurrencyProvider>
    );
  });
}

describe('CurrencyProvider account isolation (bug-364)', () => {
  beforeEach(() => {
    seenCurrency = null;
  });

  it('does not carry A’s currency into B on sign-out -> sign-in', async () => {
    mockAuth = { user: { uid: UID_A }, userDoc: {} };
    const renderer = await renderCurrency();
    await act(async () => {
      await seenCurrency!.setCurrency('JPY');
    });
    expect(seenCurrency!.currency).toBe('JPY');

    mockAuth = { user: { uid: UID_B }, userDoc: {} };
    await rerenderCurrency(renderer);
    expect(seenCurrency!.currency).toBe('USD');
  });

  it('does not carry A’s currency into B on a COLD START', async () => {
    mockAuth = { user: { uid: UID_A }, userDoc: {} };
    const first = await renderCurrency();
    await act(async () => {
      await seenCurrency!.setCurrency('JPY');
    });
    await act(async () => {
      first.unmount();
    });

    seenCurrency = null;
    mockAuth = { user: { uid: UID_B }, userDoc: {} };
    await renderCurrency();
    expect(seenCurrency!.currency).toBe('USD');
  });

  it('caches a doc-resolved currency locally so it survives an offline cold start', async () => {
    mockAuth = { user: { uid: UID_B }, userDoc: { currency: 'JPY' } };
    const first = await renderCurrency();
    expect(seenCurrency!.currency).toBe('JPY');
    await act(async () => {
      first.unmount();
    });

    seenCurrency = null;
    mockAuth = { user: { uid: UID_B }, userDoc: null };
    await renderCurrency();
    expect(seenCurrency!.currency).toBe('JPY');
  });

  it('still restores B’s OWN currency on a cold start with no user doc', async () => {
    mockAuth = { user: { uid: UID_B }, userDoc: {} };
    const first = await renderCurrency();
    await act(async () => {
      await seenCurrency!.setCurrency('EUR');
    });
    await act(async () => {
      first.unmount();
    });

    seenCurrency = null;
    mockAuth = { user: { uid: UID_B }, userDoc: null };
    await renderCurrency();
    expect(seenCurrency!.currency).toBe('EUR');
  });
});
