import {
  SHARED_GAME_SCHEMA,
  buildSharedGameSnapshot,
  paymentMapFromSnapshot,
} from '@/utils/sharedGameSnapshot';
import { Game, PlayerBalance, Settlement } from '@/types/game';

const balances: PlayerBalance[] = [
  { playerId: 'p1', playerName: 'Ada', totalBuyins: 100, totalCashouts: 140, netBalance: 40 },
  { playerId: 'p2', playerName: 'Bob', totalBuyins: 100, totalCashouts: 60, netBalance: -40 },
];

const settlements: Settlement[] = [{ from: 'Bob', to: 'Ada', amount: 40 }];

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    name: 'Friday Night',
    date: new Date('2026-08-19T00:00:00.000Z'),
    status: 'completed',
    createdAt: new Date('2026-08-19T00:00:00.000Z'),
    currency: 'EUR',
    players: [
      { id: 'p1', name: 'Ada', methods: { venmo: 'ada-l' }, defaultMethod: 'venmo', savedPlayerId: 'saved-1' },
      { id: 'p2', name: 'Bob', methods: { cash: '' }, defaultMethod: 'cash' },
    ],
    transactions: [
      { id: 't1', playerId: 'p1', type: 'buyin', amount: 100, timestamp: new Date() },
    ],
    ...overrides,
  };
}

const inputs = { balances, settlements, totalPot: 200 };

