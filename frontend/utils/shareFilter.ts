/**
 * The player-chip filter for the shared game route.
 *
 * The summary is grouped BY RECIPIENT ("Ada receives $30 from Bob, $40 from
 * Cal"). That is the right shape for a host reviewing the whole table and the
 * wrong shape for one player hunting for one number, which is what the chips fix.
 *
 * Filters the INPUTS to buildSummaryListData, never its output: the builder
 * computes `isLast` and picks the empty-state label internally, so filtering
 * SummaryListItem[] afterwards would leave a wrong trailing gap and could orphan
 * the FINAL BALANCES header.
 *
 * A matching card is kept WHOLE — rows and total untouched. GroupedSettlement's
 * totalAmount is a sum over its own payments array, so narrowing the rows would
 * require recomputing the total, and a miss there prints a header amount that its
 * own rows do not add up to. Keeping cards intact makes that unreachable.
 *
 * No react-native import — unit-testable under jest-expo/node.
 */
import { PlayerBalance } from '@/types/game';
import { GroupedSettlement } from '@/utils/settlementUtils';

/**
 * Chip labels, in balance order, de-duplicated.
 *
 * Settlements are name-based, so two same-named players are already conflated
 * upstream — two identical chips would be two identical filters.
 */
export function chipNamesFromBalances(balances: readonly PlayerBalance[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const balance of balances) {
    if (seen.has(balance.playerName)) continue;
    seen.add(balance.playerName);
    names.push(balance.playerName);
  }
  return names;
}

function involves(group: GroupedSettlement, name: string): boolean {
  return group.recipient === name || group.payments.some(p => p.from === name);
}

export function filterSummaryInputs(params: {
  grouped: readonly GroupedSettlement[];
  balances: readonly PlayerBalance[];
  selectedName: string | null;
}): { grouped: GroupedSettlement[]; balances: PlayerBalance[] } {
  const { grouped, balances, selectedName } = params;

  // Unselected is the default and is identical to what the host sees.
  if (selectedName === null) {
    return { grouped: [...grouped], balances: [...balances] };
  }

  return {
    // Whole cards. No row removal, therefore no total to recompute.
    grouped: grouped.filter(g => involves(g, selectedName)),
    balances: balances.filter(b => b.playerName === selectedName),
  };
}
