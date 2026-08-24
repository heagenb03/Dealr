/**
 * PaymentEditorContent is add-then-fill: the editor opens showing ONLY the methods the player
 * already has, each with a full-width handle input, and a picker adds more. Save collapses
 * that local state through applyPaymentInvariant into a single PaymentCarrier.
 *
 * The row set IS `handles`' key set — a key present means "this player has this method", which
 * is exactly what handleSave already iterated (it skips `undefined` entries), so the save path
 * is unchanged from the show-all-seven-rows design this replaced.
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
  default: {
    View: require('react-native').View,
    // PaymentEditorContent's body is a Reanimated.ScrollView (it drives the bottom fade
    // from an animated scroll handler). Without this the body renders as undefined.
    ScrollView: require('react-native').ScrollView,
  },
  useAnimatedKeyboard: () => ({ height: { value: 0 } }),
  useAnimatedStyle: () => ({}),
  useAnimatedScrollHandler: () => () => {},
  useSharedValue: (initial: number) => ({ value: initial }),
  withTiming: (v: number) => v,
  runOnJS: (fn: any) => fn,
}));
// The add/remove controls are icon-led. Under jest-expo/node the real Ionicons resolves a
// font through the asset registry, which the preset does not provide — rendering one throws
// `Module "1" is missing from the asset registry`. Same stub as SummaryView.test.tsx:37; the
// testIDs this file queries sit on the surrounding TouchableOpacity, not on the icon.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
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

/** The single node with this testID, or undefined when it is not rendered. */
function byTestId(tree: ReactTestRenderer, testID: string) {
  const found = tree.root.findAllByProps({ testID });
  return found[0];
}

/**
 * Add a method the way a user does. The picker stands open on its own only while no method
 * has been added yet (that is the empty state); every later add needs the "Add method" row
 * first, so this presses it when the method's picker row is not already on screen.
 */
function addMethod(tree: ReactTestRenderer, key: string) {
  if (!byTestId(tree, 'payment-add-' + key)) {
    act(() => { byTestId(tree, 'payment-add-toggle').props.onPress(); });
  }
  act(() => { byTestId(tree, 'payment-add-' + key).props.onPress(); });
}

/** Save is the confirm-variant ModalButton — fired via its onPress prop (see file header). */
function pressSave(tree: ReactTestRenderer) {
  const save = tree.root.findAllByType(ModalButton).find(b => b.props.variant === 'confirm');
  act(() => { save!.props.onPress(); });
}

