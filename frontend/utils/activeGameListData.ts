/**
 * Item union for the active game screen's player list: a Players header, active rows
 * (or an empty item), then an optional Completed header and its rows.
 *
 * No react-native import — jest-expo/node has no RN renderer.
 */
import { Player, PlayerBalance } from '@/types/game';

export type ActiveGameListItem =
  | { type: 'sectionHeader'; key: string; label: 'players' | 'completed' }
  | { type: 'activePlayer'; key: string; player: Player; balance?: PlayerBalance; isBanker: boolean }
  | { type: 'completedPlayer'; key: string; player: Player; balance?: PlayerBalance }
  | { type: 'empty'; key: string; label: string; icon: string };

export interface ActiveGameListParams {
  players: readonly Player[];
  balances: readonly PlayerBalance[];
  settlementMode?: string;
  bankerPlayerId?: string;
}

/**
 * `label` on sectionHeader is a discriminant, not display copy — the Players header
 * carries an add-player action and the Completed header does not, so renderItem needs
 * to tell them apart. Handlers never live in the items (they would make this impure).
 */
export function buildActiveGameListData({
  players,
  balances,
  settlementMode,
  bankerPlayerId,
}: ActiveGameListParams): ActiveGameListItem[] {
  const balanceById = new Map(balances.map(b => [b.playerId, b]));
  const active = players.filter(p => !p.completedAt);
  const completed = players.filter(p => p.completedAt);

  const items: ActiveGameListItem[] = [
    { type: 'sectionHeader', key: 'header-players', label: 'players' },
  ];

  if (active.length === 0) {
    items.push({
      type: 'empty',
      key: 'empty-players',
      label: 'No players yet',
      icon: 'person-outline',
    });
  } else {
    active.forEach(player => {
      items.push({
        type: 'activePlayer',
        key: player.id,
        player,
        balance: balanceById.get(player.id),
        isBanker: settlementMode === 'banker' && bankerPlayerId === player.id,
      });
    });
  }

  if (completed.length > 0) {
    items.push({ type: 'sectionHeader', key: 'header-completed', label: 'completed' });
    completed.forEach(player => {
      items.push({
        type: 'completedPlayer',
        key: player.id,
        player,
        balance: balanceById.get(player.id),
      });
    });
  }

  return items;
}
