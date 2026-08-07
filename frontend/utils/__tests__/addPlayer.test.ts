import { isNameTakenInGame, findPlayerByName, matchSavedByExactName, filterSavedByQuery, formatAddedConfirmation, singleExactSavedMatch, isLastAddVisibleInList, shouldShowAddedConfirmation, sortSavedByName, isLosslessUndo, addedConfirmationPlacement, postAddFocusTarget } from '../addPlayer';
import type { Player, Transaction } from '@/types/game';
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

describe('findPlayerByName', () => {
  it('finds an exact match', () => {
    expect(findPlayerByName([player('Gabe')], 'Gabe')?.id).toBe('p_Gabe');
  });
  it('matches case-insensitively and trimmed', () => {
    expect(findPlayerByName([player('Gabe')], '  gabe ')?.id).toBe('p_Gabe');
  });
  it('finds a completed player', () => {
    expect(findPlayerByName([player('Gabe', true)], 'Gabe')?.id).toBe('p_Gabe');
  });
  it('returns null for a distinct name', () => {
    expect(findPlayerByName([player('Gabe')], 'Gabe B')).toBeNull();
  });
  it('returns null for an empty/whitespace name', () => {
    expect(findPlayerByName([player('Gabe')], '   ')).toBeNull();
  });
  // Pins the `if (!target) return null` guard. The whitespace test above cannot: with no
  // blank-named player in the roster the find misses regardless. Only a blank-named player
  // makes the guard load-bearing — without it, norm('  ') === norm('   ') === '' matches.
  it('returns null for a blank query even when the roster holds a blank-named player', () => {
    const roster = [{ id: 'blank', name: '   ' }] as Player[];
    expect(findPlayerByName(roster, '  ')).toBeNull();
  });
  it('returns null for an empty roster', () => {
    expect(findPlayerByName([], 'Gabe')).toBeNull();
  });
  it('returns the first match when legacy data holds duplicates', () => {
    const dupes = [{ id: 'a', name: 'Gabe' }, { id: 'b', name: 'gabe' }] as Player[];
    expect(findPlayerByName(dupes, 'GABE')?.id).toBe('a');
  });

  // The pair MUST agree: "Added ✓" comes from isNameTakenInGame and the undo target from
  // findPlayerByName. If they ever diverge, the row shows an Undo that does nothing.
  it('agrees with isNameTakenInGame on every case', () => {
    const roster = [player('Gabe'), player('Mike', true)];
    for (const q of ['Gabe', '  gabe ', 'MIKE', 'Gabe B', '   ', '']) {
      expect(findPlayerByName(roster, q) !== null).toBe(isNameTakenInGame(roster, q));
    }
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

describe('shouldShowAddedConfirmation', () => {
  const mike = saved('Mike');
  const visibleWithMike = [mike];
  const playersWithMike = [player('Mike')];

  it('shows when an amount is present, even though the row is already visible in the list', () => {
    expect(
      shouldShowAddedConfirmation('Added Mike · $20.00 · 3 total', 20, 'Mike', visibleWithMike, playersWithMike),
    ).toBe(true);
  });

  it('suppresses when there is no amount and the row is already visible in the list', () => {
    expect(
      shouldShowAddedConfirmation('Added Mike · 3 total', null, 'Mike', visibleWithMike, playersWithMike),
    ).toBe(false);
  });

  it('shows when there is no amount but the row is not visible in the list', () => {
    expect(
      shouldShowAddedConfirmation('Added Dave · 3 total', null, 'Dave', visibleWithMike, playersWithMike),
    ).toBe(true);
  });

  it('suppresses when there is no confirmation label at all, regardless of amount', () => {
    expect(shouldShowAddedConfirmation(null, 20, 'Mike', visibleWithMike, playersWithMike)).toBe(false);
  });
});

describe('sortSavedByName', () => {
  it('orders case-insensitively by name', () => {
    const list = [saved('mike'), saved('Alice'), saved('bob')];
    expect(sortSavedByName(list).map(p => p.name)).toEqual(['Alice', 'bob', 'mike']);
  });
  it('leaves an already-sorted list in the same order', () => {
    const list = [saved('Alice'), saved('bob'), saved('mike')];
    expect(sortSavedByName(list).map(p => p.name)).toEqual(['Alice', 'bob', 'mike']);
  });
  it('does not mutate the input array', () => {
    const list = [saved('mike'), saved('Alice')];
    sortSavedByName(list);
    expect(list.map(p => p.name)).toEqual(['mike', 'Alice']);
  });
  it('orders accented names via localeCompare', () => {
    const list = [saved('Zoe'), saved('Émile'), saved('Adam')];
    expect(sortSavedByName(list).map(p => p.name)).toEqual(['Adam', 'Émile', 'Zoe']);
  });
  it('returns an empty array unchanged', () => {
    expect(sortSavedByName([])).toEqual([]);
  });
});

describe('isLosslessUndo', () => {
  const DEFAULT = 20;
  const tx = (playerId: string, type: 'buyin' | 'cashout', amount: number): Transaction => ({
    id: `t_${playerId}_${type}_${amount}`,
    playerId,
    type,
    amount,
    timestamp: new Date(),
  });
  const gabe = player('Gabe');

  it('is true with no transactions at all', () => {
    expect(isLosslessUndo(gabe, [], DEFAULT, undefined)).toBe(true);
  });

  it('is true with exactly one buyin at the game default', () => {
    expect(isLosslessUndo(gabe, [tx('p_Gabe', 'buyin', 20)], DEFAULT, undefined)).toBe(true);
  });

  // A hand-typed amount is NOT reproducible by a re-tap — the re-add would use the default.
  it('is false with one buyin at a different amount', () => {
    expect(isLosslessUndo(gabe, [tx('p_Gabe', 'buyin', 47.5)], DEFAULT, undefined)).toBe(false);
  });

  it('is false with a rebuy on top of the default buyin', () => {
    const txs = [tx('p_Gabe', 'buyin', 20), tx('p_Gabe', 'buyin', 20)];
    expect(isLosslessUndo(gabe, txs, DEFAULT, undefined)).toBe(false);
  });

  it('is false when a cashout is present', () => {
    const txs = [tx('p_Gabe', 'buyin', 20), tx('p_Gabe', 'cashout', 35)];
    expect(isLosslessUndo(gabe, txs, DEFAULT, undefined)).toBe(false);
  });

  it('is false with a lone cashout and no buyin', () => {
    expect(isLosslessUndo(gabe, [tx('p_Gabe', 'cashout', 0)], DEFAULT, undefined)).toBe(false);
  });

  // Pins the `only.type === 'buyin'` clause. The existing lone-cashout case uses
  // amount 0, so it fails on the amount check and never exercises the type check.
  // A cashout that happens to equal the default must still be lossy: removing the
  // player would cascade-delete a real cashout.
  it('is false with a lone cashout whose amount equals the default', () => {
    expect(isLosslessUndo(gabe, [tx('p_Gabe', 'cashout', 20)], DEFAULT, undefined)).toBe(false);
  });

  // With no default configured there is no amount a re-tap would restore.
  it('is false when the game has no default buy-in', () => {
    expect(isLosslessUndo(gabe, [tx('p_Gabe', 'buyin', 20)], 0, undefined)).toBe(false);
  });

  // Pins the `gameDefaultBuyIn > 0` guard. The test above cannot: it uses a buyin of 20
  // against a default of 0, so the amount comparison returns false before the guard is
  // reached. Only amount === default === 0 exercises it. GameService.addTransaction
  // rejects totalAmount <= 0, so this state is not constructible through the app — the
  // guard is dead-defensive, and this test is what keeps it from being "simplified" away.
  it('is false for a zero-amount buyin when the game default is also zero', () => {
    expect(isLosslessUndo(gabe, [tx('p_Gabe', 'buyin', 0)], 0, undefined)).toBe(false);
  });

  it('is still true with no transactions even when the game has no default buy-in', () => {
    expect(isLosslessUndo(gabe, [], 0, undefined)).toBe(true);
  });

  // removePlayer silently resets settlementMode to 'optimal' and clears bankerPlayerId.
  // A re-add does not restore banker designation, so this is lossy by definition.
  it('is false when the player is the designated banker', () => {
    expect(isLosslessUndo(gabe, [], DEFAULT, 'p_Gabe')).toBe(false);
  });

  it('is true when someone ELSE is the banker', () => {
    expect(isLosslessUndo(gabe, [], DEFAULT, 'p_Mike')).toBe(true);
  });

  it('is false when the player has completed', () => {
    expect(isLosslessUndo(player('Gabe', true), [], DEFAULT, undefined)).toBe(false);
  });

  it('ignores other players transactions', () => {
    const txs = [tx('p_Mike', 'buyin', 20), tx('p_Mike', 'cashout', 90), tx('p_Gabe', 'buyin', 20)];
    expect(isLosslessUndo(gabe, txs, DEFAULT, undefined)).toBe(true);
  });

  it('is true with no transactions when the array holds only other players rows', () => {
    expect(isLosslessUndo(gabe, [tx('p_Mike', 'buyin', 20)], DEFAULT, undefined)).toBe(true);
  });
});

describe('addedConfirmationPlacement', () => {
  it('renders nothing when the whether-gate is closed', () => {
    expect(addedConfirmationPlacement(false, false, 5)).toBe('none');
  });

  // The invariant: while a name is being entered, the card shows only the name control,
  // the buy-in box, the save-player slot, and the Add button.
  it('renders nothing while a name is being entered, however many saved players', () => {
    expect(addedConfirmationPlacement(true, true, 5)).toBe('none');
    expect(addedConfirmationPlacement(true, true, 1)).toBe('none');
    expect(addedConfirmationPlacement(true, true, 0)).toBe('none');
  });

  it('floats the pill in the browse view once there are two rows to float over', () => {
    expect(addedConfirmationPlacement(true, false, 2)).toBe('pill');
    expect(addedConfirmationPlacement(true, false, 20)).toBe('pill');
  });

  // The pill is bottom-anchored, so with a single row it would cover that row's Undo
  // control; with no rows there is no list to float over at all.
  it('falls back to in-flow with fewer than two saved players', () => {
    expect(addedConfirmationPlacement(true, false, 1)).toBe('inline');
    expect(addedConfirmationPlacement(true, false, 0)).toBe('inline');
  });
});

describe('postAddFocusTarget', () => {
  it('returns the caret to the search box after a typed add', () => {
    expect(postAddFocusTarget(false, false)).toBe('search');
    expect(postAddFocusTarget(false, true)).toBe('search');
  });

  // The complaint this fixes: the host filtered the list, tapped a match, and the keyboard
  // they were about to reuse disappeared.
  it('keeps the keyboard up when a tap came from an active search', () => {
    expect(postAddFocusTarget(true, true)).toBe('search');
  });

  // Unchanged from today: a browse tap has the keyboard down already, and the tall browse
  // card is the state it should return to.
  it('leaves the keyboard down when a tap came from browsing', () => {
    expect(postAddFocusTarget(true, false)).toBe('dismiss');
  });
});
