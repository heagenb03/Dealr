/**
 * Mutation guards for the two payment-display changes made to the three player
 * card display sites (PlayerCardActive, PlayerCardCompleted, SavedPlayerCard)
 * in task 8 of the multiple-payment-methods spec:
 *
 * 1. The "+N" payment-method-count badge. Each card shows the resolved DEFAULT
 *    method's label/handle, plus a "+N" suffix counting the OTHER filled
 *    methods (filledMethods(player).length - 1). A regression that always
 *    renders 0 extra methods, or never renders the suffix at all, would be
 *    invisible to every other suite in this repo.
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

// One filled method only -> zero "other" methods, no +N suffix expected.
const oneMethodPlayer: Player = {
  id: 'p2',
  name: 'Bob',
  methods: { cash: '' },
  defaultMethod: 'cash',
};

const noop = () => {};

describe('PlayerCardActive — payment badge +N count', () => {
  it('shows +1 when the player has one filled method beyond the default', async () => {
    const tree = await renderWithCurrency(
      <PlayerCardActive
        player={twoMethodPlayer}
        balance={undefined}
        onBuyIn={noop} onCashOut={noop} onComplete={noop} onDelete={noop}
        onRename={noop} onEditPayment={noop}
        reduceMotion={true}
      />
    );
    expect(texts(tree).join('')).toContain('+1');
  });

  it('shows no +N suffix when the player has exactly one filled method', async () => {
    const tree = await renderWithCurrency(
      <PlayerCardActive
        player={oneMethodPlayer}
        balance={undefined}
        onBuyIn={noop} onCashOut={noop} onComplete={noop} onDelete={noop}
        onRename={noop} onEditPayment={noop}
        reduceMotion={true}
      />
    );
    expect(texts(tree).join('')).not.toContain('+1');
  });
});

describe('PlayerCardCompleted — payment badge +N count', () => {
  it('shows +1 when the player has one filled method beyond the default', async () => {
    const tree = await renderWithCurrency(
      <PlayerCardCompleted
        player={twoMethodPlayer}
        balance={undefined}
        onReactivate={noop} onDelete={noop}
        reduceMotion={true}
      />
    );
    expect(texts(tree).join('')).toContain('+1');
  });

  it('shows no +N suffix when the player has exactly one filled method', async () => {
    const tree = await renderWithCurrency(
      <PlayerCardCompleted
        player={oneMethodPlayer}
        balance={undefined}
        onReactivate={noop} onDelete={noop}
        reduceMotion={true}
      />
    );
    expect(texts(tree).join('')).not.toContain('+1');
  });
});

describe('SavedPlayerCard — payment badge +N count', () => {
  const twoMethodSaved: SavedPlayer = {
    id: 'sp1',
    name: 'Ada',
    methods: twoMethodPlayer.methods,
    defaultMethod: twoMethodPlayer.defaultMethod,
  };
  const oneMethodSaved: SavedPlayer = {
    id: 'sp2',
    name: 'Bob',
    methods: oneMethodPlayer.methods,
    defaultMethod: oneMethodPlayer.defaultMethod,
  };

  it('shows +1 when the player has one filled method beyond the default', () => {
    const tree = render(
      <SavedPlayerCard
        player={twoMethodSaved}
        onRename={noop} onEditPayment={noop} onDelete={noop}
        reduceMotion={true}
      />
    );
    expect(texts(tree).join('')).toContain('+1');
  });

  it('shows no +N suffix when the player has exactly one filled method', () => {
    const tree = render(
      <SavedPlayerCard
        player={oneMethodSaved}
        onRename={noop} onEditPayment={noop} onDelete={noop}
        reduceMotion={true}
      />
    );
    expect(texts(tree).join('')).not.toContain('+1');
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
