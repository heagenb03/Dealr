import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Text, View } from '@/components/Themed';
import ModalButton from '@/components/ModalButton';
import { PRIVACY_POLICY_URL, TERMS_URL } from '@/constants/Links';
import { PurchasesPackage } from 'react-native-purchases';
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
} from '@/services/revenueCatService';
import { useAuth } from '@/contexts/AuthContext';
import { setProSince } from '@/services/firebaseService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaywallModalProps {
  visible: boolean;
  onClose: () => void;
  /** Optional message shown at the top to explain why the paywall appeared */
  triggerMessage?: string;
}

type PlanKey = 'monthly' | 'annual' | 'lifetime';

// Hardcoded display data shown while offerings load or as fallback
const DISPLAY_MONTHLY = {
  period: 'Monthly',
  price: '$1.99',
  detail: 'per month',
};
const DISPLAY_ANNUAL = {
  period: 'Annual',
  price: '$10.99',
  detail: 'per year · ~$0.92/mo',
};
const DISPLAY_LIFETIME = {
  period: 'Lifetime',
  price: '$17.99',
  detail: 'one-time · pay once, keep forever',
};

const PLAN_ROWS: Array<{
  key: PlanKey;
  period: string;
  detail: string;
  bestValue?: boolean;
}> = [
  { key: 'monthly', period: DISPLAY_MONTHLY.period, detail: DISPLAY_MONTHLY.detail },
  { key: 'annual', period: DISPLAY_ANNUAL.period, detail: DISPLAY_ANNUAL.detail },
  { key: 'lifetime', period: DISPLAY_LIFETIME.period, detail: DISPLAY_LIFETIME.detail, bestValue: true },
];

const FEATURES = [
  'Unlimited game history',
  'Unlimited players per game',
  'Save & bulk-manage players',
  'All your devices',
];

// ---------------------------------------------------------------------------
// SectionLabel
// ---------------------------------------------------------------------------

