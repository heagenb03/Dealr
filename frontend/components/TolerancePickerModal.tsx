import React from 'react';
import { Modal, FlatList, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Text, View } from '@/components/Themed';
import { useCurrency } from '@/contexts/CurrencyContext';
import { CurrencyCode } from '@/constants/Currencies';
import {
  getToleranceOptions,
  resolveTolerance,
  EXACT_TOLERANCE,
} from '@/constants/Tolerances';

interface Props {
  visible: boolean;
  currentTolerance?: number;
  currency: CurrencyCode;
  onSelect: (tolerance: number) => void;
  onClose: () => void;
}

export default function TolerancePickerModal({
  visible,
  currentTolerance,
  currency,
  onSelect,
  onClose,
}: Props) {
  const { formatAmount } = useCurrency();
  const options = getToleranceOptions(currency);
  const selected = resolveTolerance(currentTolerance, currency);

  const labelFor = (t: number) =>
    t === EXACT_TOLERANCE ? `Exact (${formatAmount(0)})` : formatAmount(t);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>Imbalance Tolerance</Text>
            <Text style={styles.subtitle}>
              Warn me at cash-out if total buy-ins and cash-outs are off by more than this.
            </Text>
            <FlatList
              data={options}
              keyExtractor={(item) => item.toString()}
              renderItem={({ item }: { item: number }) => (
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.label}>{labelFor(item)}</Text>
                    {item === EXACT_TOLERANCE && (
                      <Text style={styles.subLabel}>Warn on any imbalance</Text>
                    )}
                  </View>
                  {item === selected && (
                    <Ionicons name="checkmark" size={20} color="#B072BB" />
                  )}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.divider} />}
            />
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
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.2)',
    paddingTop: 20,
    paddingBottom: 8,
    maxHeight: '80%',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
    paddingHorizontal: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: 'transparent',
  },
  label: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  rowText: { backgroundColor: 'transparent' },
  subLabel: { fontSize: 12, fontWeight: '400', color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  divider: { height: 1, backgroundColor: 'rgba(176,114,187,0.1)', marginHorizontal: 20 },
  cancelButton: {
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  cancelText: { fontSize: 16, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
});
