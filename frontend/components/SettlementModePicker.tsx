import React, { useCallback, useMemo } from 'react';
import { Modal, TouchableOpacity, StyleSheet, Pressable, FlatList, ListRenderItemInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Text, View } from '@/components/Themed';
import { Player } from '@/types/game';
import { buildBankerPickerListData, BankerPickerItem } from '@/utils/bankerPickerListData';

interface Props {
  visible: boolean;
  players: Player[];
  bankerPlayerId?: string;
  onSelectBanker: (playerId: string) => void;
  onAddSomeone: () => void;
  onClose: () => void;
}

export default function SettlementModePicker({
  visible,
  players,
  bankerPlayerId,
  onSelectBanker,
  onAddSomeone,
  onClose,
}: Props) {
  const listData = useMemo(
    () => buildBankerPickerListData(players, bankerPlayerId),
    [players, bankerPlayerId],
  );

  const keyExtractor = useCallback((item: BankerPickerItem) => item.key, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<BankerPickerItem>) => (
      <TouchableOpacity
        style={styles.row}
        onPress={() => { onSelectBanker(item.id); onClose(); }}
        activeOpacity={0.7}
      >
        <Text style={styles.label}>{item.name}</Text>
        {item.isSelected && <Ionicons name="checkmark" size={20} color="#B072BB" />}
      </TouchableOpacity>
    ),
    [onSelectBanker, onClose],
  );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>Banker</Text>

            {players.length === 0 ? (
              <TouchableOpacity style={styles.emptyRow} onPress={onAddSomeone} activeOpacity={0.7}>
                <Ionicons name="person-add-outline" size={18} color="#B072BB" />
                <Text style={styles.emptyText}>Add a player to set as banker</Text>
              </TouchableOpacity>
            ) : (
              <>
                <FlatList
                  data={listData}
                  renderItem={renderItem}
                  keyExtractor={keyExtractor}
                  style={styles.list}
                  initialNumToRender={10}
                  maxToRenderPerBatch={10}
                  windowSize={5}
                />

                <View style={styles.divider} />

                <TouchableOpacity style={styles.addRow} onPress={onAddSomeone} activeOpacity={0.7}>
                  <Ionicons name="add" size={20} color="#B072BB" />
                  <Text style={styles.addText}>Add someone</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.cancelButton} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end', padding: 16 },
  sheet: {
    backgroundColor: '#1A1A1A', borderRadius: 20, borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.2)', paddingTop: 20, paddingBottom: 8, maxHeight: '80%',
  },
  title: {
    fontSize: 16, fontWeight: '600', color: 'rgba(255,255,255,0.5)', textAlign: 'center',
    marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase',
  },
  // The sheet is maxHeight-bounded; RN defaults flexShrink to 0, so without this the
  // list keeps its full content height and a long roster is clipped instead of
  // scrolling. A VirtualizedList also needs a bounded height or it renders every row
  // and virtualizes nothing.
  list: { flexShrink: 1 },
  hint: {
    fontSize: 12, color: 'rgba(255,255,255,0.4)', textAlign: 'center',
    marginBottom: 12, paddingHorizontal: 20,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 20, backgroundColor: 'transparent',
  },
  label: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  divider: { height: 1, backgroundColor: 'rgba(176,114,187,0.1)', marginHorizontal: 20 },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 20, backgroundColor: 'transparent',
  },
  addText: { fontSize: 15, fontWeight: '600', color: '#B072BB' },
  emptyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 24, paddingHorizontal: 20, backgroundColor: 'transparent',
  },
  emptyText: { fontSize: 15, fontWeight: '500', color: 'rgba(255,255,255,0.8)' },
  cancelButton: {
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
  },
  cancelText: { fontSize: 16, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
});
