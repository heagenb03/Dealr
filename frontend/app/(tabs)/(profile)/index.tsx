import React, { useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text, View } from '@/components/Themed';
import HudSectionHeader from '@/components/HudSectionHeader';
import Button from '@/components/Button';
import PaywallModal from '@/components/PaywallModal';
import { useAuth } from '@/contexts/AuthContext';
import { formatStatNumber, formatMonthYear } from '@/utils/formatUtils';
import { useCurrency } from '@/contexts/CurrencyContext';
import { getTrialLabel } from '@/utils/trialUtils';

// ---------------------------------------------------------------------------
// Account Screen
// ---------------------------------------------------------------------------

export default function AccountScreen() {
  const router = useRouter();
  const { user, userDoc, isPro, isTrialing, trialDaysRemaining } = useAuth();
  const { formatAmountCompact, meta } = useCurrency();

  const [showPaywall, setShowPaywall] = useState(false);

  const displayName = userDoc?.displayName || user?.displayName || 'Anonymous';
  const email = userDoc?.email || user?.email || '';
  const isFree = !isPro && !isTrialing;

  // Stat values — all all-time-accurate (counters + derived from counters).
  const gamesPlayed = userDoc?.totalGamesPlayed ?? 0;
  const moneyTracked = userDoc?.totalMoneyTracked ?? 0;
  const playersHosted = userDoc?.totalPlayersHosted ?? 0;
  const biggestPot = userDoc?.biggestPot ?? 0;
  const avgPot = gamesPlayed > 0 ? moneyTracked / gamesPlayed : 0;
  const hostingSince = userDoc?.createdAt ? formatMonthYear(userDoc.createdAt, meta.locale) : '—';

  const stats: { label: string; value: string }[] = [
    { label: 'GAMES', value: formatStatNumber(gamesPlayed) },
    { label: 'TRACKED', value: formatAmountCompact(moneyTracked) },
    { label: 'PLAYERS', value: formatStatNumber(playersHosted) },
    { label: 'BIGGEST POT', value: biggestPot > 0 ? formatAmountCompact(biggestPot) : '—' },
    { label: 'AVG POT', value: gamesPlayed > 0 ? formatAmountCompact(avgPot) : '—' },
    { label: 'HOSTING SINCE', value: hostingSince },
  ];

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

        {/* Header */}
        <HudSectionHeader
          label="Account"
          centered={true}
          showSettingsIcon={true}
          onSettingsPress={() => router.push('/(tabs)/(profile)/settings' as any)}
        />

        {/* Identity hero — text only, no avatar */}
        <View style={styles.hero}>
          <Text style={styles.heroName}>{displayName}</Text>
          {!!email && <Text style={styles.heroEmail}>{email}</Text>}
        </View>

        {/* Membership card — free */}
        {isFree && (
          <View style={styles.membershipCardUpgrade}>
            <View style={styles.membershipHeader}>
              <Ionicons name="star" size={20} color="#B072BB" style={styles.membershipIcon} />
              <Text style={styles.membershipTitle}>CASH CAGE PRO</Text>
            </View>
            <Text style={styles.membershipFeatures}>
              Unlimited history · 20 players per game · 200 saved
            </Text>
            <Button
              title="Upgrade Now"
              variant="primary"
              fullWidth={true}
              onPress={() => setShowPaywall(true)}
              accessibilityLabel="Upgrade to Cash Cage Pro"
              accessibilityHint="Opens the subscription paywall"
            />
          </View>
        )}

        {/* Membership card — active trial */}
        {isTrialing && (
          <View style={styles.membershipCardTrial}>
            <View style={styles.membershipHeader}>
              <Ionicons name="star" size={16} color="#B072BB" />
              <Text style={styles.membershipBadgeText}>PRO TRIAL</Text>
            </View>
            <Text style={styles.membershipCountdown}>{getTrialLabel(trialDaysRemaining)}</Text>
            <TouchableOpacity onPress={() => setShowPaywall(true)} activeOpacity={0.7}>
              <Text style={styles.membershipLink}>Upgrade to keep Pro</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Membership card — paid Pro */}
        {isPro && !isTrialing && (
          <View style={styles.membershipCardRow}>
            <Ionicons name="star" size={16} color="#B072BB" />
            <Text style={styles.membershipRowText}>
              Pro member{userDoc?.proSince ? ` since ${formatMonthYear(userDoc.proSince, meta.locale)}` : ''}
            </Text>
          </View>
        )}

        {/* Stats */}
        <HudSectionHeader label="Stats" centered={true} />
        <View style={styles.statsGrid}>
          {stats.map((s) => (
            <View key={s.label} style={styles.statTile}>
              <Text style={styles.statLabel}>{s.label}</Text>
              <Text style={styles.statValue}>{s.value}</Text>
            </View>
          ))}
        </View>

      </ScrollView>

      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },

  // Identity hero
  hero: {
    alignItems: 'center',
    paddingVertical: 20,
    marginBottom: 20,
    backgroundColor: 'transparent',
  },
  heroName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  heroEmail: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 4,
    backgroundColor: 'transparent',
  },
  // Membership cards (unified radius 12, #1A1A1A, purple border)
  membershipCardUpgrade: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.4)',
    marginBottom: 20,
  },
  membershipCardTrial: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.3)',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  membershipCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.2)',
    marginBottom: 20,
  },
  membershipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    backgroundColor: 'transparent',
  },
  membershipIcon: {
    marginRight: 8,
  },
  membershipTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#B072BB',
    letterSpacing: 2,
    backgroundColor: 'transparent',
  },
  membershipBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#B072BB',
    letterSpacing: 2,
    backgroundColor: 'transparent',
  },
  membershipFeatures: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
    backgroundColor: 'transparent',
  },
  membershipCountdown: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    backgroundColor: 'transparent',
  },
  membershipLink: {
    fontSize: 12,
    color: '#B072BB',
    textDecorationLine: 'underline',
    backgroundColor: 'transparent',
  },
  membershipRowText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    backgroundColor: 'transparent',
  },

  // Stats grid (2 columns)
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  statTile: {
    width: '48%',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    paddingVertical: 16,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(176,114,187,0.65)',
    letterSpacing: 1.5,
    marginBottom: 6,
    backgroundColor: 'transparent',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.92)',
    backgroundColor: 'transparent',
    ...Platform.select({
      ios: { fontFamily: 'SpaceMono' },
      android: { fontFamily: 'SpaceMono' },
      default: { fontFamily: 'monospace' },
    }),
  },
});