/** HUD micro-label between hairline rules — the app's section-header grammar. */
function SectionLabel({ label }: { label: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <View style={styles.sectionLine} />
      <Text style={styles.sectionLabelText}>{label}</Text>
      <View style={styles.sectionLine} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// PaywallModal
// ---------------------------------------------------------------------------

export default function PaywallModal({ visible, onClose, triggerMessage }: PaywallModalProps) {
  const { user, refreshEntitlements, lapsed, trialExpired } = useAuth();
  // A lapsed subscriber also satisfies trialExpired (their old trialEndsAt is long
  // past), so lapsed must be checked FIRST or they get trial copy.
  const showEndedBanner = lapsed || trialExpired;

  const [selectedPeriod, setSelectedPeriod] = useState<PlanKey>('annual');
  const [offerings, setOfferings] = useState<{
    monthly: PurchasesPackage | null;
    annual: PurchasesPackage | null;
    lifetime: PurchasesPackage | null;
  }>({ monthly: null, annual: null, lifetime: null });
  const [loading, setLoading] = useState(false);
  const [offeringsLoading, setOfferingsLoading] = useState(false);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(false);

  // Fetch offerings when modal opens
  useEffect(() => {
    if (!visible) return;

    setError('');
    setSelectedPeriod('annual');

    const fetchOfferings = async () => {
      setOfferingsLoading(true);
      try {
        const result = await getOfferings();
        if (result?.current?.availablePackages) {
          const pkgs = result.current.availablePackages;
          const monthly = pkgs.find(p =>
            p.packageType === 'MONTHLY' ||
            p.product.identifier.includes('monthly')
          ) ?? null;
          const annual = pkgs.find(p =>
            p.packageType === 'ANNUAL' ||
            p.product.identifier.includes('annual')
          ) ?? null;
          const lifetime = pkgs.find(p =>
            p.packageType === 'LIFETIME' ||
            p.product.identifier.includes('lifetime')
          ) ?? null;
          setOfferings({ monthly, annual, lifetime });
        }
      } catch {
        // Offerings unavailable — fall back to display-only UI
      } finally {
        setOfferingsLoading(false);
      }
    };

    fetchOfferings();
  }, [visible]);

  const selectedPackage =
    selectedPeriod === 'monthly' ? offerings.monthly :
    selectedPeriod === 'annual'  ? offerings.annual  :
    offerings.lifetime;

  const handlePurchase = useCallback(async () => {
    if (!selectedPackage) {
      setError('Unable to load pricing. Please check your connection and try again.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const customerInfo = await purchasePackage(selectedPackage);
      if (customerInfo) {
        // Set proSince timestamp (fire-and-forget, only sets if not already set)
        if (user?.uid) {
          setProSince(user.uid).catch(err => console.warn('setProSince failed:', err));
        }
        // Purchase succeeded — refresh entitlements in AuthContext
        await refreshEntitlements();
        onClose();
      }
      // null = user cancelled — stay on paywall
    } catch (err: any) {
      const message = err?.message ?? 'Purchase failed. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [selectedPackage, refreshEntitlements, onClose]);

  const handleRestore = useCallback(async () => {
    setRestoring(true);
    setError('');
    try {
      const customerInfo = await restorePurchases();
      if (customerInfo?.entitlements?.active?.['pro']) {
        if (user?.uid) {
          setProSince(user.uid).catch(err => console.warn('setProSince failed:', err));
        }
        await refreshEntitlements();
        onClose();
      } else {
        setError('No active Pro subscription found to restore.');
      }
    } catch {
      setError('Restore failed. Please try again.');
    } finally {
      setRestoring(false);
    }
  }, [refreshEntitlements, onClose]);

  const getDisplayPrice = (period: PlanKey): string => {
    const pkg =
      period === 'monthly' ? offerings.monthly :
      period === 'annual'  ? offerings.annual  :
      offerings.lifetime;
    if (pkg?.product?.priceString) return pkg.product.priceString;
    return period === 'monthly' ? DISPLAY_MONTHLY.price :
           period === 'annual'  ? DISPLAY_ANNUAL.price  :
           DISPLAY_LIFETIME.price;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetAccent} />
            {/* Dismiss button */}
            <TouchableOpacity style={styles.dismissButton} onPress={onClose} accessibilityLabel="Close paywall">
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              {/* Header — HUD grammar: hairline rules flanking the title */}
              <View style={styles.headerRow}>
                <View style={styles.headerLine} />
                <Text style={styles.title}>CASH CAGE PRO</Text>
                <View style={styles.headerLine} />
              </View>

              {showEndedBanner && (
                <View style={styles.trialExpiredBanner}>
                  <Ionicons name="time-outline" size={16} color="#FFB547" />
                  <Text style={styles.trialExpiredText}>
                    {lapsed
                      ? 'Your Pro subscription has ended. Resubscribe to keep full access.'
                      : 'Your free trial has ended. Upgrade to keep full access.'}
                  </Text>
                </View>
              )}

              {triggerMessage && !showEndedBanner && (
                <Text style={styles.triggerMessage}>{triggerMessage}</Text>
              )}

              {/* Unlocks — un-carded ledger rows */}
              <SectionLabel label="Unlocks" />
              <View style={styles.featureList}>
                {FEATURES.map((feature) => (
                  <View key={feature} style={styles.featureRow}>
                    <Text style={styles.featurePlus}>+</Text>
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </View>

              {/* Plan selector — single ledger container, hairline-divided rows */}
              <SectionLabel label="Plan" />
              {offeringsLoading ? (
                <ActivityIndicator color="#B072BB" style={styles.offeringsSpinner} />
              ) : (
                <View style={styles.planLedger}>
                  <View style={styles.planLedgerAccent} />
                  {PLAN_ROWS.map((row, index) => {
                    const selected = selectedPeriod === row.key;
                    return (
                      <React.Fragment key={row.key}>
                        {index > 0 && <View style={styles.planDivider} />}
                        <TouchableOpacity
                          style={styles.planRow}
                          onPress={() => setSelectedPeriod(row.key)}
                          activeOpacity={0.8}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          accessibilityLabel={`${row.period} plan, ${getDisplayPrice(row.key)}, ${row.detail}${row.bestValue ? ', Best Value' : ''}`}
                        >
                          {selected && <View style={styles.planSelectedBar} />}
                          <View style={styles.planRowLeft}>
                            <View style={styles.planLabelRow}>
                              <Text style={[styles.planPeriod, selected && styles.planPeriodSelected]}>
                                {row.period}
                              </Text>
                              {row.bestValue && <Text style={styles.bestValueLabel}>Best Value</Text>}
                            </View>
                            <Text style={styles.planDetail}>{row.detail}</Text>
                          </View>
                          <Text style={[styles.planPrice, selected && styles.planPriceSelected]}>
                            {getDisplayPrice(row.key)}
                          </Text>
                        </TouchableOpacity>
                      </React.Fragment>
                    );
                  })}
                </View>
              )}

              {/* Error */}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              {/* CTA */}
              <View style={styles.ctaContainer}>
                {loading ? (
                  <ActivityIndicator color="#B072BB" size="large" />
                ) : (
                  <ModalButton
                    title="Upgrade Now"
                    variant="confirm"
                    onPress={handlePurchase}
                    disabled={loading || offeringsLoading}
                  />
                )}
              </View>

              {/* Restore */}
              <TouchableOpacity
                onPress={handleRestore}
                disabled={restoring}
                style={styles.restoreButton}
                accessibilityLabel="Restore purchases"
              >
                {restoring ? (
                  <ActivityIndicator size="small" color="rgba(255,255,255,0.4)" />
                ) : (
                  <Text style={styles.restoreText}>Restore purchases</Text>
                )}
              </TouchableOpacity>

              {/* Subscription disclosure (required by Apple Guideline 3.1.2) */}
              <Text style={styles.disclosureText}>
                Cash Cage Pro is offered as a monthly auto-renewing subscription ($1.99/month) or
                an annual auto-renewing subscription ($10.99/year), or as a one-time Lifetime
                purchase ($17.99). Payment will be charged to your Apple ID account at confirmation
                of purchase. Subscriptions automatically renew unless auto-renew is turned off at
                least 24 hours before the end of the current period. Your account will be charged
                for renewal within 24 hours prior to the end of the current period. You can manage
                and cancel your subscriptions by going to your App Store account settings after
                purchase.
              </Text>

              <View style={styles.legalRow}>
                <Text
                  style={styles.legalLink}
                  onPress={() => Linking.openURL(TERMS_URL).catch(() => {})}
                  accessibilityRole="link"
                >
                  Terms of Use (EULA)
                </Text>
                <Text style={styles.legalSep}>  ·  </Text>
                <Text
                  style={styles.legalLink}
                  onPress={() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {})}
                  accessibilityRole="link"
                >
                  Privacy Policy
                </Text>
              </View>

            </ScrollView>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0A0A0A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#242424',
    overflow: 'hidden',
    paddingBottom: 40,
    maxHeight: '90%',
  },
  sheetAccent: {
    height: 1,
    backgroundColor: 'rgba(176,114,187,0.15)',
  },
  dismissButton: {
    alignSelf: 'flex-end',
    padding: 16,
    paddingBottom: 4,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    backgroundColor: 'transparent',
  },
  headerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(176,114,187,0.2)',
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#B072BB',
    letterSpacing: 3,
    backgroundColor: 'transparent',
  },
  trialExpiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,181,71,0.08)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,181,71,0.15)',
  },
  trialExpiredText: {
    flex: 1,
    fontSize: 13,
    color: '#FFB547',
    lineHeight: 18,
    backgroundColor: 'transparent',
  },
  triggerMessage: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
    backgroundColor: 'transparent',
  },

  // Section labels (HUD grammar)
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(176,114,187,0.2)',
  },
  sectionLabelText: {
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 3,
    color: '#B072BB',
    backgroundColor: 'transparent',
  },

  // Features (un-carded)
  featureList: {
    gap: 10,
    marginBottom: 20,
    backgroundColor: 'transparent',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  featurePlus: {
    fontSize: 15,
    color: 'rgba(176,114,187,0.7)',
    marginRight: 10,
    backgroundColor: 'transparent',
    ...Platform.select({
      ios: { fontFamily: 'SpaceMono' },
      android: { fontFamily: 'SpaceMono' },
      default: { fontFamily: 'monospace' },
    }),
  },
  featureText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
    backgroundColor: 'transparent',
  },

  // Plan cards
  offeringsSpinner: {
    marginVertical: 24,
  },
  planLedger: {
    backgroundColor: '#161616',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#242424',
    overflow: 'hidden',
    marginBottom: 20,
  },
  planLedgerAccent: {
    height: 1,
    backgroundColor: 'rgba(176,114,187,0.15)',
  },
  planDivider: {
    height: 1,
    backgroundColor: 'rgba(176,114,187,0.1)',
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  planSelectedBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#B072BB',
  },
  planRowLeft: {
    backgroundColor: 'transparent',
  },
  planLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  planPeriod: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.5)',
    backgroundColor: 'transparent',
  },
  planPeriodSelected: {
    color: 'rgba(176,114,187,0.9)',
  },
  bestValueLabel: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: 'rgba(176,114,187,0.65)',
    backgroundColor: 'transparent',
  },
  planDetail: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    marginTop: 4,
    backgroundColor: 'transparent',
  },
  planPrice: {
    fontSize: 18,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
    backgroundColor: 'transparent',
    ...Platform.select({
      ios: { fontFamily: 'SpaceMono' },
      android: { fontFamily: 'SpaceMono' },
      default: { fontFamily: 'monospace' },
    }),
  },
  planPriceSelected: {
    color: '#FFFFFF',
  },

  // Error
  errorText: {
    fontSize: 13,
    color: '#FF3B5C',
    textAlign: 'center',
    marginBottom: 12,
    backgroundColor: 'transparent',
  },

  // CTA
  ctaContainer: {
    marginBottom: 16,
  },

  // Restore
  restoreButton: {
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 12,
  },
  restoreText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    textDecorationLine: 'underline',
  },

  // Legal
  disclosureText: {
    fontSize: 10,
    lineHeight: 14,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 10,
    backgroundColor: 'transparent',
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  legalLink: {
    fontSize: 12,
    color: '#B072BB',
    textDecorationLine: 'underline',
  },
  legalSep: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    backgroundColor: 'transparent',
  },
});
