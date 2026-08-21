/**
 * PaymentEditorContent is fill-many: one row per PAYMENT_METHODS entry, each with its
 * own handle input, plus a per-row control that marks one row the default. Save collapses
 * that local state through applyPaymentInvariant into a single PaymentCarrier.
 *
 * @testing-library/react-native is NOT a dependency of this project (frontend/package.json
 * devDependencies: @types/jest, @types/react, baseline-browser-mapping, jest, jest-expo,
 * react-test-renderer, typescript) — see AppModal.test.tsx for the established
 * react-test-renderer + act pattern this file follows instead.
 *
 * PaymentEditorContent renders inside AppModalCard and uses ModalButton for Save/Cancel.
 * No suite in this repo has rendered a tree containing ModalButton before this one: it pulls
 * in react-native-gesture-handler (Gesture.Tap/GestureDetector) and react-native-reanimated
 * (runOnJS), and AppModalCard itself imports useAnimatedKeyboard/useAnimatedStyle/
 * useSharedValue at module scope (only exercised on iOS, but still imported under
 * jest-expo/node's Platform.OS === 'web'). The mock block below merges what
 * AppModal.test.tsx establishes for AppModalCard with what SummaryView.test.tsx
 * establishes for Gesture/GestureDetector/runOnJS.
 *
 * ModalButton exposes no testID and no pressable host node under react-native-web — its
 * only surface is a GestureDetector wrapping an Animated.View. Precedent for firing a
 * component's onPress directly via its React props (rather than a host-node press event)
 * is PlayerFilterChips.test.tsx:53, though that component is a plain TouchableOpacity, not
 * a gesture-wrapped button — this file establishes the pattern for ModalButton.
 *
 * Do NOT render a FlatList here — under jest-expo/node it never returns and survives
 * jest's testTimeout. Nothing in this component tree uses one; ScrollView renders fine.
 */
import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// jest-expo/node has no DOM — `document` is undefined. react-native-web's TextInput reads
// `document.activeElement` (unconditionally, with no canUseDOM guard, unlike its other DOM
// reads) in a useLayoutEffect that runs on every mount, so rendering ANY TextInput here throws
// `ReferenceError: document is not defined` without this stub. Read-only comparison target —
// no test in this file interacts with real DOM focus, so `null` is all it needs to be.
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
import ModalButton from '@/components/ModalButton';

const noop = () => {};

function renderEditor(props: Partial<React.ComponentProps<typeof PaymentEditorContent>> = {}) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <PaymentEditorContent player={null} onSave={noop} onClose={noop} {...props} />,
    );
  });
  return tree;
}

/** The single row testID, or undefined if that row is not rendered (e.g. cash's input). */
function byTestId(tree: ReactTestRenderer, testID: string) {
  const found = tree.root.findAllByProps({ testID });
  return found[0];
}

/** Save is the confirm-variant ModalButton — fired via its onPress prop (see file header). */
function pressSave(tree: ReactTestRenderer) {
  const save = tree.root.findAllByType(ModalButton).find(b => b.props.variant === 'confirm');
  act(() => { save!.props.onPress(); });
}

describe('PaymentEditorContent', () => {
  it('renders one handle input per handle-taking method', () => {
    const tree = renderEditor();
    expect(byTestId(tree, 'payment-input-venmo')).toBeTruthy();
    expect(byTestId(tree, 'payment-input-zelle')).toBeTruthy();
    expect(byTestId(tree, 'payment-input-cash')).toBeUndefined();
  });

  it('seeds every row from the player map', () => {
    const tree = renderEditor({
      player: { methods: { venmo: 'alice', zelle: 'a@x.com' }, defaultMethod: 'zelle' },
    });
    expect(byTestId(tree, 'payment-input-venmo').props.value).toBe('alice');
    expect(byTestId(tree, 'payment-input-zelle').props.value).toBe('a@x.com');
  });

  it('saves only filled rows, and makes the first filled row the default', () => {
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText('alice'); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { venmo: 'alice' }, defaultMethod: 'venmo' });
  });

  it('auto-defaults to the first row TYPED into, not PAYMENT_METHODS declaration order', () => {
    // With only one row ever filled, applyPaymentInvariant's own filled[0] fallback would
    // produce the same defaultMethod regardless of whether the editor's auto-default runs at
    // all — that case cannot distinguish the two. Zelle sits AFTER Venmo in declaration order
    // (constants/PaymentMethods.ts), so typing zelle first and venmo second only comes out
    // 'zelle' if the editor's own typing-order auto-default fired; a defaultMethod resolved
    // instead from declaration order would give 'venmo'.
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    act(() => { byTestId(tree, 'payment-input-zelle').props.onChangeText('z'); });
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText('v'); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({
      methods: { venmo: 'v', zelle: 'z' },
      defaultMethod: 'zelle',
    });
  });

  it('saves several methods at once, keeping the chosen default', () => {
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText('alice'); });
    act(() => { byTestId(tree, 'payment-input-zelle').props.onChangeText('a@x.com'); });
    act(() => { byTestId(tree, 'payment-default-zelle').props.onPress(); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({
      methods: { venmo: 'alice', zelle: 'a@x.com' },
      defaultMethod: 'zelle',
    });
  });

  it('keeps the default as a label-only entry when its handle is cleared', () => {
    const onSave = jest.fn();
    const tree = renderEditor({
      player: { methods: { venmo: 'alice' }, defaultMethod: 'venmo' },
      onSave,
    });
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText(''); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { venmo: '' }, defaultMethod: 'venmo' });
  });

  it('drops a handle-less row when the default moves off it', () => {
    // The other half of the fall-through rule: moving the default OFF a handle-less row
    // (rather than clearing the current default's handle) drops that row entirely, since
    // a non-default row is only saved when it has a handle.
    const onSave = jest.fn();
    const tree = renderEditor({
      player: { methods: { venmo: '' }, defaultMethod: 'venmo' },
      onSave,
    });
    act(() => { byTestId(tree, 'payment-input-zelle').props.onChangeText('a@x.com'); });
    act(() => { byTestId(tree, 'payment-default-zelle').props.onPress(); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { zelle: 'a@x.com' }, defaultMethod: 'zelle' });
  });

  it('saves cash as a handle-less default', () => {
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    act(() => { byTestId(tree, 'payment-default-cash').props.onPress(); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { cash: '' }, defaultMethod: 'cash' });
  });

  it('strips a typed affix so the handle is stored bare', () => {
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText('@alice'); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { venmo: 'alice' }, defaultMethod: 'venmo' });
  });

  it('does not let an affix-only keystroke claim the default', () => {
    // The user taps the Venmo field, types '@' out of habit, changes their mind, and
    // enters their real handle in Zelle. normalizeHandle('venmo', '@') is '', so Venmo
    // saves no handle at all — if that keystroke had claimed the default (the auto-default
    // is sticky: assigned only while prev === undefined, and the per-row dot can move it
    // but never unset it), applyPaymentInvariant would honour the explicit 'venmo' default
    // and the handle the user actually entered would NOT be the one that leaves the device:
    // the badge would read "Venmo +1", the share message " (Venmo)" with no handle, and the
    // published /g/ snapshot {"method":"venmo"}.
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText('@'); });
    act(() => { byTestId(tree, 'payment-input-zelle').props.onChangeText('a@x.com'); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { zelle: 'a@x.com' }, defaultMethod: 'zelle' });
  });

  it('saves an empty carrier when nothing is filled', () => {
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({});
  });
});
