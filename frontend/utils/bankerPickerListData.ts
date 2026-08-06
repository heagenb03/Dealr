/**
 * Item union for SettlementModePicker's banker list.
 *
 * Deliberately free of react-native imports: the jest-expo/node test preset has no RN
 * renderer, so anything a test touches must not pull in react-native.
 */
import { Player } from '@/types/game';

export type BankerPickerItem = {
  type: 'playerRow';
  /** FlatList key — the player id. */
  key: string;
  id: string;
  name: string;
  /** True for the currently designated banker. */
  isSelected: boolean;
};

/**
 * Projects the roster into picker rows. Roster order is preserved — the caller
 * decides the ordering, this only reshapes.
 */
export function buildBankerPickerListData(
  players: readonly Player[],
  bankerPlayerId?: string,
): BankerPickerItem[] {
  return players.map(p => ({
    type: 'playerRow' as const,
    key: p.id,
    id: p.id,
    name: p.name,
    isSelected: bankerPlayerId === p.id,
  }));
}
