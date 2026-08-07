import {
  calculateOptimalSettlements,
  validateSettlements,
  getSettlements,
  calculateBankerSettlements,
  SOLVER_TIMEOUT_SENTINEL,
} from '../settlementService';
import { PlayerBalance } from '@/types/game';

// ---- local fallback cashRoundingUnit parity ----

describe('local fallback honors cashRoundingUnit', () => {
  it('rounds local greedy amounts to whole units', async () => {
    const balances = [
      { playerId: 'a', playerName: 'A', totalBuyins: 53, totalCashouts: 0, netBalance: -53 },
      { playerId: 'c', playerName: 'C', totalBuyins: 0, totalCashouts: 53, netBalance: 53 },
    ];
    const result = await getSettlements(balances, {
      forceLocal: true,
      settings: { cashRoundingUnit: 20 },
    });
    expect(result.source).toBe('client');
    expect(result.settlements.every(s => s.amount % 20 === 0)).toBe(true);
  });

  it('rounds local greedy amounts to the resolved default unit (5)', async () => {
    const balances = [
      { playerId: 'a', playerName: 'A', totalBuyins: 53, totalCashouts: 0, netBalance: -53 },
      { playerId: 'c', playerName: 'C', totalBuyins: 0, totalCashouts: 53, netBalance: 53 },
    ];
    const result = await getSettlements(balances, {
      forceLocal: true,
      settings: { cashRoundingUnit: 5 },
    });
    expect(result.source).toBe('client');
    expect(result.settlements.every(s => s.amount % 5 === 0)).toBe(true);
  });
});

function makeBalance(
  name: string,
  buyins: number,
  cashouts: number
): PlayerBalance {
  return {
    playerId: `id_${name}`,
    playerName: name,
    totalBuyins: buyins,
    totalCashouts: cashouts,
    netBalance: cashouts - buyins,
  };
}

// ---- calculateOptimalSettlements ----

describe('calculateOptimalSettlements', () => {
  it('returns empty array for empty balances', () => {
    expect(calculateOptimalSettlements([])).toEqual([]);
  });

  it('returns empty array when all balances are zero', () => {
    const balances = [
      makeBalance('Alice', 100, 100),
      makeBalance('Bob', 50, 50),
    ];
    expect(calculateOptimalSettlements(balances)).toEqual([]);
  });

  it('handles simple two-player case', () => {
    const balances = [
      makeBalance('Alice', 100, 0),   // net = -100 (debtor)
      makeBalance('Bob', 0, 100),     // net = +100 (creditor)
    ];

    const result = calculateOptimalSettlements(balances);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ from: 'Alice', to: 'Bob', amount: 100 });
  });

  it('handles three-player case', () => {
    const balances = [
      makeBalance('Alice', 100, 0),   // net = -100
      makeBalance('Bob', 0, 60),      // net = +60
      makeBalance('Charlie', 0, 40),  // net = +40
    ];

    const result = calculateOptimalSettlements(balances);
    // Alice owes 100 total: 60 to Bob + 40 to Charlie
    const totalPaid = result.reduce((sum, s) => sum + s.amount, 0);
    expect(totalPaid).toBe(100);
    expect(result.every(s => s.from === 'Alice')).toBe(true);
  });

  it('handles case with multiple debtors and creditors', () => {
    const balances = [
      makeBalance('Alice', 80, 0),   // net = -80
      makeBalance('Bob', 60, 0),     // net = -60
      makeBalance('Charlie', 0, 90), // net = +90
      makeBalance('Dave', 0, 50),    // net = +50
    ];

    const result = calculateOptimalSettlements(balances);
    const totalDebts = result.reduce((sum, s) => sum + s.amount, 0);
    expect(totalDebts).toBe(140);
  });

  it('rounds amounts to two decimal places', () => {
    const balances = [
      makeBalance('Alice', 33, 0),  // net = -33
      makeBalance('Bob', 0, 33),    // net = +33
    ];

    const result = calculateOptimalSettlements(balances);
    result.forEach(s => {
      const decimals = s.amount.toString().split('.')[1];
      if (decimals) {
        expect(decimals.length).toBeLessThanOrEqual(2);
      }
    });
  });
});

