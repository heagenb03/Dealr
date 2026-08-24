/**
 * Mutation guards for the two payment-display changes made to the three player
 * card display sites (PlayerCardActive, PlayerCardCompleted, SavedPlayerCard)
 * in task 8 of the multiple-payment-methods spec:
 *
 * 1. The ABSENCE of a payment-method count. Each card shows the resolved DEFAULT
 *    method's label and handle and NOTHING about how many other methods exist.
 *    A "+N" suffix counting the other filled methods shipped in task 8 and was
 *    removed on request (2026-08-21) as noise. The two fixtures below are the
 *    shapes that used to render it — a filled default with another filled method,
 *    and a LABEL-ONLY default with another filled method. Both are kept because
 *    the two count formulas that shipped (`filter(m => m !== default).length` and
 *    the wrong count-the-filled-methods-minus-one) disagree only on the second shape, so
 *    a partial revert that reinstates either one goes red here.
 *
 * 2. The memo comparators (PlayerCardActive/PlayerCardCompleted only —
 *    SavedPlayerCard's was already fixed in task 3) now compare
 *    paymentSignature(prevProps.player) === paymentSignature(nextProps.player)
 *    instead of the two now-permanently-undefined preferredPayment?.method /
 *    .handle scalar fields. The banned alternative — comparing
 *    prev.player.methods === next.player.methods by REFERENCE — would also
 *    slip past a naive test: this file constructs the one case that
 *    discriminates it, a defaultMethod move where the methods map object is
 *    reused BY REFERENCE across renders (a legitimate shape: active.tsx can
 *    change which method is default without touching the handles map).
 *    Reference comparison sees the same methods object and wrongly bails;
 *    paymentSignature's signature string embeds the resolved default, so it
 *    correctly differs and forces a re-render.
 *
 * No other test in this repo renders these three components at all, so
 * without this file both regressions would be invisible — invisible-by-
 * construction guards are exactly the "cannot fail" failure mode this branch
 * has repeatedly shipped; this file exists so the failure is actually red.
 *
 * A FOURTH badge renderer exists and is NOT covered here: saved-players.tsx's
 * select-mode row builds its own string via `badgeText`, not a card component.
 * It cannot be reached by rendering (<SavedPlayersScreen>'s top-level FlatList
 * never returns under jest-expo/node), so it is tested by calling that function
 * directly, in app/(tabs)/(profile)/__tests__/saved-players-payment-editor.test.tsx.
 * Task 8's brief named only the three components above, which is exactly how that
 * renderer shipped WITHOUT the suffix the others had — so a change to what these
 * badges show has to be made in four places, not three.
 *
 * Swipeable/Reanimated/GestureHandler/Ionicons are inert under jest-expo/node
 * (no web implementation worth rendering) and are mocked to pass-throughs —
 * same recipe as summaryCards.test.tsx and saved-players-payment-editor.test.tsx.
 * CurrencyContext needs firebase/firestore + firebaseService + AuthContext
 * neutralized at module load, same recipe as currencyFormatterMemo.test.tsx.
 */
import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => ({ runOnJS: (fn: any) => fn }));
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
    TouchableOpacity: require('react-native').TouchableOpacity,
  };
});
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => ({})),
  updateDoc: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/services/firebaseService', () => ({
  auth: {},
  db: {},
  firebaseSignOut: jest.fn(),
  createUserDocument: jest.fn(),
  setProSince: jest.fn(),
  saveSavedPlayersToFirestore: jest.fn(() => Promise.resolve()),
  fetchSavedPlayersFromFirestore: jest.fn(() => Promise.resolve({ players: [], tombstones: {} })),
  isFirestoreOfflineError: jest.fn(() => false),
}));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, userDoc: null }),
}));

import { CurrencyProvider } from '@/contexts/CurrencyContext';
import PlayerCardActive from '@/components/PlayerCardActive';
import PlayerCardCompleted from '@/components/PlayerCardCompleted';
import SavedPlayerCard from '@/components/SavedPlayerCard';
import { Player } from '@/types/game';
import { SavedPlayer } from '@/services/savedPlayersService';

