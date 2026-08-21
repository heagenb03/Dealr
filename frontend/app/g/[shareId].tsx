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
import { ActivityIndicator, StyleSheet } from 'react-native';
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
import { formatSharedAgo } from '@/utils/sharedAgo';
import { fetchSharedGame, SharedGameDoc } from '@/services/sharedGameService';
import { clearPendingShare, setPendingShare } from '@/services/pendingShare';
import { DEFAULT_CURRENCY } from '@/constants/Currencies';
import SummaryView from '@/components/summary/SummaryView';
import SummaryHudHeader from '@/components/summary/SummaryHudHeader';
import SummaryEmptyState from '@/components/summary/SummaryEmptyState';
import PlayerFilterChips from '@/components/summary/PlayerFilterChips';
import SharedGameChrome from '@/components/summary/SharedGameChrome';

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

  // Read off the DOCUMENT, not the snapshot: snapshot.date is the GAME's date.
  // publishSharedGame rebuilds the body on every refresh, so createdAt is the
  // MOST RECENT publish — which is exactly what this line must report.
  const sharedAt = state.status === 'ready' ? state.doc.createdAt : null;

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

  // Every branch below renders inside the SAME chrome, so the CASH CAGE bar and
  // the Done button are in place from the first frame — including a cold
  // deep-link start that never gets past the spinner.
  const frame = (content: React.ReactNode) => (
    <SharedGameChrome onClose={handleClose}>{content}</SharedGameChrome>
  );

  // authLoading first: on first render `params.shareId` can be transiently
  // empty before the router hydrates, and checking `!shareId` first would
  // flash "That link isn't valid" — alarming, wrong copy — on a link someone
  // just tapped, during a window that resolves itself a moment later.
  if (authLoading) return frame(<Loading />);
  if (!shareId) return frame(<Notice label="That link isn't valid" icon="link-outline" />);
  // The auth gate is redirecting; render neutral rather than flashing an error.
  if (!canView) return frame(<Loading />);
  if (state.status === 'loading') return frame(<Loading />);
  if (state.status === 'missing') {
    // Ruling 1: `resource` is null on a nonexistent Firestore doc, so the rules'
    // `resource.data.expiresAt > request.time` read DENIES before existence is
    // ever checked — fetchSharedGame maps that permission-denied the same as a
    // genuinely absent doc. This branch therefore covers BOTH an expired-but-
    // still-present document and a TTL-swept one, and under a 30-day TTL it is
    // the normal end state of every share link ever sent. Copy must read as
    // "this expired", not as a generic failure — the generic message below is
    // reserved for the real transport-error catch.
    return frame(<Notice label="This shared game has expired" icon="time-outline" />);
  }
  if (state.status === 'outdated') {
    return frame(<Notice label="Update Cash Cage to view this game" icon="arrow-up-circle-outline" />);
  }
  if (state.status === 'error' || !snapshot) {
    return frame(<Notice label="Couldn't load this game" icon="cloud-offline-outline" />);
  }

  // An ELEMENT, not an inline arrow component — `ListHeaderComponent={() => …}`
  // is a new component type every render and remounts the whole header.
  const listHeader = (
    <>
      <View style={styles.header}>
        <Text style={styles.gameTitle}>{snapshot.gameName}</Text>
        {/* ONE Text node, not two on a row: filter-then-join is what keeps a missing
            sharedAt from leaving a dangling " · " behind the date, and a single node
            is one screen-reader announcement instead of two fragments. */}
        <Text style={styles.gameMeta}>
          {[
            new Date(snapshot.date).toLocaleDateString(),
            sharedAt && sharedAt.getTime() > 0 ? formatSharedAgo(sharedAt, new Date()) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>

      <View style={styles.heroPotSection}>
        <SummaryHudHeader label="TOTAL POT" />
        <View style={styles.heroPotDisplay}>
          <Text style={styles.heroPotAmount}>{formatAmount(snapshot.totalPot)}</Text>
        </View>
      </View>

      {/* Guarded on the same list PlayerFilterChips renders from: the chip row
          returns null for an empty name list, and an unguarded header would then
          label a row that isn't there. */}
      {chipNames.length > 0 && <SummaryHudHeader label="FILTER BY PLAYER" />}
      <PlayerFilterChips
        names={chipNames}
        selectedName={selectedName}
        onSelect={setSelectedName}
      />

      <SummaryHudHeader label={snapshot.settlementMode === 'banker' ? 'PAYOUTS' : 'SETTLEMENTS'} />
    </>
  );

  return frame(
    <SummaryView
      data={listData}
      formatAmount={formatAmount}
      formatAmountCompact={formatAmountCompact}
      paymentByName={paymentByName}
      reduceMotion={reduceMotion}
      ListHeaderComponent={listHeader}
    />,
  );
}

// The Done row is NOT here — SharedGameChrome owns the only copy, and every
// caller wraps this in it. That exit matters most on exactly this state:
// fetchSharedGame -> getDoc has no timeout, and this repo's own
// sharedGameService docstring documents indefinite-pending as REAL behaviour
// under persistentLocalCache when offline/flaky, so a tapped link can land here
// and never resolve on its own. Deliberately not a fetch timeout: that changes
// behaviour, and any fixed budget short enough to matter would misclassify a
// merely slow connection as an error. The exit is the fix, not a race.
//
// The label is the second half of that: a bare spinner on black tells a viewer
// who just tapped a link nothing about what is being waited on.
function Loading() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color="#B072BB" size="large" />
      <Text style={styles.loadingLabel}>Loading shared game…</Text>
    </View>
  );
}

