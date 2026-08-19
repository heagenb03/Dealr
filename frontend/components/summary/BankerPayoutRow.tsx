/**
 * Banker-mode payout row — a flat "pay this player their stack" line with an
 * optional instant Pay button. No expand/collapse: the payer is always the
 * banker, so there is nothing to drill into.
 *
 * `formatAmount` is INJECTED rather than read from CurrencyContext, so a shared
 * game snapshot can be rendered in the GAME's currency instead of the viewer's.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, TouchableOpacity } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text, View } from '@/components/Themed';
import { PreferredPayment } from '@/types/game';
import { getPaymentMethodMeta } from '@/constants/PaymentMethods';
import { buildPaymentUri, formatHandleForDisplay } from '@/utils/paymentLinks';
import { summaryStyles as styles } from './summaryStyles';

export interface BankerPayoutRowProps {
  recipient: string;
  amount: number;
  recipientPayment?: PreferredPayment;
  formatAmount: (value: number) => string;
}

export default function BankerPayoutRow({
  recipient,
  amount,
  recipientPayment,
  formatAmount,
}: BankerPayoutRowProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasHandle = !!recipientPayment?.handle?.trim();
  const methodLabel = recipientPayment ? getPaymentMethodMeta(recipientPayment.method).label : '';
  const displayHandle = recipientPayment && hasHandle
    ? formatHandleForDisplay(recipientPayment.method, recipientPayment.handle)
    : '';
  const canPay =
    !!recipientPayment &&
    !!buildPaymentUri(recipientPayment.method, recipientPayment.handle, amount, 'x');

  const handleCopyHandle = useCallback(() => {
    if (!recipientPayment?.handle) return;
    Clipboard.setStringAsync(
      formatHandleForDisplay(recipientPayment.method, recipientPayment.handle),
    ).catch(() => {});
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1200);
  }, [recipientPayment]);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const handlePay = useCallback(() => {
    if (!recipientPayment) return;
    const uri = buildPaymentUri(recipientPayment.method, recipientPayment.handle, amount, '');
    if (uri) Linking.openURL(uri).catch(() => {});
  }, [recipientPayment, amount]);

  return (
    <View style={styles.payoutRow}>
      <View style={styles.payoutInfo}>
        <Text style={styles.recipientName}>{recipient}</Text>
        {recipientPayment && hasHandle && (
          <TouchableOpacity
            onPress={handleCopyHandle}
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Handle copied' : `Copy ${methodLabel} handle ${displayHandle}`}
            style={styles.payeeBadgeTap}
          >
            <Text style={styles.payeeBadge} numberOfLines={1}>
              {copied ? 'Copied ✓' : `${methodLabel} · ${displayHandle}`}
            </Text>
          </TouchableOpacity>
        )}
        {recipientPayment && !hasHandle && (
          <Text style={styles.payeeBadge} numberOfLines={1}>{methodLabel}</Text>
        )}
      </View>
      <View style={styles.payoutRight}>
        <Text style={styles.payoutAmount}>{formatAmount(amount)}</Text>
        {canPay && (
          <TouchableOpacity onPress={handlePay} style={styles.payButton}>
            <Text style={styles.payButtonText}>Pay →</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
