/**
 * Guards the region order inside AppModal's card: title, then the pinned
 * header, then the scrolling body, then the pinned footer. Reordering these
 * silently un-pins the Add Players modal's Done button.
 *
 * Under jest-expo/node Platform.OS resolves to 'web', so AndroidKavCard renders
 * and the iOS keyboard-lift path is NOT exercised. CardBody is shared by both
 * platform cards, which is why the ordering assertion still holds.
 */
import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { ScrollView, Text as RNText } from 'react-native';

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// AppModal imports these at module scope. Only the non-iOS card renders here, so
// these mocks exist to satisfy the imports — none of them is actually rendered.
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: require('react-native').View },
  useAnimatedKeyboard: () => ({ height: { value: 0 } }),
  useAnimatedStyle: () => ({}),
  useSharedValue: (initial: number) => ({ value: initial }),
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: require('react-native').View,
}));

import { AppModalCard } from '@/components/AppModal';

/** Flattens every rendered string into document order. */
const textsInOrder = (node: any, out: string[] = []): string[] => {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => textsInOrder(n, out));
    return out;
  }
  if (node.children) node.children.forEach((c: any) => textsInOrder(c, out));
  return out;
};

const renderCard = (props: Record<string, unknown>) => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <AppModalCard onClose={() => {}} title="TITLE" {...props}>
        <RNText>BODY</RNText>
      </AppModalCard>,
    );
  });
  return tree;
};

describe('AppModalCard regions', () => {
  it('renders the header above the body and the footer below it', () => {
    const tree = renderCard({
      header: <RNText>HEADER</RNText>,
      footer: <RNText>FOOTER</RNText>,
    });
    expect(textsInOrder(tree.toJSON())).toEqual(['TITLE', 'HEADER', 'BODY', 'FOOTER']);
  });

  it('renders neither region when they are not supplied', () => {
    const tree = renderCard({});
    expect(textsInOrder(tree.toJSON())).toEqual(['TITLE', 'BODY']);
  });

  it('renders a footer without a header', () => {
    const tree = renderCard({ footer: <RNText>FOOTER</RNText> });
    expect(textsInOrder(tree.toJSON())).toEqual(['TITLE', 'BODY', 'FOOTER']);
  });
});

describe('AppModalCard scrollBody', () => {
  it('wraps the body in a ScrollView by default', () => {
    const tree = renderCard({});
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(1);
  });

  it('renders no ScrollView when scrollBody is false', () => {
    const tree = renderCard({ scrollBody: false });
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  });

  it('keeps the title / header / body / footer order when scrollBody is false', () => {
    const tree = renderCard({
      scrollBody: false,
      header: <RNText>HEADER</RNText>,
      footer: <RNText>FOOTER</RNText>,
    });
    expect(textsInOrder(tree.toJSON())).toEqual(['TITLE', 'HEADER', 'BODY', 'FOOTER']);
  });
});
