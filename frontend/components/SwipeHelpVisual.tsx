import React from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from '@/components/Themed';

/** Static, annotated illustration of the swipe-to-reveal actions. No animation. */
export default function SwipeHelpVisual() {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Active card</Text>
        <View style={styles.actions}>
          <Ionicons name="arrow-back" size={14} color="rgba(176,114,187,0.7)" />
          <Text style={styles.action}>Rename</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.action}>Complete</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={[styles.action, styles.danger]}>Delete</Text>
        </View>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Completed card</Text>
        <View style={styles.actions}>
          <Ionicons name="arrow-back" size={14} color="rgba(176,114,187,0.7)" />
          <Text style={styles.action}>Reactivate</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={[styles.action, styles.danger]}>Delete</Text>
        </View>
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
  row: { backgroundColor: 'transparent', gap: 6 },
  rowLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'transparent' },
  action: { fontSize: 13, color: '#FFFFFF', fontWeight: '600' },
  danger: { color: '#FF3B5C' },
  dot: { color: 'rgba(255,255,255,0.3)', fontSize: 13 },
  divider: {
    height: 1,
    backgroundColor: 'rgba(176,114,187,0.1)',
    marginVertical: 12,
  },
});