describe('PaymentEditorContent', () => {
  it('renders no method rows for a player who has none', () => {
    const tree = renderEditor();
    expect(byTestId(tree, 'payment-input-venmo')).toBeUndefined();
    expect(byTestId(tree, 'payment-input-zelle')).toBeUndefined();
  });

  it('opens the picker unprompted only while the player has no method', () => {
    // The empty state has nothing else on it, so an add control the user still has to find
    // would be the whole screen. Once a row exists the picker gets out of the way.
    const tree = renderEditor();
    expect(byTestId(tree, 'payment-add-venmo')).toBeTruthy();
    addMethod(tree, 'venmo');
    expect(byTestId(tree, 'payment-add-zelle')).toBeUndefined();
    expect(byTestId(tree, 'payment-add-toggle')).toBeTruthy();
  });

  it('offers only the methods not already added', () => {
    const tree = renderEditor({ player: { methods: { venmo: 'alice' }, defaultMethod: 'venmo' } });
    act(() => { byTestId(tree, 'payment-add-toggle').props.onPress(); });
    expect(byTestId(tree, 'payment-add-venmo')).toBeUndefined();
    expect(byTestId(tree, 'payment-add-zelle')).toBeTruthy();
  });

  it('renders an input for an added method, and none for handle-less cash', () => {
    const tree = renderEditor();
    addMethod(tree, 'venmo');
    addMethod(tree, 'cash');
    expect(byTestId(tree, 'payment-input-venmo')).toBeTruthy();
    expect(byTestId(tree, 'payment-input-cash')).toBeUndefined();
  });

  it('seeds every row from the player map', () => {
    const tree = renderEditor({
      player: { methods: { venmo: 'alice', zelle: 'a@x.com' }, defaultMethod: 'zelle' },
    });
    expect(byTestId(tree, 'payment-input-venmo').props.value).toBe('alice');
    expect(byTestId(tree, 'payment-input-zelle').props.value).toBe('a@x.com');
  });

  it('draws the dot from the first method but only makes it tappable from the second', () => {
    // With one row there is nothing to choose between, so a tappable dot would be a control
    // that cannot change anything — and tapping it WOULD change something it must not: it
    // would claim the default for a blank handle-taking row, saving a handle-less Venmo.
    // The dot is still DRAWN, as an inert marker, so adding a second method turns the marker
    // into a control without sliding every label 26pt to the right at the same time.
    const tree = renderEditor();
    addMethod(tree, 'venmo');
    expect(byTestId(tree, 'payment-default-venmo')).toBeUndefined();
    expect(byTestId(tree, 'payment-default-marker-venmo')).toBeTruthy();
    addMethod(tree, 'zelle');
    expect(byTestId(tree, 'payment-default-venmo')).toBeTruthy();
    expect(byTestId(tree, 'payment-default-zelle')).toBeTruthy();
    expect(byTestId(tree, 'payment-default-marker-venmo')).toBeUndefined();
  });

  it('marks the lone method as default only once it carries a handle', () => {
    // What the inert marker is FOR: hollow while the row would save nothing, filled once the
    // auto-default has something real to attach to. Asserted through the style rather than a
    // testID because filled and hollow are the same node — an assertion on the node alone
    // would pass in both states and prove nothing.
    const tree = renderEditor();
    addMethod(tree, 'venmo');
    const flat = (n: any) => JSON.stringify(n.props.style);
    expect(flat(byTestId(tree, 'payment-default-marker-venmo'))).not.toContain('#B072BB');
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText('alice'); });
    expect(flat(byTestId(tree, 'payment-default-marker-venmo'))).toContain('#B072BB');
  });

  it('saves only filled rows, and makes the first filled row the default', () => {
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    addMethod(tree, 'venmo');
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
    addMethod(tree, 'venmo');
    addMethod(tree, 'zelle');
    act(() => { byTestId(tree, 'payment-input-zelle').props.onChangeText('z'); });
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText('v'); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({
      methods: { venmo: 'v', zelle: 'z' },
      defaultMethod: 'zelle',
    });
  });

  it('does not let ADD ORDER claim the default before anything is typed', () => {
    // Adding a handle-taking method is now a deliberate tap, which makes it tempting to treat
    // that tap as the default-claiming act. It must not be, for the same reason as the
    // affix-only case below: a row the user added and then left blank saves no handle, so
    // honouring it as the default sends a handle-less method to the card badge, the share
    // message and the published /g/ snapshot while the handle they DID enter sits elsewhere.
    // Venmo is added FIRST and Zelle second, so add order and declaration order agree on
    // 'venmo' — only leaving the default unclaimed until a real handle is typed gives 'zelle'.
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    addMethod(tree, 'venmo');
    addMethod(tree, 'zelle');
    act(() => { byTestId(tree, 'payment-input-zelle').props.onChangeText('a@x.com'); });
    pressSave(tree);
    // The blank venmo row is KEPT (bug-416 — the user added it, so it survives to be filled
    // in later); this test is about which method holds the default, which is still zelle.
    expect(onSave).toHaveBeenCalledWith({
      methods: { venmo: '', zelle: 'a@x.com' },
      defaultMethod: 'zelle',
    });
  });

  it('saves several methods at once, keeping the chosen default', () => {
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    addMethod(tree, 'venmo');
    addMethod(tree, 'zelle');
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

  it('keeps a handle-less row when the default moves off it', () => {
    // Renamed and reversed at bug-416. This asserted that moving the default OFF a handle-less
    // row dropped that row entirely — the rule Heagen hit. Nothing here removes venmo: the user
    // adds zelle and hands it the default, and losing venmo on the way is the defect, not the
    // behaviour. What the move MUST do is carry the default, which is still asserted.
    const onSave = jest.fn();
    const tree = renderEditor({
      player: { methods: { venmo: '' }, defaultMethod: 'venmo' },
      onSave,
    });
    addMethod(tree, 'zelle');
    act(() => { byTestId(tree, 'payment-input-zelle').props.onChangeText('a@x.com'); });
    act(() => { byTestId(tree, 'payment-default-zelle').props.onPress(); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({
      methods: { venmo: '', zelle: 'a@x.com' },
      defaultMethod: 'zelle',
    });
  });

  it('adding cash claims the default, so a cash-only player saves something', () => {
    // Cash takes no handle, so adding it is the entire statement the user can make about it
    // and there is no keystroke left to claim the default with. applyPaymentInvariant keeps a
    // handle-less method ONLY when it is the default, so without this rule the tap produces
    // {} and Cash silently vanishes on save.
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    addMethod(tree, 'cash');
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { cash: '' }, defaultMethod: 'cash' });
  });

  it('does not let a later cash tap steal the default from a filled row', () => {
    // The claim above is conditional on nothing else holding the default yet — it must never
    // override a handle the user already entered. Cash is still SAVED, it just does not become
    // the default: this assertion read `{ venmo: 'alice' }` until bug-416, where dropping the
    // cash the user had just tapped turned out to be the reported bug rather than the point of
    // this test. Both halves are asserted here so a regression on either one fails.
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    addMethod(tree, 'venmo');
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText('alice'); });
    addMethod(tree, 'cash');
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({
      methods: { cash: '', venmo: 'alice' },
      defaultMethod: 'venmo',
    });
  });

  it('removing a method drops it from the saved carrier', () => {
    const onSave = jest.fn();
    const tree = renderEditor({
      player: { methods: { venmo: 'alice', zelle: 'a@x.com' }, defaultMethod: 'venmo' },
      onSave,
    });
    act(() => { byTestId(tree, 'payment-remove-zelle').props.onPress(); });
    expect(byTestId(tree, 'payment-input-zelle')).toBeUndefined();
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { venmo: 'alice' }, defaultMethod: 'venmo' });
  });

  it('hands the default to the first remaining filled row when the default is removed', () => {
    // Leaving defaultMethod pointed at a key that is no longer in the map falls through to
    // applyPaymentInvariant's filled[0] at save time, but the editor would show no dot filled
    // in the meantime. Reassigning on removal keeps state and UI saying the same thing.
    const onSave = jest.fn();
    const tree = renderEditor({
      player: { methods: { venmo: 'alice', zelle: 'a@x.com' }, defaultMethod: 'venmo' },
      onSave,
    });
    act(() => { byTestId(tree, 'payment-remove-venmo').props.onPress(); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { zelle: 'a@x.com' }, defaultMethod: 'zelle' });
  });

  it('hands the default to handle-less cash when no remaining row is filled', () => {
    // Same reassignment, through the branch a filled-row search cannot reach: Cash never has
    // a handle, so "first remaining filled row" finds nothing and the rule has to fall through
    // to it, or the surviving Cash row is dropped by the invariant and the save is empty.
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    addMethod(tree, 'cash');
    addMethod(tree, 'venmo');
    act(() => { byTestId(tree, 'payment-default-venmo').props.onPress(); });
    act(() => { byTestId(tree, 'payment-remove-venmo').props.onPress(); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { cash: '' }, defaultMethod: 'cash' });
  });

  it('prefers a filled row over a handle-less one that precedes it in declaration order', () => {
    // The two cases above cannot separate fallbackDefault's two branches: each has only one
    // candidate left, so a rule that searched handle-less rows FIRST would return the same
    // answer. Cash sits AHEAD of Venmo in PAYMENT_METHODS, so this is the case where the two
    // orderings disagree — 'cash' here would mean the surviving Venmo handle stops being what
    // the card badge, the share message and the /g/ snapshot show.
    const onSave = jest.fn();
    const tree = renderEditor({
      player: { methods: { cash: '', venmo: 'alice', zelle: 'z@x.com' }, defaultMethod: 'zelle' },
      onSave,
    });
    act(() => { byTestId(tree, 'payment-remove-zelle').props.onPress(); });
    pressSave(tree);
    // Only zelle was removed, so cash stays (bug-416 — it used to vanish here too, as
    // collateral of removing an unrelated method). The default still goes to venmo, not cash.
    expect(onSave).toHaveBeenCalledWith({
      methods: { cash: '', venmo: 'alice' },
      defaultMethod: 'venmo',
    });
  });

  it('reopens the picker when the last method is removed', () => {
    const tree = renderEditor({ player: { methods: { venmo: 'alice' }, defaultMethod: 'venmo' } });
    act(() => { byTestId(tree, 'payment-remove-venmo').props.onPress(); });
    expect(byTestId(tree, 'payment-add-zelle')).toBeTruthy();
  });

  it('strips a typed affix so the handle is stored bare', () => {
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    addMethod(tree, 'venmo');
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
    addMethod(tree, 'venmo');
    addMethod(tree, 'zelle');
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText('@'); });
    act(() => { byTestId(tree, 'payment-input-zelle').props.onChangeText('a@x.com'); });
    pressSave(tree);
    // The venmo row itself survives with no handle (bug-416): the user added it and did not
    // remove it. What must not happen is venmo holding the DEFAULT, which is what would send
    // a handle-less method to the badge, the share message and the /g/ snapshot.
    expect(onSave).toHaveBeenCalledWith({
      methods: { venmo: '', zelle: 'a@x.com' },
      defaultMethod: 'zelle',
    });
  });

  it('gives the picker a way back once the player has a method', () => {
    // The old exit was a "− Done adding" line at the BOTTOM of the scrolling list, which read
    // as a caption rather than a control. It is now a Done in the picker's own header row,
    // beside the "Add a method" label, where a header control belongs.
    const tree = renderEditor({ player: { methods: { venmo: 'alice' }, defaultMethod: 'venmo' } });
    act(() => { byTestId(tree, 'payment-add-toggle').props.onPress(); });
    expect(byTestId(tree, 'payment-picker-done')).toBeTruthy();
    act(() => { byTestId(tree, 'payment-picker-done').props.onPress(); });
    expect(byTestId(tree, 'payment-add-zelle')).toBeUndefined();
    expect(byTestId(tree, 'payment-input-venmo')).toBeTruthy();
  });

  it('offers no way out of the picker while the player has no method', () => {
    // The empty state IS the picker: there is no list behind it to go back to, so a Done
    // would leave a card with nothing on it but the control that dismissed everything.
    const tree = renderEditor();
    expect(byTestId(tree, 'payment-add-venmo')).toBeTruthy();
    expect(byTestId(tree, 'payment-picker-done')).toBeUndefined();
  });

  it('swaps the list for the picker instead of stacking one under the other', () => {
    // One viewport, two modes — which is what lets the card have a fixed maximum height at
    // all. Stacked, the cap would push the method rows out of view the moment the picker
    // opened, and the pinned Add method row would sit above a list it no longer applied to.
    const tree = renderEditor({ player: { methods: { venmo: 'alice' }, defaultMethod: 'venmo' } });
    act(() => { byTestId(tree, 'payment-add-toggle').props.onPress(); });
    expect(byTestId(tree, 'payment-input-venmo')).toBeUndefined();
    expect(byTestId(tree, 'payment-add-toggle')).toBeUndefined();
    expect(byTestId(tree, 'payment-add-zelle')).toBeTruthy();
  });

  it('renders a bottom scroll fade that never intercepts touches', () => {
    // What this can and cannot check: the fade's opacity comes from useAnimatedStyle, which
    // is mocked to {} here, so whether it actually tracks scroll position is NOT observable —
    // that arithmetic is pinned in utils/__tests__/scrollFade.test.ts instead. What IS worth
    // pinning here is that the overlay exists at all, and that it is transparent to touch: it
    // sits over the bottom 30pt of the list, which is exactly where a row's input lands when
    // the list is scrolled to the end.
    const tree = renderEditor();
    const fade = byTestId(tree, 'payment-scroll-fade');
    expect(fade).toBeTruthy();
    expect(fade.props.pointerEvents).toBe('none');
  });

  it('saves an empty carrier when nothing is filled', () => {
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({});
  });
});

