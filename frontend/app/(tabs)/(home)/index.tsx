import { StyleSheet, FlatList, TouchableOpacity, Alert, ListRenderItemInfo } from 'react-native';
import { Text, View } from '@/components/Themed';
import { useGame } from '@/contexts/GameContext';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState, useCallback, useMemo } from 'react';
import GameCard from '@/components/GameCard';
import Button from '@/components/Button';
import ModalButton from '@/components/ModalButton';
import PaywallModal from '@/components/PaywallModal';
import AppModal, { appModalStyles } from '@/components/AppModal';
import { useAuth } from '@/contexts/AuthContext';
import { Game } from '@/types/game';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { getTrialLabel } from '@/utils/trialUtils';
import { groupGamesByMonth } from '@/utils/historyGrouping';
import { splitCompletedHistory } from '@/utils/tierLimits';
import HistoryMonthHeader from '@/components/HistoryMonthHeader';

function HudSectionHeader({ label }: { label: string }) {
  return (
    <View style={styles.hudHeader}>
      <View style={styles.hudLine} />
      <Text style={styles.hudLabel}>{label}</Text>
      <View style={styles.hudLine} />
    </View>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconRing}>
        <Ionicons name={label === 'Active' ? 'play-circle-outline' : 'checkmark-circle-outline'} size={28} color="rgba(176,114,187,0.35)" />
      </View>
      <Text style={styles.emptyStateText}>No {label.toLowerCase()} games</Text>
    </View>
  );
}

const MAX_ANIMATED_CARDS = 5;

type ListItem =
  | { type: 'header'; label: string; key: string }
  | { type: 'monthHeader'; label: string; key: string }
  | { type: 'empty'; label: string; key: string }
  | { type: 'game'; game: Game; isCompleted: boolean; entryIndex: number; key: string }
  | { type: 'upgrade'; hiddenCount: number; key: string };

