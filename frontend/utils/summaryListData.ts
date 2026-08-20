/**
 * Item union for the game summary screen's single FlatList: settlements (or banker
 * payouts) first, then the FINAL BALANCES header, then one row per player.
 *
 * No react-native import — jest-expo/node has no RN renderer.
 */
import { PlayerBalance } from '@/types/game';
import { GroupedSettlement } from '@/utils/settlementUtils';

export type SummaryListItem =
  | { type: 'settlement'; key: string; grouped: GroupedSettlement }
  | { type: 'bankerPayout'; key: string; recipient: string; amount: number }
  | { type: 'sectionHeader'; key: string; label: string }
  | {
      type: 'balance';
      key: string;
      balance: PlayerBalance;
      hint?: string;
      /** True only for the banker's own row, and only in banker mode. */
      isBanker: boolean;
      isLast: boolean;
    }
  | { type: 'empty'; key: string; label: string; icon: string };

export interface SummaryListParams {
  /** Settlements already grouped by recipient. */
  grouped: readonly GroupedSettlement[];
  balances: readonly PlayerBalance[];
  isBanker: boolean;
  bankerPlayerId?: string;
}

/**
 * Chrome above the settlements (title, TOTAL POT, the section header, the banker
 * subhead, the fallback banner, the rounding note) is NOT part of this sequence —
 * it lives in the screen's ListHeaderComponent.
 *
 * Settlement and payout keys are index-based, matching the `key={index}` the
 * pre-FlatList `.map()` used, so remount behaviour is unchanged.
 */
export function buildSummaryListData({
  grouped,
  balances,
  isBanker,
  bankerPlayerId,
}: SummaryListParams): SummaryListItem[] {
  const items: SummaryListItem[] = [];

  if (grouped.length === 0) {
    items.push({
      type: 'empty',
      key: 'empty-settlements',
      label: isBanker ? 'Nothing to pay out' : 'All balanced',
      icon: 'checkmark-circle-outline',
    });
  } else if (isBanker) {
    grouped.forEach((g, index) => {
      items.push({
        type: 'bankerPayout',
        key: `payout-${index}`,
        recipient: g.recipient,
        amount: g.totalAmount,
      });
    });
  } else {
    grouped.forEach((g, index) => {
      items.push({ type: 'settlement', key: `settlement-${index}`, grouped: g });
    });
  }

  items.push({ type: 'sectionHeader', key: 'header-balances', label: 'FINAL BALANCES' });

  balances.forEach((balance, index) => {
    // The BANKER badge marks EVERY banker, matching PlayerCardActive, which gates
    // its badge on isBanker alone.
    const isThisPlayerBanker = isBanker && bankerPlayerId === balance.playerId;
    // The hint is the narrower case: a banker who never bought in or cashed out is
    // in the roster only to receive and disburse; the hint keeps a flat 0 row from
    // reading as "forgot to enter anything".
    const isNonPlayingBanker =
      isThisPlayerBanker &&
      balance.totalBuyins === 0 &&
      balance.totalCashouts === 0;
    items.push({
      type: 'balance',
      key: `balance-${balance.playerId}`,
      balance,
      isBanker: isThisPlayerBanker,
      // isLast reproduces balancesContainer's `gap: 8` without a trailing gap.
      isLast: index === balances.length - 1,
      // 'not playing', NOT 'banker · not playing': the BANKER badge now sits
      // immediately left of this, so the old copy read "Ada BANKER banker · not playing".
      ...(isNonPlayingBanker ? { hint: 'not playing' } : {}),
    });
  });

  return items;
}
