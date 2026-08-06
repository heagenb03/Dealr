import { buildSavedPlayersListData } from '@/utils/savedPlayersListData';

const p = (id: string, name: string) => ({ id, name });

describe('buildSavedPlayersListData', () => {
  it('emits a single empty item for no saved players', () => {
    expect(buildSavedPlayersListData([])).toEqual([{ type: 'empty', key: 'empty' }]);
  });

  it('emits one row for a single saved player, keyed by id', () => {
    expect(buildSavedPlayersListData([p('s1', 'Ada')])).toEqual([
      { type: 'savedPlayer', key: 's1', player: p('s1', 'Ada') },
    ]);
  });

  it('sorts case-insensitively by name', () => {
    const items = buildSavedPlayersListData([p('s1', 'zed'), p('s2', 'Ada'), p('s3', 'bob')]);
    expect(items.map(i => (i as any).player.name)).toEqual(['Ada', 'bob', 'zed']);
  });

  it('does not mutate the input array', () => {
    const input = [p('s1', 'Zed'), p('s2', 'Ada')];
    buildSavedPlayersListData(input);
    expect(input.map(x => x.name)).toEqual(['Zed', 'Ada']);
  });

  it('returns a fresh array identity each call so a memo dep change is observable', () => {
    const input = [p('s1', 'Ada')];
    expect(buildSavedPlayersListData(input)).not.toBe(buildSavedPlayersListData(input));
  });

  it('carries the caller\u2019s player object through untouched', () => {
    const rich = { id: 's1', name: 'Ada', preferredPayment: { method: 'venmo', handle: '@ada' } };
    const items = buildSavedPlayersListData([rich]);
    expect((items[0] as any).player).toBe(rich);
  });
});
