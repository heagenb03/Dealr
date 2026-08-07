import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SavedPickerRowProps, savedPickerRowPropsEqual } from '@/utils/savedPickerRow';

function SavedPickerRow({ id, name, badge, inGame, disabled, isFirst, isLast, onSelect }: SavedPickerRowProps) {
  // An added row is deliberately NOT pressable. Under the alphabetical show-all list it keeps
  // its position after being added, so the add tap and a would-be undo tap land on identical
  // pixels — binding undo to the row would make a double-tap silently remove the player, and
  // a player with no buy-in shifts neither total, so no imbalance warning would catch it.
  // Undo therefore lives on its own small control. Not nested inside a disabled
  // TouchableOpacity either: whether a child receives touches there depends on Pressability's
  // responder gating, which this must not rest on.
  if (inGame) {
    return (
      <View style={[styles.pickerRow, isFirst && styles.pickerRowFirst, isLast && styles.pickerRowLast]}>
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
        isFirst && styles.pickerRowFirst,
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
  // These rows ARE the grouped panel. There is no wrapping box: the FlatList that holds
  // them shares one scroll container with the modal's other children, and a wrapper that
  // surrounded only the rows would have to sit inside the list, where it cannot span
  // virtualized content. So every edge is drawn per row — left/right on all of them,
  // top on isFirst, bottom on isLast — which composites into a single continuous panel.
  //
  // paddingHorizontal: 12 deliberately supersedes the previous zero-inset rationale
  // (row names aligning with the SAVED label, the buy-in field and the Save-player
  // checkbox). That was written for a world with no box. The panel itself is still
  // full-bleed and still aligns with those elements; only the text insets, which is
  // standard grouped-list behaviour.
  //
  // paddingVertical is UNCHANGED at 14 — row height and the number of visible players
  // must not move, because row height is the divisor for the visible-row count in both
  // of the card's height states (80% of the window with the keyboard down, 50% with it
  // up).
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: '#242424',
    borderLeftWidth: 1,
    borderLeftColor: '#333333',
    borderRightWidth: 1,
    borderRightColor: '#333333',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  pickerRowFirst: {
    borderTopWidth: 1,
    borderTopColor: '#333333',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  // NOT borderBottomWidth: 0. The final row carries the panel's bottom EDGE, so the
  // border stays and only its colour changes from the divider tint to the edge colour.
  // Dropping it would leave the panel open-bottomed.
  pickerRowLast: {
    borderBottomColor: '#333333',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
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
