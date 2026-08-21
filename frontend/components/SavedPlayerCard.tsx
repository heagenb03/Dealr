import React, { useRef, useCallback, useMemo } from 'react';
import { Animated, StyleSheet, TouchableOpacity as RNTouchableOpacity } from 'react-native';
import { Text, View } from '@/components/Themed';
import { Gesture, GestureDetector, TouchableOpacity } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';
import { SavedPlayer } from '@/services/savedPlayersService';
import { getPaymentMethodMeta } from '@/constants/PaymentMethods';
import { formatHandleForDisplay } from '@/utils/paymentLinks';
import { resolvePayment, paymentSignature, filledMethods } from '@/utils/paymentMethods';

interface SavedPlayerCardProps {
  player: SavedPlayer;
  onRename: (player: SavedPlayer) => void;
  onEditPayment: (player: SavedPlayer) => void;
  onDelete: (player: SavedPlayer) => void;
  reduceMotion: boolean;
}

const SavedPlayerCard: React.FC<SavedPlayerCardProps> = ({
  player,
  onRename,
  onEditPayment,
  onDelete,
  reduceMotion,
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const animateScaleDown = useCallback(() => {
    if (!reduceMotion) {
      Animated.spring(scaleAnim, { toValue: 0.975, tension: 300, friction: 20, useNativeDriver: true }).start();
    }
  }, [reduceMotion, scaleAnim]);

  const animateScaleUp = useCallback((velocity: number = 0) => {
    if (!reduceMotion) {
      Animated.spring(scaleAnim, { toValue: 1, tension: 200, friction: 15, velocity, useNativeDriver: true }).start();
    }
  }, [reduceMotion, scaleAnim]);

  // Body tap only animates (no navigation) — matches PlayerCardActive.
  const tapGesture = useMemo(() => Gesture.Tap()
    .maxDuration(200)
    .maxDistance(10)
    .onBegin(() => runOnJS(animateScaleDown)())
    .onFinalize(() => { runOnJS(animateScaleUp)(0); }), [animateScaleDown, animateScaleUp]);

  const renderRightActions = useCallback(() => (
    <TouchableOpacity style={styles.deleteAction} onPress={() => onDelete(player)} activeOpacity={0.8}>
      <Ionicons name="trash" size={22} color="rgba(192,70,87,0.85)" />
    </TouchableOpacity>
  ), [player, onDelete]);

  // player.preferredPayment is always undefined (derived only at the storage serialize
  // boundary — see savedPlayersService.ts) — resolve the badge from methods/defaultMethod.
  const legacy = resolvePayment(player);
  const extra = legacy ? filledMethods(player).filter(m => m !== legacy.method).length : 0;
  const badge = legacy
    ? `${getPaymentMethodMeta(legacy.method).label}${
        legacy.handle ? ` · ${formatHandleForDisplay(legacy.method, legacy.handle)}` : ''
      }${extra > 0 ? ` +${extra}` : ''}`
    : null;

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={2}
      rightThreshold={40}
    >
      <GestureDetector gesture={tapGesture}>
        <Animated.View
          accessible={false}
          style={[styles.playerCard, !reduceMotion && { transform: [{ scale: scaleAnim }] }]}
        >
          <View style={styles.cardHeader}>
            <RNTouchableOpacity
              onPress={() => onRename(player)}
              style={styles.nameRow}
              accessibilityRole="button"
              accessibilityLabel={`Rename ${player.name}`}
            >
              <Text style={styles.playerName}>{player.name}</Text>
              <Text style={styles.nameEditIcon}>✎</Text>
            </RNTouchableOpacity>
            <RNTouchableOpacity
              onPress={() => onEditPayment(player)}
              style={styles.paymentBadge}
              accessibilityRole="button"
              accessibilityLabel={badge ? `Edit payment, ${badge}` : `Add payment for ${player.name}`}
            >
              {badge ? (
                <Text style={styles.paymentBadgeText} numberOfLines={1}>{badge}</Text>
              ) : (
                <Text style={styles.paymentBadgeAdd}>+ Payment</Text>
              )}
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
    backgroundColor: 'transparent',
    gap: 12,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
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
  paymentBadge: {
    maxWidth: 180,
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
});

export default React.memo(SavedPlayerCard, (prev, next) =>
  prev.player.name === next.player.name &&
  // player.preferredPayment is always undefined now (derived only at the storage serialize
  // boundary), so comparing it directly would always read equal and mask a payment change —
  // paymentSignature compares the actual methods/defaultMethod map instead.
  paymentSignature(prev.player) === paymentSignature(next.player) &&
  prev.reduceMotion === next.reduceMotion,
);
