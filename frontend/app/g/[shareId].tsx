/**
 * A shared game, read-only.
 *
 * Top level, outside both (auth) and (tabs): a shared game is not a tab and is
 * not one of your games. Opening it is EPHEMERAL — the route renders the
 * snapshot and backing out discards it. There is no "shared with me" list.
 *
 * Renders through the SAME SummaryView the host screen uses (extracted in Plan
 * 1), fed by the SAME buildSummaryListData. That is the whole point: this repo
 * has already watched a forked renderer drift until one copy had to be deleted.
 *
 * NO WRITE PATH EXISTS HERE. Not "disabled" — absent. SummaryView takes no
 * callbacks, so there is nothing to gate, which is why no `readOnly` prop was
 * added (see the plan's Global Constraints).
 *
 * Untested by jest on purpose: rendering SummaryView means rendering a FlatList,
 * which never returns under jest-expo/node. The logic lives in tested pure
 * modules; the wiring is a device-QA item.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Text, View } from '@/components/Themed';
import { PreferredPayment } from '@/types/game';
import { useAuth } from '@/contexts/AuthContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { needsVerification } from '@/utils/emailVerification';
import { createCurrencyFormatters } from '@/utils/currencyFormat';
import { groupSettlementsByRecipient } from '@/utils/settlementUtils';
import { buildSummaryListData } from '@/utils/summaryListData';
import { parseShareId } from '@/utils/shareLink';
import { chipNamesFromBalances, filterSummaryInputs } from '@/utils/shareFilter';
import { paymentMapFromSnapshot, SHARED_GAME_SCHEMA } from '@/utils/sharedGameSnapshot';
import { fetchSharedGame, SharedGameDoc } from '@/services/sharedGameService';
import { clearPendingShare, setPendingShare } from '@/services/pendingShare';
import { DEFAULT_CURRENCY } from '@/constants/Currencies';
import SummaryView from '@/components/summary/SummaryView';
import SummaryHudHeader from '@/components/summary/SummaryHudHeader';
import SummaryEmptyState from '@/components/summary/SummaryEmptyState';
import PlayerFilterChips from '@/components/summary/PlayerFilterChips';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; doc: SharedGameDoc }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'outdated' };

export default function SharedGameScreen() {
  const params = useLocalSearchParams<{ shareId?: string }>();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { user, emailVerified, isLoading: authLoading } = useAuth();

  const shareId = parseShareId(params.shareId ?? null);
  const canView = !!user && !needsVerification(user, emailVerified);

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [selectedName, setSelectedName] = useState<string | null>(null);

  // If the navigator ever reuses this instance across a /g/A -> /g/B transition,
  // a chip selected on game A must not survive into game B's render — the
  // Ruling-2 override would then name a player who isn't in the game being
  // viewed, over an empty balances section.
  useEffect(() => {
    setSelectedName(null);
  }, [shareId]);

  // Stash the id whenever this route cannot render yet, so the auth gate can
  // replay it after sign-in. THIS EFFECT IS THE DEEP-LINK CAPTURE POINT: a child
  // effect runs before its parent's, so the id is in place before _layout.tsx's
  // redirect effect reads it — which removes the cold-start ordering race
  // entirely. Clearing on the success side stops a stale id firing on some
  // later, unrelated auth transition.
  useEffect(() => {
    if (!shareId || authLoading) return;
    if (canView) clearPendingShare();
    else setPendingShare(shareId);
  }, [shareId, canView, authLoading]);

  useEffect(() => {
    if (!shareId || !canView) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetchSharedGame(shareId)
      .then(doc => {
        if (cancelled) return;
        if (!doc) return setState({ status: 'missing' });
        // Installed builds are not upgradable on demand. A snapshot written by a
        // NEWER build may hold a shape this one cannot draw.
        if (doc.schema > SHARED_GAME_SCHEMA) return setState({ status: 'outdated' });
        setState({ status: 'ready', doc });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => { cancelled = true; };
  }, [shareId, canView]);

  const snapshot = state.status === 'ready' ? state.doc.snapshot : null;

  // One formatter bundle per currency, not one per row. Keyed on the SNAPSHOT's
  // currency, not the viewer's: a game played in EUR reads in EUR no matter what
  // the viewer's own preference is. This is the reason Plan 1 extracted
  // createCurrencyFormatters out of CurrencyContext at all.
  const { formatAmount, formatAmountCompact } = useMemo(
    () => createCurrencyFormatters(snapshot?.currency ?? DEFAULT_CURRENCY),
    [snapshot?.currency],
  );

  // Explicitly typed: an untyped `new Map()` on the empty branch widens the memo
  // to Map<any, any> and fails against SummaryView's paymentByName prop.
  const paymentByName = useMemo<Map<string, PreferredPayment>>(
    () => (snapshot ? paymentMapFromSnapshot(snapshot) : new Map()),
    [snapshot],
  );

  const chipNames = useMemo(
    () => (snapshot ? chipNamesFromBalances(snapshot.balances) : []),
    [snapshot],
  );

  // Filtered inputs are kept separate from the built list data so Ruling 2
  // (below) can tell "the table is empty" apart from "this filter has nothing
  // to show" without re-deriving the filter a second time.
  const filtered = useMemo(() => {
    if (!snapshot) return null;
    // Filter the INPUTS and re-run the builder. Filtering the built items would
    // leave a wrong trailing gap (isLast) and could orphan the section header.
    return filterSummaryInputs({
      grouped: groupSettlementsByRecipient(snapshot.settlements),
      balances: snapshot.balances,
      selectedName,
    });
  }, [snapshot, selectedName]);

  const listData = useMemo(() => {
    if (!snapshot || !filtered) return [];
    const built = buildSummaryListData({
      grouped: filtered.grouped,
      balances: filtered.balances,
      // Already RESOLVED at projection time — the snapshot omits players[], so
      // this cannot be re-derived here. See utils/sharedGameSnapshot.ts.
      isBanker: snapshot.settlementMode === 'banker',
      bankerPlayerId: snapshot.bankerPlayerId,
    });

    // Ruling 2: buildSummaryListData's whole-table empty copy ('All balanced' /
    // 'Nothing to pay out') is FALSE under an active chip filter — the table
    // isn't balanced, this one player just has nothing to settle. Swap that
    // item's label for filter-scoped copy that names the player and points
    // back to the chip row (the escape hatch: tapping the selected chip again
    // clears it). Narrowed on `item.type === 'empty'`, not the key string, so
    // TS keeps the discriminated-union spread sound.
    if (selectedName && filtered.grouped.length === 0) {
      return built.map(item =>
        item.type === 'empty'
          ? { ...item, label: `${selectedName} has nothing to settle` }
          : item,
      );
    }
    return built;
  }, [snapshot, filtered, selectedName]);

  const handleClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }, [router]);

  // authLoading first: on first render `params.shareId` can be transiently
  // empty before the router hydrates, and checking `!shareId` first would
  // flash "That link isn't valid" — alarming, wrong copy — on a link someone
  // just tapped, during a window that resolves itself a moment later.
  if (authLoading) return <Loading onClose={handleClose} />;
  if (!shareId) return <Notice label="That link isn't valid" icon="link-outline" onClose={handleClose} />;
  // The auth gate is redirecting; render neutral rather than flashing an error.
  if (!canView) return <Loading onClose={handleClose} />;
  if (state.status === 'loading') return <Loading onClose={handleClose} />;
  if (state.status === 'missing') {
    // Ruling 1: `resource` is null on a nonexistent Firestore doc, so the rules'
    // `resource.data.expiresAt > request.time` read DENIES before existence is
    // ever checked — fetchSharedGame maps that permission-denied the same as a
    // genuinely absent doc. This branch therefore covers BOTH an expired-but-
    // still-present document and a TTL-swept one, and under a 30-day TTL it is
    // the normal end state of every share link ever sent. Copy must read as
    // "this expired", not as a generic failure — the generic message below is
    // reserved for the real transport-error catch.
    return <Notice label="This shared game has expired" icon="time-outline" onClose={handleClose} />;
  }
  if (state.status === 'outdated') {
    return <Notice label="Update Cash Cage to view this game" icon="arrow-up-circle-outline" onClose={handleClose} />;
  }
  if (state.status === 'error' || !snapshot) {
    return <Notice label="Couldn't load this game" icon="cloud-offline-outline" onClose={handleClose} />;
  }

  // An ELEMENT, not an inline arrow component — `ListHeaderComponent={() => …}`
  // is a new component type every render and remounts the whole header.
  const listHeader = (
    <>
      <View style={styles.header}>
        <Text style={styles.gameTitle}>{snapshot.gameName}</Text>
        <Text style={styles.gameDate}>{new Date(snapshot.date).toLocaleDateString()}</Text>
      </View>

      <View style={styles.heroPotSection}>
        <SummaryHudHeader label="TOTAL POT" />
        <View style={styles.heroPotDisplay}>
          <Text style={styles.heroPotAmount}>{formatAmount(snapshot.totalPot)}</Text>
        </View>
      </View>

      <PlayerFilterChips
        names={chipNames}
        selectedName={selectedName}
        onSelect={setSelectedName}
      />

      <SummaryHudHeader label={snapshot.settlementMode === 'banker' ? 'PAYOUTS' : 'SETTLEMENTS'} />

      {snapshot.settlementMode === 'banker' && (
        <Text style={styles.bankerSubhead}>
          {snapshot.bankerName ?? '—'}, the banker, pays out below
        </Text>
      )}
    </>
  );

  return (
    <View style={styles.container}>
      <SummaryView
        data={listData}
        formatAmount={formatAmount}
        formatAmountCompact={formatAmountCompact}
        paymentByName={paymentByName}
        reduceMotion={reduceMotion}
        ListHeaderComponent={listHeader}
      />
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.doneButton}
          onPress={handleClose}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Carries the same Done row as Notice. fetchSharedGame -> getDoc has no
// timeout, and this repo's own sharedGameService docstring documents
// indefinite-pending as REAL behaviour under persistentLocalCache when
// offline/flaky — a tapped link can land here and never resolve on its own.
// The root Stack is headerShown: false, so without this row a stuck fetch (or
// a stuck auth gate) traps the viewer on a spinner with no way out, cold-start
// or otherwise. Deliberately not a fetch timeout: that changes behaviour, and
// any fixed budget short enough to matter would misclassify a merely slow
// connection as an error. The exit is the fix, not a race.
function Loading({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.container}>
      <View style={styles.centered}>
        <ActivityIndicator color="#B072BB" size="large" />
      </View>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.doneButton}
          onPress={onClose}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Notice({ label, icon, onClose }: { label: string; icon: string; onClose: () => void }) {
  return (
    <View style={styles.container}>
      <View style={styles.centered}>
        <SummaryEmptyState label={label} icon={icon} />
      </View>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.doneButton}
          onPress={onClose}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingTop: 60, paddingBottom: 8 },
  gameTitle: { fontSize: 28, fontWeight: '700', color: '#FFFFFF' },
  gameDate: { fontSize: 14, color: '#A0A0A0', marginTop: 4 },
  heroPotSection: { marginTop: 24, marginBottom: 24 },
  heroPotDisplay: { alignItems: 'center', paddingVertical: 12 },
  heroPotAmount: { fontSize: 40, fontWeight: '700', color: '#B072BB' },
  bankerSubhead: { fontSize: 13, color: '#A0A0A0', marginTop: 6, marginBottom: 8 },
  actions: { padding: 20, paddingBottom: 34 },
  doneButton: {
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#B072BB',
    alignItems: 'center',
  },
  doneText: { fontSize: 16, fontWeight: '700', color: '#0A0A0A' },
});