export default function HomeScreen() {
  const { games, setActiveGame, deleteGame, createGame } = useGame();
  const { isPro, isTrialing, trialDaysRemaining } = useAuth();
  const router = useRouter();

  const [gameToDelete, setGameToDelete] = useState<{ id: string; name: string } | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const reduceMotionEnabled = useReduceMotion();
  const [showPaywall, setShowPaywall] = useState(false);
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false);

  const showTrialBanner = isTrialing && trialDaysRemaining <= 2 && !trialBannerDismissed;

  const listData = useMemo<ListItem[]>(() => {
    const byCreatedDesc = (a: Game, b: Game) => b.createdAt.getTime() - a.createdAt.getTime();
    const byDateDesc = (a: Game, b: Game) => new Date(b.date).getTime() - new Date(a.date).getTime();

    const activeGames = games.filter(g => g.status === 'active').sort(byCreatedDesc);
    const completedGames = games.filter(g => g.status === 'completed').sort(byDateDesc);
    const { visible: visibleCompleted, hiddenCount } = splitCompletedHistory(completedGames, isPro);

    const items: ListItem[] = [];
    let entryIndex = 0;

    // Active section
    items.push({ type: 'header', label: 'Active', key: 'header-active' });
    if (activeGames.length === 0) {
      items.push({ type: 'empty', label: 'Active', key: 'empty-active' });
    } else {
      activeGames.forEach((game) => {
        items.push({ type: 'game', game, isCompleted: false, entryIndex: entryIndex++, key: game.id });
      });
    }

    // History section — grouped by month of game.date, newest first
    items.push({ type: 'header', label: 'History', key: 'header-history' });
    if (visibleCompleted.length === 0) {
      items.push({ type: 'empty', label: 'History', key: 'empty-history' });
    } else {
      const groups = groupGamesByMonth(visibleCompleted, new Date());
      groups.forEach((group) => {
        items.push({ type: 'monthHeader', label: group.label, key: group.key });
        group.games.forEach((game) => {
          items.push({ type: 'game', game, isCompleted: true, entryIndex: entryIndex++, key: game.id });
        });
      });
    }

    if (hiddenCount > 0) {
      items.push({ type: 'upgrade', hiddenCount, key: 'upgrade-cta' });
    }

    return items;
  }, [games, isPro]);

  const handleGamePress = useCallback(async (gameId: string, isCompleted: boolean) => {
    await setActiveGame(gameId);
    if (isCompleted) {
      router.push('/game/summary' as any);
    } else {
      router.push('/game/active' as any);
    }
  }, [setActiveGame, router]);

  const confirmDeleteGame = useCallback((game: { id: string; name: string }) => {
    setGameToDelete(game);
    setShowDeleteConfirmation(true);
  }, []);

  const handleDeleteGame = useCallback(async () => {
    if (!gameToDelete) return;

    try {
      await deleteGame(gameToDelete.id);
      setShowDeleteConfirmation(false);
      setGameToDelete(null);
    } catch (error) {
      Alert.alert('Error', 'Failed to delete game. Please try again.');
      console.error('Error deleting game:', error);
    }
  }, [gameToDelete, deleteGame]);

  const handleCreateNewGame = useCallback(async () => {
    try {
      await createGame('Untitled Game');
      router.push('/game/active' as any);
    } catch (error) {
      Alert.alert('Error', 'Failed to create game');
      console.error('Error creating game:', error);
    }
  }, [createGame, router]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<ListItem>) => {
    switch (item.type) {
      case 'header':
        return <HudSectionHeader label={item.label} />;
      case 'monthHeader':
        return <HistoryMonthHeader label={item.label} />;
      case 'empty':
        return <EmptyState label={item.label} />;
      case 'game':
        return (
          <GameCard
            game={item.game}
            onPress={handleGamePress}
            onDelete={confirmDeleteGame}
            isCompleted={item.isCompleted}
            reduceMotion={reduceMotionEnabled}
            entryIndex={item.entryIndex < MAX_ANIMATED_CARDS ? item.entryIndex : undefined}
          />
        );
      case 'upgrade':
        return (
          <TouchableOpacity
            style={styles.upgradeHistoryCard}
            onPress={() => setShowPaywall(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="star" size={16} color="#B072BB" style={styles.upgradeHistoryIcon} />
            <Text style={styles.upgradeHistoryText}>
              {item.hiddenCount} older {item.hiddenCount === 1 ? 'game' : 'games'} hidden. Upgrade to Pro to see your full history.
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#B072BB" />
          </TouchableOpacity>
        );
    }
  }, [handleGamePress, confirmDeleteGame, reduceMotionEnabled]);

  const keyExtractor = useCallback((item: ListItem) => item.key, []);

  return (
    <View style={styles.container}>
      {showTrialBanner && (
        <TouchableOpacity
          style={styles.trialBanner}
          onPress={() => setShowPaywall(true)}
          activeOpacity={0.8}
        >
          <View style={styles.trialBannerContent}>
            <Ionicons name="time-outline" size={16} color="#FFB547" />
            <Text style={styles.trialBannerText}>
              Your Pro trial ends {trialDaysRemaining <= 1 ? 'today' : `in ${trialDaysRemaining} days`}. Upgrade to keep full access.
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setTrialBannerDismissed(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={16} color="rgba(255,255,255,0.4)" />
          </TouchableOpacity>
        </TouchableOpacity>
      )}
      <FlatList
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        style={styles.scrollView}
        contentContainerStyle={styles.listContent}
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        windowSize={5}
        removeClippedSubviews={false}
      />

      {/* Actions */}
      <View style={styles.actions}>
        <Button
          onPress={handleCreateNewGame}
          title="+ New Game"
          variant="primary"
          fullWidth
          accessibilityHint="Creates a new poker game session"
        />
      </View>

      {/* Paywall Modal */}
      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        triggerMessage="Upgrade to Pro to see your full game history."
      />

      {/* Delete Confirmation Modal */}
      <AppModal
        visible={showDeleteConfirmation}
        onClose={() => setShowDeleteConfirmation(false)}
        dismissOnBackdrop={false}
        contentStyle={appModalStyles.centeredContent}
      >
        <Ionicons name="warning" size={48} color="#C04657" style={styles.warningIcon} />
        <Text style={appModalStyles.title}>Delete Game?</Text>
        <Text style={styles.deleteWarningText}>
          Are you sure you want to delete "{gameToDelete?.name}"? This will remove all players,
          transactions, and settlements.
          {'\n\n'}This action cannot be undone.
        </Text>
        <View style={styles.modalButtons}>
          <ModalButton
            variant="cancel"
            title="Cancel"
            onPress={() => {
              setShowDeleteConfirmation(false);
              setGameToDelete(null);
            }}
          />
          <ModalButton
            variant="destructive"
            title="Delete"
            onPress={handleDeleteGame}
          />
        </View>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  scrollView: {
    flex: 1,
  },
  listContent: {
    padding: 20,
  },

  // Trial expiry banner
  trialBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,181,71,0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,181,71,0.15)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  trialBannerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  trialBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#FFB547',
    lineHeight: 16,
  },

  // HUD section header
  hudHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  hudLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2A2A2A',
  },
  hudLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#B072BB',
    textTransform: 'uppercase',
    letterSpacing: 3,
  },
  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  emptyIconRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyStateText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.5,
  },
  emptyStateSubtext: {
    fontSize: 11,
    color: 'rgba(176,114,187,0.3)',
    letterSpacing: 2,
    marginTop: 4,
    fontFamily: 'SpaceMono',
  },

  // Actions bar
  actions: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#1E1E1E',
  },

  // Modal
  warningIcon: {
    marginBottom: 16,
  },
  deleteWarningText: {
    fontSize: 15,
    color: '#FFFFFF',
    opacity: 0.8,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    backgroundColor: 'transparent',
  },

  // Upgrade history card (shown below capped history for free users)
  upgradeHistoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.3)',
    padding: 14,
    marginTop: 8,
    gap: 10,
  },
  upgradeHistoryIcon: {
    flexShrink: 0,
  },
  upgradeHistoryText: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 18,
  },
});
