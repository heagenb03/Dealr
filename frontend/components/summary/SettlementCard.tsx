/**
 * One "X receives $N" card for the game summary, expandable into a grid of who
 * pays what, with a Pay button per payer.
 *
 * `formatAmount` is INJECTED rather than read from CurrencyContext, so a shared
 * game snapshot can be rendered in the GAME's currency instead of the viewer's.
 *
 * TWO structural details are load-bearing and must not be tidied:
 *   1. The expanded payment section sits OUTSIDE the GestureDetector wrapping
 *      settlementCardBody. Inside it, a Pay tap would collapse the card.
 *   2. The badge's tap gesture is registered with requireExternalGestureToFail,
 *      so the card tap only activates once the badge tap has failed — i.e. the
 *      touch was not on the badge.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Linking, TouchableOpacity } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from '@/components/Themed';
import { PreferredPayment } from '@/types/game';
import { getPaymentMethodMeta } from '@/constants/PaymentMethods';
import { buildPaymentUri, formatHandleForDisplay } from '@/utils/paymentLinks';
import { GroupedSettlement, sortPaymentsByAmount } from '@/utils/settlementUtils';
import { buildPaymentGridRows } from '@/utils/paymentGridRows';
import { summaryStyles as styles } from './summaryStyles';

export interface SettlementCardProps {
  groupedSettlement: GroupedSettlement;
  reduceMotion: boolean;
  recipientPayment?: PreferredPayment;
  formatAmount: (value: number) => string;
}

export default function SettlementCard({
  groupedSettlement,
  reduceMotion,
  recipientPayment,
  formatAmount,
}: SettlementCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasHandle = !!recipientPayment?.handle?.trim();
  const methodLabel = recipientPayment ? getPaymentMethodMeta(recipientPayment.method).label : '';
  const displayHandle = recipientPayment && hasHandle
    ? formatHandleForDisplay(recipientPayment.method, recipientPayment.handle)
    : '';

  // Sort payments by amount (largest first), then chunk into fixed-width grid rows.
  // The chunker owns "first cell of a visual row" so the render never has to infer
  // it from the item index — see utils/paymentGridRows.ts for why that matters.
  // The sort lives INSIDE the memo: sortPaymentsByAmount returns a fresh array every
  // call, so keying on its result would change the dep on every render and memoize
  // nothing.
  const paymentRows = useMemo(
    () => buildPaymentGridRows(sortPaymentsByAmount(groupedSettlement).payments),
    [groupedSettlement],
  );

  const handleToggle = useCallback(() => {
    const newExpandedState = !isExpanded;
    setIsExpanded(newExpandedState);

    if (!reduceMotion) {
      Animated.timing(opacityAnim, {
        toValue: newExpandedState ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      opacityAnim.setValue(newExpandedState ? 1 : 0);
    }
  }, [isExpanded, reduceMotion, opacityAnim]);

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

  const handleCopyHandle = useCallback(() => {
    if (!recipientPayment?.handle) return;
    Clipboard.setStringAsync(formatHandleForDisplay(recipientPayment.method, recipientPayment.handle)).catch(() => {});
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1200);
  }, [recipientPayment]);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const badgeTapGesture = useMemo(() => Gesture.Tap()
    .maxDuration(250)
    .hitSlop({ top: 8, bottom: 8, left: 8, right: 8 })
    .onEnd((_event, success) => {
      if (success) {
        runOnJS(handleCopyHandle)();
      }
    }), [handleCopyHandle]);

  const tapGesture = useMemo(() => {
    const tap = Gesture.Tap()
      .maxDuration(200)
      .maxDistance(10)
      .onBegin(() => runOnJS(animateScaleDown)())
      .onFinalize((_, success) => {
        runOnJS(animateScaleUp)();
        if (success) {
          runOnJS(handleToggle)();
        }
      });
    // A tap on the badge must copy, not toggle: the card tap only activates
    // once the badge tap has failed (i.e. the touch wasn't on the badge).
    return hasHandle ? tap.requireExternalGestureToFail(badgeTapGesture) : tap;
  }, [animateScaleDown, animateScaleUp, handleToggle, hasHandle, badgeTapGesture]);

  const handlePay = useCallback((amount: number) => {
    if (!recipientPayment) return;
    const uri = buildPaymentUri(recipientPayment.method, recipientPayment.handle, amount, '');
    if (uri) Linking.openURL(uri).catch(() => {});
  }, [recipientPayment]);

  return (
    <Animated.View
      style={[
        styles.settlementCard,
        !reduceMotion && { transform: [{ scale: scaleAnim }] }
      ]}
    >
      <GestureDetector gesture={tapGesture}>
        <View style={styles.settlementCardBody}>
          <View style={styles.settlementHeader}>
            <View style={styles.recipientNameWrapper}>
              <View
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={`${groupedSettlement.recipient} receives ${formatAmount(groupedSettlement.totalAmount)}. ${isExpanded ? 'Collapse' : 'Expand'} payment details.`}
                accessibilityHint={isExpanded ? 'Double tap to collapse payment details' : 'Double tap to expand payment details'}
                accessibilityState={{ expanded: isExpanded }}
                style={styles.toggleA11yRegion}
              >
                <Text style={styles.recipientName}>{groupedSettlement.recipient}</Text>
              </View>
              {recipientPayment && hasHandle && (
                <GestureDetector gesture={badgeTapGesture}>
                  <View
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={copied ? 'Handle copied' : `Copy ${methodLabel} handle ${displayHandle}`}
                    style={styles.payeeBadgeTap}
                  >
                    <Text style={styles.payeeBadge} numberOfLines={1}>
                      {copied ? 'Copied ✓' : `${methodLabel} · ${displayHandle}`}
                    </Text>
                  </View>
                </GestureDetector>
              )}
              {recipientPayment && !hasHandle && (
                <Text style={styles.payeeBadge} numberOfLines={1}>{methodLabel}</Text>
              )}
            </View>
            <Ionicons
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={20}
              color="rgba(176,114,187,0.6)"
            />
          </View>
          <View style={styles.totalSection}>
            <Text style={styles.totalLabel}>RECEIVES</Text>
            <Text style={styles.totalAmount}>
              {formatAmount(groupedSettlement.totalAmount)}
            </Text>
          </View>
        </View>
      </GestureDetector>

      {/* Payment details — outside GestureDetector so Pay/Copy taps don't collapse the card */}
      {isExpanded && (
        <Animated.View
          style={[
            styles.paymentDetailsSection,
            !reduceMotion && { opacity: opacityAnim }
          ]}
        >
          <View style={styles.paymentDivider} />
          <Text style={styles.paymentSectionLabel}>
            FROM ({groupedSettlement.payments.length} {groupedSettlement.payments.length === 1 ? 'PLAYER' : 'PLAYERS'})
          </Text>
          <View style={styles.paymentGrid}>
            {paymentRows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.paymentGridRow}>
                {row.map((slot, slotIndex) => {
                  if (slot.kind === 'divider') {
                    // The invisible ones still hold their width, so a short last
                    // row keeps the same column positions as the rows above it.
                    return (
                      <View
                        key={slotIndex}
                        style={slot.visible ? styles.paymentGridDivider : styles.paymentGridDividerSpacer}
                      />
                    );
                  }
                  if (slot.kind === 'spacer') {
                    return <View key={slotIndex} style={styles.paymentGridCell} />;
                  }
                  const payment = slot.payment;
                  return (
                    <View key={slotIndex} style={styles.paymentGridCell}>
                      <Text style={styles.paymentNameLabel} numberOfLines={2} ellipsizeMode="tail">
                        {payment.from}
                      </Text>
                      <View style={styles.paymentAmountRow}>
                        <Text style={styles.paymentAmountValue}>
                          {formatAmount(payment.amount)}
                        </Text>
                      </View>
                      {recipientPayment && buildPaymentUri(recipientPayment.method, recipientPayment.handle, payment.amount, 'x') && (
                        <TouchableOpacity onPress={() => handlePay(payment.amount)} style={styles.payButton}>
                          <Text style={styles.payButtonText}>Pay</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </Animated.View>
      )}
    </Animated.View>
  );
}
