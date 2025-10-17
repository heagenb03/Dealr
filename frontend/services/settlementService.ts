import { PlayerBalance, Settlement, Validation } from '@/types/game';

export function calculateOptimalSettlements(balances: PlayerBalance[]): Settlement[] {
  const settlements: Settlement[] = [];
  
  const debtorsDict = balances.filter(b => b.netBalance < 0)
    .map(b => ({ name: b.playerName, amount: Math.abs(b.netBalance) }))
    .sort((a, b) => b.amount - a.amount);

  const creditorsDict = balances.filter(b => b.netBalance > 0)
    .map(b => ({ name: b.playerName, amount: b.netBalance }))
    .sort((a, b) => b.amount - a.amount);

  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtorsDict.length && creditorIndex < creditorsDict.length) {
    const debtor = debtorsDict[debtorIndex];
    const creditor = creditorsDict[creditorIndex];

    const settlementAmount = Math.min(debtor.amount, creditor.amount);
    
    settlements.push({
      from: debtor.name,
      to: creditor.name,
      amount: parseFloat(settlementAmount.toFixed(2))
    });
    
    debtor.amount -= settlementAmount;
    creditor.amount -= settlementAmount;
    
    if (debtor.amount === 0) {
      debtorIndex++;
    }
    if (creditor.amount === 0) {
      creditorIndex++;
    }
  }
  
  return settlements;
}

export function validateSettlements(balances: PlayerBalance[]): Validation {
  const tolerance = 0.01;
  const validation : Validation = {
    isValid: true,
    errors: [],
    warnings: [],
    totalBuyins: 0,
    totalCashouts: 0,
    netDifference: 0
  };

  const playersWithNoActivity = balances.filter(b => b.totalBuyins === 0 && b.totalCashouts === 0);
  if (!Array.isArray(balances) || balances.length === 0) {
    validation.errors.push('No player balances available for validation.');
    return validation;
  } else if(balances.length < 2) {
    validation.errors.push('At least two players are required to validate settlements.');
    return validation;
  } else if (playersWithNoActivity.length > 0) {
    validation.errors.push(`Players with no activity: ${playersWithNoActivity.map(p => p.playerName).join(', ')}.`);
    return validation;
  }

  validation.totalBuyins = balances.reduce((sum, b) => sum + b.totalBuyins, 0);
  validation.totalCashouts = balances.reduce((sum, b) => sum + b.totalCashouts, 0);
  validation.netDifference = Math.abs(validation.totalBuyins - validation.totalCashouts);

  if (validation.netDifference > tolerance) {
    validation.warnings.push(`Total buyins ($${validation.totalBuyins.toFixed(2)}) and cashouts ($${validation.totalCashouts.toFixed(2)}) differ by $${validation.netDifference.toFixed(2)}, which exceeds the tolerance of $${tolerance.toFixed(2)}.`);
  }

  if (validation.errors.length === 0) {
    validation.isValid = true;
  }
  
  return validation;
}
