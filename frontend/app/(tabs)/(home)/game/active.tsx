import React, { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Animated, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from '@/components/Themed';
import { useGame } from '@/contexts/GameContext';
import { useFocusEffect, useRouter } from 'expo-router';
import { useHelp } from '@/contexts/HelpContext';
import HelpSheet from '@/components/HelpSheet';
import HelpHint from '@/components/HelpHint';
import { ACTIVE_GAME_TOPIC_IDS, getTopicsByIds } from '@/constants/helpTopics';
import { GameService } from '@/services/gameService';
import { getSettlements, calculateBankerSettlements } from '@/services/settlementService';
import { Player, PlayerBalance, Validation, PreferredPayment } from '@/types/game';
import { getNetBalanceColor, formatNetBalanceDisplay } from '@/utils/formatUtils';
import { incrementProfileStats } from '@/services/firebaseService';
import { isValidNumericInput } from '@/utils/validationUtils';
import { loadSavedPlayers, SavedPlayer, FREE_SAVED_CAP, PRO_SAVED_CAP, savedCapFor, canAddMoreSavedPlayers, getSavedPlayersByName, getSavedPlayerById, createSavedPlayer, updateSavedPlayer } from '@/services/savedPlayersService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PlayerCardActive from '@/components/PlayerCardActive';
import PlayerCardCompleted from '@/components/PlayerCardCompleted';
import Button from '@/components/Button';
import ModalButton from '@/components/ModalButton';
import PaywallModal from '@/components/PaywallModal';
import CashUnitPickerModal from '@/components/CashUnitPickerModal';
import TolerancePickerModal from '@/components/TolerancePickerModal';
import { resolveTolerance } from '@/constants/Tolerances';
import SettlementModePicker from '@/components/SettlementModePicker';
import PaymentEditorModal from '@/components/PaymentEditorModal';
import AppModal, { appModalStyles } from '@/components/AppModal';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { EXACT_CASH_UNIT, resolveCashUnit } from '@/constants/CashUnits';
import { computeRoundingDistortion, PlayerDistortion } from '@/utils/roundingUtils';
import { getPaymentMethodMeta } from '@/constants/PaymentMethods';
import { formatHandleForDisplay } from '@/utils/paymentLinks';
import { isNameTakenInGame, matchSavedByExactName, filterSavedByQuery, formatAddedConfirmation, singleExactSavedMatch, isLastAddVisibleInList } from '@/utils/addPlayer';
import { formatSettingsSummary, toleranceCaption } from '@/utils/settingsSummary';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function HudSectionHeader({ label, onAction, actionIcon, accessibilityLabel = 'Add player', accessibilityHint = 'Opens the add player dialog' }: { label: string; onAction?: () => void; actionIcon?: string; accessibilityLabel?: string; accessibilityHint?: string }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReduceMotion();

  const animateScaleDown = useCallback((scaleValue: number = 0.945) => {
    if (!reduceMotion) {
      Animated.spring(scaleAnim, {
        toValue: scaleValue,
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

  const handleTapSuccess = useCallback(() => {
    if (onAction) {
      onAction();
    }
  }, [onAction]);

  const tapGesture = useMemo(() => Gesture.Tap()
    .maxDuration(200)
    .maxDistance(10)
    .enabled(!!onAction)
    .onBegin(() => {
      runOnJS(animateScaleDown)(0.9);
    })
    .onFinalize((_, success) => {
      if (success) {
        runOnJS(handleTapSuccess)();
        runOnJS(animateScaleUp)(-0.5);
      } else {
        runOnJS(animateScaleUp)(0);
      }
    }), [onAction, animateScaleDown, animateScaleUp, handleTapSuccess]);

  return (
    <View style={styles.hudHeader}>
      <View style={styles.hudLines}>
        <View style={styles.hudLine} />
      </View>
      <Text style={styles.hudLabel}>{label}</Text>
      {onAction && actionIcon && (
        <GestureDetector gesture={tapGesture}>
          <Animated.View
            style={[
              styles.hudIconSlot,
              !reduceMotion && { transform: [{ scale: scaleAnim }] }
            ]}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={accessibilityHint}
          >
            <Ionicons
              name={actionIcon as any}
              size={22}
              color="rgba(176,114,187,0.7)"
            />
          </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
}

function EmptyState({ label, icon }: { label: string; icon: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconRing}>
        <Ionicons name={icon as any} size={28} color="rgba(176,114,187,0.35)" />
      </View>
      <Text style={styles.emptyStateText}>{label}</Text>
    </View>
  );
}

function SolvingOverlay() {
  const reduceMotion = useReduceMotion();
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => {
      setDotCount(c => (c >= 3 ? 1 : c + 1));
    }, 380);
    return () => clearInterval(id);
  }, [reduceMotion]);

  return (
    <View style={styles.solvingOverlay}>
      <View style={styles.solvingHudHeader}>
        <View style={styles.solvingHudLine} />
        <Text style={styles.solvingHudLabel}>SETTLING</Text>
        <View style={styles.solvingHudLine} />
      </View>

      <View style={styles.solvingDots}>
        <View style={[styles.solvingDot, { opacity: reduceMotion ? 0.6 : 1 }]} />
        <View style={[styles.solvingDot, { opacity: reduceMotion ? 0.6 : dotCount >= 2 ? 1 : 0.15 }]} />
        <View style={[styles.solvingDot, { opacity: reduceMotion ? 0.6 : dotCount >= 3 ? 1 : 0.15 }]} />
      </View>

      <Text style={styles.solvingStatusLabel}>OPTIMIZING TRANSFERS</Text>
    </View>
  );
}

const PLAYERS_PAYWALL_MESSAGE = 'Upgrade to Pro for unlimited players per game.';
const SAVED_CAP_PAYWALL_MESSAGE = `You've saved ${FREE_SAVED_CAP} players — the free limit. Upgrade to Pro to save up to ${PRO_SAVED_CAP}.`;
const RECENT_LIMIT = 5;
const HELP_HINT_SEEN_KEY = 'help_hint_seen';

export default function ActiveGameScreen() {
  const { activeGame, updateGame, setActiveGame, createGame } = useGame();
  const { user, isPro } = useAuth();
  const { formatAmount, meta, currency } = useCurrency();
  const router = useRouter();
  const { registerHelp } = useHelp();
  const [helpVisible, setHelpVisible] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(HELP_HINT_SEEN_KEY).then((seen) => {
      if (!seen) setHintVisible(true);
    });
  }, []);

  const dismissHint = useCallback(() => {
    setHintVisible(false);
    AsyncStorage.setItem(HELP_HINT_SEEN_KEY, '1');
  }, []);

  useFocusEffect(
    useCallback(() => {
      const unregister = registerHelp(() => {
        setHelpVisible(true);
        dismissHint();
      });
      return unregister;
    }, [registerHelp, dismissHint])
  );

  const handleSeeFullGuide = useCallback(() => {
    // Dismiss this native modal BEFORE navigating (iOS single-modal rule).
    setHelpVisible(false);
    setTimeout(() => router.push('/how-it-works' as any), 250);
  }, [router]);

  const uid = user?.uid ?? null;
  const refreshSavedNames = useCallback(() => {
    if (!uid) return;
    const apply = (list: SavedPlayer[]) => setSavedPlayers(list);
    loadSavedPlayers(uid, apply).then(apply).catch(() => {});
  }, [uid]);

  // Helper function to highlight critical values in error/warning messages
  const highlightCriticalValues = (message: string): React.ReactNode => {
    // Pattern matches: $XX.XX, player names (if any), numeric values
    const parts = message.split(/(\$[\d,]+\.?\d*|\d+\.\d+)/);

    return (
      <Text style={styles.completionModalErrorText}>
        {parts.map((part, index) => {
          // Check if part matches currency or decimal number pattern
          if (/^\$[\d,]+\.?\d*$/.test(part) || /^\d+\.\d+$/.test(part)) {
            return (
              <Text key={index} style={styles.criticalValue}>
                {part}
              </Text>
            );
          }
          return part;
        })}
      </Text>
    );
  };

  const [showAddPlayer, setShowAddPlayer] = useState(false);
  // Set by handleAddBanker; consumed (and reset) by commitAddPlayer or the Add Player
  // modal's cancel/close paths. When true, the player resulting from the Add Player flow
  // is designated banker.
  const [pendingBankerDesignation, setPendingBankerDesignation] = useState(false);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerBuyIn, setNewPlayerBuyIn] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [transactionAmount, setTransactionAmount] = useState('');
  const [transactionType, setTransactionType] = useState<'buyin' | 'cashout'>('buyin');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [playerToDelete, setPlayerToDelete] = useState<Player | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const reduceMotionEnabled = useReduceMotion();
  const [settingsExpanded, setSettingsExpanded] = useState((activeGame?.players.length ?? 0) === 0);
  // True once the initial collapse state has been seeded off the first non-null `activeGame`.
  // Synchronous-mount paths (fresh game, native resume) are already seeded correctly by the
  // useState initializer above, so this starts true for them and the layout effect below is a
  // no-op. Only the async-load path (activeGame starts null on cold start / deep link / web
  // refresh) starts false, deferring the seed to the layout effect.
  const hasSeededSettings = useRef(activeGame != null);
  // True once the user (or the one-time auto-collapse) has decided; blocks any further auto-collapse.
  const hasToggledSettings = useRef((activeGame?.players.length ?? 0) > 0);

  // Silently seeds the collapse state off the first non-null `activeGame`, synchronously before
  // paint. This exists solely for the async-load path: without it, `settingsExpanded` would still
  // hold its initial (expanded) value from the null-activeGame mount, so the settings card would
  // paint expanded for one frame before the animated auto-collapse effect below kicks in. Seeding
  // here (no LayoutAnimation) forces React to re-render with the correct value before anything is
  // painted, so a resumed game with players never visibly flashes expanded.
  useLayoutEffect(() => {
    if (hasSeededSettings.current || activeGame == null) return;
    hasSeededSettings.current = true;
    if (activeGame.players.length > 0) {
      hasToggledSettings.current = true;
      setSettingsExpanded(false);
    }
  }, [activeGame]);

  useEffect(() => {
    const count = activeGame?.players.length ?? 0;
    if (!hasToggledSettings.current && count > 0) {
      hasToggledSettings.current = true;
      if (!reduceMotionEnabled) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setSettingsExpanded(false);
    }
  }, [activeGame?.players.length, reduceMotionEnabled]);

  const toggleSettings = useCallback(() => {
    hasToggledSettings.current = true; // manual interaction disables future auto-collapse
    if (!reduceMotionEnabled) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSettingsExpanded(v => !v);
  }, [reduceMotionEnabled]);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renamedPlayerName, setRenamedPlayerName] = useState('');
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallMessage, setPaywallMessage] = useState(PLAYERS_PAYWALL_MESSAGE);
  const [savePlayerToggle, setSavePlayerToggle] = useState(true);
  // User explicitly chose "Add as new" on a typed name that exactly matches a
  // saved player — suppresses the auto-bind so no saved identity/payment is
  // inherited. Reset on name edit, modal close, and after each add.
  const [forceUnlinked, setForceUnlinked] = useState(false);
  const [savedPlayers, setSavedPlayers] = useState<SavedPlayer[]>([]);
  const [renameSuggestions, setRenameSuggestions] = useState<SavedPlayer[]>([]);
  // Identity of the saved player the user picked from suggestions (null = typed freely).
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  // Running per-session confirmation for the stay-open Add Player modal.
  const [addedCount, setAddedCount] = useState(0);
  const [lastAddedName, setLastAddedName] = useState<string | null>(null);
  // Synchronous re-entry guard for commitAddPlayer (state-based `disabled` has a race window).
  const addingPlayerRef = useRef(false);
  const nameInputRef = useRef<TextInput>(null);
  const buyInInputRef = useRef<TextInput>(null);

  // Game completion modal state
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [completionModalMode, setCompletionModalMode] = useState<'error' | 'warning' | 'confirm'>('confirm');
  const [validationResult, setValidationResult] = useState<Validation | null>(null);
  const [showSolvingModal, setShowSolvingModal] = useState(false);
  const [showCashUnitPicker, setShowCashUnitPicker] = useState(false);
  const [showTolerancePicker, setShowTolerancePicker] = useState(false);
  const [showSettlementModePicker, setShowSettlementModePicker] = useState(false);
  const [showDistortionModal, setShowDistortionModal] = useState(false);
  const [distortions, setDistortions] = useState<PlayerDistortion[]>([]);

  // Payment editor state
  const [showPaymentEditor, setShowPaymentEditor] = useState(false);
  const [paymentPlayer, setPaymentPlayer] = useState<Player | null>(null);

  const savedBadge = (p: SavedPlayer): string | null => {
    if (!p.preferredPayment) return null;
    const { method, handle } = p.preferredPayment;
    const label = getPaymentMethodMeta(method).label;
    return handle ? `${label} · ${formatHandleForDisplay(method, handle)}` : label;
  };

  const samePayment = (a: PreferredPayment, b: PreferredPayment): boolean =>
    a.method === b.method && (a.handle ?? '') === (b.handle ?? '');

  const handleCreateNewGame = async () => {
    try {
      await createGame('Untitled Game');
      // The useEffect or state update will automatically handle the active game change
    } catch (error) {
      Alert.alert('Error', 'Failed to create game');
      console.error('Error creating game:', error);
    }
  };

  const openPaymentEditor = (player: Player) => {
    setPaymentPlayer(player);
    setShowPaymentEditor(true);
  };

  const handleSavePayment = async (pref: PreferredPayment) => {
    if (!paymentPlayer || !activeGame) return;
    const idx = activeGame.players.findIndex(p => p.id === paymentPlayer.id);
    if (idx !== -1) activeGame.players[idx] = { ...activeGame.players[idx], preferredPayment: pref };
    await updateGame(activeGame);

    // Write back to the SAVED list only through an explicit binding (savedPlayerId) — never
    // guess by name. Fill an empty saved payment silently; confirm before overwriting a set one.
    const sid = (idx !== -1 ? activeGame.players[idx]?.savedPlayerId : undefined) ?? paymentPlayer.savedPlayerId;
    if (uid && sid) {
      const saved = await getSavedPlayerById(uid, sid);
      if (saved) {
        if (!saved.preferredPayment) {
          updateSavedPlayer(uid, sid, { preferredPayment: pref }).catch(() => {});
        } else if (!samePayment(saved.preferredPayment, pref)) {
          Alert.alert(
            'Update saved player?',
            `Also update ${saved.name}'s saved payment for next time?`,
            [
              { text: 'Just this game', style: 'cancel' },
              { text: 'Update saved', onPress: () => { updateSavedPlayer(uid, sid, { preferredPayment: pref }).catch(() => {}); } },
            ],
          );
        }
      }
    }
    setShowPaymentEditor(false);
    setPaymentPlayer(null);
  };

  // Calculate balances - must be before early return to avoid hooks error
  const balances = activeGame ? GameService.calculateBalances(activeGame) : [];

  const getPlayerBalance = (playerId: string): PlayerBalance | undefined => {
    return balances.find(b => b.playerId === playerId);
  };

  const openTransactionModal = useCallback((player: Player, type: 'buyin' | 'cashout') => {
    const balance = getPlayerBalance(player.id);

    // Block cashout if player has no buy-in
    if (type === 'cashout') {
      const currentBuyin = balance?.totalBuyins ?? 0;
      if (currentBuyin <= 0) {
        Alert.alert('Error', 'Player must have a buy-in before cashing out');
        return;
      }
    }

    const currentTotal = type === 'buyin'
      ? balance?.totalBuyins ?? 0
      : balance?.totalCashouts ?? 0;

    setSelectedPlayer(player);
    setTransactionType(type);
    setTransactionAmount(currentTotal.toString());
    setShowAddTransaction(true);
  }, [balances]);

  const handleBuyIn = useCallback((player: Player) => {
    openTransactionModal(player, 'buyin');
  }, [openTransactionModal]);

  const handleCashOut = useCallback((player: Player) => {
    openTransactionModal(player, 'cashout');
  }, [openTransactionModal]);

  const openRenameModal = useCallback((player: Player) => {
    setSelectedPlayer(player);
    setRenamedPlayerName(player.name);
    setRenameSuggestions([]);
    refreshSavedNames();
    setShowRenameModal(true);
  }, []);

  if (!activeGame) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>No active game. Please select or create a game.</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={handleCreateNewGame}
        >
          <Text style={styles.buttonText}>Create New Game</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const activePlayers = activeGame.players.filter(p => !p.completedAt);
  const completedPlayers = activeGame.players.filter(p => p.completedAt);

  // Save-toggle state for the Add Player modal (spec: the cap is never silent).
  const savedListFull = !canAddMoreSavedPlayers(savedPlayers.length, isPro);
  const trimmedName = newPlayerName.trim();
  const filteredSaved = filterSavedByQuery(savedPlayers, newPlayerName);
  const visibleSaved = filteredSaved.slice(0, RECENT_LIMIT);
  const isTypedNew =
    trimmedName.length > 0 &&
    !selectedSavedId &&
    matchSavedByExactName(savedPlayers, newPlayerName).length === 0;
  const atPlayerCap = !isPro && activeGame.players.length >= 12;

  const addedConfirmLabel = formatAddedConfirmation(lastAddedName, addedCount);

  const hasSubject = trimmedName.length > 0;
  // The single saved player an untapped typed name exactly matches (else null).
  // Mutually exclusive with isTypedNew (which excludes exact matches).
  const typedExactMatch = selectedSavedId == null ? singleExactSavedMatch(savedPlayers, newPlayerName) : null;
  const committingTapped = selectedSavedId != null;            // decisive pick — list hidden
  const committingTyped = hasSubject && selectedSavedId == null; // still searching / brand-new

  const closeAddModal = () => {
    setNewPlayerName('');
    setNewPlayerBuyIn('');
    setSelectedSavedId(null);
    setSavePlayerToggle(true);
    setForceUnlinked(false);
    setShowAddPlayer(false);
    setPendingBankerDesignation(false);
  };

  // Tapping a saved player selects (does not commit) them, so a buy-in can ride
  // along in the same Add. Focus moves to the buy-in field.
  const handleSelectSaved = (p: SavedPlayer) => {
    setNewPlayerName(p.name);
    setSelectedSavedId(p.id);
    requestAnimationFrame(() => buyInInputRef.current?.focus());
  };

  // Editing the name un-selects any tapped saved player.
  const handleNameChange = (text: string) => {
    setNewPlayerName(text);
    setSelectedSavedId(null);
    setForceUnlinked(false);
  };

  // The '‹ Adding {name}' header taps back to Browse (un-picks the saved row).
  const clearSubject = () => {
    setNewPlayerName('');
    setSelectedSavedId(null);
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  const commitAddPlayer = async () => {
    if (addingPlayerRef.current) return;

    // Pro gate: free tier caps at 12 players. Enforced on EVERY add because the
    // modal stays open for multiple adds (not just when opening the modal).
    if (!isPro && activeGame.players.length >= 12) {
      setShowAddPlayer(false);
      setPendingBankerDesignation(false);
      setPaywallMessage(PLAYERS_PAYWALL_MESSAGE);
      setShowPaywall(true);
      return;
    }

    const name = newPlayerName.trim();
    if (!name) {
      Alert.alert('Error', 'Please enter a player name');
      return;
    }
    if (newPlayerBuyIn.trim() && !isValidNumericInput(newPlayerBuyIn)) {
      Alert.alert('Error', 'Please enter a valid numeric amount (digits and decimal point only) or leave it empty');
      return;
    }
    const buyInAmount = parseFloat(newPlayerBuyIn);
    if (newPlayerBuyIn.trim() && (isNaN(buyInAmount) || buyInAmount < 0)) {
      Alert.alert('Error', 'Please enter a valid buy-in amount or leave it empty');
      return;
    }

    // Hard-lock: names must be unique within the game (active + completed).
    if (isNameTakenInGame(activeGame.players, name)) {
      Alert.alert(
        'Name already used',
        `You already have a player named "${name}" in this game. Add a last initial (e.g. "${name} R") so you can tell them apart.`,
      );
      return;
    }

    // Resolve which saved identity (if any) to bind.
    let bound: SavedPlayer | null = selectedSavedId
      ? savedPlayers.find(p => p.id === selectedSavedId) ?? null
      : null;
    if (!bound && !forceUnlinked) {
      const exact = matchSavedByExactName(savedPlayers, name);
      if (exact.length === 1) {
        bound = exact[0];
      } else if (exact.length >= 2) {
        // Legacy duplicate saved names — cannot auto-pick. Steer to tap one.
        Alert.alert('Which one?', `Tap the "${name}" you mean in the list above.`);
        return;
      }
    }

    addingPlayerRef.current = true;
    try {
      const player = GameService.addPlayer(activeGame, name);

      let savedId: string | undefined = bound?.id;
      const payment = bound?.preferredPayment;

      if (uid) {
        if (bound) {
          updateSavedPlayer(uid, bound.id, {}).catch(() => {}); // recency bump
        } else if (savePlayerToggle && !savedListFull && !forceUnlinked) {
          const res = await createSavedPlayer(uid, name, undefined, savedCapFor(isPro));
          if (res.ok) savedId = res.id;
        }
      }

      if (savedId || payment) {
        const i = activeGame.players.findIndex(p => p.id === player.id);
        if (i !== -1) {
          activeGame.players[i] = {
            ...activeGame.players[i],
            ...(payment ? { preferredPayment: payment } : {}),
            ...(savedId ? { savedPlayerId: savedId } : {}),
          };
        }
      }

      if (!isNaN(buyInAmount) && buyInAmount > 0) {
        GameService.addTransaction(activeGame, player.id, 'buyin', buyInAmount);
      }

      if (pendingBankerDesignation) {
        activeGame.settlementMode = 'banker';
        activeGame.bankerPlayerId = player.id;
        GameService.clearSettlementCache(activeGame);
        setPendingBankerDesignation(false);
      }

      await updateGame(activeGame);
      refreshSavedNames(); // reflect the new/bumped saved entry + recency order

      // Reset for the next add; keep the modal open.
      setAddedCount(c => c + 1);
      setLastAddedName(name);
      setNewPlayerName('');
      setNewPlayerBuyIn('');
      setSelectedSavedId(null);
      setSavePlayerToggle(true);
      setForceUnlinked(false);
      requestAnimationFrame(() => nameInputRef.current?.focus());
    } finally {
      addingPlayerRef.current = false;
    }
  };

  const handleAddTransaction = async () => {
    if (!selectedPlayer) return;

    // Validate format before parsing
    if (!isValidNumericInput(transactionAmount)) {
      Alert.alert('Error', 'Please enter a valid numeric amount (digits and decimal point only)');
      return;
    }

    const amount = parseFloat(transactionAmount);
    if (isNaN(amount) || amount < 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    const playerBalance = GameService
      .calculateBalances(activeGame)
      .find(balance => balance.playerId === selectedPlayer.id);

    const currentTotal = transactionType === 'buyin'
      ? playerBalance?.totalBuyins ?? 0
      : playerBalance?.totalCashouts ?? 0;

    if (transactionType === 'buyin') {
      const currentCashout = playerBalance?.totalCashouts ?? 0;
      if (currentCashout > 0 && amount < currentCashout) {
        Alert.alert('Error', `Buy-in cannot be less than cash out of ${formatAmount(currentCashout)}`);
        return;
      }
    }

    if (transactionType === 'cashout') {
      const currentBuyin = playerBalance?.totalBuyins ?? 0;
      if (currentBuyin <= 0) {
        Alert.alert('Error', 'Player must have a buy-in before cashing out');
        return;
      }
      // No upper limit constraint - players can cash out more than their buy-in when they win
    }

    if (amount === currentTotal) {
      setTransactionAmount('');
      setShowAddTransaction(false);
      setSelectedPlayer(null);
      return;
    }

    GameService.setPlayerTransactionTotal(activeGame, selectedPlayer.id, transactionType, amount);
    await updateGame(activeGame);
    setTransactionAmount('');
    setShowAddTransaction(false);
    setSelectedPlayer(null);
  };

  const handleCompleteGame = () => {
    const balances = GameService.calculateBalances(activeGame);
    const validation = GameService.validateGame(
      balances,
      formatAmount,
      activeGame.settlementMode === 'banker' ? activeGame.bankerPlayerId : undefined,
      activeGame.settlementMode,
      resolveTolerance(activeGame.imbalanceTolerance, currency),
    );

    setValidationResult(validation);

    // Determine modal mode based on validation
    if (!validation.isValid) {
      setCompletionModalMode('error');
    } else if (validation.warnings.length > 0) {
      setCompletionModalMode('warning');
    } else {
      setCompletionModalMode('confirm');
    }

    setShowCompletionModal(true);
  };

  const finalizeCompletion = async () => {
    try {
      GameService.completeGame(activeGame);
      await updateGame(activeGame);
      setShowCompletionModal(false);
      setShowDistortionModal(false);
      setShowSolvingModal(true);

      const balances = GameService.calculateBalances(activeGame);
      const banker =
        activeGame.settlementMode === 'banker'
          ? activeGame.players.find(p => p.id === activeGame.bankerPlayerId)
          : undefined;
      const result =
        banker
          ? calculateBankerSettlements(
              balances,
              { id: banker.id, name: banker.name },
              resolveCashUnit(activeGame.cashUnit, currency),
            )
          : await getSettlements(balances, {
              settings: {
                cashRoundingUnit: resolveCashUnit(activeGame.cashUnit, currency),
                imbalanceTolerance: resolveTolerance(
                  activeGame.imbalanceTolerance,
                  currency,
                ),
              },
            });

      GameService.cacheSettlements(activeGame, result);
      await updateGame(activeGame);

      // Fire-and-forget review games counter
      AsyncStorage.getItem('review_games_completed').then(val => {
        const count = parseInt(val ?? '0', 10);
        AsyncStorage.setItem('review_games_completed', String(count + 1));
      }).catch(() => {});

      // Fire-and-forget profile stat increment — after successful completion
      if (user?.uid) {
        const totalPot = balances.reduce((sum, b) => sum + b.totalBuyins, 0);
        const playerCount = activeGame.players.length;
        if (Number.isFinite(totalPot) && totalPot > 0 && playerCount > 0) {
          incrementProfileStats(user.uid, {
            gamesPlayed: 1,
            moneyTracked: Math.round(totalPot * 100) / 100,
            playersHosted: playerCount,
            gamePot: Math.round(totalPot * 100) / 100,
          }).catch(err => console.warn('Profile stats increment failed:', err));
        }
      }

      setShowSolvingModal(false);
      router.push('/game/summary' as any);
    } catch (error) {
      setShowSolvingModal(false);
      Alert.alert('Error', 'Failed to complete game. Please try again.');
      console.error('Error completing game:', error);
    }
  };

  const bankerName =
    activeGame.settlementMode === 'banker'
      ? activeGame.players.find(p => p.id === activeGame.bankerPlayerId)?.name
      : undefined;

  const roundingLabel =
    resolveCashUnit(activeGame.cashUnit, currency) === EXACT_CASH_UNIT
      ? 'Exact'
      : formatAmount(resolveCashUnit(activeGame.cashUnit, currency));

  const resolvedTolerance = resolveTolerance(activeGame.imbalanceTolerance, currency);
  // Expanded-row value (always shown, plain like the Rounding value).
  const toleranceValueLabel =
    resolvedTolerance === 0 ? 'Exact' : formatAmount(resolvedTolerance);
  // Collapsed caption segment + a11y label: always shown (like rounding), so the
  // summary stays consistent at the currency default instead of dropping it.
  const toleranceLabel = toleranceCaption(resolvedTolerance, formatAmount);

  const settingsSummary = formatSettingsSummary(
    activeGame.settlementMode === 'banker',
    bankerName,
    roundingLabel,
    toleranceLabel,
  );

  const applySettlementMode = async (mode: 'optimal' | 'banker', bankerId?: string) => {
    GameService.setSettlementMode(activeGame, mode, bankerId);
    await updateGame(activeGame);
  };

  const handleTapDirect = () => {
    if (activeGame.settlementMode !== 'banker') return; // already Direct
    applySettlementMode('optimal');
  };

  const handleTapBanker = () => {
    if (GameService.hasRememberedBanker(activeGame)) {
      applySettlementMode('banker'); // one-tap: reuse the remembered banker
    } else {
      setShowSettlementModePicker(true); // must choose one first (invariant)
    }
  };

  // From the banker picker's "Add someone" row / empty-state prompt. Close the
  // picker (a native Modal) in the same batch that opens the Add Player AppModal
  // — iOS shows one native Modal at a time. Designation is applied atomically on
  // save via the existing pendingBankerDesignation path; cancelling Add Player
  // leaves settlementMode untouched, so we never enter a banker-without-banker state.
  const handleAddBanker = () => {
    setShowSettlementModePicker(false);
    setPendingBankerDesignation(true);
    setNewPlayerName('');
    setAddedCount(0);
    setLastAddedName(null);
    setShowAddPlayer(true);
  };

  const handleConfirmCompletion = async () => {
    const balances = GameService.calculateBalances(activeGame);
    const { significantDistortions } = computeRoundingDistortion(
      balances,
      resolveCashUnit(activeGame.cashUnit, currency),
    );
    if (significantDistortions.length > 0) {
      setDistortions(significantDistortions);
      setShowCompletionModal(false);
      setShowDistortionModal(true);
      return;
    }
    await finalizeCompletion();
  };

  const handleTitlePress = () => {
    setEditedTitle(activeGame.name);
    setIsEditingTitle(true);
  };

  const handleTitleBlur = async () => {
    const trimmedTitle = editedTitle.trim();

    // Validation: empty title
    if (!trimmedTitle) {
      Alert.alert('Error', 'Game name cannot be empty');
      setEditedTitle(activeGame.name);
      setIsEditingTitle(false);
      return;
    }

    // Only update if changed
    if (trimmedTitle !== activeGame.name) {
      activeGame.name = trimmedTitle;
      await updateGame(activeGame);
    }

    setIsEditingTitle(false);
  };

  const confirmDeletePlayer = (player: Player) => {
    setPlayerToDelete(player);
    setShowDeleteConfirmation(true);
  };

  const handleDeletePlayer = async () => {
    if (!playerToDelete || !activeGame) return;

    try {
      GameService.removePlayer(activeGame, playerToDelete.id);
      await updateGame(activeGame);

      setShowDeleteConfirmation(false);
      setPlayerToDelete(null);
    } catch (error) {
      Alert.alert('Error', 'Failed to delete player. Please try again.');
      console.error('Error deleting player:', error);
    }
  };

  const handleCompletePlayer = async (player: Player) => {
    if (!activeGame) return;

    try {
      GameService.markPlayerAsCompleted(activeGame, player.id);
      await updateGame(activeGame);
    } catch (error) {
      Alert.alert('Error', 'Failed to mark player as completed. Please try again.');
      console.error('Error completing player:', error);
    }
  };

  const handleReactivatePlayer = async (player: Player) => {
    if (!activeGame) return;

    try {
      GameService.markPlayerAsActive(activeGame, player.id);
      await updateGame(activeGame);
    } catch (error) {
      Alert.alert('Error', 'Failed to reactivate player. Please try again.');
      console.error('Error reactivating player:', error);
    }
  };

  const handleRenamePlayer = async () => {
    if (!selectedPlayer) return;
    const trimmedName = renamedPlayerName.trim();
    if (!trimmedName) {
      Alert.alert('Error', 'Player name cannot be empty');
      return;
    }
    if (trimmedName !== selectedPlayer.name) {
      GameService.renamePlayer(activeGame!, selectedPlayer.id, trimmedName);
      // Re-resolve preferred payment for the new name so a renamed player doesn't
      // keep the previous person's payment info. Mirrors the Add Player autofill:
      // apply the new name's saved payment, or clear the badge if it has none.
      // Re-resolve the saved-pool binding for the NEW name. Keep savedPlayerId + payment only
      // when the new name uniquely matches one saved entry; if it matches 0 or 2+ (ambiguous),
      // drop the stale binding so a later payment edit can't write back to the wrong entry.
      const matches = uid ? await getSavedPlayersByName(uid, trimmedName) : [];
      const saved = matches.length === 1 ? matches[0] : undefined;
      const i = activeGame!.players.findIndex(p => p.id === selectedPlayer.id);
      if (i !== -1) {
        const { preferredPayment, savedPlayerId, ...rest } = activeGame!.players[i];
        activeGame!.players[i] = saved
          ? {
              ...rest,
              savedPlayerId: saved.id,
              ...(saved.preferredPayment ? { preferredPayment: saved.preferredPayment } : {}),
            }
          : rest;
      }
      await updateGame(activeGame!);
    }
    setShowRenameModal(false);
    setSelectedPlayer(null);
    setRenamedPlayerName('');
    setRenameSuggestions([]);
  };

  return (
    <View style={styles.container}>
      <HelpHint visible={hintVisible} onDismiss={dismissHint} />
      <ScrollView style={styles.scrollView}>
        {/* Game Info */}
        <View style={styles.header}>
          {isEditingTitle ? (
            <TextInput
              style={styles.gameTitleInput}
              value={editedTitle}
              onChangeText={setEditedTitle}
              onBlur={handleTitleBlur}
              onSubmitEditing={handleTitleBlur}
              autoFocus
              returnKeyType="done"
              maxLength={50}
              placeholder="Game name"
              placeholderTextColor="#666"
            />
          ) : (
            <TouchableOpacity onPress={handleTitlePress} activeOpacity={0.7}>
              <View style={styles.titleContainer}>
                <Text style={styles.gameTitle}>{activeGame.name}</Text>
                <Text style={styles.editIcon}>✎</Text>
              </View>
            </TouchableOpacity>
          )}
          <Text style={styles.gameInfo}>
            {new Date(activeGame.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </Text>
        </View>

        {/* Settlement / Settings */}
        <View style={styles.section}>
          <HudSectionHeader
            label="Settings"
            onAction={toggleSettings}
            actionIcon={settingsExpanded ? 'chevron-up' : 'chevron-down'}
            accessibilityLabel={settingsExpanded ? 'Collapse settings' : 'Expand settings'}
            accessibilityHint={
              settingsExpanded
                ? 'Collapses the game settings section'
                : 'Expands the game settings section'
            }
          />

          {settingsExpanded ? (
            <View style={styles.settlementCard}>
              <View style={styles.segment}>
                <TouchableOpacity
                  style={[styles.segmentBtn, activeGame.settlementMode !== 'banker' && styles.segmentBtnActive]}
                  onPress={handleTapDirect}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.segmentText, activeGame.settlementMode !== 'banker' && styles.segmentTextActive]}>
                    Direct
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segmentBtn, activeGame.settlementMode === 'banker' && styles.segmentBtnActive]}
                  onPress={handleTapBanker}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.segmentText, activeGame.settlementMode === 'banker' && styles.segmentTextActive]}>
                    Banker
                  </Text>
                </TouchableOpacity>
              </View>

              {activeGame.settlementMode === 'banker' && (
                <>
                  <View style={styles.menuDivider} />
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => setShowSettlementModePicker(true)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.menuItemLeft}>
                      <Ionicons name="person-outline" size={18} color="rgba(255,255,255,0.5)" />
                      <Text style={styles.menuItemLabel}>Banker</Text>
                    </View>
                    <View style={styles.menuItemRight}>
                      <Text style={styles.menuItemValue}>
                        {bankerName ? bankerName : 'Choose banker'}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.4)" />
                    </View>
                  </TouchableOpacity>
                </>
              )}

              <View style={styles.menuDivider} />

              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => setShowCashUnitPicker(true)}
                activeOpacity={0.7}
              >
                <View style={styles.menuItemLeft}>
                  <Ionicons name="options-outline" size={18} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.menuItemLabel}>Rounding</Text>
                </View>
                <View style={styles.menuItemRight}>
                  <Text style={styles.menuItemValue}>{roundingLabel}</Text>
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.4)" />
                </View>
              </TouchableOpacity>

              <View style={styles.menuDivider} />

              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => setShowTolerancePicker(true)}
                activeOpacity={0.7}
              >
                <View style={styles.menuItemLeft}>
                  <Ionicons name="git-compare-outline" size={18} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.menuItemLabel}>Imbalance tolerance</Text>
                </View>
                <View style={styles.menuItemRight}>
                  <Text style={styles.menuItemValue}>{toleranceValueLabel}</Text>
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.4)" />
                </View>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={toggleSettings}
              activeOpacity={0.7}
              style={styles.settingsSummaryRow}
              accessibilityRole="button"
              accessibilityLabel={`Settings: ${settingsSummary}`}
              accessibilityHint="Expands the game settings section"
            >
              {/* Mode group (shrinks + ellipsizes for long banker names) */}
              <View style={[styles.settingsSummaryGroup, styles.settingsSummaryModeGroup]}>
                <Ionicons
                  name={activeGame.settlementMode === 'banker' ? 'person-outline' : 'swap-horizontal'}
                  size={15}
                  color="rgba(255,255,255,0.5)"
                />
                {activeGame.settlementMode === 'banker' ? (
                  <Text style={styles.settingsSummaryLabel} numberOfLines={1}>
                    Banker
                    <Text style={styles.settingsSummaryValue}>
                      {bankerName ? ` · ${bankerName}` : ' · Choose banker'}
                    </Text>
                  </Text>
                ) : (
                  <Text style={styles.settingsSummaryValue} numberOfLines={1}>
                    Direct
                  </Text>
                )}
              </View>

              {/* Separator + rounding — suppressed while banker mode has no banker chosen */}
              {(activeGame.settlementMode !== 'banker' || !!bankerName) && (
                <>
                  <Text style={styles.settingsSummaryDot}>·</Text>
                  <View style={styles.settingsSummaryGroup}>
                    <Ionicons name="options-outline" size={15} color="rgba(255,255,255,0.5)" />
                    <Text style={styles.settingsSummaryValue} numberOfLines={1}>
                      {roundingLabel}
                    </Text>
                  </View>
                </>
              )}

              {/* Tolerance — always shown, same banker-unchosen suppression as rounding */}
              {(activeGame.settlementMode !== 'banker' || !!bankerName) && (
                  <>
                    <Text style={styles.settingsSummaryDot}>·</Text>
                    <View style={styles.settingsSummaryGroup}>
                      <Ionicons name="git-compare-outline" size={15} color="rgba(255,255,255,0.5)" />
                      <Text style={styles.settingsSummaryValue} numberOfLines={1}>
                        {toleranceLabel}
                      </Text>
                    </View>
                  </>
                )}
            </TouchableOpacity>
          )}
        </View>

        {/* Active Players List */}
        <View style={styles.section}>
          <HudSectionHeader
            label="Players"
            onAction={() => {
              if (!isPro && activeGame.players.length >= 12) {
                setPaywallMessage(PLAYERS_PAYWALL_MESSAGE);
                setShowPaywall(true);
              } else {
                refreshSavedNames();
                setSavePlayerToggle(true); // toggle defaults ON each time the modal opens
                setAddedCount(0);
                setLastAddedName(null);
                setShowAddPlayer(true);
              }
            }}
            actionIcon="add-circle-outline"
          />

          {activePlayers.length === 0 ? (
            <EmptyState label="No players yet" icon="person-outline" />
          ) : (
            activePlayers.map(player => {
              const balance = getPlayerBalance(player.id);
              return (
                <View key={player.id} style={{ marginBottom: 8, backgroundColor: 'transparent' }}>
                  <PlayerCardActive
                    player={player}
                    balance={balance}
                    onBuyIn={handleBuyIn}
                    onCashOut={handleCashOut}
                    onComplete={handleCompletePlayer}
                    onDelete={confirmDeletePlayer}
                    onRename={openRenameModal}
                    onEditPayment={openPaymentEditor}
                    reduceMotion={reduceMotionEnabled}
                    isBanker={activeGame.settlementMode === 'banker' && activeGame.bankerPlayerId === player.id}
                  />
                </View>
              );
            })
          )}
        </View>

        {/* Completed Players List */}
        {completedPlayers.length > 0 && (
          <View style={styles.section}>
            <HudSectionHeader label="Completed" />

            {completedPlayers.map(player => {
              const balance = getPlayerBalance(player.id);
              return (
                <View key={player.id} style={{ marginBottom: 8, backgroundColor: 'transparent' }}>
                  <PlayerCardCompleted
                    player={player}
                    balance={balance}
                    onReactivate={handleReactivatePlayer}
                    onDelete={confirmDeletePlayer}
                    reduceMotion={reduceMotionEnabled}
                  />
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Actions */}
      {activeGame.players.length > 1 && activeGame.transactions.length > 0 && (
        <View style={styles.actions}>
          <Button
            onPress={handleCompleteGame}
            title="Complete Game"
            variant="primary"
            fullWidth
            accessibilityHint="Finalize game and calculate settlements"
           />
        </View>
      )}

      {/* Add Player Modal */}
      <AppModal
        visible={showAddPlayer}
        title="Add Players"
        onClose={closeAddModal}
        contentStyle={appModalStyles.centeredContent}
      >
        {pendingBankerDesignation && (
          <Text style={styles.bankerPendingHint}>This person will be set as banker</Text>
        )}

        {addedConfirmLabel && !isLastAddVisibleInList(lastAddedName, visibleSaved, activeGame.players) && (
          <Text style={styles.addedConfirm}>✓ {addedConfirmLabel}</Text>
        )}

        {/* Subject header (decisive pick) OR search field (Browse / typing). */}
        {committingTapped ? (
          <TouchableOpacity
            style={styles.addingHeader}
            onPress={clearSubject}
            accessibilityRole="button"
            accessibilityLabel="Back to saved players"
          >
            <Ionicons name="chevron-back" size={18} color="#B072BB" />
            <Text style={styles.addingHeaderText}>
              Adding <Text style={styles.addingHeaderName}>{trimmedName}</Text>
            </Text>
          </TouchableOpacity>
        ) : (
          <TextInput
            ref={nameInputRef}
            style={styles.input}
            value={newPlayerName}
            onChangeText={handleNameChange}
            placeholder="Search saved or type a name"
            placeholderTextColor="#666"
            autoFocus
            autoCapitalize="words"
            returnKeyType="next"
          />
        )}

        {/* Pick-first saved list — Browse + typing only; hidden on decisive pick.
            Collapses to nothing when a typed query matches no saved player. */}
        {!committingTapped && savedPlayers.length > 0 && filteredSaved.length > 0 && (
          <>
            <Text style={styles.pickerLabel}>SAVED · {savedPlayers.length}</Text>
            <View style={styles.pickerList}>
              {visibleSaved.map((p, index) => {
                const inGame = isNameTakenInGame(activeGame.players, p.name);
                const badge = savedBadge(p);
                return (
                  <TouchableOpacity
                    key={p.id}
                    disabled={inGame || atPlayerCap}
                    onPress={() => handleSelectSaved(p)}
                    style={[
                      styles.pickerRow,
                      index === visibleSaved.length - 1 && styles.pickerRowLast,
                      (inGame || atPlayerCap) && styles.pickerRowDisabled,
                    ]}
                  >
                    <Text style={styles.pickerRowName}>{p.name}</Text>
                    {inGame ? (
                      <Text style={styles.pickerAddedTag}>Added ✓</Text>
                    ) : badge ? (
                      <Text style={styles.pickerRowBadge} numberOfLines={1}>{badge}</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            {filteredSaved.length > RECENT_LIMIT && (
              <Text style={styles.pickMoreHint}>+{filteredSaved.length - RECENT_LIMIT} more ›</Text>
            )}
          </>
        )}

        {/* Buy-in — only once a subject exists (Commit). */}
        {hasSubject && (
          <TextInput
            ref={buyInInputRef}
            style={styles.input}
            value={newPlayerBuyIn}
            onChangeText={setNewPlayerBuyIn}
            placeholder="Buy-In"
            placeholderTextColor="#666"
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={commitAddPlayer}
          />
        )}

        {/* Save-player opt-in — typing-a-new-name only, in a fixed-height slot so
            crossing an exact saved-name match doesn't shift the Add button. */}
        {committingTyped && (
          <View style={styles.saveToggleSlot}>
            {isTypedNew ? (
              savedListFull ? (
                <TouchableOpacity
                  style={styles.saveToggleRow}
                  disabled={isPro}
                  onPress={() => {
                    setShowAddPlayer(false);
                    setPendingBankerDesignation(false);
                    setPaywallMessage(SAVED_CAP_PAYWALL_MESSAGE);
                    setShowPaywall(true);
                  }}
                >
                  <Ionicons name="lock-closed" size={14} color="#B072BB" />
                  <Text style={styles.saveToggleFullText}>
                    Saved players full · {savedPlayers.length}/{savedCapFor(isPro)}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.saveToggleRow} onPress={() => setSavePlayerToggle(v => !v)}>
                  <Ionicons
                    name={savePlayerToggle ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={savePlayerToggle ? '#B072BB' : '#666'}
                  />
                  <Text style={styles.saveToggleText}>Save player</Text>
                </TouchableOpacity>
              )
            ) : typedExactMatch ? (
              forceUnlinked ? (
                <TouchableOpacity style={styles.identityRow} onPress={() => setForceUnlinked(false)}>
                  <Ionicons name="close-circle-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.identityUnlinkedText} numberOfLines={1}>Adding as new · not linked</Text>
                  <Text style={styles.identityAction}>Undo</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.identityRow} onPress={() => setForceUnlinked(true)}>
                  <Ionicons name="arrow-forward" size={14} color="#B072BB" />
                  <Text style={styles.identityUsingText} numberOfLines={1}>
                    Using saved {typedExactMatch.name}
                    {savedBadge(typedExactMatch) ? ` · ${savedBadge(typedExactMatch)}` : ''}
                  </Text>
                  <Text style={styles.identityAction}>Add as new</Text>
                </TouchableOpacity>
              )
            ) : null}
          </View>
        )}

        {atPlayerCap && (
          <Text style={styles.pickHint}>Free limit reached · 12 players. Upgrade to Pro for unlimited.</Text>
        )}

        <View style={styles.modalButtons}>
          {hasSubject ? (
            <ModalButton variant="confirm" title="Add" onPress={commitAddPlayer} />
          ) : (
            <ModalButton variant="cancel" title="Done" onPress={closeAddModal} />
          )}
        </View>
      </AppModal>

      {/* Add Transaction Modal */}
      <AppModal
        visible={showAddTransaction}
        title={`${transactionType === 'buyin' ? 'Buy-in' : 'Cash Out'} - ${selectedPlayer?.name}`}
        onClose={() => setShowAddTransaction(false)}
        contentStyle={appModalStyles.centeredContent}
      >
        <TextInput
          style={styles.input}
          value={transactionAmount}
          onChangeText={setTransactionAmount}
          placeholder="Amount"
          placeholderTextColor="#666"
          keyboardType="decimal-pad"
          autoFocus
        />
        <View style={styles.modalButtons}>
          <ModalButton
            variant="cancel"
            title="Cancel"
            onPress={() => {
              setTransactionAmount('');
              setShowAddTransaction(false);
              setSelectedPlayer(null);
            }}
          />
          <ModalButton
            variant="confirm"
            title="Confirm"
            onPress={handleAddTransaction}
          />
        </View>
      </AppModal>

      {/* Rename Player Modal */}
      <AppModal
        visible={showRenameModal}
        title="Rename Player"
        onClose={() => {
          setShowRenameModal(false);
          setSelectedPlayer(null);
          setRenamedPlayerName('');
          setRenameSuggestions([]);
        }}
        contentStyle={appModalStyles.centeredContent}
      >
            <TextInput
              style={[styles.input, renameSuggestions.length > 0 && styles.inputWithSuggestions]}
              value={renamedPlayerName}
              onChangeText={text => {
                setRenamedPlayerName(text);
                if (text.trim().length === 0) {
                  setRenameSuggestions([]);
                  return;
                }
                const lower = text.toLowerCase();
                setRenameSuggestions(
                  savedPlayers.filter(p => p.name.toLowerCase().startsWith(lower)).slice(0, 4)
                );
              }}
              placeholder="New name"
              placeholderTextColor="#666"
              autoFocus
              onSubmitEditing={handleRenamePlayer}
              returnKeyType="done"
            />
            {renameSuggestions.length > 0 && (
              <View style={styles.suggestionsContainer}>
                {renameSuggestions.map((p, index) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.suggestionItem,
                      index === renameSuggestions.length - 1 && styles.suggestionItemLast,
                    ]}
                    onPress={() => {
                      setRenamedPlayerName(p.name);
                      setRenameSuggestions([]);
                    }}
                  >
                    <Text style={styles.suggestionText}>{p.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <View style={styles.modalButtons}>
              <ModalButton
                variant="cancel"
                title="Cancel"
                onPress={() => {
                  setShowRenameModal(false);
                  setSelectedPlayer(null);
                  setRenamedPlayerName('');
                  setRenameSuggestions([]);
                }}
              />
              <ModalButton
                variant="confirm"
                title="Save"
                onPress={handleRenamePlayer}
              />
            </View>
      </AppModal>

      {/* Delete Player Confirmation Modal */}
      <AppModal
        visible={showDeleteConfirmation}
        onClose={() => setShowDeleteConfirmation(false)}
        dismissOnBackdrop={false}
        contentStyle={appModalStyles.centeredContent}
      >
        <Ionicons name="warning" size={48} color="#C04657" style={styles.warningIcon} />
        <Text style={appModalStyles.title}>Delete Player?</Text>
        <Text style={styles.deleteWarningText}>
          This will remove {playerToDelete?.name} and all their transactions from this game.
          {'\n\n'}This action cannot be undone.
        </Text>
        <View style={styles.modalButtons}>
          <ModalButton
            variant="cancel"
            title="Cancel"
            onPress={() => {
              setShowDeleteConfirmation(false);
              setPlayerToDelete(null);
            }}
          />
          <ModalButton
            variant="destructive"
            title="Delete"
            onPress={handleDeletePlayer}
          />
        </View>
      </AppModal>

      {/* Game Completion Modal */}
      <AppModal
        visible={showCompletionModal}
        onClose={() => setShowCompletionModal(false)}
        contentStyle={appModalStyles.centeredContent}
      >
              {/* Dynamic Icon */}
              {completionModalMode === 'error' && (
                <Ionicons name="alert-circle" size={48} color="#C04657" style={styles.completionModalIcon} />
              )}
              {completionModalMode === 'warning' && (
                <Ionicons name="warning" size={48} color="#C04657" style={styles.completionModalIcon} />
              )}
              {completionModalMode === 'confirm' && (
                <Ionicons name="checkmark-circle" size={48} color="#00D66F" style={styles.completionModalIcon} />
              )}

              {/* Dynamic Title */}
              <Text style={appModalStyles.title}>
                {completionModalMode === 'error' ? 'Cannot Complete Game' :
                completionModalMode === 'warning' ? 'Warning' :
                'Complete Game'}
              </Text>

              {/* Dynamic Content */}
              {completionModalMode === 'error' && validationResult && (
                <>
                  {validationResult.errors.map((error, index) => (
                    <View key={index} style={{ backgroundColor: 'transparent' }}>
                      {highlightCriticalValues(error)}
                      {index < validationResult.errors.length - 1 && <View style={{ height: 22, backgroundColor: 'transparent' }} />}
                    </View>
                  ))}
                </>
              )}

              {completionModalMode === 'warning' && validationResult && (
                <>
                  {validationResult.warnings.map((warning, index) => (
                    <View key={index} style={{ backgroundColor: 'transparent' }}>
                      {highlightCriticalValues(warning)}
                      {index < validationResult.warnings.length - 1 && <View style={{ height: 12, backgroundColor: 'transparent' }} />}
                    </View>
                  ))}
                </>
              )}

              {completionModalMode === 'confirm' && (
                <Text style={styles.completionModalConfirmText}>
                  Are you sure you want to complete this game? This action cannot be undone.
                </Text>
              )}

              {/* Dynamic Buttons */}
              {completionModalMode === 'error' ? (
                <ModalButton
                  variant="cancel"
                  title="OK"
                  onPress={() => setShowCompletionModal(false)}
                  fullWidth
                />
              ) : (
                <View style={styles.modalButtons}>
                  <ModalButton
                    variant="cancel"
                    title="Cancel"
                    onPress={() => setShowCompletionModal(false)}
                  />
                  <ModalButton
                    variant={completionModalMode === 'warning' ? 'destructive' : 'success'}
                    title={completionModalMode === 'warning' ? 'Complete Anyway' : 'Complete'}
                    onPress={handleConfirmCompletion}
                  />
                </View>
              )}
      </AppModal>

      {/* Rounding-distortion Confirm Modal */}
      <AppModal
        visible={showDistortionModal}
        onClose={() => setShowDistortionModal(false)}
        contentStyle={appModalStyles.centeredContent}
      >
              <Ionicons name="warning" size={48} color="#E0A800" style={styles.completionModalIcon} />
              <Text style={appModalStyles.title}>Rounding distorts a settlement</Text>
              <Text style={styles.completionModalConfirmText}>
                At {formatAmount(resolveCashUnit(activeGame.cashUnit, currency))} rounding:
              </Text>
              {distortions.map((d, i) => (
                <Text key={`${d.playerName}-${i}`} style={styles.completionModalConfirmText}>
                  {d.tier === 'zeroOut'
                    ? `${d.playerName}'s ${formatAmount(Math.abs(d.original))} balance rounds to ${formatAmount(0)}. Settles nothing`
                    : `${d.playerName}'s ${formatAmount(Math.abs(d.original))} balance rounds to ${formatAmount(Math.abs(d.rounded))}`}
                </Text>
              ))}
              <Text style={styles.completionModalConfirmText}>
                Pick a smaller rounding unit to reduce this.
              </Text>
              <View style={styles.modalButtons}>
                <ModalButton
                  variant="cancel"
                  title="Back"
                  onPress={() => { setShowDistortionModal(false); setShowCompletionModal(true); }}
                />
                <ModalButton
                  variant="destructive"
                  title="Continue"
                  onPress={finalizeCompletion}
                />
              </View>
      </AppModal>

      {/* Paywall Modal — shown when free user tries to add an 11th player */}
      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        triggerMessage={paywallMessage}
      />

      {/* Cash Unit Picker Modal */}
      <CashUnitPickerModal
        visible={showCashUnitPicker}
        currentUnit={activeGame.cashUnit}
        currency={currency}
        onSelect={async (unit) => {
          activeGame.cashUnit = unit;
          GameService.clearSettlementCache(activeGame);
          await updateGame(activeGame);
        }}
        onClose={() => setShowCashUnitPicker(false)}
      />

      {/* Imbalance Tolerance Picker Modal */}
      <TolerancePickerModal
        visible={showTolerancePicker}
        currentTolerance={activeGame.imbalanceTolerance}
        currency={currency}
        onSelect={async (tol) => {
          activeGame.imbalanceTolerance = tol;
          GameService.clearSettlementCache(activeGame);
          await updateGame(activeGame);
        }}
        onClose={() => setShowTolerancePicker(false)}
      />

      <SettlementModePicker
        visible={showSettlementModePicker}
        players={activeGame.players}
        bankerPlayerId={activeGame.bankerPlayerId}
        onSelectBanker={(id) => applySettlementMode('banker', id)}
        onAddSomeone={handleAddBanker}
        onClose={() => setShowSettlementModePicker(false)}
      />

      {/* Payment Editor Modal */}
      <PaymentEditorModal
        visible={showPaymentEditor}
        player={paymentPlayer}
        onSave={handleSavePayment}
        onClose={() => { setShowPaymentEditor(false); setPaymentPlayer(null); }}
      />

      {/* Solving overlay — uses an absolute View instead of a native <Modal>
           so that react-native-screens can properly detach it when this screen
           loses focus.  A native Modal creates an independent overlay window
           that persists even when the parent screen is frozen/detached, which
           blocks all touch events on any screen pushed on top. */}
      {showSolvingModal && <SolvingOverlay />}

      <HelpSheet
        visible={helpVisible}
        title="During a Game"
        topics={getTopicsByIds(ACTIVE_GAME_TOPIC_IDS)}
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
  scrollView: {
    flex: 1,
    padding: 20,
  },
  header: {
    marginBottom: 24,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    backgroundColor: 'transparent',
  },
  gameTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#B072BB',
    letterSpacing: 1,
  },
  gameTitleInput: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#B072BB',
    letterSpacing: 1,
    textAlign: 'left',
    borderBottomWidth: 2,
    borderBottomColor: '#B072BB',
    paddingBottom: 4,
    marginBottom: 4,
    minWidth: 200,
  },
  editIcon: {
    fontSize: 20,
    color: '#B072BB',
    opacity: 0.5,
    marginBottom: 4,
  },
  gameInfo: {
    fontSize: 14,
    opacity: 0.5,
    color: '#FFFFFF',
  },
  section: {
    marginBottom: 28,
    backgroundColor: 'transparent',
  },

  // HUD section header
  hudHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    backgroundColor: 'transparent',
  },
  hudLines: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
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
    paddingHorizontal: 10,
    backgroundColor: '#0A0A0A',
    zIndex: 1,
  },
  hudIconSlot: {
    position: 'absolute',
    right: 0,
    width: 32,
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 2,
    backgroundColor: '#0A0A0A',
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
  emptyText: {
    fontSize: 15,
    opacity: 0.4,
    textAlign: 'center',
    marginTop: 20,
    color: '#FFFFFF',
  },
  actions: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#1E1E1E',
  },
  button: {
    backgroundColor: '#B072BB',
    padding: 20,
    borderRadius: 8,
    alignItems: 'center',
    margin: 20,
  },
  buttonText: {
    color: '#0A0A0A',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  input: {
    width: '100%',
    backgroundColor: '#0A0A0A',
    borderRadius: 6,
    padding: 16,
    fontSize: 18,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    backgroundColor: 'transparent',
  },
  saveToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  saveToggleText: { fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  saveToggleFullText: { fontSize: 13, color: '#B072BB', fontFamily: 'SpaceMono' },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  identityUsingText: { fontSize: 13, color: 'rgba(176,114,187,0.9)', flexShrink: 1 },
  identityUnlinkedText: { fontSize: 13, color: 'rgba(255,255,255,0.55)', flexShrink: 1 },
  identityAction: { marginLeft: 'auto', fontSize: 13, fontWeight: '600', color: '#B072BB' },
  validationBox: {
    flexDirection: 'row',
    backgroundColor: '#2A0A0A',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: '#FF3B5C',
  },
  validationWarningBox: {
    backgroundColor: '#2A1A0A',
    borderColor: '#B072BB',
  },
  validationIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  validationContent: {
    flex: 1,
  },
  validationTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#fff',
  },
  validationError: {
    fontSize: 14,
    color: '#FF3B5C',
    marginBottom: 4,
    lineHeight: 20,
  },
  validationWarning: {
    fontSize: 14,
    color: '#B072BB',
    marginBottom: 4,
    lineHeight: 20,
  },
  completedActionButton: {
    backgroundColor: '#141414',
    borderColor: '#4A3C4A',
  },
  completedActionButtonText: {
    opacity: 0.6,
  },
  completeConfirmButton: {
    backgroundColor: '#4CAF50',
    borderWidth: 0,
  },
  completeConfirmButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  warningIcon: {
    marginBottom: 16,
  },
  deleteWarningText: {
    fontSize: 15,
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    opacity: 0.8,
  },
  completionModalIcon: {
    marginBottom: 16,
  },
  completionModalErrorText: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  completionModalWarningText: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
  },
  criticalValue: {
    color: '#C04657',
    fontWeight: 'bold',
  },
  completionModalConfirmText: {
    fontSize: 15,
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    opacity: 0.8,
  },
  completionModalSubtext: {
    fontSize: 14,
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    opacity: 0.6,
  },
  solvingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
    zIndex: 100,
  },
  solvingHudHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: 200,
    marginBottom: 28,
  },
  solvingHudLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2A2A2A',
  },
  solvingHudLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#B072BB',
    textTransform: 'uppercase',
    letterSpacing: 3,
  },
  solvingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 24,
  },
  solvingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#B072BB',
    shadowColor: '#B072BB',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 3,
  },
  solvingStatusLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: 'rgba(176,114,187,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  inputWithSuggestions: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomColor: 'rgba(176,114,187,0.25)',
    marginBottom: 0,
  },
  suggestionsContainer: {
    width: '100%',
    backgroundColor: '#0A0A0A',
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#2A2A2A',
    marginBottom: 20,
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  suggestionItemLast: {
    borderBottomWidth: 0,
  },
  suggestionText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 15,
  },
  pickerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(176,114,187,0.7)',
    letterSpacing: 1.5,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  pickerList: {
    width: '100%',
    backgroundColor: '#0A0A0A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginBottom: 16,
    overflow: 'hidden',
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  pickerRowLast: { borderBottomWidth: 0 },
  pickerRowDisabled: { opacity: 0.4 },
  pickerRowName: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  pickerRowBadge: {
    fontSize: 11,
    color: 'rgba(176,114,187,0.9)',
    fontFamily: 'SpaceMono',
    flexShrink: 1,
    textAlign: 'right',
  },
  pickerAddedTag: { fontSize: 12, color: '#00D66F', fontFamily: 'SpaceMono' },
  pickHint: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  pickMoreHint: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    alignSelf: 'flex-end',
    marginBottom: 12,
  },
  saveToggleSlot: {
    width: '100%',
    height: 30,
    justifyContent: 'center',
    marginBottom: 16,
    backgroundColor: 'transparent',
  },
  addingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  addingHeaderText: { fontSize: 15, color: 'rgba(255,255,255,0.7)' },
  addingHeaderName: { color: '#FFFFFF', fontWeight: '700' },
  bankerPendingHint: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B072BB',
    textAlign: 'center',
    marginBottom: 10,
  },
  addedConfirm: {
    fontSize: 13,
    fontWeight: '600',
    color: '#00D66F',
    textAlign: 'center',
    marginBottom: 10,
  },
  settlementCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.2)',
    overflow: 'hidden',
  },
  segment: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10, padding: 3,
    marginHorizontal: 20, marginTop: 16, marginBottom: 16,
  },
  segmentBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  segmentBtnActive: { backgroundColor: '#49264F' },
  segmentText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  segmentTextActive: { color: '#FFFFFF' },
  menuDivider: { height: 1, backgroundColor: 'rgba(176,114,187,0.1)', marginHorizontal: 20 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, paddingHorizontal: 20, backgroundColor: 'transparent',
  },
  menuItemLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'transparent' },
  menuItemRight: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent' },
  menuItemLabel: { fontSize: 16, color: '#FFFFFF', fontWeight: '500' },
  menuItemValue: { fontSize: 14, color: 'rgba(255,255,255,0.4)' },
  settingsSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  settingsSummaryGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'transparent',
  },
  settingsSummaryModeGroup: { flexShrink: 1, minWidth: 0 },
  settingsSummaryLabel: { fontSize: 15, color: 'rgba(255,255,255,0.5)' },
  settingsSummaryValue: { fontSize: 15, color: 'rgba(255,255,255,0.75)' },
  settingsSummaryDot: { fontSize: 15, color: 'rgba(255,255,255,0.3)', marginHorizontal: 10 },
});
