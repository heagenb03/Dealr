import { buildAddPlayerPickerListData, PickerRowSource } from '@/utils/addPlayerPickerListData';

const row = (id: string, name: string, badge: string | null = null): PickerRowSource => ({ id, name, badge });
const noneInGame = () => false;

describe('buildAddPlayerPickerListData', () => {
  it('returns no items for an empty saved list', () => {
    expect(buildAddPlayerPickerListData([], noneInGame, false)).toEqual([]);
  });

  it('marks a single row as both first and last', () => {
    expect(buildAddPlayerPickerListData([row('s1', 'Ada', 'Venmo · @ada')], noneInGame, false)).toEqual([
      {
        type: 'savedRow',
        key: 's1',
        id: 's1',
        name: 'Ada',
        badge: 'Venmo · @ada',
        inGame: false,
        disabled: false,
        isFirst: true,
        isLast: true,
      },
    ]);
  });

  it('marks only the final row as last across many rows', () => {
    const items = buildAddPlayerPickerListData(
      [row('s1', 'Ada'), row('s2', 'Bob'), row('s3', 'Cyd')],
      noneInGame,
      false,
    );
    expect(items.map(i => i.isLast)).toEqual([false, false, true]);
  });

  it('marks only the opening row as first across many rows', () => {
    const items = buildAddPlayerPickerListData(
      [row('s1', 'Ada'), row('s2', 'Bob'), row('s3', 'Cyd')],
      noneInGame,
      false,
    );
    expect(items.map(i => i.isFirst)).toEqual([true, false, false]);
  });

  it('disables a row whose name is already in the game and flags it inGame', () => {
    const items = buildAddPlayerPickerListData(
      [row('s1', 'Ada'), row('s2', 'Bob')],
      name => name === 'Ada',
      false,
    );
    expect(items.map(i => [i.inGame, i.disabled])).toEqual([[true, true], [false, false]]);
  });

  it('disables every row at the player cap without marking any inGame', () => {
    const items = buildAddPlayerPickerListData([row('s1', 'Ada'), row('s2', 'Bob')], noneInGame, true);
    expect(items.every(i => i.disabled)).toBe(true);
    expect(items.every(i => !i.inGame)).toBe(true);
  });

  it('preserves the caller-supplied order', () => {
    const items = buildAddPlayerPickerListData([row('s2', 'Zed'), row('s1', 'Ada')], noneInGame, false);
    expect(items.map(i => i.name)).toEqual(['Zed', 'Ada']);
  });
});
