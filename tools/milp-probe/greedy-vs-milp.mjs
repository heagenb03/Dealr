/**
 * Counts what the CLIENT GREEDY fallback actually returns on the exact instances
 * probe-milp.mjs sends to the backend, so MILP results can be compared against the
 * real fallback rather than against greedy's theoretical <= N-1 upper bound.
 *
 * Replicates, in order, what the backend does before solving:
 *   1. roundBalancesToDollars  (milp_solver.cpp:102) — round each net to $5, then the
 *      biggest winner absorbs the residual and is re-rounded.
 *   2. calculateOptimalSettlements (settlementService.ts) — the greedy the client falls
 *      back to: sort debtors and creditors descending, repeatedly settle min(debt, credit).
 *
 * Balance generation is byte-identical to probe-milp.mjs (same LCG, same seeds), so
 * counts here line up with the measured MILP counts seed-for-seed.
 */

const ROUND_UNIT = Number(process.env.ROUND_UNIT ?? 5);
const ROUNDING_THRESHOLD = 0.01;

function makeRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Identical to probe-milp.mjs makeBalances. */
function makeBalances(n, seed) {
  const rng = makeRng(seed);
  const cents = [];
  for (let i = 0; i < n - 1; i++) {
    const mag = Math.floor(rng() * 40000) + 137;
    cents.push(rng() < 0.5 ? -mag : mag);
  }
  cents.push(-cents.reduce((a, b) => a + b, 0));

  return cents.map((c, i) => {
    const net = c / 100;
    const buyins = 200 + Math.floor(rng() * 300);
    return {
      playerId: `p${i + 1}`,
      playerName: `Player ${i + 1}`,
      totalBuyins: buyins,
      totalCashouts: Number((buyins + net).toFixed(2)),
      netBalance: Number(net.toFixed(2)),
    };
  });
}

/** Port of roundBalancesToDollars (milp_solver.cpp:102-147). */
function roundBalances(balances, increment) {
  const rounded = balances.map((b) => ({ ...b }));

  for (const b of rounded) {
    b.netBalance =
      Math.abs(b.netBalance) > ROUNDING_THRESHOLD
        ? Math.round(b.netBalance / increment) * increment
        : 0;
  }

  const totalError = rounded.reduce((s, b) => s + b.netBalance, 0);
  if (Math.abs(totalError) > ROUNDING_THRESHOLD) {
    let idx = 0;
    let maxWin = 0;
    for (let i = 0; i < rounded.length; i++) {
      if (rounded[i].netBalance > maxWin) {
        maxWin = rounded[i].netBalance;
        idx = i;
      }
    }
    if (maxWin > 0) {
      rounded[idx].netBalance =
        Math.round((rounded[idx].netBalance - totalError) / increment) * increment;
    }
  }
  return rounded;
}

/** Port of calculateOptimalSettlements (settlementService.ts) — the client greedy. */
function greedy(balances) {
  const settlements = [];
  const debtors = balances
    .filter((b) => b.netBalance < 0)
    .map((b) => ({ name: b.playerName, amount: Math.abs(b.netBalance) }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = balances
    .filter((b) => b.netBalance > 0)
    .map((b) => ({ name: b.playerName, amount: b.netBalance }))
    .sort((a, b) => b.amount - a.amount);

  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].amount, creditors[c].amount);
    settlements.push({ from: debtors[d].name, to: creditors[c].name, amount });
    debtors[d].amount -= amount;
    creditors[c].amount -= amount;
    if (debtors[d].amount === 0) d++;
    if (creditors[c].amount === 0) c++;
  }
  return settlements;
}

/**
 * Measured settlement counts, dev @1769MB, SOLVER_TIME_LIMIT_MS=5000.
 *
 * N=12 and N=50 are 8 seeds, measured with the FULL production request body
 * (`{balances, settings:{cashRoundingUnit:5, imbalanceTolerance:2.5}}`) — these are the
 * load-bearing rows and the only ones with enough samples to quote. Everything else is
 * 3 seeds and pre-dates the request-body fix: indicative only, re-measure before citing.
 * A 3-seed read of N=50 gave 17.8%; 8 seeds gave 12.6%.
 */
