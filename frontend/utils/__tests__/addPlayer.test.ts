import { isNameTakenInGame, matchSavedByExactName, filterSavedByQuery, formatAddedConfirmation, singleExactSavedMatch, isLastAddVisibleInList } from '../addPlayer';
import type { Player } from '@/types/game';
import type { SavedPlayer } from '@/services/savedPlayersService';

const player = (name: string, completed = false): Player => ({
  id: `p_${name}`,
  name,
  ...(completed ? { completedAt: new Date() } : {}),
});
const saved = (name: string): SavedPlayer => ({ id: `s_${name}`, name });

describe('isNameTakenInGame', () => {
  it('matches case-insensitively and trimmed', () => {
    expect(isNameTakenInGame([player('Gabe')], '  gabe ')).toBe(true);
  });
  it('counts completed players', () => {
    expect(isNameTakenInGame([player('Gabe', true)], 'Gabe')).toBe(true);
  });
  it('returns false for a distinct name', () => {
    expect(isNameTakenInGame([player('Gabe')], 'Gabe B')).toBe(false);
  });
  it('returns false for an empty/whitespace name', () => {
    expect(isNameTakenInGame([player('Gabe')], '   ')).toBe(false);
  });
});

describe('matchSavedByExactName', () => {
  it('returns the single exact match', () => {
    const list = [saved('Gabe'), saved('Mike')];
    expect(matchSavedByExactName(list, 'gabe').map(p => p.id)).toEqual(['s_Gabe']);
  });
  it('treats a substring as NOT an exact match', () => {
    expect(matchSavedByExactName([saved('Gabe')], 'Gab')).toEqual([]);
  });
  it('returns 2+ for legacy duplicate saved names', () => {
    const list = [{ id: 'a', name: 'Gabe' }, { id: 'b', name: 'gabe' }] as SavedPlayer[];
    expect(matchSavedByExactName(list, 'Gabe')).toHaveLength(2);
  });
  it('returns [] for an empty name', () => {
    expect(matchSavedByExactName([saved('Gabe')], '  ')).toEqual([]);
  });
});

describe('filterSavedByQuery', () => {
  it('substring-matches case-insensitively', () => {
    const list = [saved('Gabe'), saved('Mike')];
    expect(filterSavedByQuery(list, 'ab').map(p => p.id)).toEqual(['s_Gabe']);
  });
  it('empty query returns the same list reference (recent-first order preserved)', () => {
    const list = [saved('Gabe'), saved('Mike')];
    expect(filterSavedByQuery(list, '  ')).toBe(list);
  });
  it('no match returns []', () => {
    expect(filterSavedByQuery([saved('Gabe')], 'zzz')).toEqual([]);
  });
});

describe('formatAddedConfirmation', () => {
  it('returns null before any add (count 0)', () => {
    expect(formatAddedConfirmation(null, 0)).toBeNull();
    expect(formatAddedConfirmation('Mike', 0)).toBeNull();
  });

  it('returns null when there is no name, even if count > 0', () => {
    expect(formatAddedConfirmation(null, 2)).toBeNull();
    expect(formatAddedConfirmation('', 2)).toBeNull();
  });

  it('formats name and running total once at least one add', () => {
    expect(formatAddedConfirmation('Mike', 1)).toBe('Added Mike · 1 total');
    expect(formatAddedConfirmation('Gabe R.', 3)).toBe('Added Gabe R. · 3 total');
  });

  it('inserts the amount label between name and count when provided', () => {
    expect(formatAddedConfirmation('Mike', 3, '$20')).toBe('Added Mike · $20 · 3 total');
  });

  it('output is unchanged when no amount label is provided', () => {
    expect(formatAddedConfirmation('Mike', 3)).toBe('Added Mike · 3 total');
    expect(formatAddedConfirmation('Mike', 3, null)).toBe('Added Mike · 3 total');
  });

  it('still returns null before any add, amount label or not', () => {
    expect(formatAddedConfirmation(null, 0, '$20')).toBeNull();
    expect(formatAddedConfirmation('Mike', 0, '$20')).toBeNull();
  });
});

describe('singleExactSavedMatch', () => {
  it('returns the saved player when exactly one exact match', () => {
    const list = [saved('Mike'), saved('Gabe')];
    expect(singleExactSavedMatch(list, 'mike')?.id).toBe('s_Mike');
  });
  it('returns null when there is no exact match', () => {
    expect(singleExactSavedMatch([saved('Mike')], 'Mik')).toBeNull();
  });
  it('returns null for 2+ legacy duplicate exact matches (ambiguous)', () => {
    const list = [{ id: 'a', name: 'Mike' }, { id: 'b', name: 'mike' }] as SavedPlayer[];
    expect(singleExactSavedMatch(list, 'Mike')).toBeNull();
  });
  it('returns null for an empty/whitespace name', () => {
    expect(singleExactSavedMatch([saved('Mike')], '  ')).toBeNull();
  });
});

describe('isLastAddVisibleInList', () => {
  const mike = saved('Mike');
  it('true when last-added matches an in-game visible saved row', () => {
    expect(isLastAddVisibleInList('Mike', [mike], [player('Mike')])).toBe(true);
  });
  it('false when the matching saved row is not in the game', () => {
    expect(isLastAddVisibleInList('Mike', [mike], [player('Dave')])).toBe(false);
  });
  it('false when no visible saved row matches the name', () => {
    expect(isLastAddVisibleInList('Dave', [mike], [player('Dave')])).toBe(false);
  });
  it('false when lastAddedName is null or whitespace', () => {
    expect(isLastAddVisibleInList(null, [mike], [player('Mike')])).toBe(false);
    expect(isLastAddVisibleInList('  ', [mike], [player('Mike')])).toBe(false);
  });
});
