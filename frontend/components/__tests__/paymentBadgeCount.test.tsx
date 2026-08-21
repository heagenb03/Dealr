/**
 * Mutation guard for the "+N" payment-method-count badge added to the three
 * player card display sites (PlayerCardActive, PlayerCardCompleted,
 * SavedPlayerCard) in task 8 of the multiple-payment-methods spec.
 *
 * Each card shows the resolved DEFAULT method's label/handle, plus a "+N"
 * suffix counting the OTHER filled methods (filledMethods(player).length - 1).
 * A regression that always renders 0 extra methods, or never renders the
 * suffix at all, would be invisible to every other suite in this repo — no
 * other test renders these three components. This file exists so that
 * regression is actually red, not just eyeballed (per the branch's repeated
 * "guard that cannot fail" lesson).
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