// ---- validateSettlements ----

describe('validateSettlements', () => {
  it('returns error for empty balances array', () => {
    const result = validateSettlements([]);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns error when players have no activity', () => {
    const balances = [
      makeBalance('Alice', 0, 0), // no activity
      makeBalance('Bob', 100, 100),
    ];

    const result = validateSettlements(balances);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('Alice');
  });

  it('returns valid for balanced game', () => {
    const balances = [
      makeBalance('Alice', 100, 50),
      makeBalance('Bob', 50, 100),
    ];

    const result = validateSettlements(balances);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.totalBuyins).toBe(150);
    expect(result.totalCashouts).toBe(150);
    expect(result.netDifference).toBe(0);
  });

  it('returns warning for imbalance > $2.50 (buy-ins higher)', () => {
    const balances = [
      makeBalance('Alice', 100, 50),
      makeBalance('Bob', 50, 97),  // total buyins = 150, cashouts = 147, diff = 3
    ];

    const result = validateSettlements(balances);
    expect(result.isValid).toBe(true); // warnings don't block
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.netDifference).toBe(3);

    const msg = result.warnings[0];
    expect(msg).toContain('Buy-ins are');
    expect(msg).toContain('more than cash-outs');
    expect(msg).toContain('your $2.50 limit');
    expect(msg).toContain('non-optimized settlements');
    expect(msg).toBe(
      'Buy-ins are $3.00 more than cash-outs, over your $2.50 limit (In $150.00 · Out $147.00). Proceeding will produce non-optimized settlements.'
    );
  });

  it('returns warning for imbalance > $2.50 (cash-outs higher, direction flips)', () => {
    const balances = [
      makeBalance('Alice', 50, 100),
      makeBalance('Bob', 97, 50),  // total buyins = 147, cashouts = 150, diff = 3
    ];

    const result = validateSettlements(balances);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.netDifference).toBe(3);

    const msg = result.warnings[0];
    expect(msg).toContain('Cash-outs are');
    expect(msg).toContain('more than buy-ins');
  });

  it('returns no warning for imbalance within tolerance ($2.50)', () => {
    const balances = [
      makeBalance('Alice', 100, 50),
      makeBalance('Bob', 50, 98), // diff = 2, within tolerance
    ];

    const result = validateSettlements(balances);
    expect(result.isValid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns no warning at exactly $2.50 difference (boundary, strict >)', () => {
    const balances = [
      makeBalance('Alice', 100, 50),
      makeBalance('Bob', 50, 97.5), // diff = 2.50 exactly
    ];

    const result = validateSettlements(balances);
    expect(result.isValid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.netDifference).toBe(2.5);
  });

  it('honors a custom (looser) tolerance — no warning under it', () => {
    const balances = [
      makeBalance('Alice', 100, 100),
      makeBalance('Bob', 50, 54), // diff = 4.00
    ];
    const result = validateSettlements(balances, undefined, undefined, undefined, 5.0);
    expect(result.warnings).toHaveLength(0);
    expect(result.isValid).toBe(true);
  });

  it('honors a custom (stricter) tolerance — warns above it', () => {
    const balances = [
      makeBalance('Alice', 100, 100),
      makeBalance('Bob', 50, 49), // diff = 1.00
    ];
    const result = validateSettlements(balances, undefined, undefined, undefined, 0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.isValid).toBe(true); // still a warning, never a block
  });

  it('defaults to 2.50 tolerance when omitted (back-compat)', () => {
    const balances = [
      makeBalance('Alice', 100, 100),
      makeBalance('Bob', 50, 46), // diff = 4.00 > 2.50
    ];
    const result = validateSettlements(balances);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('computes totals correctly', () => {
    const balances = [
      makeBalance('Alice', 200, 80),
      makeBalance('Bob', 100, 220),
    ];

    const result = validateSettlements(balances);
    expect(result.totalBuyins).toBe(300);
    expect(result.totalCashouts).toBe(300);
    expect(result.netDifference).toBe(0);
  });
});

// ---- getSettlements ----

describe('getSettlements', () => {
  const balances = [
    makeBalance('Alice', 100, 0),
    makeBalance('Bob', 0, 100),
  ];

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    jest.restoreAllMocks();
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('returns local result when forceLocal is true', async () => {
    const result = await getSettlements(balances, { forceLocal: true });
    expect(result.source).toBe('client');
    expect(result.algorithm).toBe('client-greedy-v1');
    expect(result.error).toBe('force-local');
    expect(result.settlements).toHaveLength(1);
  });

  it('returns local result for empty balances', async () => {
    const result = await getSettlements([], { forceLocal: false });
    expect(result.source).toBe('client');
    expect(result.settlements).toEqual([]);
  });

  it('returns local result when no endpoint is configured', async () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    const result = await getSettlements(balances);
    expect(result.source).toBe('client');
    expect(result.error).toBe('missing-endpoint');
  });

  it('returns server result on successful fetch', async () => {
    const mockResponse = {
      settlements: [{ from: 'Alice', to: 'Bob', amount: 100 }],
      algorithm: 'server-milp-v1',
      generatedAt: '2025-01-01T00:00:00Z',
      requestId: 'req_123',
      warnings: ['adjusted'],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await getSettlements(balances, {
      endpoint: 'https://api.example.com/settlements/optimal',
    });

    expect(result.source).toBe('server');
    expect(result.algorithm).toBe('server-milp-v1');
    expect(result.settlements).toHaveLength(1);
    expect(result.serverRequestId).toBe('req_123');
    expect(result.warnings).toEqual(['adjusted']);
  });

  it('falls back to local on fetch failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const result = await getSettlements(balances, {
      endpoint: 'https://api.example.com/settlements/optimal',
    });

    expect(result.source).toBe('client');
    expect(result.error).toBe('Network error');
    expect(result.settlements).toHaveLength(1);
  });

  it('reports a stable sentinel when our own budget expires', async () => {
    global.fetch = jest.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            // Mirrors a real aborted fetch: the message is platform-dependent,
            // only `name` is reliable.
            const err = new Error('The user aborted a request.');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const result = await getSettlements(balances, {
      endpoint: 'https://api.example.com/settlements/optimal',
      timeoutMs: 10,
    });

    expect(result.source).toBe('client');
    expect(result.error).toBe(SOLVER_TIMEOUT_SENTINEL);
  });

  it('does not report a solver timeout for an ordinary network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const result = await getSettlements(balances, {
      endpoint: 'https://api.example.com/settlements/optimal',
    });

    expect(result.error).toBe('Network error');
    expect(result.error).not.toBe(SOLVER_TIMEOUT_SENTINEL);
  });

  it('does not report a solver timeout when the caller supplies its own signal', async () => {
    // A caller-supplied signal (e.g. a screen unmounting) makes `controller` null
    // internally, so even though this abort is name/message-identical to a real
    // solver timeout, it must NOT be reported as one — that result is being
    // discarded anyway. This is the case that falsifies a name/message-based
    // implementation (e.g. `error.name === 'AbortError'`), which cannot tell it
    // apart from an internal-timeout abort.
    const callerController = new AbortController();

    global.fetch = jest.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('The user aborted a request.');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const promise = getSettlements(balances, {
      endpoint: 'https://api.example.com/settlements/optimal',
      signal: callerController.signal,
    });

    callerController.abort();
    const result = await promise;

    expect(result.error).toBe('The user aborted a request.');
    expect(result.error).not.toBe(SOLVER_TIMEOUT_SENTINEL);
  });

  it('falls back to local on non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    const result = await getSettlements(balances, {
      endpoint: 'https://api.example.com/settlements/optimal',
    });

    expect(result.source).toBe('client');
    expect(result.error).toContain('500');
  });

  it('falls back to local when server returns empty settlements array', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ settlements: [] }),
    });

    const result = await getSettlements(balances, {
      endpoint: 'https://api.example.com/settlements/optimal',
    });

    expect(result.source).toBe('client');
    expect(result.error).toContain('Invalid settlement payload');
  });

  it('falls back to local with the server explanation when the server rejects with warnings', async () => {
    const warning = 'Game imbalance ($4.00) exceeds tolerance ($2.50)';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ settlements: [], warnings: [warning] }),
    });

    const result = await getSettlements(balances, {
      endpoint: 'https://api.example.com/settlements/optimal',
    });

    expect(result.source).toBe('client');
    expect(result.algorithm).toBe('client-greedy-v1');
    expect(result.error).toBe(warning);
    expect(result.warnings).toEqual([warning]);
    expect(result.settlements).toHaveLength(1);
  });

  it('uses EXPO_PUBLIC_API_BASE_URL when no custom endpoint provided', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';

    const mockResponse = {
      settlements: [{ from: 'Alice', to: 'Bob', amount: 100 }],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    await getSettlements(balances);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/settlements/optimal',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('handles timeout via AbortController', async () => {
    jest.useFakeTimers();

    global.fetch = jest.fn().mockImplementation(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }
        })
    );

    const promise = getSettlements(balances, {
      endpoint: 'https://api.example.com/settlements/optimal',
      timeoutMs: 5000,
    });

    jest.advanceTimersByTime(5000);
    const result = await promise;

    expect(result.source).toBe('client');
    // The internal timeout fired `controller.abort()`, so `controller.signal.aborted`
    // is true regardless of the rejection's shape (DOMException here isn't even
    // `instanceof Error`) — this is precisely the case the sentinel exists to mark.
    expect(result.error).toBe(SOLVER_TIMEOUT_SENTINEL);
  });
});

