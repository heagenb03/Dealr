import React, { useRef, useCallback, useMemo } from 'react';
import { Animated, StyleSheet, TouchableOpacity as RNTouchableOpacity } from 'react-native';
import { Text, View } from '@/components/Themed';
import { Gesture, GestureDetector, TouchableOpacity } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';
import { Player, PlayerBalance } from '@/types/game';
import { useCurrency } from '@/contexts/CurrencyContext';
import { getPaymentMethodMeta } from '@/constants/PaymentMethods';
import { formatHandleForDisplay } from '@/utils/paymentLinks';

interface PlayerCardActiveProps {
  player: Player;
  balance: PlayerBalance | undefined;
  onBuyIn: (player: Player) => void;
  onCashOut: (player: Player) => void;
  onComplete: (player: Player) => void;
  onDelete: (player: Player) => void;
  onRename: (player: Player) => void;
  onEditPayment: (player: Player) => void;
  isBanker?: boolean;
  reduceMotion: boolean;
}

const PlayerCardActive: React.FC<PlayerCardActiveProps> = ({
  player,
  balance,
  onBuyIn,
  onCashOut,
  onComplete,
  onDelete,
  onRename,
  onEditPayment,
  isBanker = false,
  reduceMotion
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const { formatAmount } = useCurrency();

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

  const animateScaleUp = useCallback((velocity: number = 0) => {
    if (!reduceMotion) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 200,
        friction: 15,
        velocity,
        useNativeDriver: true
      }).start();
    }
  }, [reduceMotion, scaleAnim]);

  const tapGesture = useMemo(() => Gesture.Tap()
    .maxDuration(200)
    .maxDistance(10)
    .onBegin(() => runOnJS(animateScaleDown)())
    .onFinalize(() => {
      runOnJS(animateScaleUp)(0);
    }), [animateScaleDown, animateScaleUp]);

  const renderLeftActions = useCallback(() => (
    <TouchableOpacity
      style={styles.completeAction}
      onPress={() => onComplete(player)}
      activeOpacity={0.8}
    >
      <Ionicons name="checkmark-circle" size={22} color="rgba(76,175,80,0.85)" />
    </TouchableOpacity>
  ), [player, onComplete]);

  const renderRightActions = useCallback(() => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => onDelete(player)}
      activeOpacity={0.8}
    >
      <Ionicons name="trash" size={22} color="rgba(192,70,87,0.85)" />
    </TouchableOpacity>
  ), [player, onDelete]);

  return (
    <Swipeable
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
      leftThreshold={40}
      rightThreshold={40}
    >
      <GestureDetector gesture={tapGesture}>
        <Animated.View
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`${player.name}, Buy-in: ${formatAmount(balance?.totalBuyins ?? 0)}, Cash out: ${formatAmount(balance?.totalCashouts ?? 0)}`}
          accessibilityHint="Tap In or Out values to edit. Swipe for actions."
          style={[
            styles.playerCard,
            !reduceMotion && { transform: [{ scale: scaleAnim }] }
          ]}
        >
          {/* Name row */}
          <View style={styles.cardHeader}>
            <RNTouchableOpacity onPress={() => onRename(player)} style={styles.nameRow}>
              <Text style={styles.playerName}>{player.name}</Text>
              <Text style={styles.nameEditIcon}>✎</Text>
              {isBanker && (
                <Text style={styles.bankerLabel}>BANKER</Text>
              )}
              {isBanker && (balance?.totalBuyins ?? 0) === 0 && (balance?.totalCashouts ?? 0) === 0 && (
                <Text style={styles.notPlayingHint}>not playing</Text>
              )}
            </RNTouchableOpacity>
            <RNTouchableOpacity onPress={() => onEditPayment(player)} style={styles.paymentBadge}>
              {player.preferredPayment ? (
                <Text style={styles.paymentBadgeText} numberOfLines={1}>
                  {getPaymentMethodMeta(player.preferredPayment.method).label}
                  {player.preferredPayment.handle ? ` · ${formatHandleForDisplay(player.preferredPayment.method, player.preferredPayment.handle)}` : ''}
                </Text>
              ) : (
                <Text style={styles.paymentBadgeAdd}>+ Payment</Text>
              )}
            </RNTouchableOpacity>
          </View>

          {/* Data row — tappable In / Out values */}
          <View style={styles.dataRow}>
            <RNTouchableOpacity style={styles.dataItem} onPress={() => onBuyIn(player)}>
              <Text style={styles.dataLabel}>In</Text>
              <Text style={styles.dataValue}>{formatAmount(balance?.totalBuyins ?? 0)}</Text>
            </RNTouchableOpacity>
            <View style={styles.dataDivider} />
            <RNTouchableOpacity style={styles.dataItem} onPress={() => onCashOut(player)}>
              <Text style={styles.dataLabel}>Out</Text>
              <Text style={styles.dataValue}>{formatAmount(balance?.totalCashouts ?? 0)}</Text>
            </RNTouchableOpacity>
          </View>
        </Animated.View>
      </GestureDetector>
    </Swipeable>
  );
};

const styles = StyleSheet.create({
  playerCard: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#242424',
    borderTopColor: 'rgba(176,114,187,0.2)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'transparent',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'transparent',
  },
  playerName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  nameEditIcon: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.4,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  dataItem: {
    flex: 1,
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
    height: 28,
    backgroundColor: '#2A2A2A',
    marginHorizontal: 12,
  },
  completeAction: {
    backgroundColor: '#141A14',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.25)',
    height: '100%',
  },
  deleteAction: {
    backgroundColor: '#1A1414',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(192,70,87,0.25)',
    height: '100%',
  },
  paymentBadge: {
    maxWidth: 160,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.25)',
    backgroundColor: 'transparent',
  },
  paymentBadgeText: {
    fontSize: 11,
    color: 'rgba(176,114,187,0.9)',
    fontFamily: 'SpaceMono',
  },
  paymentBadgeAdd: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
  },
  bankerLabel: {
    marginLeft: 6,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#B072BB',
  },
  notPlayingHint: {
    marginLeft: 6,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.35)',
  },
});

export default React.memo(PlayerCardActive, (prevProps, nextProps) => {
  return (
    prevProps.player.id === nextProps.player.id &&
    prevProps.player.name === nextProps.player.name &&
    prevProps.balance?.totalBuyins === nextProps.balance?.totalBuyins &&
    prevProps.balance?.totalCashouts === nextProps.balance?.totalCashouts &&
    prevProps.player.preferredPayment?.method === nextProps.player.preferredPayment?.method &&
    prevProps.player.preferredPayment?.handle === nextProps.player.preferredPayment?.handle &&
    prevProps.isBanker === nextProps.isBanker &&
    prevProps.reduceMotion === nextProps.reduceMotion
  );
});
