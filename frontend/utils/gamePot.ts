import { Transaction } from '@/types/game';

/**
 * Total of a game's buy-in transactions — the "Pot" figure on a GameCard.
 *
 * Deliberately NOT memoized by its callers. Every mutator in the app rewrites
 * `game.transactions` IN PLACE (`GameService.addTransaction` pushes;
 * `setPlayerTransactionTotal` does `length = 0` then re-pushes) and
 * `GameContext.updateGame` only SHALLOW-clones the game, so that array keeps
 * its reference across every edit. Anything gated on its identity — a
 * `useMemo` dependency or a `React.memo` comparator — reads a stale pot until
 * the component is remounted. See `utils/__tests__/gamePot.test.ts`.
 *
 * It is a reduce over at most two transactions per player. Just recompute it.
 */
export function calculateBuyinTotal(transactions: Transaction[]): number {
  return transactions.reduce(
    (sum, transaction) => (transaction.type === 'buyin' ? sum + transaction.amount : sum),
    0,
  );
}