// ---- calculateBankerSettlements (casino / cash-out model) ----

describe('calculateBankerSettlements', () => {
  const banker = { id: 'id_Bank', name: 'Bank' };

  it('pays each non-banker their full cash-out (stack), not their net', () => {
    const balances = [
      makeBalance('Bank', 0, 0),      // non-playing banker
      makeBalance('Alice', 100, 150), // net +50, cash-out 150
      makeBalance('Bob', 100, 50),    // net -50, but still redeems his $50 stack
    ];
    const { settlements, algorithm, source } = calculateBankerSettlements(balances, banker);
    expect(algorithm).toBe('client-banker-v1');
    expect(source).toBe('client');
    expect(settlements).toContainEqual({ from: 'Bank', to: 'Alice', amount: 150 });
    expect(settlements).toContainEqual({ from: 'Bank', to: 'Bob', amount: 50 });
    expect(settlements).toHaveLength(2);
  });

  it('omits busted players (cash-out 0) and never pays the banker itself', () => {
    const balances = [
      makeBalance('Bank', 100, 150), // playing banker — no self-row despite cash-out > 0
      makeBalance('Cara', 100, 0),   // busted — no row
      makeBalance('Alice', 50, 80),  // cash-out 80
    ];
    const { settlements } = calculateBankerSettlements(balances, banker);
    expect(settlements).toEqual([{ from: 'Bank', to: 'Alice', amount: 80 }]);
  });

  it('excludes strictly by id — a same-name, different-id player is still paid', () => {
    const dealerBanker = { id: 'id_Dealer', name: 'Dealer' };
    const balances = [
      // Same NAME as the banker but a DIFFERENT id → must be paid (id-keyed
      // exclusion), producing a same-name self-loop {from:'Dealer', to:'Dealer'}
      // as the discriminator: an id-keyed impl keeps it, a name-keyed one drops it.
      { playerId: 'id_Dealer_2', playerName: 'Dealer', totalBuyins: 0, totalCashouts: 40, netBalance: 40 },
      makeBalance('W1', 0, 40),
    ];
    const { settlements } = calculateBankerSettlements(balances, dealerBanker);
    expect(settlements).toHaveLength(2);
    expect(settlements).toContainEqual({ from: 'Dealer', to: 'Dealer', amount: 40 });
    expect(settlements).toContainEqual({ from: 'Dealer', to: 'W1', amount: 40 });
  });

  it('rounds cash-outs to the cash unit', () => {
    const balances = [
      makeBalance('Bank', 0, 0),
      makeBalance('Alice', 0, 53), // 53 → 55 at unit 5
    ];
    const { settlements } = calculateBankerSettlements(balances, banker, 5);
    expect(settlements).toEqual([{ from: 'Bank', to: 'Alice', amount: 55 }]);
  });

  it('returns no settlements when nobody has cashed out', () => {
    const balances = [
      makeBalance('Bank', 0, 0),
      makeBalance('Alice', 50, 0),
      makeBalance('Bob', 30, 0),
    ];
    const { settlements } = calculateBankerSettlements(balances, banker);
    expect(settlements).toEqual([]);
  });
});

