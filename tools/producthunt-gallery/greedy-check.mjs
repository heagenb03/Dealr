// Runs the EXACT client-greedy-v1 body from frontend/services/settlementService.ts
// against the Friday Night Poker worked example that gallery image 3 renders.
function calculateOptimalSettlements(balances) {
  const settlements = [];
  const debtorsDict = balances.filter(b => b.netBalance < 0)
    .map(b => ({ name: b.playerName, amount: Math.abs(b.netBalance) }))
    .sort((a, b) => b.amount - a.amount);
  const creditorsDict = balances.filter(b => b.netBalance > 0)
    .map(b => ({ name: b.playerName, amount: b.netBalance }))
    .sort((a, b) => b.amount - a.amount);
  let debtorIndex = 0, creditorIndex = 0;
  while (debtorIndex < debtorsDict.length && creditorIndex < creditorsDict.length) {
    const debtor = debtorsDict[debtorIndex];
    const creditor = creditorsDict[creditorIndex];
    const settlementAmount = Math.min(debtor.amount, creditor.amount);
    settlements.push({ from: debtor.name, to: creditor.name, amount: parseFloat(settlementAmount.toFixed(2)) });
    debtor.amount -= settlementAmount;
    creditor.amount -= settlementAmount;
    if (debtor.amount === 0) debtorIndex++;
    if (creditor.amount === 0) creditorIndex++;
  }
  return settlements;
}

// Net balances implied by SHARE_TEXT in tools/appstore-screenshots/slides.config.mjs:
//   Doyle  +400 (400 from Daniel)
//   Maria  +380 (300 from Johnny, 80 from Wolfgang)
//   Phil   +220 (220 from Wolfgang)
//   Daniel -400, Johnny -300, Wolfgang -300
const balances = [
  { playerName: 'Doyle',    netBalance:  400 },
  { playerName: 'Maria',    netBalance:  380 },
  { playerName: 'Phil',     netBalance:  220 },
  { playerName: 'Daniel',   netBalance: -400 },
  { playerName: 'Johnny',   netBalance: -300 },
  { playerName: 'Wolfgang', netBalance: -300 },
];

const greedy = calculateOptimalSettlements(balances);
console.log('greedy transfer count:', greedy.length);
for (const s of greedy) console.log(`  ${s.from} -> ${s.to}: $${s.amount.toFixed(2)}`);

const shipped = [
  { from: 'Daniel',   to: 'Doyle', amount: 400 },
  { from: 'Johnny',   to: 'Maria', amount: 300 },
  { from: 'Wolfgang', to: 'Maria', amount:  80 },
  { from: 'Wolfgang', to: 'Phil',  amount: 220 },
];
const key = (a) => a.map(s => `${s.from}>${s.to}:${s.amount}`).sort().join('|');
console.log('shipped (image 3 / landing) count:', shipped.length);
console.log('IDENTICAL SET?', key(greedy) === key(shipped));
