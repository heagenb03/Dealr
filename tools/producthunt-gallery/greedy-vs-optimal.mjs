// Does client-greedy-v1 actually match the optimal transfer count?
// Exact greedy body from frontend/services/settlementService.ts:34-72.
function calculateOptimalSettlements(balances) {
  const settlements = [];
  const debtorsDict = balances.filter(b => b.netBalance < 0)
    .map(b => ({ name: b.playerName, amount: Math.abs(b.netBalance) }))
    .sort((a, b) => b.amount - a.amount);
  const creditorsDict = balances.filter(b => b.netBalance > 0)
    .map(b => ({ name: b.playerName, amount: b.netBalance }))
    .sort((a, b) => b.amount - a.amount);
  let di = 0, ci = 0;
  while (di < debtorsDict.length && ci < creditorsDict.length) {
    const d = debtorsDict[di], c = creditorsDict[ci];
    const amt = Math.min(d.amount, c.amount);
    settlements.push({ from: d.name, to: c.name, amount: parseFloat(amt.toFixed(2)) });
    d.amount -= amt; c.amount -= amt;
    if (d.amount === 0) di++;
    if (c.amount === 0) ci++;
  }
  return settlements;
}

// True optimum: min transfers = (#nonzero players) - (max # of disjoint zero-sum subsets).
// Bitmask DP over submasks. Exact, not heuristic.
function optimalTransferCount(nets) {
  const v = nets.filter(x => x !== 0);
  const n = v.length;
  if (n === 0) return 0;
  const sum = new Array(1 << n).fill(0);
  for (let m = 1; m < (1 << n); m++) {
    const lb = m & -m, i = 31 - Math.clz32(lb);
    sum[m] = sum[m ^ lb] + v[i];
  }
  const dp = new Array(1 << n).fill(-1);
  dp[0] = 0;
  for (let m = 1; m < (1 << n); m++) {
    for (let s = m; s > 0; s = (s - 1) & m) {
      if (sum[s] !== 0 || dp[m ^ s] < 0) continue;
      if (dp[m ^ s] + 1 > dp[m]) dp[m] = dp[m ^ s] + 1;
    }
  }
  return n - dp[(1 << n) - 1];
}

// Deterministic LCG so this is reproducible.
let seed = 20260725;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// Realistic home-game nets: multiples of $5, 4-8 players, forced to balance.
function randomGame(nPlayers) {
  const nets = [];
  for (let i = 0; i < nPlayers - 1; i++) {
    nets.push((Math.floor(rnd() * 41) - 20) * 5); // -100..+100 in $5 steps
  }
  nets.push(-nets.reduce((a, b) => a + b, 0));
  return nets;
}

let trials = 0, worse = 0, totalExtra = 0, maxExtra = 0;
const examples = [];
for (const nPlayers of [4, 5, 6, 7, 8]) {
  for (let t = 0; t < 2000; t++) {
    const nets = randomGame(nPlayers);
    if (nets.every(x => x === 0)) continue;
    const balances = nets.map((netBalance, i) => ({ playerName: `P${i}`, netBalance }));
    const g = calculateOptimalSettlements(balances).length;
    const o = optimalTransferCount(nets);
    trials++;
    if (g > o) {
      worse++; totalExtra += g - o; maxExtra = Math.max(maxExtra, g - o);
      if (examples.length < 3) examples.push({ nets, greedy: g, optimal: o });
    }
  }
}
console.log('=== GREEDY vs OPTIMAL (balanced games) ===');
console.log(`trials: ${trials}`);
console.log(`greedy strictly worse: ${worse} (${(100 * worse / trials).toFixed(1)}%)`);
console.log(`avg extra transfers when worse: ${(totalExtra / Math.max(worse, 1)).toFixed(2)}`);
console.log(`worst case extra transfers: ${maxExtra}`);
for (const e of examples) {
  console.log(`  e.g. nets ${JSON.stringify(e.nets)} -> greedy ${e.greedy}, optimal ${e.optimal}`);
}

// Heagen's case: the numbers DON'T line up (buy-ins != cash-outs).
console.log('\n=== IMBALANCED TABLE (buy-ins != cash-outs) ===');
const imbalanced = [
  { playerName: 'Doyle',    netBalance:  400 },
  { playerName: 'Maria',    netBalance:  380 },
  { playerName: 'Phil',     netBalance:  220 },
  { playerName: 'Daniel',   netBalance: -400 },
  { playerName: 'Johnny',   netBalance: -300 },
  { playerName: 'Wolfgang', netBalance: -240 }, // $60 short: someone miscounted chips
];
const net = imbalanced.reduce((a, b) => a + b.netBalance, 0);
const out = calculateOptimalSettlements(imbalanced);
const paidTo = {};
for (const s of out) paidTo[s.to] = (paidTo[s.to] || 0) + s.amount;
console.log(`table imbalance: $${net.toFixed(2)} (credits exceed debits)`);
console.log(`greedy emitted ${out.length} transfers:`);
for (const s of out) console.log(`  ${s.from} -> ${s.to}: $${s.amount.toFixed(2)}`);
console.log('creditor shortfalls (owed by the table but never paid):');
for (const b of imbalanced.filter(x => x.netBalance > 0)) {
  const got = paidTo[b.playerName] || 0;
  const short = b.netBalance - got;
  console.log(`  ${b.playerName}: owed $${b.netBalance.toFixed(2)}, receives $${got.toFixed(2)}` +
    (short > 0 ? `  <-- SHORT $${short.toFixed(2)}, silently` : ''));
}
