import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from '@/components/Themed';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

/** One-time nudge pointing at the top-bar (?) icon. Static (no animation). */
export default function HelpHint({ visible, onDismiss }: Props) {
  if (!visible) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bubble}>
        <Ionicons name="arrow-up" size={16} color="#B072BB" />
        <Text style={styles.text}>New here? Tap for help</Text>
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss hint"
        >
          <Ionicons name="close" size={14} color="rgba(255,255,255,0.5)" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 8,
    right: 12,
    zIndex: 20,
    backgroundColor: 'transparent',
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.4)',
  },
  text: { fontSize: 13, color: '#FFFFFF', fontWeight: '600' },
});
