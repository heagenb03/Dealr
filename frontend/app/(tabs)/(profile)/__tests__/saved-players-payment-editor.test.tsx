/**
 * Two regression tests for saved-players.tsx's payment-editor wiring (task 7 of the
 * multiple-payment-methods spec), both reproducing the screen's actual hook wiring against
 * the REAL PaymentEditorContent rather than importing the screen directly — it cannot be
 * rendered here: its top-level FlatList never returns under jest-expo/node and survives
 * jest's testTimeout (see PaymentEditorModal.test.tsx's header note, and CLAUDE.md/memory:
 * "Do not render a FlatList in a test"). Both harnesses reuse the mocks (reanimated,
 * gesture-handler, `document` stub) established in PaymentEditorModal.test.tsx.
 *
 * 1. R-23 (reference stability): the "Add player" flow renders PaymentEditorContent in
 *    place, passing it a synthetic target object it constructs itself. PaymentEditorContent's
 *    re-seed effect keys on [visible, player] (PaymentEditorModal.tsx), so if that target
 *    object were rebuilt on every render, ANY unrelated state change on the same screen while
 *    the overlay is open — most concretely, typing in the "Name" field right next to it —
 *    would re-fire the effect and silently wipe whatever the user is mid-typing into the
 *    payment rows. saved-players.tsx guards against this with
 *    `paymentPlayer = useMemo(..., [paymentTarget])`, deliberately excluding
 *    addName/addPayment from the dependency array.
 *
 * 2. Carry-forward write-back (clear vs. don't-touch): the edit flow wraps the editor's
 *    result in `paymentWriteBackPatch` before calling `updateSavedPlayer`, so a fully-cleared
 *    editor result (bare `{}`) is sent as an explicit `{methods: {}}` rather than being
 *    confused with updateSavedPlayer's own "don't touch payment" convention.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { TouchableOpacity } from 'react-native';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// jest-expo/node has no DOM — react-native-web's TextInput reads document.activeElement
// unconditionally in a mount-time useLayoutEffect. See PaymentEditorModal.test.tsx.
(global as any).document = { activeElement: null };

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: require('react-native').View },
  useAnimatedKeyboard: () => ({ height: { value: 0 } }),
  useAnimatedStyle: () => ({}),
  useSharedValue: (initial: number) => ({ value: initial }),
  runOnJS: (fn: any) => fn,
}));
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
    GestureHandlerRootView: require('react-native').View,
    Gesture: { Tap: build },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

import { PaymentEditorContent } from '@/components/PaymentEditorModal';
import { PaymentCarrier } from '@/types/game';
import { paymentWriteBackPatch } from '@/utils/paymentMethods';

type PaymentTarget = { kind: 'add' } | null;

/**
 * Reproduces saved-players.tsx's add-flow wiring: a discriminant `paymentTarget` gates the
 * in-place overlay, and `paymentPlayer` is memoized on `[paymentTarget]` ONLY — the same
 * dependency array as the production code (see saved-players.tsx's `paymentPlayer` useMemo).
 * `addName`/`addPayment` stand in for the screen's add-name TextInput and payment-so-far
 * state, both deliberately excluded from the deps.
 */
