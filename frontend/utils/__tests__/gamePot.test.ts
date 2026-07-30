import fs from 'fs';
import path from 'path';
import { calculateBuyinTotal } from '../gamePot';
import { Transaction } from '@/types/game';

function txn(type: 'buyin' | 'cashout', amount: number, playerId = 'p1'): Transaction {
  return {
    id: `txn_${type}_${amount}_${playerId}`,
    playerId,
    type,
    amount,
    timestamp: new Date('2025-01-01'),
  };
}

describe('calculateBuyinTotal', () => {
  it('returns 0 for no transactions', () => {
    expect(calculateBuyinTotal([])).toBe(0);
  });

  it('sums buy-ins across players', () => {
    expect(calculateBuyinTotal([txn('buyin', 100), txn('buyin', 50, 'p2')])).toBe(150);
  });

  it('ignores cash-outs', () => {
    expect(calculateBuyinTotal([txn('buyin', 100), txn('cashout', 80)])).toBe(100);
  });

  it('reads current CONTENT after an in-place rewrite', () => {
    // The shape of GameService.setPlayerTransactionTotal: same array, new contents.
    const transactions: Transaction[] = [txn('buyin', 100)];
    expect(calculateBuyinTotal(transactions)).toBe(100);

    transactions.length = 0;
    transactions.push(txn('buyin', 250));
    expect(calculateBuyinTotal(transactions)).toBe(250);

    transactions.push(txn('buyin', 50, 'p2'));
    expect(calculateBuyinTotal(transactions)).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Regression guards for "GameCard Pot reads $0 until the app is restarted".
//
// GameCard cannot be rendered in this repo's test setup (the `jest-expo/node`
// preset has no React Native environment, and importing the component pulls in
// reanimated + gesture-handler), so these pin the two source-level properties
// whose absence caused the bug. Both were present before the fix.
//
// Why a comparator cannot be repaired instead of removed: React does not
// snapshot props. `prevProps.game.players` and `nextProps.game.players` are the
// SAME array object after an in-place mutation, so `prevProps.game.players
// .length === nextProps.game.players.length` compares that one array against
// itself and is unconditionally true. The only reliable signal is the game
// OBJECT identity, which `GameContext.updateGame` does replace ({ ...game }) —
// and that is exactly what React.memo's default shallow compare checks.
// ---------------------------------------------------------------------------

describe('GameCard staleness guards', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'components', 'GameCard.tsx'),
    'utf8',
  );

  it('memoizes GameCard with the DEFAULT shallow compare, not a custom comparator', () => {
    // The trailing `)` must close the memo call — a second argument would not match.
    expect(source).toMatch(/React\.memo\(GameCard\)\s*;/);
    expect(source).not.toMatch(/prevProps|nextProps/);
  });

  it('never derives displayed values from game.transactions identity', () => {
    // A useMemo/useCallback dependency on the array reference freezes the value
    // for the lifetime of the mount, so not even a re-render repairs it.
    expect(source).not.toMatch(/\[\s*game\.transactions\s*\]/);
    expect(source).not.toMatch(/\[\s*game\.players\s*\]/);
  });
});
