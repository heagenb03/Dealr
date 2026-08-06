import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SavedPickerRowProps, savedPickerRowPropsEqual } from '@/utils/savedPickerRow';

function SavedPickerRow({ id, name, badge, inGame, disabled, isLast, onSelect }: SavedPickerRowProps) {
  // An added row is deliberately NOT pressable. Under the alphabetical show-all list it keeps
  // its position after being added, so the add tap and a would-be undo tap land on identical
  // pixels — binding undo to the row would make a double-tap silently remove the player, and
  // a player with no buy-in shifts neither total, so no imbalance warning would catch it.
  // Undo therefore lives on its own small control. Not nested inside a disabled
  // TouchableOpacity either: whether a child receives touches there depends on Pressability's
  // responder gating, which this must not rest on.
  if (inGame) {
    return (
      <View style={[styles.pickerRow, isLast && styles.pickerRowLast]}>
        <Text style={[styles.pickerRowName, styles.pickerRowNameShrink]} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.pickerRowRight}>
          <Text style={styles.pickerAddedTag}>Added ✓</Text>
          <TouchableOpacity
            onPress={() => onSelect(id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${name} from game`}
          >
            <Text style={styles.pickerUndoTag}>Undo</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

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
      {badge ? (
        <Text style={styles.pickerRowBadge} numberOfLines={1}>{badge}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // No horizontal inset, deliberately. The bordered styles.pickerList box that used to wrap
  // these rows is gone (the picker now shares one scroll container with the modal's other
  // children), so a 16pt inset here would indent the row names 16pt past the SAVED label,
  // the buy-in field and the Save-player checkbox, which all start at x=0. The right edge
  // matches too: identityRow — the structurally identical sibling, a left label plus a
  // right-hand action at marginLeft:'auto' — is full-width with zero inset, so the badge
  // and "Added ✓" sit flush right exactly where "Add as new" does. Rows are therefore
  // full-bleed and so are their tap targets and press highlights, which is intended.
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  pickerRowLast: { borderBottomWidth: 0 },
  pickerRowDisabled: { opacity: 0.4 },
  pickerRowName: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  // Added rows carry two right-hand tags, so the name is what must give way.
  pickerRowNameShrink: { flexShrink: 1 },
  pickerRowBadge: {
    fontSize: 11,
    color: 'rgba(176,114,187,0.9)',
    fontFamily: 'SpaceMono',
    flexShrink: 1,
    textAlign: 'right',
  },
  // The row is space-between with two children. "Added ✓" and "Undo" must be ONE child or
  // all three would spread evenly and float the tag into the middle of the row.
  pickerRowRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pickerAddedTag: { fontSize: 12, color: '#00D66F', fontFamily: 'SpaceMono' },
  pickerUndoTag: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: 'SpaceMono' },
});

export default React.memo(SavedPickerRow, savedPickerRowPropsEqual);
