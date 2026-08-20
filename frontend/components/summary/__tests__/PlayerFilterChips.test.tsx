import React from 'react';
import renderer, { act, ReactTestInstance } from 'react-test-renderer';
import { Text } from 'react-native';
import PlayerFilterChips from '@/components/summary/PlayerFilterChips';

// NO FlatList anywhere in this component — see the plan's Global Constraints.
// A 3-row FlatList under jest-expo/node never returns and hangs the whole suite.

function render(props: Partial<React.ComponentProps<typeof PlayerFilterChips>> = {}) {
  const onSelect = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <PlayerFilterChips
        names={['Ada', 'Bob', 'Cal']}
        selectedName={null}
        onSelect={onSelect}
        {...props}
      />,
    );
  });
  return { tree, onSelect };
}

function chipFor(tree: renderer.ReactTestRenderer, name: string): ReactTestInstance {
  return tree.root.findAll(
    node => node.props?.accessibilityRole === 'button' && node.props?.accessibilityLabel?.includes(name),
  )[0];
}

function labels(tree: renderer.ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map(n => n.props.children).filter(c => typeof c === 'string');
}

// Text is imported from react-native, not @/components/Themed: Themed's Text
// renders a react-native Text underneath, so findAllByType finds it either way.
// If labels() comes back empty on the first run, that is why — not a component bug.
describe('rendering', () => {
  it('renders one chip per name', () => {
    const { tree } = render();
    expect(labels(tree)).toEqual(['Ada', 'Bob', 'Cal']);
  });

  it('renders nothing at all for an empty name list', () => {
    const { tree } = render({ names: [] });
    expect(tree.toJSON()).toBeNull();
  });
});

describe('selection', () => {
  it('selects an unselected chip', () => {
    const { tree, onSelect } = render();
    act(() => { chipFor(tree, 'Bob').props.onPress(); });
    expect(onSelect).toHaveBeenCalledWith('Bob');
  });

  it('CLEARS when the already-selected chip is tapped again', () => {
    // Tapping again clears — the documented escape hatch. Without it a viewer
    // who taps the wrong name has no way back to the full list.
    const { tree, onSelect } = render({ selectedName: 'Bob' });
    act(() => { chipFor(tree, 'Bob').props.onPress(); });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('switches straight from one selection to another', () => {
    const { tree, onSelect } = render({ selectedName: 'Bob' });
    act(() => { chipFor(tree, 'Cal').props.onPress(); });
    expect(onSelect).toHaveBeenCalledWith('Cal');
  });
});

describe('accessibility', () => {
  it('reports selected state to assistive tech', () => {
    const { tree } = render({ selectedName: 'Bob' });
    expect(chipFor(tree, 'Bob').props.accessibilityState).toEqual({ selected: true });
    expect(chipFor(tree, 'Ada').props.accessibilityState).toEqual({ selected: false });
  });

  it('gives each chip a name-bearing label, per WCAG Label in Name', () => {
    // accessibilityRole="button" means the accessible name must CONTAIN the
    // visible text. This repo settled that question on the balance cards.
    const { tree } = render();
    expect(chipFor(tree, 'Ada').props.accessibilityLabel).toContain('Ada');
  });
});
