/**
 * Read-only per-player balance card for the game summary: name, then IN / OUT /
 * NET.
 *
 * `formatAmountCompact` is INJECTED rather than read from CurrencyContext. The
 * host screen passes the signed-in user's formatter; a shared-game route passes
 * one built for the GAME's currency, which need not be the viewer's preference.
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { Animated } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Text, View } from '@/components/Themed';
import { PlayerBalance } from '@/types/game';
import { getNetBalanceColor, netBalanceDisplay } from '@/utils/formatUtils';
import { summaryStyles as styles } from './summaryStyles';

export interface BalanceCardProps {
  balance: PlayerBalance;
  reduceMotion: boolean;
  hint?: string;
  formatAmountCompact: (value: number) => string;
}

export default function BalanceCard({
  balance,
  reduceMotion,
  hint,
  formatAmountCompact,
}: BalanceCardProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const animateScaleDown = useCallback(() => {
    if (!reduceMotion) {
      Animated.spring(scaleAnim, {
        toValue: 0.975,
        tension: 300,
        friction: 20,
        useNativeDriver: true
      }).start();
    }
  }, [reduceMotion, scaleAnim]);

  const animateScaleUp = useCallback(() => {
    if (!reduceMotion) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 200,
        friction: 15,
        useNativeDriver: true
      }).start();
    }
  }, [reduceMotion, scaleAnim]);

  const tapGesture = useMemo(() => Gesture.Tap()
    .maxDuration(200)
    .maxDistance(10)
    .onBegin(() => runOnJS(animateScaleDown)())
    .onFinalize(() => runOnJS(animateScaleUp)()), [animateScaleDown, animateScaleUp]);

  // Summary cards show compact (k/M) figures at a glance; settlement cards carry the exact amounts.
  // The sign rule lives in netBalanceDisplay so this card and the active screen's
  // PlayerCardCompleted cannot drift apart again.
  const netDisplay = netBalanceDisplay(balance.netBalance, formatAmountCompact);

  return (
    <GestureDetector gesture={tapGesture}>
      <Animated.View
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`${balance.playerName}, Net: ${netDisplay}`}
        style={[
          styles.playerCard,
          !reduceMotion && { transform: [{ scale: scaleAnim }] }
        ]}
      >
        {/* Name row */}
        <View style={styles.cardHeader}>
          <View style={styles.nameRow}>
            <Text style={styles.playerName}>{balance.playerName}</Text>
            {hint && <Text style={styles.balanceHint}>{hint}</Text>}
          </View>
        </View>

        {/* Data row — IN | OUT | NET */}
        <View style={styles.dataRow}>
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>In</Text>
            <Text style={styles.dataValue} numberOfLines={1}>{formatAmountCompact(balance.totalBuyins)}</Text>
          </View>
          <View style={styles.dataDivider} />
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>Out</Text>
            <Text style={styles.dataValue} numberOfLines={1}>{formatAmountCompact(balance.totalCashouts)}</Text>
          </View>
          <View style={styles.dataDivider} />
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>Net</Text>
            <Text style={[
              styles.dataValue,
              { color: getNetBalanceColor(balance.netBalance) }
            ]} numberOfLines={1}>
              {netDisplay}
            </Text>
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
