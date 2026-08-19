/**
 * The summary screen's section header: label flanked by two rules.
 *
 * NOT the same component as components/HudSectionHeader.tsx, which has a
 * different geometry (one rule unless `centered`, wrapped in a flex box with
 * marginRight: 12), a different rule colour and a different marginBottom, plus
 * optional action/settings icon slots. Do not consolidate them here — that is a
 * design decision, not a refactor.
 */
import React from 'react';
import { Text, View } from '@/components/Themed';
import { summaryStyles as styles } from './summaryStyles';

export default function SummaryHudHeader({ label }: { label: string }) {
  return (
    <View style={styles.hudHeader}>
      <View style={styles.hudLine} />
      <Text style={styles.hudLabel}>{label}</Text>
      <View style={styles.hudLine} />
    </View>
  );
}