const MILP_5S = {
  12: [9, 9, 10, 10, 10, 9, 10, 10],
  16: [12, 12, 13],
  20: [15, 15, 16],
  24: [19, 18, 20],
  28: [21, 19, 23],
  32: [24, 23, 26],
  40: [30, 30, 31],
  50: [41, 41, 38, 47, 37, 45, 43, 42],
};
const MILP_15S = {
  20: [15, 15, 15],
  24: [18, 18, 20],
  32: [24, 23, 26],
  50: [40, 39, 38],
};
/** Ground truth from the 120s-limit build, 2026-08-03. Only these are known. */
const OPTIMUM = { 24: [17, 17, null] };

const SIZES = (process.argv[2] ?? '20,24,32,50').split(',').map(Number);
const SEEDS = (process.argv[3] ?? '1,2,3').split(',').map(Number);

// MILP_5S / MILP_15S / OPTIMUM are indexed POSITIONALLY — index i holds the
// measurement for the i-th seed of the canonical run, not for seed value i+1.
// Supplying SEEDS out of canonical order (or starting elsewhere, or skipping a
// value) silently pairs one seed's greedy count with another seed's MILP datum.
// This is a low-risk guard, not a table restructure: the tables stay positional
// and tracked as-is; we only refuse to index them unsafely.
const seedsAreCanonicalPrefix = SEEDS.every((seed, i) => seed === i + 1);
if (!seedsAreCanonicalPrefix) {
  console.error(
    'ERROR: the MILP_5S / MILP_15S / OPTIMUM tables in this file are POSITIONAL ' +
      '(index i = the i-th seed of the canonical run), not keyed by seed value. ' +
      `SEEDS=[${SEEDS.join(',')}] is not the canonical ascending prefix starting ` +
      'at 1, so positional indexing would silently mispair seeds with the wrong ' +
      'MILP measurement. Supply seeds in canonical ascending order starting at 1 ' +
      '(e.g. "1,2,3" or "1,2,3,4,5").',
  );
  process.exit(1);
}

console.log(`Greedy vs MILP on identical instances  (rounding unit $${ROUND_UNIT})\n`);
console.log('   N  seed   greedy   MILP-5s   MILP-15s   optimum   greedy-vs-5s   captured');

const agg = {};
const skippedCounts = {};
for (const n of SIZES) {
  agg[n] = { greedy: 0, milp: 0, count: 0 };
  skippedCounts[n] = 0;
  for (let i = 0; i < SEEDS.length; i++) {
    const seed = SEEDS[i];
    const g = greedy(roundBalances(makeBalances(n, seed), ROUND_UNIT)).length;
    const m5 = MILP_5S[n]?.[i] ?? null;
    const m15 = MILP_15S[n]?.[i] ?? null;
    const opt = OPTIMUM[n]?.[i] ?? null;

    // Of the payments greedy could possibly shed (greedy - optimum), how many did MILP shed?
    const captured =
      opt !== null && m5 !== null && g - opt > 0
        ? `${(((g - m5) / (g - opt)) * 100).toFixed(0)}%`
        : '—';

    // Only instances with BOTH a greedy count and a MILP datum enter the aggregate —
    // letting greedy accumulate unconditionally while MILP only accumulates when
    // present inflates the reported saving (a seed with no MILP datum would count
    // fully on the greedy side and not at all on the MILP side).
    if (m5 !== null) {
      agg[n].greedy += g;
      agg[n].milp += m5;
      agg[n].count++;
    } else {
      skippedCounts[n]++;
    }

    console.log(
      `${String(n).padStart(4)}  ${String(seed).padStart(4)}   ` +
        `${String(g).padStart(6)}   ${String(m5 ?? '—').padStart(7)}   ` +
        `${String(m15 ?? '—').padStart(8)}   ${String(opt ?? '—').padStart(7)}   ` +
        `${String(m5 !== null ? g - m5 : '—').padStart(12)}   ${captured.padStart(8)}`,
    );
  }
}

console.log('\n--- per-N totals (greedy vs MILP-5s) ---');
for (const n of SIZES) {
  const a = agg[n];
  if (!a.count) continue;
  const saved = a.greedy - a.milp;
  const pct = ((saved / a.greedy) * 100).toFixed(1);
  console.log(
    `N=${String(n).padStart(2)}  greedy=${a.greedy}  MILP=${a.milp}  ` +
      `MILP saves ${saved} payments (${pct}% fewer)`,
  );
  if (skippedCounts[n] > 0) {
    console.log(
      `note: N=${n} aggregate covers ${a.count}/${SEEDS.length} seeds ` +
        `(${skippedCounts[n]} skipped: no MILP datum)`,
    );
  }
}