/** Every rendered string, in document order. */
const texts = (node: any, out: string[] = []): string[] => {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (node.children) node.children.forEach((c: any) => texts(c, out));
  return out;
};

async function renderWithCurrency(element: React.ReactElement): Promise<any> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<CurrencyProvider>{element}</CurrencyProvider>);
  });
  return tree.toJSON();
}

const render = (element: React.ReactElement) => {
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(element); });
  return tree.toJSON();
};

// Two filled methods, default = venmo -> exactly ONE "other" filled method (zelle).
const twoMethodPlayer: Player = {
  id: 'p1',
  name: 'Ada',
  methods: { venmo: 'ada-l', zelle: 'ada@x.com' },
  defaultMethod: 'venmo',
};

// Label-only default (no handle) with ONE other filled method. This is the shape that
// separates the two count formulas that shipped: `filter(m => m !== default).length`
// reads it as 1, the wrong count-the-filled-methods-minus-one reads it as 0. Keeping both
// fixtures means a partial revert reinstating EITHER formula goes red.
//
// The old "no +N" fixtures (cash-only, and a single filled method that IS the default)
// are gone: with the count removed, "renders no count" is true of every shape, so those
// two discriminated nothing any more.
const labelOnlyDefaultWithOtherFilled: Player = {
  id: 'p4',
  name: 'Dee',
  methods: { venmo: '', zelle: 'dee@x.com' },
  defaultMethod: 'venmo',
};

const noop = () => {};

describe('PlayerCardActive — payment badge carries no method count', () => {
  const card = (player: Player) => (
    <PlayerCardActive
      player={player}
      balance={undefined}
      onBuyIn={noop} onCashOut={noop} onComplete={noop} onDelete={noop}
      onRename={noop} onEditPayment={noop}
      reduceMotion={true}
    />
  );

  it('shows the default method and handle with nothing counted beside them', async () => {
    const rendered = texts(await renderWithCurrency(card(twoMethodPlayer))).join('');
    expect(rendered).toContain('Venmo · @ada-l');
    expect(rendered).not.toMatch(/\+\d/);
  });

  it('counts nothing when the default is label-only and another method is filled', async () => {
    const rendered = texts(await renderWithCurrency(card(labelOnlyDefaultWithOtherFilled))).join('');
    expect(rendered).toContain('Venmo');
    expect(rendered).not.toMatch(/\+\d/);
  });
});

describe('PlayerCardCompleted — payment badge carries no method count', () => {
  const card = (player: Player) => (
    <PlayerCardCompleted
      player={player}
      balance={undefined}
      onReactivate={noop} onDelete={noop}
      reduceMotion={true}
    />
  );

  it('shows the default method and handle with nothing counted beside them', async () => {
    const rendered = texts(await renderWithCurrency(card(twoMethodPlayer))).join('');
    expect(rendered).toContain('Venmo · @ada-l');
    expect(rendered).not.toMatch(/\+\d/);
  });

  it('counts nothing when the default is label-only and another method is filled', async () => {
    const rendered = texts(await renderWithCurrency(card(labelOnlyDefaultWithOtherFilled))).join('');
    expect(rendered).toContain('Venmo');
    expect(rendered).not.toMatch(/\+\d/);
  });
});

describe('SavedPlayerCard — payment badge carries no method count', () => {
  const twoMethodSaved: SavedPlayer = {
    id: 'sp1',
    name: 'Ada',
    methods: twoMethodPlayer.methods,
    defaultMethod: twoMethodPlayer.defaultMethod,
  };
  const labelOnlyDefaultSaved: SavedPlayer = {
    id: 'sp4',
    name: 'Dee',
    methods: labelOnlyDefaultWithOtherFilled.methods,
    defaultMethod: labelOnlyDefaultWithOtherFilled.defaultMethod,
  };
  const card = (player: SavedPlayer) => (
    <SavedPlayerCard
      player={player}
      onRename={noop} onEditPayment={noop} onDelete={noop}
      reduceMotion={true}
    />
  );

  it('shows the default method and handle with nothing counted beside them', () => {
    const rendered = texts(render(card(twoMethodSaved))).join('');
    expect(rendered).toContain('Venmo · @ada-l');
    expect(rendered).not.toMatch(/\+\d/);
  });

  it('counts nothing when the default is label-only and another method is filled', () => {
    const rendered = texts(render(card(labelOnlyDefaultSaved))).join('');
    expect(rendered).toContain('Venmo');
    expect(rendered).not.toMatch(/\+\d/);
  });
});

