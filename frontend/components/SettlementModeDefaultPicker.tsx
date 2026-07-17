import React from 'react';
import { Modal, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Text, View } from '@/components/Themed';

type SettlementMode = 'optimal' | 'banker';

interface Props {
  visible: boolean;
  currentMode: SettlementMode;
  onSelect: (mode: SettlementMode) => void;
  onClose: () => void;
}

const OPTIONS: { mode: SettlementMode; label: string; sub: string }[] = [
  { mode: 'optimal', label: 'Direct', sub: 'Settle player-to-player' },
  { mode: 'banker', label: 'Banker', sub: 'One player is the banker. Assign them in-game' },
];

export default function SettlementModeDefaultPicker({
  visible,
  currentMode,
  onSelect,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>Settlement Mode</Text>
            {OPTIONS.map((opt, i) => (
              <React.Fragment key={opt.mode}>
                {i > 0 && <View style={styles.divider} />}
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => {
                    onSelect(opt.mode);
                    onClose();
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.label}>{opt.label}</Text>
                    <Text style={styles.subLabel}>{opt.sub}</Text>
                  </View>
                  {opt.mode === currentMode && (
                    <Ionicons name="checkmark" size={20} color="#B072BB" />
                  )}
                </TouchableOpacity>
              </React.Fragment>
            ))}
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
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
    padding: 16,
  },
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
    marginBottom: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: 'transparent',
  },
  rowText: {
    backgroundColor: 'transparent',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(176,114,187,0.1)',
    marginHorizontal: 20,
  },
  cancelButton: {
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  cancelText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '500',
  },
});
