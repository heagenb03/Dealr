// capCopy imports values (not just types) from savedPlayersService, which
// transitively imports firebaseService. That module initializes a real
// Firebase app at import time, which throws (auth/invalid-api-key) outside
// a configured environment. Stub it the same way savedPlayersService.test.ts
// does so importing capCopy never touches a real Firebase instance.
jest.mock('@/services/firebaseService', () => ({
  saveSavedPlayersToFirestore: jest.fn(() => Promise.resolve()),
  fetchSavedPlayersFromFirestore: jest.fn(() => Promise.resolve({ players: [], tombstones: {} })),
  isFirestoreOfflineError: jest.fn(() => false),
}));

import {
  PLAYERS_PAYWALL_MESSAGE,
  playerCapHint,
  savedCapCounter,
  savedCapModalNotice,
  savedCapPaywallMessage,
} from '../capCopy';

describe('PLAYERS_PAYWALL_MESSAGE', () => {
  it('names the real Pro cap and never claims unlimited', () => {
    expect(PLAYERS_PAYWALL_MESSAGE).toContain('50');
    expect(PLAYERS_PAYWALL_MESSAGE.toLowerCase()).not.toContain('unlimited');
  });
});

describe('playerCapHint', () => {
  it('states the free limit when exactly at it', () => {
    const s = playerCapHint(12, false);
    expect(s).toContain('12');
    expect(s).toContain('50');
    expect(s.toLowerCase()).not.toContain('unlimited');
  });

  // The downgrade case: 14 on the table, free cap is 12.
  it('leads with the real count when over the free cap', () => {
    const s = playerCapHint(14, false);
    expect(s).toContain('14');
    expect(s).toContain('12');
    expect(s).not.toMatch(/limit reached . 12 players/i);
  });

  it('does not present the cap as the user count when over cap', () => {
    expect(playerCapHint(14, false)).not.toMatch(/^12 players/);
  });

  // Newly reachable: before this change a Pro user could never hit a cap.
  it('uses Pro wording at the Pro cap, with no upgrade prompt', () => {
    const s = playerCapHint(50, true);
    expect(s).toContain('50');
    expect(s.toLowerCase()).not.toContain('upgrade');
    expect(s.toLowerCase()).not.toContain('free');
  });
});

describe('savedCapCounter', () => {
  it('reads as a plain fraction below the cap', () => {
    expect(savedCapCounter(9, false)).toBe('9 / 15 saved');
  });

  it('offers the upgrade at the free cap', () => {
    const s = savedCapCounter(15, false);
    expect(s).toContain('15');
    expect(s).toContain('200');
  });

  it('never renders count-over-cap as a fraction', () => {
    const s = savedCapCounter(40, false);
    expect(s).toContain('40');
    expect(s).not.toContain('40 / 15');
    expect(s).not.toContain('40/15');
  });

  it('reads as a plain fraction for Pro', () => {
    expect(savedCapCounter(150, true)).toBe('150 / 200 saved');
  });

  // Hardening: unreachable today (savedPlayersService clamps merges to
  // PRO_SAVED_CAP), but the copy must not mislabel 200 as a free-tier number
  // or render an ungrammatical count/cap fraction if a Pro user ever exceeds it.
  it('never mislabels the Pro cap as a free limit when a Pro user is over it', () => {
    const s = savedCapCounter(250, true);
    expect(s).toContain('250');
    expect(s).toContain('200');
    expect(s.toLowerCase()).not.toContain('free');
    expect(s).not.toContain('250 / 200');
    expect(s).not.toContain('250/200');
  });
});

describe('savedCapModalNotice', () => {
  it('shows a fraction at the cap', () => {
    expect(savedCapModalNotice(15, false)).toBe('Saved players full · 15/15');
  });

  it('never renders count-over-cap as a fraction', () => {
    const s = savedCapModalNotice(40, false);
    expect(s).toContain('40');
    expect(s).not.toContain('40/15');
  });

  // Hardening: same unreachable-today scenario as savedCapCounter above.
  it('never mislabels the Pro cap as a free limit when a Pro user is over it', () => {
    const s = savedCapModalNotice(250, true);
    expect(s).toContain('250');
    expect(s).toContain('200');
    expect(s.toLowerCase()).not.toContain('on free');
    expect(s).not.toContain('250/200');
  });
});

describe('savedCapPaywallMessage', () => {
  it('states the free limit at the cap', () => {
    const s = savedCapPaywallMessage(15, false);
    expect(s).toContain('15');
    expect(s).toContain('200');
  });

  // Today this says "You've saved 15 players" to someone holding 40.
  it('states the real count when over the cap', () => {
    const s = savedCapPaywallMessage(40, false);
    expect(s).toContain('40');
    expect(s).toContain('200');
    expect(s).not.toMatch(/saved 15 players/);
  });

  it('does not sell Pro to someone who already has it', () => {
    const s = savedCapPaywallMessage(200, true);
    expect(s).toContain('200');
    expect(s.toLowerCase()).not.toContain('free limit');
    expect(s.toLowerCase()).not.toContain('upgrade to pro');
  });
});