function AddFlowHarness() {
  const [paymentTarget, setPaymentTarget] = useState<PaymentTarget>(null);
  const [addName, setAddName] = useState('');
  const [addPayment, setAddPayment] = useState<PaymentCarrier | undefined>(undefined);

  const paymentPlayer = useMemo(() => {
    if (!paymentTarget) return null;
    return {
      id: 'add',
      name: addName || 'Player',
      methods: addPayment?.methods,
      defaultMethod: addPayment?.defaultMethod,
    };
    // addName/addPayment intentionally omitted — matches saved-players.tsx exactly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentTarget]);

  const handleSave = useCallback((payment: PaymentCarrier) => {
    setAddPayment(payment);
    setPaymentTarget(null);
  }, []);

  return (
    <>
      <TouchableOpacity testID="open-editor" onPress={() => setPaymentTarget({ kind: 'add' })} />
      {/* Stands in for the add-name TextInput's onChangeText firing while the overlay is open. */}
      <TouchableOpacity testID="type-name" onPress={() => setAddName('Bob')} />
      {paymentTarget?.kind === 'add' && (
        <PaymentEditorContent
          player={paymentPlayer}
          onSave={handleSave}
          onClose={() => setPaymentTarget(null)}
        />
      )}
    </>
  );
}

/**
 * Reproduces saved-players.tsx's edit-flow `handlePaymentSave` wiring exactly (see that
 * screen's `updateSavedPlayer(uid, paymentTarget.player.id, paymentWriteBackPatch(payment))`
 * call). `onPatch` stands in for the `updateSavedPlayer` call, capturing exactly the patch
 * argument saved-players.tsx would send.
 *
 * NOTE on what this test does and doesn't prove: applyPaymentInvariant only ever returns a
 * bare `{}` (no `methods` key) when the editor's target had NO resolvable default to begin
 * with — once a default is seeded (or set by typing/tapping in this session) it always
 * survives as at least a label-only entry, so "clear the one filled method on an already-
 * payment-bearing player" does NOT reach `{}` (verified: it produces
 * `{methods: {venmo: ''}, defaultMethod: 'venmo'}` instead, which needs no patch — see the
 * task-7 report for the full derivation). The seed below (`player: null`) is the one target
 * shape that DOES reach `{}`. For THIS call site specifically, that only happens when the
 * saved player had no payment already, i.e. paymentWriteBackPatch is a same-session no-op
 * here (methods/prev.methods are both already absent) — the real value of wrapping it is a
 * narrow async race (updateSavedPlayer re-reads the entry fresh from storage at save time,
 * not from the editor's open-time snapshot). This test only proves the mechanics — that the
 * wrap does what it's documented to do — not that this exact scenario is otherwise a live bug.
 */
function EditFlowHarness({ onPatch }: { onPatch: (patch: PaymentCarrier) => void }) {
  const handleSave = React.useCallback(
    (payment: PaymentCarrier) => { onPatch(paymentWriteBackPatch(payment)); },
    [onPatch],
  );
  return <PaymentEditorContent player={null} onSave={handleSave} onClose={() => {}} />;
}

function byTestId(tree: ReactTestRenderer, testID: string) {
  return tree.root.findAllByProps({ testID })[0];
}

function press(tree: ReactTestRenderer, testID: string) {
  act(() => { byTestId(tree, testID).props.onPress(); });
}

function pressSave(tree: ReactTestRenderer) {
  // ModalButton exposes no host-node press surface under react-native-web (see
  // PaymentEditorModal.test.tsx's header note) — fire onPress via its React props directly.
  const save = tree.root
    .findAllByProps({ variant: 'confirm' })
    .find((n) => typeof n.props.onPress === 'function');
  act(() => { save!.props.onPress(); });
}

describe('saved-players add-flow payment editor (R-23 reference stability)', () => {
  it('does not wipe a mid-typed payment row when the name field changes while the overlay is open', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<AddFlowHarness />); });

    press(tree, 'open-editor');
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText('mid-typed'); });

    // The state change that would re-render the parent while the overlay stays open.
    press(tree, 'type-name');

    expect(byTestId(tree, 'payment-input-venmo').props.value).toBe('mid-typed');
  });
});

describe('saved-players edit-flow write-back (carry-forward: clear vs. don’t-touch)', () => {
  it('turns a bare {} editor result into an explicit {methods: {}} before it reaches updateSavedPlayer', () => {
    const onPatch = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<EditFlowHarness onPatch={onPatch} />); });

    // No target, nothing typed/tapped — applyPaymentInvariant resolves no default at all,
    // so the editor's raw onSave result here is the bare {} (see PaymentEditorModal.test.tsx's
    // "saves an empty carrier when nothing is filled").
    pressSave(tree);

    // A bare {} would be indistinguishable from updateSavedPlayer's own "don't touch
    // payment" recency-bump convention (updateSavedPlayer(uid, sid, {})).
    expect(onPatch).toHaveBeenCalledWith({ methods: {} });
  });
});