/**
 * Heagen, testing the add-then-fill editor shipped in b14d1b3: "the non-default payments
 * are sometimes removing themselves after closing and reopening the modal."
 *
 * "Sometimes" is the tell. Presence in `handles` is an explicit user act now — a row exists
 * because the user tapped to add it — but the save path still prunes a non-default method
 * whose handle is empty, a rule written for the show-all-seven-rows editor where a row's
 * presence meant nothing. b14d1b3 covered exactly one case of the fallout (adding Cash
 * claims the default WHEN NONE IS SET) and left the rest, which is why it looks intermittent.
 */
describe('PaymentEditorContent — an added method survives the save (bug-416)', () => {
  it('keeps cash added AFTER another row already holds the default', () => {
    // The case b14d1b3's default-claiming rule cannot reach: `prev ?? m.key` is a no-op once
    // venmo holds the default, so cash stays non-default, has no handle by construction
    // (takesHandle: false), and the prune rule deletes the row the user just tapped.
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    addMethod(tree, 'venmo');
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText('alice'); });
    addMethod(tree, 'cash');
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({
      methods: { cash: '', venmo: 'alice' },
      defaultMethod: 'venmo',
    });
  });

  it('keeps a handle-taking row added and left blank', () => {
    // Add-then-fill's own intermediate state: the user adds Zelle meaning to type into it and
    // closes the modal first. The row is gone on reopen, so the add cannot be resumed.
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    addMethod(tree, 'venmo');
    act(() => { byTestId(tree, 'payment-input-venmo').props.onChangeText('alice'); });
    addMethod(tree, 'zelle');
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({
      methods: { venmo: 'alice', zelle: '' },
      defaultMethod: 'venmo',
    });
  });

  it('keeps a lone blank handle-taking row without giving it the default', () => {
    // Nothing typed means setDefaultMethod never fires (it is gated on the NORMALIZED value),
    // so this reaches applyPaymentInvariant with no explicit default at all. Two halves, both
    // load-bearing: the row must survive (it used to collapse the carrier to {} - bug-416),
    // and it must come back with NO default, or reopening the editor seeds one and the sticky
    // rule in setHandle can never fire again (bug-421).
    const onSave = jest.fn();
    const tree = renderEditor({ onSave });
    addMethod(tree, 'venmo');
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { venmo: '' } });
  });

  it('still drops a row the user explicitly removed', () => {
    // The counterpart the new rule must not break: keeping every PRESENT key is only correct
    // because removal deletes the key outright (removeMethod), not because it blanks it.
    const onSave = jest.fn();
    const tree = renderEditor({
      player: { methods: { venmo: 'alice', zelle: '' }, defaultMethod: 'venmo' },
      onSave,
    });
    act(() => { byTestId(tree, 'payment-remove-zelle').props.onPress(); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { venmo: 'alice' }, defaultMethod: 'venmo' });
  });
});

