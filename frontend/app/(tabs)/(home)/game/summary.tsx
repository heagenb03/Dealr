import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { StyleSheet, FlatList, ListRenderItemInfo, TouchableOpacity, Share, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { Text, View } from '@/components/Themed';
import { useGame } from '@/contexts/GameContext';
import { useRouter, useFocusEffect } from 'expo-router';
import { useHelp } from '@/contexts/HelpContext';
import { useAuth } from '@/contexts/AuthContext';
import HelpSheet from '@/components/HelpSheet';
import { getSummaryTopicIds, getTopicsByIds } from '@/constants/helpTopics';
import { GameService } from '@/services/gameService';
import { reverseProfileStats } from '@/services/firebaseService';
import { getSettlements, calculateBankerSettlements, SOLVER_TIMEOUT_SENTINEL } from '@/services/settlementService';
import { PlayerBalance, SettlementResult } from '@/types/game';
import { groupSettlementsByRecipient } from '@/utils/settlementUtils';
import { useCurrency } from '@/contexts/CurrencyContext';
import Button from '@/components/Button';
import { Ionicons } from '@expo/vector-icons';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { computeRoundingDistortion } from '@/utils/roundingUtils';
import { resolveCashUnit } from '@/constants/CashUnits';
import { resolveTolerance } from '@/constants/Tolerances';
import { PreferredPayment } from '@/types/game';
import { buildShareMessage } from '@/utils/shareMessage';
import AppModal, { appModalStyles } from '@/components/AppModal';
import ModalButton from '@/components/ModalButton';
import { fallbackBannerCopy } from '@/utils/fallbackBannerCopy';
import { buildSummaryListData, SummaryListItem } from '@/utils/summaryListData';
import { summaryStyles } from '@/components/summary/summaryStyles';
import BalanceCard from '@/components/summary/BalanceCard';
import BankerPayoutRow from '@/components/summary/BankerPayoutRow';
import SettlementCard from '@/components/summary/SettlementCard';
import SummaryEmptyState from '@/components/summary/SummaryEmptyState';
import SummaryHudHeader from '@/components/summary/SummaryHudHeader';

// Fallback Banner Component
function isRetryableFallback(error?: string, balances?: PlayerBalance[], tolerance: number = 2.50): boolean {
  // 4xx = backend rejected (e.g. imbalance too large) — retry won't help
  if (error && /Server responded with status 4\d{2}/.test(error)) {
    return false;
  }

  // Detect imbalance locally — even if the server was unreachable,
  // retrying won't help when the data itself is the problem
  if (balances && balances.length > 0) {
    const totalBuyins = balances.reduce((sum, b) => sum + b.totalBuyins, 0);
    const totalCashouts = balances.reduce((sum, b) => sum + b.totalCashouts, 0);
    if (Math.abs(totalBuyins - totalCashouts) > tolerance) {
      return false;
    }
  }

  return true;
}

interface FallbackBannerProps {
  onDismiss: () => void;
  onRetry: () => void;
  isRetrying: boolean;
  errorMessage?: string;
  balances?: PlayerBalance[];
  tolerance: number;
  formatAmount: (n: number) => string;
}

function FallbackBanner({ onDismiss, onRetry, isRetrying, errorMessage, balances, tolerance, formatAmount }: FallbackBannerProps) {
  const retryable = isRetryableFallback(errorMessage, balances, tolerance);
  const timedOut = errorMessage === SOLVER_TIMEOUT_SENTINEL;

  const totalBuyins = (balances ?? []).reduce((sum, b) => sum + b.totalBuyins, 0);
  const totalCashouts = (balances ?? []).reduce((sum, b) => sum + b.totalCashouts, 0);
  const netDifference = Math.abs(totalBuyins - totalCashouts);

  // A timeout is not a connectivity problem, so it must not wear the signal icon.
  const icon = timedOut
    ? 'time-outline'
    : retryable
      ? 'cellular-outline'
      : 'alert-circle-outline';
  const text = fallbackBannerCopy(retryable, isRetrying, netDifference, tolerance, formatAmount, timedOut);

  return (
    <View style={styles.fallbackBanner} accessibilityRole="alert">
      <View style={styles.fallbackBannerContent}>
        <Ionicons name={icon as any} size={14} color="rgba(212,175,55,0.75)" />
        <Text style={styles.fallbackBannerText}>{text}</Text>
      </View>
      <View style={styles.fallbackBannerActions}>
        {retryable && (
          isRetrying ? (
            <ActivityIndicator size="small" color="#D4AF37" />
          ) : (
            <TouchableOpacity
              onPress={onRetry}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Retry for optimal settlements"
            >
              <Ionicons name="refresh-outline" size={16} color="#D4AF37" />
            </TouchableOpacity>
          )
        )}
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notice"
        >
          <Ionicons name="close" size={16} color="rgba(255,255,255,0.4)" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function GameSummaryScreen() {
  const { activeGame, updateGame } = useGame();
  const { user } = useAuth();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { formatAmount, formatAmountCompact, currency } = useCurrency();
  const { registerHelp } = useHelp();
  const [helpVisible, setHelpVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const unregister = registerHelp(() => setHelpVisible(true));
      return unregister;
    }, [registerHelp])
  );

  const handleSeeFullGuide = useCallback(() => {
    setHelpVisible(false);
    setTimeout(() => router.push('/how-it-works' as any), 250);
  }, [router]);

  const summary = useMemo(
    () => (activeGame ? GameService.generateGameSummary(activeGame) : null),
    [activeGame]
  );
  const [settlementResult, setSettlementResult] = useState<SettlementResult | null>(() =>
    summary
      ? {
          settlements: summary.settlements,
          ...summary.settlementMeta,
        }
      : null
  );
  const [isLoadingSettlements, setIsLoadingSettlements] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>();
  const [showFallbackBanner, setShowFallbackBanner] = useState(false);
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);
  const balancesRef = useRef<PlayerBalance[]>(summary?.balances ?? []);
  const cashUnitRef = useRef<number | undefined>(summary?.game.cashUnit);

  useEffect(() => {
    balancesRef.current = summary?.balances ?? [];
    cashUnitRef.current = summary?.game.cashUnit;
  }, [summary]);

  const settlementsLoaded =
    !isLoadingSettlements && settlementResult !== null;

  useEffect(() => {
    if (!settlementsLoaded) return;
    if (showFallbackBanner) return;

    const maybeRequestReview = async () => {
      try {
        const canReview = await StoreReview.hasAction();
        if (!canReview) return;

        const [lastPromptStr, gamesCompletedStr, installDateStr] = await Promise.all([
          AsyncStorage.getItem('review_last_prompt_date'),
          AsyncStorage.getItem('review_games_completed'),
          AsyncStorage.getItem('review_install_date'),
        ]);

        const now = Date.now();
        const gamesCompleted = parseInt(gamesCompletedStr ?? '0', 10);
        const installDate = parseInt(installDateStr ?? String(now), 10);
        const lastPrompt = parseInt(lastPromptStr ?? '0', 10);
        const daysSinceInstall = (now - installDate) / (1000 * 60 * 60 * 24);
        const daysSinceLastPrompt = (now - lastPrompt) / (1000 * 60 * 60 * 24);

        const qualified =
          gamesCompleted >= 2 &&
          daysSinceInstall >= 5 &&
          daysSinceLastPrompt >= 90;

        if (!qualified) return;

        await AsyncStorage.setItem('review_last_prompt_date', String(now));
        await StoreReview.requestReview();
      } catch {
        // review prompt is best-effort; ignore errors
      }
    };

    const timer = setTimeout(maybeRequestReview, 5000);
    return () => clearTimeout(timer);
  }, [settlementsLoaded, showFallbackBanner]);

  useEffect(() => {
    if (!summary) {
      setSettlementResult(null);
      return;
    }

    // Banker mode: compute the star on-device. Never call the server, show the
    // fallback banner, or offer retry (those are keyed on server-vs-client fallback,
    // which does not apply to an intentional client computation).
    if (activeGame?.settlementMode === 'banker' && activeGame.bankerPlayerId) {
      const banker = activeGame.players.find(p => p.id === activeGame.bankerPlayerId);
      if (banker) {
        const result = calculateBankerSettlements(
          summary.balances,
          { id: banker.id, name: banker.name },
          resolveCashUnit(summary.game.cashUnit, currency),
        );
        setSettlementResult(result);
        setIsLoadingSettlements(false);
        setLastError(undefined);
        setShowFallbackBanner(false);
        GameService.cacheSettlements(activeGame, result);
        updateGame(activeGame); // fire-and-forget persist
        return;
      }
      // banker id unresolved (player removed) → fall through to optimal
    }

    // Check for cached settlements first
    const cachedResult = activeGame
      ? GameService.getCachedSettlements(activeGame)
      : null;

    if (cachedResult) {
setSettlementResult(cachedResult);
      setIsLoadingSettlements(false);

      // If server result, we're done
      if (cachedResult.source === 'server') {
        setLastError(undefined);
        setShowFallbackBanner(false);
        return;
      }

      // If greedy fallback, show cached but allow manual retry
      setLastError(cachedResult.error ?? 'Using cached on-device result');
      setShowFallbackBanner(true);
      return;
    }

    // No valid cache - fetch from server
    let cancelled = false;
    setSettlementResult({
      settlements: summary.settlements,
      ...summary.settlementMeta,
    });
    setIsLoadingSettlements(true);
    setLastError(undefined);

    (async () => {
      try {
        const result = await getSettlements(summary.balances, {
          settings: {
            cashRoundingUnit: resolveCashUnit(summary.game.cashUnit, currency),
            imbalanceTolerance: resolveTolerance(
              summary.game.imbalanceTolerance,
              currency,
            ),
          },
        });
        if (cancelled) return;

        setSettlementResult(result);

        // Cache the result
        if (activeGame) {
          GameService.cacheSettlements(activeGame, result);
          await updateGame(activeGame);
        }

        if (result.source !== 'server') {
          setLastError(result.error ?? 'Using on-device fallback');
          setShowFallbackBanner(true);
        } else {
          setLastError(undefined);
          setShowFallbackBanner(false);
        }
      } catch (error) {
        if (cancelled) return;

        const message = error instanceof Error ? error.message : 'unknown-error';
        setLastError(message);
        setShowFallbackBanner(true);
        setSettlementResult(prev =>
          prev ?? {
            settlements: summary.settlements,
            ...summary.settlementMeta,
            error: message,
          }
        );
      } finally {
        if (!cancelled) {
          setIsLoadingSettlements(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [summary?.game.id, activeGame?.settlementMode, activeGame?.bankerPlayerId]);

  const handleRetry = async () => {
    if (!summary || !activeGame) return;

    setIsLoadingSettlements(true);
    setLastError(undefined);

    try {
      const result = await getSettlements(balancesRef.current, {
        // 15000, not a shorter "quick retry" value: a slow solve is exactly the
        // case this retry exists to recover, so a budget at or below the solver's
        // own 5000ms limit guarantees the retry fails.
        timeoutMs: 15000,
        settings: {
          cashRoundingUnit: resolveCashUnit(cashUnitRef.current, currency),
          imbalanceTolerance: resolveTolerance(
            summary.game.imbalanceTolerance,
            currency,
          ),
        },
      });
      setSettlementResult(result);

      // Cache the new result
      GameService.cacheSettlements(activeGame, result);
      await updateGame(activeGame);

      if (result.source !== 'server') {
        setLastError(result.error ?? 'Using on-device fallback');
        setShowFallbackBanner(true);
      } else {
        setShowFallbackBanner(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown-error';
      setLastError(message);
      setSettlementResult(prev =>
        prev ?? {
          settlements: summary.settlements,
          ...summary.settlementMeta,
          error: message,
        }
      );
    } finally {
      setIsLoadingSettlements(false);
    }
  };

  const handleReopen = async () => {
    if (!activeGame) return;
    setShowReopenConfirm(false);
    // Capture the counted contribution from the still-intact completed game
    // BEFORE reopenGame clears statsCounted and the user can edit amounts.
    const wasCounted = activeGame.statsCounted === true;
    const balances = GameService.calculateBalances(activeGame);
    const totalPot = balances.reduce((sum, b) => sum + b.totalBuyins, 0);
    const playerCount = activeGame.players.length;
    GameService.reopenGame(activeGame);
    await updateGame(activeGame);
    // Fire-and-forget reversal, mirroring the completion increment's guards
    // (active.tsx) so offline/failure drift stays symmetric. This assumes
    // wasCounted (statsCounted === true) implies the increment actually ran;
    // that holds only because the auth gate (app/_layout.tsx) keeps user
    // non-null on these game screens — otherwise we could subtract a
    // contribution that was never added.
    if (wasCounted && user?.uid && Number.isFinite(totalPot) && totalPot > 0 && playerCount > 0) {
      reverseProfileStats(user.uid, {
        gamesPlayed: 1,
        moneyTracked: Math.round(totalPot * 100) / 100,
        playersHosted: playerCount,
      }).catch(err => console.warn('Profile stats reversal failed:', err));
    }
    router.replace('/game/active' as any);
  };

  const activeSettlementResult: SettlementResult | null =
    settlementResult ?? (summary ? {
      settlements: summary.settlements,
      ...summary.settlementMeta,
    } : null);
  const settlementsToDisplay = activeSettlementResult?.settlements ?? [];

  const groupedSettlements = useMemo(
    () => groupSettlementsByRecipient(settlementsToDisplay),
    [settlementsToDisplay]
  );

  const paymentByName = useMemo(() => {
    const map = new Map<string, PreferredPayment>();
    summary?.game.players.forEach(p => {
      if (p.preferredPayment) map.set(p.name, p.preferredPayment);
    });
    return map;
    // Dep is the summary object, NOT summary.game.players — the players array is
    // mutated in place (active.tsx index-assigns into it), so its reference never
    // changes and a dep on it freezes this map for the lifetime of the mount.
  }, [summary]);

  // Banker mode is only really banker mode if the banker still resolves to a player.
  // The settlement recompute at :603 already requires both; these are the reads that
  // label the screen. Since 2026-08-07 removePlayer leaves 'banker' mode in place with
  // no bankerPlayerId, so a mode-only read would caption this screen "Banker" while
  // :603 fell through to the optimal solver — wrong rows under a confident label.
  // Plain const, not a hook: safe to sit above the `if (!activeGame)` guard below.
  const hasResolvedBanker =
    !!activeGame &&
    activeGame.settlementMode === 'banker' &&
    activeGame.players.some(p => p.id === activeGame.bankerPlayerId);

  // Above the guard (Rules of Hooks). Banker-ness comes from the shared hasResolvedBanker
  // const above, so this read and the header's agree by construction. Dep is
  // `activeGame`, NOT `activeGame.players` — updateGame shallow-clones the Game, so the
  // players array reference never changes.
  const listData = useMemo(
    () =>
      buildSummaryListData({
        grouped: groupedSettlements,
        balances: summary?.balances ?? [],
        isBanker: hasResolvedBanker,
        bankerPlayerId: activeGame?.bankerPlayerId,
      }),
    [groupedSettlements, summary, activeGame],
  );

  const keyExtractor = useCallback((item: SummaryListItem) => item.key, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SummaryListItem>) => {
      switch (item.type) {
        case 'empty':
          return <SummaryEmptyState label={item.label} icon={item.icon} />;
        case 'bankerPayout':
          return (
            <BankerPayoutRow
              recipient={item.recipient}
              amount={item.amount}
              recipientPayment={paymentByName.get(item.recipient)}
              formatAmount={formatAmount}
            />
          );
        case 'settlement':
          return (
            <SettlementCard
              groupedSettlement={item.grouped}
              recipientPayment={paymentByName.get(item.grouped.recipient)}
              reduceMotion={reduceMotion}
              formatAmount={formatAmount}
            />
          );
        case 'sectionHeader':
          return (
            <View style={summaryStyles.listSectionHeader}>
              <SummaryHudHeader label={item.label} />
            </View>
          );
        case 'balance':
          return (
            <View style={item.isLast ? undefined : summaryStyles.balanceGap}>
              <BalanceCard
                balance={item.balance}
                reduceMotion={reduceMotion}
                hint={item.hint}
                formatAmountCompact={formatAmountCompact}
              />
            </View>
          );
      }
    },
    [paymentByName, reduceMotion, formatAmount, formatAmountCompact],
  );

  if (!activeGame || !summary) {
    return (
      <View style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <SummaryEmptyState label="No active game" icon="game-controller-outline" />
        </View>
      </View>
    );
  }

  const isBanker = hasResolvedBanker;
  const bankerName = isBanker
    ? activeGame.players.find(p => p.id === activeGame.bankerPlayerId)?.name
    : undefined;

  const handleShare = async () => {
    try {
      const message = buildShareMessage({
        gameName: activeGame.name,
        totalPot: summary.totalPot,
        grouped: groupedSettlements,
        paymentByName,
        formatAmount,
        mode: isBanker ? 'banker' : 'optimal',
        bankerName,
      });
      await Share.share({ message });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const distortion = computeRoundingDistortion(summary.balances, resolveCashUnit(summary.game.cashUnit, currency));

  // An ELEMENT, not an inline arrow component — `ListHeaderComponent={() => …}` is a new
  // component type every render and remounts the whole header.
  const listHeader = (
    <>
      {/* Game Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View style={styles.titleColumn}>
            <Text style={styles.gameTitle}>{activeGame.name}</Text>
            <Text style={styles.gameDate}>
              {new Date(activeGame.date).toLocaleDateString()}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.shareIconButton}
            onPress={handleShare}
            activeOpacity={0.6}
            accessibilityLabel="Share game summary"
            accessibilityHint="Opens share dialog to send summary via apps"
            accessibilityRole="button"
          >
            <Ionicons name="share-outline" size={20} color="#B072BB" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Total Pot Hero Metric */}
      <View style={styles.heroPotSection}>
        <SummaryHudHeader label="TOTAL POT" />
        <View style={styles.heroPotDisplay}>
          <Text style={styles.heroPotAmount}>
            {formatAmount(summary.totalPot)}
          </Text>
        </View>
      </View>

      <SummaryHudHeader label={isBanker ? 'PAYOUTS' : 'SETTLEMENTS'} />

      {isBanker && (
        <Text style={styles.bankerSubhead}>
          {bankerName ?? '—'}, the banker, pays out below
        </Text>
      )}

      {/* Fallback notice */}
      {showFallbackBanner && (
        <FallbackBanner
          onDismiss={() => setShowFallbackBanner(false)}
          onRetry={handleRetry}
          isRetrying={isLoadingSettlements}
          errorMessage={lastError}
          balances={summary.balances}
          formatAmount={formatAmount}
          tolerance={resolveTolerance(
            summary.game.imbalanceTolerance,
            currency,
          )}
        />
      )}

      {/* Rounding distortion note — net-based, so it does not describe banker
          cash-out payouts; suppressed in banker mode. */}
      {!isBanker && distortion.maxDelta > 0 && (
        <Text style={styles.roundingNote}>
          Rounded to {formatAmount(resolveCashUnit(summary.game.cashUnit, currency))} — largest change {formatAmount(distortion.maxDelta)}.
        </Text>
      )}
    </>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeader}
        style={summaryStyles.scrollView}
        contentContainerStyle={summaryStyles.listContent}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        /* RN's default 21, not the 5 the other converted surfaces use: SettlementCard
           owns `isExpanded` local state that a user expects to persist. At windowSize=5
           a card scrolled ~2 viewports away unmounts and comes back COLLAPSED, which is
           reachable around a 12-20 player game. Under the pre-virtualization ScrollView
           expansion survived any amount of scrolling; this keeps that. */
        windowSize={21}
        /* Same reason, second half: these cells CHANGE HEIGHT on expand, and Android's
           default removeClippedSubviews={true} detaches/reattaches native views around
           measurements it took at the old height. index.tsx:211 opts out for a different
           reason (Reanimated Swipeable); this surface is the only one with variable-height
           cells. */
        removeClippedSubviews={false}
      />

      {/* Actions */}
      <View style={styles.actions}>
        {activeGame.status === 'completed' ? (
          <View style={styles.actionRow}>
            <View style={styles.actionRowItem}>
              <Button
                onPress={() => setShowReopenConfirm(true)}
                title="Reopen"
                variant="secondary"
                accessibilityHint="Reopen this game to edit buy-ins and cash-outs"
              />
            </View>
            <View style={styles.actionRowItem}>
              <Button
                onPress={() => router.dismissAll()}
                title="Done"
                variant="primary"
                accessibilityHint="Returns to the home screen"
              />
            </View>
          </View>
        ) : (
          <Button
            onPress={() => router.dismissAll()}
            title="Done"
            variant="primary"
            fullWidth
            accessibilityHint="Returns to the home screen"
          />
        )}
      </View>

      <AppModal
        visible={showReopenConfirm}
        onClose={() => setShowReopenConfirm(false)}
        dismissOnBackdrop={false}
        contentStyle={appModalStyles.centeredContent}
      >
        <Ionicons name="refresh-circle-outline" size={48} color="#B072BB" style={styles.reopenIcon} />
        <Text style={appModalStyles.title}>Reopen this game?</Text>
        <Text style={styles.reopenModalText}>
          You'll be able to edit buy-ins and cash-outs, then complete it again.
        </Text>
        <View style={styles.reopenModalButtons}>
          <ModalButton variant="cancel" title="Cancel" onPress={() => setShowReopenConfirm(false)} />
          <ModalButton variant="confirm" title="Reopen" onPress={handleReopen} />
        </View>
      </AppModal>

      <HelpSheet
        visible={helpVisible}
        title="Reading Results"
        topics={getTopicsByIds(getSummaryTopicIds(activeGame.settlementMode))}
        onClose={() => setHelpVisible(false)}
        onSeeFullGuide={handleSeeFullGuide}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  header: {
    marginBottom: 24,
    backgroundColor: 'transparent',
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: 'transparent',
  },
  titleColumn: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  shareIconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
  },
  gameTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#B072BB',
    letterSpacing: 1,
  },
  gameDate: {
    fontSize: 14,
    opacity: 0.5,
    color: '#FFFFFF',
  },
  heroPotSection: {
    marginBottom: 32,
  },
  heroPotDisplay: {
    paddingVertical: 20,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  heroPotAmount: {
    fontSize: 52,
    fontWeight: 'bold',
    color: '#B072BB',
  },
  actions: {
    paddingVertical: 20,
    gap: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
  },
  actionRowItem: {
    flex: 1,
  },
  // Fallback Banner styles (slim inline notice) — gold, not the purple brand
  // accent, so the notice reads as a warning instead of blending into the UI.
  fallbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.08)',   // Colors.dark.warning @ 8%
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.22)',       // Colors.dark.warning @ 22%
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    gap: 10,
  },
  fallbackBannerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  fallbackBannerText: {
    flex: 1,
    fontSize: 12,
    color: 'rgba(212,175,55,0.90)',             // Colors.dark.warning @ 90%
    lineHeight: 16,
  },
  fallbackBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'transparent',
  },
  reopenIcon: {
    alignSelf: 'center',
    marginBottom: 8,
  },
  reopenModalText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  reopenModalButtons: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  roundingNote: {
    fontSize: 12,
    color: 'rgba(176,114,187,0.55)',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  bankerSubhead: {
    fontSize: 12,
    color: 'rgba(176,114,187,0.75)',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 0.3,
  },
});
