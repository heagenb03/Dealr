/**
 * Measures whether an N-player table solves via the backend MILP inside the
 * client's DEFAULT_TIMEOUT_MS (15000), or aborts to client-greedy-v1.
 *
 * Mirrors settlementService.getSettlements: POST {balances, settings} to
 * /settlements/optimal, 15s AbortController, same PlayerBalance shape.
 */

const ENDPOINT = process.env.ENDPOINT;
if (!ENDPOINT) {
  console.error(
    'ENDPOINT is required — this probe has no safe default.\n\n' +
      '  dev:  https://i3stlalxlpgd3d3oenx2bdyxny0hlpll.lambda-url.us-east-1.on.aws/settlements/optimal\n' +
      '  prod: https://meg3qqzdpqc6oh7affpw3vmsem0szuzq.lambda-url.us-east-1.on.aws/settlements/optimal\n\n' +
      'Usage: ENDPOINT=<url> [TIMEOUT_MS=15000] node probe-milp.mjs <sizes> <seeds>\n' +
      '  e.g. ENDPOINT=$DEV TIMEOUT_MS=15000 node probe-milp.mjs 20,50 1,2,3\n\n' +
      'This file previously defaulted to the PROD url, and a run meant for dev\n' +
      'silently measured production instead. Confirm the mapping before trusting\n' +
      'any number:  aws lambda list-function-url-configs --function-name <fn>',
  );
  process.exit(1);
}
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 15000);

/**
 * MUST mirror what settlementService.getSettlements actually POSTs:
 * `{balances, settings: {cashRoundingUnit, imbalanceTolerance}}`.
 *
 * Sending only `{balances}` — as this probe did until 2026-08-04 — silently flatters every
 * measurement: the same seed-1 N=20 instance took 8.7-8.9s bare and 9320-9351ms with the app's
 * real settings at 1024MB. A missing request field is invisible in the output and turns a
 * reported margin into a fiction. Diff this against the call site before trusting a number.
 */
const SETTINGS = {
  cashRoundingUnit: Number(process.env.ROUND_UNIT ?? 5),
  imbalanceTolerance: Number(process.env.TOLERANCE ?? 2.5),
};

// Deterministic LCG so runs are reproducible.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * Messy, non-round net balances summing to exactly zero (worked in cents so no
 * FP drift). Round numbers let the solver find exact debtor/creditor matches
 * cheaply; the point is to present a genuinely hard min-cardinality instance.
 */
function makeBalances(n, seed) {
  const rng = makeRng(seed);
  const cents = [];
  for (let i = 0; i < n - 1; i++) {
    const mag = Math.floor(rng() * 40000) + 137; // $1.37 .. ~$401
    cents.push(rng() < 0.5 ? -mag : mag);
  }
  cents.push(-cents.reduce((a, b) => a + b, 0)); // force exact zero sum

  return cents.map((c, i) => {
    const net = c / 100;
    // Buyins/cashouts consistent with net; magnitudes irrelevant to the solver.
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

async function probe(n, seed) {
  const balances = makeBalances(n, seed);
  const sum = balances.reduce((a, b) => a + b.netBalance, 0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balances, settings: SETTINGS }),
      signal: controller.signal,
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      console.log(`N=${String(n).padStart(2)} seed=${seed}  HTTP ${res.status}  ${ms}ms`);
      return { n, seed, ms, outcome: `http-${res.status}` };
    }
    const body = await res.json();
    const algo = body.algorithm ?? '(absent → server-milp-v1)';
    const count = Array.isArray(body.settlements) ? body.settlements.length : 0;
    console.log(
      `N=${String(n).padStart(2)} seed=${seed}  ${String(ms).padStart(5)}ms  ` +
        `algorithm=${algo}  settlements=${count}  imbalance=${sum.toFixed(2)}` +
        (body.warnings?.length ? `  warnings=${JSON.stringify(body.warnings)}` : ''),
    );
    return { n, seed, ms, outcome: 'server', algo, count };
  } catch (err) {
    const ms = Date.now() - t0;
    const aborted = err.name === 'AbortError';
    console.log(
      `N=${String(n).padStart(2)} seed=${seed}  ${String(ms).padStart(5)}ms  ` +
        `${aborted ? '*** TIMED OUT → client-greedy-v1 fallback ***' : `ERROR ${err.message}`}`,
    );
    return { n, seed, ms, outcome: aborted ? 'timeout' : 'error' };
  } finally {
    clearTimeout(timer);
  }
}

const sizes = process.argv[2] ? process.argv[2].split(',').map(Number) : [12, 16, 20];
const seeds = process.argv[3]
  ? process.argv[3].split(',').map(Number)
  : [1, 2, 3];
const results = [];

// Warm the Lambda so the first measurement isn't a cold start.
console.log('warming lambda...');
await probe(4, 99);
console.log('');

for (const n of sizes) {
  for (const seed of seeds) results.push(await probe(n, seed));
}

console.log('\n--- summary ---');
for (const n of sizes) {
  const r = results.filter((x) => x.n === n);
  const times = r.map((x) => x.ms);
  const timeouts = r.filter((x) => x.outcome === 'timeout').length;
  console.log(
    `N=${String(n).padStart(2)}  max=${Math.max(...times)}ms  ` +
      `median=${times.sort((a, b) => a - b)[Math.floor(times.length / 2)]}ms  timeouts=${timeouts}/${r.length}`,
  );
}
