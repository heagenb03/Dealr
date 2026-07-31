import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SavedPickerRowProps, savedPickerRowPropsEqual } from '@/utils/savedPickerRow';

function SavedPickerRow({ id, name, badge, inGame, disabled, isLast, onSelect }: SavedPickerRowProps) {
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={() => onSelect(id)}
      style={[
        styles.pickerRow,
        isLast && styles.pickerRowLast,
        disabled && styles.pickerRowDisabled,
      ]}
    >
      <Text style={styles.pickerRowName}>{name}</Text>
      {inGame ? (
        <Text style={styles.pickerAddedTag}>Added ✓</Text>
      ) : badge ? (
        <Text style={styles.pickerRowBadge} numberOfLines={1}>{badge}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  pickerRowLast: { borderBottomWidth: 0 },
  pickerRowDisabled: { opacity: 0.4 },
  pickerRowName: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  pickerRowBadge: {
    fontSize: 11,
    color: 'rgba(176,114,187,0.9)',
    fontFamily: 'SpaceMono',
    flexShrink: 1,
    textAlign: 'right',
  },
  pickerAddedTag: { fontSize: 12, color: '#00D66F', fontFamily: 'SpaceMono' },
});

export default React.memo(SavedPickerRow, savedPickerRowPropsEqual);
