import { Player } from '@/types/game';
import { buildBankerPickerListData } from '@/utils/bankerPickerListData';

const mkPlayer = (id: string, name: string): Player => ({ id, name } as Player);

describe('buildBankerPickerListData', () => {
  it('returns no items for an empty roster', () => {
    expect(buildBankerPickerListData([], undefined)).toEqual([]);
  });

  it('projects a single player into one row keyed by player id', () => {
    expect(buildBankerPickerListData([mkPlayer('p1', 'Ada')], undefined)).toEqual([
      { type: 'playerRow', key: 'p1', id: 'p1', name: 'Ada', isSelected: false },
    ]);
  });

  it('preserves roster order across many players', () => {
    const items = buildBankerPickerListData(
      [mkPlayer('p1', 'Ada'), mkPlayer('p2', 'Bob'), mkPlayer('p3', 'Cyd')],
      undefined,
    );
    expect(items.map(i => i.name)).toEqual(['Ada', 'Bob', 'Cyd']);
  });

  it('marks exactly the selected banker', () => {
    const items = buildBankerPickerListData(
      [mkPlayer('p1', 'Ada'), mkPlayer('p2', 'Bob')],
      'p2',
    );
    expect(items.map(i => i.isSelected)).toEqual([false, true]);
  });

  it('marks nobody when the banker id matches no player', () => {
    const items = buildBankerPickerListData([mkPlayer('p1', 'Ada')], 'ghost');
    expect(items.every(i => !i.isSelected)).toBe(true);
  });
});