describe('buildSharedGameSnapshot — what it carries', () => {
  it('projects the presentational fields', () => {
    const snap = buildSharedGameSnapshot({ game: makeGame(), ...inputs });
    expect(snap.gameName).toBe('Friday Night');
    expect(snap.date).toEqual(new Date('2026-08-19T00:00:00.000Z'));
    expect(snap.currency).toBe('EUR');
    expect(snap.totalPot).toBe(200);
    expect(snap.settlements).toEqual(settlements);
  });

  it('carries the FULL PlayerBalance including playerId', () => {
    // Forced, not stylistic: buildSummaryListData reads balance.playerId twice —
    // for the non-playing-banker hint and for the React key.
    const snap = buildSharedGameSnapshot({ game: makeGame(), ...inputs });
    expect(snap.balances).toEqual(balances);
    expect(snap.balances[0].playerId).toBe('p1');
  });

  it('keys payments by player NAME, matching the existing paymentByName map', () => {
    const snap = buildSharedGameSnapshot({ game: makeGame(), ...inputs });
    expect(snap.payments).toEqual({
      Ada: { method: 'venmo', handle: 'ada-l' },
      Bob: { method: 'cash' },
    });
  });

  it('omits players with no preferred payment rather than writing undefined', () => {
    // Firestore rejects undefined values outright.
    const game = makeGame({
      players: [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Bob' }],
    });
    const snap = buildSharedGameSnapshot({ game, ...inputs });
    expect(snap.payments).toEqual({});
  });

  it('drops an undefined handle instead of writing the key', () => {
    const game = makeGame({
      players: [{ id: 'p1', name: 'Ada', methods: { cash: '' }, defaultMethod: 'cash' }],
    });
    const snap = buildSharedGameSnapshot({ game, ...inputs });
    expect(snap.payments.Ada).toEqual({ method: 'cash' });
    expect('handle' in snap.payments.Ada).toBe(false);
  });
});

describe('buildSharedGameSnapshot — what it must NOT carry', () => {
  it('omits transactions, the player roster and savedPlayerId', () => {
    const snap = buildSharedGameSnapshot({ game: makeGame(), ...inputs });
    const keys = Object.keys(snap);
    expect(keys).not.toContain('transactions');
    expect(keys).not.toContain('players');
    expect(JSON.stringify(snap)).not.toContain('saved-1');
    expect(JSON.stringify(snap)).not.toContain('t1');
  });
});

describe('buildSharedGameSnapshot — the RESOLVED settlement mode', () => {
  it('projects banker mode when the banker still resolves to a player', () => {
    const game = makeGame({ settlementMode: 'banker', bankerPlayerId: 'p1' });
    const snap = buildSharedGameSnapshot({ game, ...inputs });
    expect(snap.settlementMode).toBe('banker');
    expect(snap.bankerName).toBe('Ada');
    expect(snap.bankerPlayerId).toBe('p1');
  });

  it('DOWNGRADES to optimal when bankerPlayerId no longer matches a player', () => {
    // The snapshot omits players[], so the shared route cannot re-derive this.
    // Copying the raw mode would render "PAYOUTS" with the subhead
    // "—, the banker, pays out below". Commit ab45984 exists for this exact bug.
    const game = makeGame({ settlementMode: 'banker', bankerPlayerId: 'deleted' });
    const snap = buildSharedGameSnapshot({ game, ...inputs });
    expect(snap.settlementMode).toBe('optimal');
    expect(snap.bankerName).toBeUndefined();
    expect(snap.bankerPlayerId).toBeUndefined();
  });

  it('DOWNGRADES to optimal when banker mode has no bankerPlayerId at all', () => {
    const game = makeGame({ settlementMode: 'banker', bankerPlayerId: undefined });
    expect(buildSharedGameSnapshot({ game, ...inputs }).settlementMode).toBe('optimal');
  });

  it('ignores a remembered bankerPlayerId while in optimal mode', () => {
    // bankerPlayerId legitimately persists in optimal mode as the remembered choice.
    const game = makeGame({ settlementMode: 'optimal', bankerPlayerId: 'p1' });
    const snap = buildSharedGameSnapshot({ game, ...inputs });
    expect(snap.settlementMode).toBe('optimal');
    expect(snap.bankerPlayerId).toBeUndefined();
    expect(snap.bankerName).toBeUndefined();
  });

  it('treats an absent settlementMode as optimal', () => {
    const game = makeGame({ settlementMode: undefined });
    expect(buildSharedGameSnapshot({ game, ...inputs }).settlementMode).toBe('optimal');
  });
});

describe('buildSharedGameSnapshot — currency', () => {
  it('falls back to the default when the game has no currency', () => {
    const game = makeGame({ currency: undefined });
    expect(buildSharedGameSnapshot({ game, ...inputs }).currency).toBe('USD');
  });

  it('falls back to the default for an unsupported code', () => {
    // game.currency is typed `string`, so a stale or hand-edited doc can hold
    // anything. createCurrencyFormatters would read SUPPORTED_CURRENCIES[code]
    // as undefined and throw on meta.locale.
    const game = makeGame({ currency: 'XYZ' });
    expect(buildSharedGameSnapshot({ game, ...inputs }).currency).toBe('USD');
  });
});

describe('paymentMapFromSnapshot', () => {
  it('converts the plain object to the Map SummaryView expects', () => {
    const snap = buildSharedGameSnapshot({ game: makeGame(), ...inputs });
    const map = paymentMapFromSnapshot(snap);
    expect(map).toBeInstanceOf(Map);
    expect(map.get('Ada')).toEqual({ method: 'venmo', handle: 'ada-l' });
    expect(map.get('Nobody')).toBeUndefined();
  });

  it('tolerates a snapshot whose payments field is missing', () => {
    // Forward-compat: an older or partial document must not crash the route.
    const base = buildSharedGameSnapshot({ game: makeGame(), ...inputs });
    const snap = { ...base, payments: undefined as any };
    expect(paymentMapFromSnapshot(snap).size).toBe(0);
  });
});

describe('buildSharedGameSnapshot — frozen (no aliasing of caller-owned state)', () => {
  // A test that only reassigns the source array variable, or only pushes to it,
  // passes against a buggy pass-through implementation — reassignment and push
  // don't touch the array reference the snapshot already captured. Only mutating
  // an ELEMENT OBJECT in place discriminates a shallow-copy bug from a real one.
  it('is unaffected by mutating the source balances/settlements element objects and game.date after the call', () => {
    const sourceBalances: PlayerBalance[] = [
      { playerId: 'p1', playerName: 'Ada', totalBuyins: 100, totalCashouts: 140, netBalance: 40 },
      { playerId: 'p2', playerName: 'Bob', totalBuyins: 100, totalCashouts: 60, netBalance: -40 },
    ];
    const sourceSettlements: Settlement[] = [{ from: 'Bob', to: 'Ada', amount: 40 }];
    const game = makeGame();

    const snap = buildSharedGameSnapshot({
      game,
      balances: sourceBalances,
      settlements: sourceSettlements,
      totalPot: 200,
    });

    // Mutate the source element objects in place, and the source Game's date,
    // AFTER the snapshot was built.
    sourceBalances[0].netBalance = 999999;
    sourceBalances[0].playerName = 'MUTATED';
    sourceSettlements[0].amount = 999999;
    game.date.setFullYear(1999);

    expect(snap.balances[0].netBalance).toBe(40);
    expect(snap.balances[0].playerName).toBe('Ada');
    expect(snap.settlements[0].amount).toBe(40);
    expect(snap.date).toEqual(new Date('2026-08-19T00:00:00.000Z'));
  });
});

describe('SHARED_GAME_SCHEMA', () => {
  it('is 1', () => {
    expect(SHARED_GAME_SCHEMA).toBe(1);
  });
});

describe('buildSharedGameSnapshot — publishes the default of the new methods/defaultMethod carrier', () => {
  it('publishes only the default method, in the unchanged wire format', () => {
    const game = makeGame({
      players: [
        { id: 'p1', name: 'Ada', methods: { venmo: 'ada-l', zelle: 'ada@x.com' }, defaultMethod: 'zelle' },
      ],
    });
    const snap = buildSharedGameSnapshot({ game, ...inputs });
    expect(snap.payments).toEqual({ Ada: { method: 'zelle', handle: 'ada@x.com' } });
  });

  it('emits a label-only entry with no handle key at all (Firestore rejects undefined)', () => {
    const game = makeGame({
      players: [{ id: 'p1', name: 'Ada', methods: { venmo: '' }, defaultMethod: 'venmo' }],
    });
    const snap = buildSharedGameSnapshot({ game, ...inputs });
    expect(snap.payments).toEqual({ Ada: { method: 'venmo' } });
    expect('handle' in snap.payments.Ada).toBe(false);
  });

  it('is byte-identical to the legacy single-method output', () => {
    const game = makeGame({
      players: [{ id: 'p1', name: 'Ada', methods: { venmo: 'ada-l' }, defaultMethod: 'venmo' }],
    });
    const viaMethods = buildSharedGameSnapshot({ game, ...inputs });
    // The exact JSON a pre-change build wrote for the same player. If this ever differs,
    // firestore.rules and every already-published /g/ document are implicated.
    expect(JSON.stringify(viaMethods.payments)).toBe('{"Ada":{"method":"venmo","handle":"ada-l"}}');
  });
});