describe('validateSettlements banker exemption', () => {
  it('does not error on a zero-activity player when they are the banker', () => {
    const balances = [
      makeBalance('Bank', 0, 0), // banker, no activity
      makeBalance('L1', 50, 0),
      makeBalance('W1', 0, 50),
    ];
    const v = validateSettlements(balances, undefined, 'id_Bank');
    expect(v.errors).toHaveLength(0);
    expect(v.isValid).toBe(true);
  });

  it('still errors on a zero-activity player who is NOT the banker', () => {
    const balances = [
      makeBalance('Bank', 40, 40),
      makeBalance('Ghost', 0, 0), // not the banker
      makeBalance('L1', 50, 0),
    ];
    const v = validateSettlements(balances, undefined, 'id_Bank');
    expect(v.isValid).toBe(false);
    expect(v.errors.join(' ')).toContain('Ghost');
  });
});

describe('validateSettlements banker-mode gate', () => {
  // This gate existed before 2026-08-07 but was unreachable: removePlayer used to
  // reset settlementMode to 'optimal', so "banker mode with no banker" could not
  // persist. Now that it can, these are the tests that keep completion blocked.

  it('blocks completion in banker mode when no banker is set', () => {
    const balances = [makeBalance('L1', 50, 0), makeBalance('W1', 0, 50)];
    const v = validateSettlements(balances, undefined, undefined, 'banker');
    expect(v.isValid).toBe(false);
    expect(v.errors).toContain('Choose a banker before completing the game.');
  });

  it('blocks completion when the banker id no longer resolves to a player', () => {
    const balances = [makeBalance('L1', 50, 0), makeBalance('W1', 0, 50)];
    const v = validateSettlements(balances, undefined, 'id_Gone', 'banker');
    expect(v.isValid).toBe(false);
    expect(v.errors).toContain('Choose a banker before completing the game.');
  });

  it('reports ONLY the banker error, suppressing a zero-activity player', () => {
    // The gate returns early, so it is the single error the host sees. Pinning
    // this stops a future refactor from burying it under a list of other errors.
    const balances = [
      makeBalance('Ghost', 0, 0),
      makeBalance('L1', 50, 0),
      makeBalance('W1', 0, 50),
    ];
    const v = validateSettlements(balances, undefined, undefined, 'banker');
    expect(v.errors).toEqual(['Choose a banker before completing the game.']);
  });

  it('allows completion once the banker resolves to a player', () => {
    const balances = [
      makeBalance('Bank', 0, 0),
      makeBalance('L1', 50, 0),
      makeBalance('W1', 0, 50),
    ];
    const v = validateSettlements(balances, undefined, 'id_Bank', 'banker');
    expect(v.isValid).toBe(true);
    expect(v.errors).toHaveLength(0);
  });

  it('does not gate optimal mode when no banker is set', () => {
    const balances = [makeBalance('L1', 50, 0), makeBalance('W1', 0, 50)];
    const v = validateSettlements(balances, undefined, undefined, 'optimal');
    expect(v.isValid).toBe(true);
  });
});