// A methods map object reused BY REFERENCE across renders, only the player's
// defaultMethod field differing. `prev.player.methods === next.player.methods`
// would see the same reference and wrongly bail out (stale badge); paymentSignature
// embeds the resolved default in its output, so it correctly forces a re-render.
const sharedMethods = { venmo: 'ada-v', zelle: 'ada-z' };
const defaultingVenmo: Player = { id: 'p1', name: 'Ada', methods: sharedMethods, defaultMethod: 'venmo' };
const defaultingZelle: Player = { id: 'p1', name: 'Ada', methods: sharedMethods, defaultMethod: 'zelle' };

describe('PlayerCardActive — memo comparator catches a default-method move behind a shared methods reference', () => {
  it('re-renders the badge when defaultMethod changes even though methods is the same object', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <CurrencyProvider>
          <PlayerCardActive
            player={defaultingVenmo}
            balance={undefined}
            onBuyIn={noop} onCashOut={noop} onComplete={noop} onDelete={noop}
            onRename={noop} onEditPayment={noop}
            reduceMotion={true}
          />
        </CurrencyProvider>
      );
    });
    expect(texts(tree.toJSON()).join('')).toContain('Venmo');

    await act(async () => {
      tree.update(
        <CurrencyProvider>
          <PlayerCardActive
            player={defaultingZelle}
            balance={undefined}
            onBuyIn={noop} onCashOut={noop} onComplete={noop} onDelete={noop}
            onRename={noop} onEditPayment={noop}
            reduceMotion={true}
          />
        </CurrencyProvider>
      );
    });
    expect(texts(tree.toJSON()).join('')).toContain('Zelle');
  });
});

describe('PlayerCardCompleted — memo comparator catches a default-method move behind a shared methods reference', () => {
  it('re-renders the badge when defaultMethod changes even though methods is the same object', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <CurrencyProvider>
          <PlayerCardCompleted
            player={defaultingVenmo}
            balance={undefined}
            onReactivate={noop} onDelete={noop}
            reduceMotion={true}
          />
        </CurrencyProvider>
      );
    });
    expect(texts(tree.toJSON()).join('')).toContain('Venmo');

    await act(async () => {
      tree.update(
        <CurrencyProvider>
          <PlayerCardCompleted
            player={defaultingZelle}
            balance={undefined}
            onReactivate={noop} onDelete={noop}
            reduceMotion={true}
          />
        </CurrencyProvider>
      );
    });
    expect(texts(tree.toJSON()).join('')).toContain('Zelle');
  });
});

describe('SavedPlayerCard — memo comparator catches a default-method move behind a shared methods reference', () => {
  it('re-renders the badge when defaultMethod changes even though methods is the same object', () => {
    const savedVenmo: SavedPlayer = { id: 'sp1', name: 'Ada', methods: sharedMethods, defaultMethod: 'venmo' };
    const savedZelle: SavedPlayer = { id: 'sp1', name: 'Ada', methods: sharedMethods, defaultMethod: 'zelle' };

    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <SavedPlayerCard
          player={savedVenmo}
          onRename={noop} onEditPayment={noop} onDelete={noop}
          reduceMotion={true}
        />
      );
    });
    expect(texts(tree.toJSON()).join('')).toContain('Venmo');

    act(() => {
      tree.update(
        <SavedPlayerCard
          player={savedZelle}
          onRename={noop} onEditPayment={noop} onDelete={noop}
          reduceMotion={true}
        />
      );
    });
    expect(texts(tree.toJSON()).join('')).toContain('Zelle');
  });
});
