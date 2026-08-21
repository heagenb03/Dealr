/**
 * Player filter chips for the shared game route.
 *
 * Shared route only — the host does not get these. The summary is grouped BY
 * RECIPIENT ("Ada receives $30 from Bob, $40 from Cal"), which is the right
 * shape for a host reviewing the whole table and the wrong shape for one player
 * hunting for one number.
 *
 * Starts UNSELECTED, full list visible, identical to what the host sees. No
 * inference, no pre-selection from the account display name, no prompt.
 * Pre-selecting would open the list already filtered BY A GUESS, and a wrong
 * guess shows the viewer someone else's obligations while they believe the
 * numbers are theirs. Ignoring the row costs nothing.
 *
 * ScrollView, NOT FlatList. A FlatList here would make this component
 * untestable: under jest-expo/node a 3-row FlatList never returns and survives
 * jest's testTimeout, hanging the suite. The row holds one chip per player and
 * is capped by PRO_PLAYER_CAP, so virtualization buys nothing.
 */
import React from 'react';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '@/components/Themed';

export interface PlayerFilterChipsProps {
  names: string[];
  selectedName: string | null;
  onSelect: (name: string | null) => void;
}

export default function PlayerFilterChips({
  names,
  selectedName,
  onSelect,
}: PlayerFilterChipsProps) {
  if (names.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
    >
      {names.map(name => {
        const isSelected = name === selectedName;
        return (
          <TouchableOpacity
            key={name}
            style={[styles.chip, isSelected && styles.chipSelected]}
            // Tapping the selected chip clears it — the escape hatch for a
            // viewer who taps the wrong name.
            onPress={() => onSelect(isSelected ? null : name)}
            activeOpacity={0.7}
            accessibilityRole="button"
            // Contains the visible text: role="button" means WCAG 2.5.3 Label in
            // Name wants the accessible name to include what is drawn.
            accessibilityLabel={`Filter by ${name}`}
            accessibilityHint={
              isSelected ? 'Shows everyone again' : 'Shows only this player'
            }
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
              {name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    // flexGrow:0 keeps the row at its content height inside a column parent —
    // without it a ScrollView claims all the remaining vertical space.
    flexGrow: 0,
    // 32 is the shared summary section gap (see summaryStyles.listSectionHeader and
    // the screens' heroPotSection). The row below owns no vertical padding, so this
    // margin IS the rendered gap down to the next HUD header — nothing adds to it.
    marginBottom: 32,
  },
  row: {
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#1A1A1A',
  },
  chipSelected: {
    borderColor: '#B072BB',
    backgroundColor: '#49264F',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#A0A0A0',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
});
