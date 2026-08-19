import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from '@/components/Themed';
import { summaryStyles as styles } from './summaryStyles';

export default function SummaryEmptyState({ label, icon }: { label: string; icon: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconRing}>
        <Ionicons name={icon as any} size={28} color="rgba(176,114,187,0.35)" />
      </View>
      <Text style={styles.emptyStateText}>{label}</Text>
    </View>
  );
}