/**
 * bug-421. Heagen's gesture spans two openings of the editor, which is why every
 * single-session test above passes while the app gets it wrong:
 *
 *   1. Add Venmo, type nothing, Save.  -> saved as { venmo: '' }
 *   2. Reopen, add Cash App, type a handle, Save.
 *
 * Step 2's handle is the only thing the user ever typed, so it must hold the default. It did
 * not: step 1 persisted `defaultMethod: 'venmo'` (applyPaymentInvariant's `?? present[0]`),
 * the editor seeded that back as a chosen default, and setHandle's auto-assign is gated on
 * the default being unset. The badge, the share message and the published /g/ snapshot then
 * all read "Venmo" with no handle.
 */
describe('PaymentEditorContent - a blank row saved earlier does not own the default (bug-421)', () => {
  it('gives the default to the first handle typed after reopening', () => {
    const onSave = jest.fn();
    const tree = renderEditor({ player: { methods: { venmo: '' } }, onSave });
    addMethod(tree, 'cashapp');
    act(() => { byTestId(tree, 'payment-input-cashapp').props.onChangeText('alice'); });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({
      methods: { venmo: '', cashapp: 'alice' },
      defaultMethod: 'cashapp',
    });
  });

  it('leaves the lone marker hollow when the reopened row has no handle', () => {
    // Same defect seen on screen. The marker's contract is "hollow while the row would say
    // nothing, filled once there is a handle" - a fabricated default fills it on reopen for a
    // row the user never typed into. Asserted through the style because filled and hollow are
    // the same node.
    const tree = renderEditor({ player: { methods: { venmo: '' } } });
    const flat = (n: any) => JSON.stringify(n.props.style);
    expect(flat(byTestId(tree, 'payment-default-marker-venmo'))).not.toContain('#B072BB');
  });

  it('seeds the mount-time default from the chosen one, not just the re-open effect', () => {
    // visible={false} makes the re-seed effect return early, which is what makes this the
    // ONLY test that reaches the useState initializer. Every other test here mounts visible,
    // so the effect overwrites the initializer one commit later and a wrong initializer is
    // invisible to them. The overlay in saved-players.tsx really does mount while closed.
    const onSave = jest.fn();
    const tree = renderEditor({ player: { methods: { venmo: '' } }, visible: false, onSave });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({ methods: { venmo: '' } });
  });

  it('ignores a saved default that names a method the player does not have', () => {
    // A defaultMethod outside the map is the shape resolveDefaultMethod has a documented
    // fallback for, and the editor cannot represent it — there is no row to mark. Seeding it
    // anyway makes handleSave send it to applyPaymentInvariant, which honours an explicit
    // default by ADDING it to the map: a Venmo row the user never touched appears on save and
    // takes the default away from the handle they did type.
    const onSave = jest.fn();
    const tree = renderEditor({
      player: { methods: { cashapp: 'alice' }, defaultMethod: 'venmo' },
      onSave,
    });
    expect(byTestId(tree, 'payment-input-venmo')).toBeUndefined();
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({
      methods: { cashapp: 'alice' },
      defaultMethod: 'cashapp',
    });
  });

  it('keeps a blank default the user actually chose, and does not hand it to a filled row', () => {
    // The opposite direction, which the fix must NOT relax: an explicit defaultMethod on a
    // handle-less row survives a reopen-and-save untouched even though another row is filled.
    const onSave = jest.fn();
    const tree = renderEditor({
      player: { methods: { venmo: '', cashapp: 'alice' }, defaultMethod: 'venmo' },
      onSave,
    });
    pressSave(tree);
    expect(onSave).toHaveBeenCalledWith({
      methods: { venmo: '', cashapp: 'alice' },
      defaultMethod: 'venmo',
    });
  });
});
