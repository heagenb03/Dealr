/**
 * Tests for the frame around the shared-game route.
 *
 * The load-bearing assertions here are the safe-area ones. SharedGameChrome
 * exists because /g/[shareId] used a hardcoded `paddingTop: 60` and
 * `paddingBottom: 34` — constants that happen to look right on one iPhone and
 * leave 56pt of dead space above the title on a 24pt Android status bar. These
 * tests pin that the padding now MOVES with the device, which a snapshot or a
 * "renders without crashing" test would not catch.
 *
 * Under jest-expo/node `react-native` resolves to react-native-web, so Gesture
 * Handler and Reanimated are mocked to pass-throughs the same way
 * summaryCards.test.tsx does — Button is built on both. This file's gesture
 * mock additionally RECORDS the built gesture, because Button has no onPress
 * prop to call: its tap arrives through `onFinalize`, and without capturing it
 * there is no way to prove Done does anything.
 *
 * NO FlatList is rendered here: a 3-row FlatList under jest-expo/node never
 * returns and survives jest's testTimeout. Chrome takes `children`, so the test
 * passes a plain Text and the list stays a device-QA item.
 */
import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text as RNText } from 'react-native';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// `mock`-prefixed so babel-jest allows the factories to close over them. Both
// are read at render time, not at mock time, so a test can reassign or drain
// them before rendering.
let mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
const mockTapGestures: { handlers: Record<string, any> }[] = [];

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock('react-native-gesture-handler', () => {
  const build = () => {
    const g: any = { handlers: {} };
    [
      'maxDuration', 'maxDistance', 'hitSlop', 'enabled',
      'onBegin', 'onEnd', 'onFinalize', 'requireExternalGestureToFail',
    ].forEach((m) => {
      g[m] = (fn: any) => { g.handlers[m] = fn; return g; };
    });
    mockTapGestures.push(g);
    return g;
  };
  return {
    Gesture: { Tap: build },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});
jest.mock('react-native-reanimated', () => ({ runOnJS: (fn: any) => fn }));

import SharedGameChrome from '@/components/summary/SharedGameChrome';
import Button from '@/components/Button';

const CHILD_MARKER = 'child content';

function render(onClose: () => void = jest.fn()) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SharedGameChrome onClose={onClose}>
        <RNText>{CHILD_MARKER}</RNText>
      </SharedGameChrome>,
    );
  });
  return tree;
}

/**
 * Flattened styles of every rendered node that has one. Position-independent on
 * purpose: react-native-web is free to add wrapper elements, and an assertion
 * that depends on "the first child of the root" would break on an upgrade
 * without the component changing at all.
 */
function allStyles(tree: ReactTestRenderer): Record<string, any>[] {
  return tree.root
    .findAll(node => !!node.props?.style)
    .map(node => StyleSheet.flatten(node.props.style) ?? {});
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(RNText)
    .map(n => n.props.children)
    .filter((c): c is string => typeof c === 'string');
}

beforeEach(() => {
  mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
  mockTapGestures.length = 0;
});

describe('chrome', () => {
  it('renders the CASH CAGE wordmark', () => {
    // The reason this component exists: /g/ sits outside (tabs), so it gets no
    // DynamicCashCageHeader and the top of the screen was blank.
    expect(texts(render())).toContain('CASH CAGE');
  });

  it('renders its children', () => {
    expect(texts(render())).toContain(CHILD_MARKER);
  });

  it('renders exactly one Done button', () => {
    // Three hand-rolled copies of this button used to live in [shareId].tsx —
    // one per load state. Chrome owns the only one now.
    // By component type, not by accessibility props: under jest-expo/node
    // react-native resolves to react-native-web, which rewrites
    // accessibilityRole/accessibilityLabel into role/aria-label on the host
    // element — so a props-based query finds either zero nodes or each button
    // twice (composite + host), and neither count means anything.
    const done = render().root.findAllByType(Button);
    expect(done).toHaveLength(1);
    expect(done[0].props.title).toBe('Done');
  });

  it('calls onClose when the Done tap completes', () => {
    const onClose = jest.fn();
    render(onClose);
    const onFinalize = mockTapGestures[mockTapGestures.length - 1].handlers.onFinalize;
    expect(typeof onFinalize).toBe('function');
    act(() => { onFinalize({}, true); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when the tap is cancelled', () => {
    // Guards the `success` branch in Button's onFinalize: a drag off the button
    // must not close the screen.
    const onClose = jest.fn();
    render(onClose);
    const onFinalize = mockTapGestures[mockTapGestures.length - 1].handlers.onFinalize;
    act(() => { onFinalize({}, false); });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('safe area', () => {
  it('takes its top padding from the device inset, not a constant', () => {
    expect(allStyles(render()).some(s => s.paddingTop === 59)).toBe(true);
  });

  it('follows a different device to a different top inset', () => {
    // A 24pt Android status bar. Under the old hardcoded 60 this number could
    // never change, which is the whole defect.
    mockInsets = { top: 24, bottom: 0, left: 0, right: 0 };
    const styles = allStyles(render());
    expect(styles.some(s => s.paddingTop === 24)).toBe(true);
    expect(styles.some(s => s.paddingTop === 59)).toBe(false);
  });

  it('uses the home-indicator inset for the bottom padding', () => {
    expect(allStyles(render()).some(s => s.paddingBottom === 34)).toBe(true);
  });

  it('floors the bottom padding at 20 on hardware with no bottom inset', () => {
    // Math.max, not `insets.bottom + 20`: adding would push Done 54pt off the
    // bottom of an iPhone. The floor only covers a 0-inset device.
    mockInsets = { top: 24, bottom: 0, left: 0, right: 0 };
    expect(allStyles(render()).some(s => s.paddingBottom === 20)).toBe(true);
  });
});
