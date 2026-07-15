import React from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from '@/components/Themed';

const GREEN = 'rgba(76,175,80,0.85)';
const RED = 'rgba(192,70,87,0.85)';

interface Cell {
  label: string;
  value: string;
}

interface MockCardProps {
  /** Ionicons name for the green (left-edge) action tile. */
  leftIcon: string;
  /** Ionicons name for the red (right-edge) action tile. */
  rightIcon: string;
  name: string;
  cells: Cell[];
  /** Show the ✎ glyph next to the name (active card only). */
  showRename?: boolean;
}

/** A stripped-down silhouette of a real player card, with action tiles on their true edges. */
function MockCard({ leftIcon, rightIcon, name, cells, showRename }: MockCardProps) {
  return (
    <View style={styles.cardRow}>
      <View style={[styles.tile, styles.tileGreen]}>
        <Ionicons name={leftIcon as any} size={18} color={GREEN} />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{name}</Text>
          {showRename && <Text style={styles.renameGlyph}>✎</Text>}
        </View>
        <View style={styles.dataRow}>
          {cells.map((c, i) => (
            <React.Fragment key={c.label}>
              {i > 0 && <View style={styles.dataDivider} />}
              <View style={styles.dataItem}>
                <Text style={styles.dataLabel}>{c.label}</Text>
                <Text style={styles.dataValue}>{c.value}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>
      <View style={[styles.tile, styles.tileRed]}>
        <Ionicons name={rightIcon as any} size={18} color={RED} />
      </View>
    </View>
  );
}

interface LegendRowProps {
  action: string;
  gesture: string;
  /** Dot color for swipe actions. Omit and set renameCue for the tap-to-rename row. */
  color?: string;
  renameCue?: boolean;
}

/** color dot → action label → gesture in words. */
function LegendRow({ action, gesture, color, renameCue }: LegendRowProps) {
  return (
    <View style={styles.legendRow}>
      {renameCue ? (
        <Text style={styles.renameCue}>✎</Text>
      ) : (
        <View style={[styles.dot, { backgroundColor: color }]} />
      )}
      <Text style={styles.legendAction}>{action}</Text>
      <Text style={styles.legendSep}>—</Text>
      <Text style={styles.legendGesture}>{gesture}</Text>
    </View>
  );
}

/** Static, annotated illustration of the real swipe actions on player cards. No animation. */
export default function SwipeHelpVisual() {
  return (
    <View style={styles.wrap}>
      <MockCard
        leftIcon="checkmark-circle"
        rightIcon="trash"
        name="Jordan"
        showRename
        cells={[
          { label: 'In', value: '40' },
          { label: 'Out', value: '80' },
        ]}
      />
      <View style={styles.legend}>
        <LegendRow color={GREEN} action="Complete" gesture="swipe right" />
        <LegendRow color={RED} action="Delete" gesture="swipe left" />
        <LegendRow renameCue action="Rename" gesture="tap the name" />
      </View>

      <View style={styles.divider} />

      <MockCard
        leftIcon="arrow-undo"
        rightIcon="trash"
        name="Riley"
        cells={[
          { label: 'In', value: '60' },
          { label: 'Out', value: '20' },
          { label: 'Net', value: '−40' },
        ]}
      />
      <View style={styles.legend}>
        <LegendRow color={GREEN} action="Reactivate" gesture="swipe right" />
        <LegendRow color={RED} action="Delete" gesture="swipe left" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.2)',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#0A0A0A',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'transparent',
  },
  tile: {
    width: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  tileGreen: {
    backgroundColor: '#141A14',
    borderColor: 'rgba(76,175,80,0.25)',
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  tileRed: {
    backgroundColor: '#1A1414',
    borderColor: 'rgba(192,70,87,0.25)',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  cardBody: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#161616',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#242424',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  renameGlyph: {
    fontSize: 12,
    color: '#FFFFFF',
    opacity: 0.4,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  dataItem: {
    alignItems: 'flex-start',
    backgroundColor: 'transparent',
  },
  dataLabel: {
    fontSize: 9,
    color: 'rgba(176,114,187,0.65)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 3,
  },
  dataValue: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    fontFamily: 'SpaceMono',
  },
  dataDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#2A2A2A',
    marginHorizontal: 12,
  },
  legend: {
    marginTop: 8,
    marginBottom: 4,
    gap: 4,
    backgroundColor: 'transparent',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  renameCue: {
    width: 8,
    fontSize: 11,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.5)',
  },
  legendAction: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  legendSep: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
  },
  legendGesture: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(176,114,187,0.1)',
    marginVertical: 14,
  },
});