function Notice({ label, icon }: { label: string; icon: string }) {
  return (
    <View style={styles.centered}>
      <SummaryEmptyState label={label} icon={icon} />
    </View>
  );
}

/**
 * The title block and hero pot match app/(tabs)/(home)/game/summary.tsx VALUE
 * FOR VALUE. They previously drifted — 28 vs 32 on the title, 40 vs 52 on the
 * pot, white vs purple — differences small enough to read as a mistake rather
 * than a signal. The two screens render the same list through the same
 * SummaryView; the header above it now says so too.
 *
 * The shared-ago string has no counterpart on the host screen, so it is appended
 * to the date INSIDE gameMeta rather than given a style of its own — that keeps
 * the two screens' title blocks the same three style keys. There is no
 * `paddingTop` here any more: SharedGameChrome owns the top of the screen and
 * reads the real safe-area inset.
 *
 * SPACING RULE, obeyed by both screens: 14 below every HUD header rule (that is
 * summaryStyles.hudHeader's marginBottom, untouched), 32 of RENDERED space between
 * sections. RENDERED is the operative word — Yoga does not collapse margins, so
 * heroPotDisplay carries no padding at all and listSectionHeader says 24, because
 * every item that can precede it (a settlement card, a payout row, the empty state
 * via summaryStyles.emptyGap) contributes its own 8.
 *
 * The rule governs exactly two gaps: header-rule-to-content, and section-to-next-
 * header. It says nothing about spacing WITHIN a section — the 8 between cards, and
 * the host screen's FallbackBanner, which sits between the SETTLEMENTS header and
 * its cards on the fallback path with its own marginBottom: 10.
 *
 * NOT normalized, and visible on the chip filter's no-settlements path:
 * summaryStyles.emptyState carries paddingVertical: 28, so the empty state's icon
 * ring sits 42 below the header rule where a card's first line sits 28. The layout
 * gaps around it obey the rule; the drawn ones read looser. Left alone deliberately
 * — it is a centred block, not a row of cards.
 *
 * Every value here was chosen against that rule; do not adjust one screen's alone.
 */
const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  loadingLabel: { fontSize: 14, color: '#A0A0A0', marginTop: 12 },
  header: { marginBottom: 32, backgroundColor: 'transparent' },
  gameTitle: { fontSize: 32, fontWeight: 'bold', color: '#B072BB', letterSpacing: 1 },
  // Explicit colour, NOT `opacity: 0.5` on white. Opacity on a Text is applied
  // inconsistently across platforms, and the value it approximated (~#808080) is
  // 5.3:1 on #0A0A0A where #A0A0A0 is 8.9:1. Replaces the old gameDate + sharedAgo
  // pair, which are now one line joined by ' · '.
  gameMeta: { fontSize: 14, color: '#A0A0A0' },
  heroPotSection: { marginBottom: 32 },
  // paddingVertical: 0, not 20. SummaryHudHeader's own marginBottom: 14 is the gap
  // above every other header's content on this screen; the 20 on top of it made the
  // pot's 34/52 while FILTER BY PLAYER sat at 14/32.
  heroPotDisplay: { alignItems: 'center', backgroundColor: 'transparent' },
  // lineHeight is load-bearing, not decoration. With none, a 52pt Text gets ~1.2x
  // natural leading, so the box carries ~10pt of empty space the style values do not
  // show — the rule-to-digit distance would read far wider than the identical 14 above
  // the chips. 56 rather than 52: dropping lineHeight below fontSize clips glyphs on
  // Android.
  heroPotAmount: { fontSize: 52, lineHeight: 56, fontWeight: 'bold', color: '#B072BB' },
});
