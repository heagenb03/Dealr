import React, { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { StyleSheet, FlatList, ListRenderItemInfo, TouchableOpacity, TextInput, Alert, Animated, Keyboard, LayoutAnimation, Platform, UIManager, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
// Aliased to Reanimated because `Animated` on line 2 is react-native's own Animated API,
// which this file still uses for the header's spring scale.
import Reanimated, {
  runOnJS,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  withTiming,
} from 'react-native-reanimated';
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
import { loadSavedPlayers, SavedPlayer, savedCapFor, canAddMoreSavedPlayers, getSavedPlayersByName, getSavedPlayerById, createSavedPlayer, updateSavedPlayer } from '@/services/savedPlayersService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PlayerCardActive from '@/components/PlayerCardActive';
import PlayerCardCompleted from '@/components/PlayerCardCompleted';
import SavedPickerRow from '@/components/SavedPickerRow';
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
import { isNameTakenInGame, matchSavedByExactName, filterSavedByQuery, formatAddedConfirmation, singleExactSavedMatch, shouldShowAddedConfirmation, sortSavedByName, findPlayerByName, isLosslessUndo, postAddFocusTarget, addedConfirmationPlacement } from '@/utils/addPlayer';
import { formatSettingsSummary, toleranceCaption } from '@/utils/settingsSummary';
import { addPlayerCardMaxHeight } from '@/utils/modalCardHeight';
import { useKeyboardVisible } from '@/hooks/useKeyboardVisible';
import { canAddMorePlayers } from '@/utils/tierLimits';
import { buildAddPlayerPickerListData, AddPlayerPickerItem } from '@/utils/addPlayerPickerListData';
import { buildActiveGameListData, ActiveGameListItem } from '@/utils/activeGameListData';
import {
  PLAYERS_PAYWALL_MESSAGE,
  playerCapBanner,
  playerCapHint,
  savedCapModalNotice,
  savedCapPaywallMessage,
} from '@/utils/capCopy';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Module scope, not component scope: a component-local arrow gets a fresh identity every
// render, which would put an unstable value in the picker useMemo's dep array and rebuild
// the list data on every keystroke. The body closes over nothing but imports.
const savedBadge = (p: SavedPlayer): string | null => {
  if (!p.preferredPayment) return null;
  const { method, handle } = p.preferredPayment;
  const label = getPaymentMethodMeta(method).label;
  return handle ? `${label} · ${formatHandleForDisplay(method, handle)}` : label;
};

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

const HELP_HINT_SEEN_KEY = 'help_hint_seen';
const DEFAULT_GAME_NAME = 'Untitled Game';

export default function ActiveGameScreen() {
  const { activeGame, updateGame, setActiveGame, createGame } = useGame();
  const { user, isPro } = useAuth();
  const { formatAmount, formatAmountCompactScaled, meta, currency } = useCurrency();
  const { height: windowHeight } = useWindowDimensions();
  // Caps the Add Players card in TWO discrete states.
  //
  // Keyboard UP: the cap must stay small enough for computeCardLift to raise the card's
  // PINNED footer clear of the keyboard. Without it the Add/Done button sits behind the
  // keyboard with no way to reach it.
  //
  // Keyboard DOWN: that constraint does not apply, so the card grows — taking the saved
  // list from 2 visible rows to 7 on a 667pt device, which is the whole point.
  //
  // The swap is deliberately DISCRETE and un-animated. Interpolating maxHeight per frame
  // around a virtualized list drives continuous re-layout and row recycling, which is
  // visible jank. On iOS keyboardWillShow fires as the keyboard's own animation begins,
  // so the resize lands underneath the incoming keyboard rather than after it.
  //
  // Declared here with the other hooks — BOTH useKeyboardVisible and this memo MUST stay
  // above the `if (!activeGame)` early return further down, or this becomes a
  // Rules-of-Hooks violation.
  const keyboardVisible = useKeyboardVisible();
  const addPlayerCardStyle = useMemo(
    () => ({ maxHeight: addPlayerCardMaxHeight(windowHeight, keyboardVisible) }),
    [windowHeight, keyboardVisible],
  );
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

  // Floating confirmation pill. Starts at 0 so nothing shows on modal open, before any add.
  //
  // The 2500ms timer below drives BOTH render sites, not just this overlay: on completion of
  // the fade it nulls lastAddedName, which closes shouldShowAddedConfirmation's gate and
  // unmounts the in-flow fallback too. That fallback used to persist indefinitely (it has no
  // opacity binding of its own) and could resurrect a stale add much later. The overlay has
  // its own reason to leave — a pill that never left would permanently cover the last saved
  // row and the scroll fade — but the lifetime is now one rule for both.
  //
  // Known minor: the in-flow fallback unmounts without fading, since it is a plain Text with
  // no opacity binding. Accepted — it is a disappearance after 2.65s, not an intrusion.
  const pillOpacity = useSharedValue(0);
  const pillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pillStyle = useAnimatedStyle(() => ({ opacity: pillOpacity.value }));

  const clearAddedPill = useCallback(() => {
    if (pillTimerRef.current) {
      clearTimeout(pillTimerRef.current);
      pillTimerRef.current = null;
    }
    pillOpacity.value = 0;
  }, [pillOpacity]);

  // Called from the ADD path only — never from a change in addedCount. Undo also writes
  // addedCount (a decrement inside removeAddedPlayer), so an inequality check would treat a
  // removal as a reason to re-show the pill. Today that would happen to be harmless, because
  // Undo also nulls lastAddedName/lastAddedAmount and shouldShowAddedConfirmation then closes
  // the gate — but that safety rests on a second, unrelated mechanism staying in place.
  // Keying to the increment site removes the coincidence.
  //
  // A second add inside the 2500ms window clears and restarts the timer, so the pill
  // always names the most recent player for a full interval.
  const showAddedPill = useCallback(() => {
    if (pillTimerRef.current) clearTimeout(pillTimerRef.current);
    pillOpacity.value = withTiming(1, { duration: reduceMotionEnabled ? 0 : 150 });
    pillTimerRef.current = setTimeout(() => {
      pillTimerRef.current = null;
      pillOpacity.value = withTiming(
        0,
        { duration: reduceMotionEnabled ? 0 : 150 },
        finished => {
          // ON COMPLETION, not when the fade starts: nulling lastAddedName closes
          // shouldShowAddedConfirmation's gate, which UNMOUNTS the pill — doing that at
          // T=2500 would pop it off screen instead of fading it.
          //
          // finished guards the interrupt case: a second add inside the window calls
          // showAddedPill again, which interrupts this fade and fires this callback with
          // false. Nulling there would erase the confirmation for the player just added.
          if (finished) runOnJS(setLastAddedName)(null);
        },
      );
    }, 2500);
  }, [pillOpacity, reduceMotionEnabled]);

  // active.tsx does NOT unmount when the Add Players modal closes — AppModal is always
  // rendered with visible={showAddPlayer}. This effect only covers leaving the screen.
  // closeAddModal (the Done/backdrop-close path) clears the timer explicitly. Two other
  // sites close the modal via setShowAddPlayer(false) directly and do NOT clear it —
  // commitAddPlayer's player-cap gate and the saved-list-full paywall row. That is benign:
  // the pending timer still fires and returns pillOpacity to 0 on its own, and both reopen
  // paths (openAddPlayer, handleAddBanker) null lastAddedName before showing the modal
  // again, which closes the mount gate the pill depends on, so it cannot resurface mid-timer
  // either. But that safety rests on those unrelated resets staying in place, not on this
  // effect or on closeAddModal.
  //
  // The timer now also nulls lastAddedName on fade completion. That does not change the
  // analysis above — nulling it is exactly what those reopen paths already do, so a late fire
  // converges on the same state rather than fighting it.
  useEffect(() => () => {
    if (pillTimerRef.current) clearTimeout(pillTimerRef.current);
  }, []);

  // Bottom-fade scroll cue. Three shared values, not one boolean: the scroll handler has
  // both heights in a frame, but onLayout and onContentSizeChange each have only one.
  // All start at 0, which evaluates to at-end → fade hidden, the correct initial state.
  // Everything below runs on the UI thread: ZERO JS re-renders per scroll frame, which is
  // load-bearing — the four commits before this work were spent virtualizing these lists.
  const pickerScrollY = useSharedValue(0);
  const pickerViewportH = useSharedValue(0);
  const pickerContentH = useSharedValue(0);

  const pickerScrollHandler = useAnimatedScrollHandler(e => {
    pickerScrollY.value = e.contentOffset.y;
    pickerViewportH.value = e.layoutMeasurement.height;
    pickerContentH.value = e.contentSize.height;
  });

  const pickerFadeStyle = useAnimatedStyle(() => {
    const atEnd =
      pickerScrollY.value + pickerViewportH.value >= pickerContentH.value - 4;
    return {
      opacity: withTiming(atEnd ? 0 : 1, { duration: reduceMotionEnabled ? 0 : 150 }),
    };
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
  const [lastAddedAmount, setLastAddedAmount] = useState<number | null>(null);
  // Synchronous re-entry guard for commitAddPlayer (state-based `disabled` has a race window).
  const addingPlayerRef = useRef(false);
  const nameInputRef = useRef<TextInput>(null);
  const buyInInputRef = useRef<TextInput>(null);
  // True when the tapped-row add currently in flight began from a non-empty search box.
  //
  // Captured at TAP time, in handleSelectSaved, because that function overwrites
  // newPlayerName with the tapped player's name — by the time commitAddPlayer runs on the
  // 0-default-buy-in path, the query is gone and unrecoverable. Reading newPlayerName in
  // commitAddPlayer would appear to work (the default-buy-in fast path calls it
  // synchronously, before the overwrite) and silently report browse-origin for every
  // two-step add.
  //
  // A ref, not state: it never affects rendering, and it must survive to the later Add press.
  const tapFromSearchRef = useRef(false);

  // Game completion modal state
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [completionModalMode, setCompletionModalMode] = useState<'error' | 'warning' | 'confirm'>('confirm');
  const [validationResult, setValidationResult] = useState<Validation | null>(null);
  const [showSolvingModal, setShowSolvingModal] = useState(false);
  const [showCashUnitPicker, setShowCashUnitPicker] = useState(false);
  const [showTolerancePicker, setShowTolerancePicker] = useState(false);
  const [showDefaultBuyInModal, setShowDefaultBuyInModal] = useState(false);
  const [defaultBuyInInput, setDefaultBuyInInput] = useState('');
  const [showSettlementModePicker, setShowSettlementModePicker] = useState(false);
  const [showDistortionModal, setShowDistortionModal] = useState(false);
  const [distortions, setDistortions] = useState<PlayerDistortion[]>([]);

  // Payment editor state
  const [showPaymentEditor, setShowPaymentEditor] = useState(false);
  const [paymentPlayer, setPaymentPlayer] = useState<Player | null>(null);

  const samePayment = (a: PreferredPayment, b: PreferredPayment): boolean =>
    a.method === b.method && (a.handle ?? '') === (b.handle ?? '');

  const handleCreateNewGame = async () => {
    try {
      await createGame(DEFAULT_GAME_NAME);
      // The useEffect or state update will automatically handle the active game change
    } catch (error) {
      Alert.alert('Error', 'Failed to create game');
      console.error('Error creating game:', error);
    }
  };

  const openPaymentEditor = useCallback((player: Player) => {
    setPaymentPlayer(player);
    setShowPaymentEditor(true);
  }, []);

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

  // Calculate balances - must be before early return to avoid hooks error.
  // Memoized so it is not a fresh array every render: openTransactionModal deps on it,
  // and listData deps on it in turn — an unstable identity here would hand FlatList new
  // `data` on every render and defeat its diffing. Dep is `activeGame`, NOT
  // `activeGame.players`: updateGame shallow-clones the Game, so the players array
  // reference never changes.
  const balances = useMemo(
    () => (activeGame ? GameService.calculateBalances(activeGame) : []),
    [activeGame],
  );

  // Alphabetical, not the service's updatedAt-desc order: every add bumps updatedAt, so
  // recency order would reorder the list under the user's finger mid-session. Hoisted above
  // the early return below (Rules of Hooks).
  const sortedSaved = useMemo(() => sortSavedByName(savedPlayers), [savedPlayers]);

  // Latest-ref wrapper: `onSelectSaved` never changes identity, so SavedPickerRow's memo
  // holds across search keystrokes, while taps still run the current handler. Hoisted above
  // the early return below (Rules of Hooks); `selectSavedRef.current` is assigned further
  // down, after `handleSelectSaved` is defined. Assigning a ref during render is safe there
  // because handlers are never read during render.
  const selectSavedRef = useRef<(id: string) => void>(() => {});
  const onSelectSaved = useCallback((id: string) => selectSavedRef.current(id), []);

  // Hoisted above the early return below (Rules of Hooks) — the picker's FlatList data
  // is a useMemo and must not sit under the guard.
  const filteredSaved = useMemo(
    () => filterSavedByQuery(sortedSaved, newPlayerName),
    [sortedSaved, newPlayerName],
  );

  // Dep is `activeGame`, NOT `activeGame.players`: GameContext.updateGame shallow-clones
  // the Game, so the players array reference never changes and a dep on it would freeze
  // this for the lifetime of the mount.
  const savedPickerListData = useMemo(
    () =>
      buildAddPlayerPickerListData(
        filteredSaved.map(p => ({ id: p.id, name: p.name, badge: savedBadge(p) })),
        name => isNameTakenInGame(activeGame?.players ?? [], name),
        !canAddMorePlayers(activeGame?.players.length ?? 0, isPro),
      ),
    [filteredSaved, activeGame, isPro],
  );

  const savedPickerKeyExtractor = useCallback((item: AddPlayerPickerItem) => item.key, []);

  const renderSavedPickerItem = useCallback(
    ({ item }: ListRenderItemInfo<AddPlayerPickerItem>) => (
      <SavedPickerRow
        id={item.id}
        name={item.name}
        badge={item.badge}
        inGame={item.inGame}
        disabled={item.disabled}
        isFirst={item.isFirst}
        isLast={item.isLast}
        onSelect={onSelectSaved}
      />
    ),
    [onSelectSaved],
  );

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
    // A 0 total is a placeholder, not a real value — open empty so the user
    // types straight away instead of deleting "0". The "Amount" placeholder shows.
    setTransactionAmount(currentTotal > 0 ? currentTotal.toString() : '');
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

  // Hoisted above the early return below (Rules of Hooks): renderItem is a useCallback
  // and closes over all three.
  const confirmDeletePlayer = useCallback((player: Player) => {
    setPlayerToDelete(player);
    setShowDeleteConfirmation(true);
  }, []);

  const handleCompletePlayer = useCallback(async (player: Player) => {
    if (!activeGame) return;

    try {
      GameService.markPlayerAsCompleted(activeGame, player.id);
      await updateGame(activeGame);
    } catch (error) {
      Alert.alert('Error', 'Failed to mark player as completed. Please try again.');
      console.error('Error completing player:', error);
    }
  }, [activeGame, updateGame]);

  const handleReactivatePlayer = useCallback(async (player: Player) => {
    if (!activeGame) return;

    try {
      GameService.markPlayerAsActive(activeGame, player.id);
      await updateGame(activeGame);
    } catch (error) {
      Alert.alert('Error', 'Failed to reactivate player. Please try again.');
      console.error('Error reactivating player:', error);
    }
  }, [activeGame, updateGame]);

  const listData = useMemo(
    () =>
      buildActiveGameListData({
        players: activeGame?.players ?? [],
        balances,
        settlementMode: activeGame?.settlementMode,
        bankerPlayerId: activeGame?.bankerPlayerId,
      }),
    [activeGame, balances],
  );

  const keyExtractor = useCallback((item: ActiveGameListItem) => item.key, []);

  const openAddPlayer = useCallback(() => {
    const count = activeGame?.players.length ?? 0;
    if (!canAddMorePlayers(count, isPro)) {
      if (isPro) {
        Alert.alert('Player Limit', playerCapHint(count, true));
      } else {
        setPaywallMessage(PLAYERS_PAYWALL_MESSAGE);
        setShowPaywall(true);
      }
    } else {
      refreshSavedNames();
      setSavePlayerToggle(true); // toggle defaults ON each time the modal opens
      setAddedCount(0);
      setLastAddedName(null);
      setShowAddPlayer(true);
    }
  }, [activeGame, isPro, refreshSavedNames]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ActiveGameListItem>) => {
      switch (item.type) {
        case 'sectionHeader':
          return item.label === 'players' ? (
            <HudSectionHeader label="Players" onAction={openAddPlayer} actionIcon="add-circle-outline" />
          ) : (
            <View style={styles.completedSectionHeader}>
              <HudSectionHeader label="Completed" />
            </View>
          );
        case 'empty':
          return <EmptyState label={item.label} icon={item.icon} />;
        case 'activePlayer':
          return (
            <View style={styles.playerCardWrap}>
              <PlayerCardActive
                player={item.player}
                balance={item.balance}
                onBuyIn={handleBuyIn}
                onCashOut={handleCashOut}
                onComplete={handleCompletePlayer}
                onDelete={confirmDeletePlayer}
                onRename={openRenameModal}
                onEditPayment={openPaymentEditor}
                reduceMotion={reduceMotionEnabled}
                isBanker={item.isBanker}
              />
            </View>
          );
        case 'completedPlayer':
          return (
            <View style={styles.playerCardWrap}>
              <PlayerCardCompleted
                player={item.player}
                balance={item.balance}
                onReactivate={handleReactivatePlayer}
                onDelete={confirmDeletePlayer}
                reduceMotion={reduceMotionEnabled}
              />
            </View>
          );
      }
    },
    [
      openAddPlayer,
      handleBuyIn,
      handleCashOut,
      handleCompletePlayer,
      confirmDeletePlayer,
      openRenameModal,
      openPaymentEditor,
      handleReactivatePlayer,
      reduceMotionEnabled,
    ],
  );

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

  // Save-toggle state for the Add Player modal (spec: the cap is never silent).
  const savedListFull = !canAddMoreSavedPlayers(savedPlayers.length, isPro);
  const trimmedName = newPlayerName.trim();
  // Alias kept because it is the argument to shouldShowAddedConfirmation below and that
  // helper's parameter name. No window — the whole roster must be tappable.
  const visibleSaved = filteredSaved;
  const isTypedNew =
    trimmedName.length > 0 &&
    !selectedSavedId &&
    matchSavedByExactName(savedPlayers, newPlayerName).length === 0;
  const atPlayerCap = !canAddMorePlayers(activeGame.players.length, isPro);

  const addedConfirmLabel = formatAddedConfirmation(
    lastAddedName,
    addedCount,
    lastAddedAmount != null ? formatAmount(lastAddedAmount) : undefined,
  );

  const hasSubject = trimmedName.length > 0;
  // The single saved player an untapped typed name exactly matches (else null).
  // Mutually exclusive with isTypedNew (which excludes exact matches).
  const typedExactMatch = selectedSavedId == null ? singleExactSavedMatch(savedPlayers, newPlayerName) : null;
  const committingTapped = selectedSavedId != null;            // decisive pick — list hidden
  const committingTyped = hasSubject && selectedSavedId == null; // still searching / brand-new

  const closeAddModal = () => {
    clearAddedPill();
    tapFromSearchRef.current = false;
    setNewPlayerName('');
    setNewPlayerBuyIn('');
    setSelectedSavedId(null);
    setSavePlayerToggle(true);
    setForceUnlinked(false);
    setShowAddPlayer(false);
    setPendingBankerDesignation(false);
  };

  // With a default buy-in active there is nothing left to enter, so a tap IS
  // the add (1 tap per regular). Otherwise: select, then buy-in rides along.
  // A row whose player is already in the game arrives here from its Undo control
  // (the row itself is inert) and means "take that add back".
  const handleSelectSaved = (p: SavedPlayer) => {
    const existing = findPlayerByName(activeGame.players, p.name);
    if (existing) {
      handleUndoAdd(existing);
      return;
    }
    // MUST be read before the setNewPlayerName below — see tapFromSearchRef's declaration.
    // Set after the undo early-return: an undo is not an add and must not arm this.
    tapFromSearchRef.current = newPlayerName.trim().length > 0;
    if (gameDefaultBuyIn > 0) {
      commitAddPlayer(p);
      return;
    }
    setNewPlayerName(p.name);
    setSelectedSavedId(p.id);
    requestAnimationFrame(() => buyInInputRef.current?.focus());
  };

  // Silent only when a re-tap would restore the identical state. removePlayer cascade-deletes
  // the player's transactions, so anything else must be confirmed. Alert (not the
  // showDeleteConfirmation AppModal) because stacking modals is avoided in this file and
  // closing the Add Players modal would lose the host's place mid-sweep.
  const handleUndoAdd = (player: Player) => {
    if (isLosslessUndo(player, activeGame.transactions, gameDefaultBuyIn, activeGame.bankerPlayerId)) {
      void removeAddedPlayer(player);
      return;
    }
    // isLosslessUndo refuses for three different reasons, so the prompt names the ones that
    // actually apply rather than assuming it was the transaction count. A banker holding no
    // buy-in is reachable (Add-someone from the banker picker with an empty buy-in field),
    // and reporting "0 transactions" there is both wrong and hides the real loss:
    // removePlayer clears bankerPlayerId (the mode itself is deliberately kept).
    const n = activeGame.transactions.filter(t => t.playerId === player.id).length;
    const parts: string[] = [];
    if (player.completedAt) {
      parts.push('They have already been marked complete — removing them undoes that.');
    }
    if (activeGame.bankerPlayerId === player.id) {
      parts.push("They are this game's banker — removing them leaves the game without a banker until you pick a new one.");
    }
    if (n > 0) {
      parts.push(n === 1
        ? 'This deletes their transaction from this game.'
        : `This deletes their ${n} transactions from this game.`);
    }
    // Defensive only: with all three refusal reasons above covered, an empty body is
    // unreachable — isLosslessUndo returns true for zero transactions, so a refusal with
    // no banker role and no completedAt must have come from the transaction branch, which
    // guarantees n > 0. Kept so the Alert can never render an empty message.
    if (parts.length === 0) parts.push('This removes them from this game.');
    Alert.alert(
      `Remove ${player.name}?`,
      parts.join(' '),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => { void removeAddedPlayer(player); } },
      ],
    );
  };

  // Reuses addingPlayerRef as the modal's mutation-in-flight lock: both this and
  // commitAddPlayer mutate the same activeGame then await updateGame, so they must not
  // interleave, and two fast Undo taps would otherwise double-decrement addedCount.
  const removeAddedPlayer = async (player: Player) => {
    if (addingPlayerRef.current) return;
    addingPlayerRef.current = true;
    try {
      GameService.removePlayer(activeGame, player.id);
      await updateGame(activeGame);
      setLastAddedName(null);
      setLastAddedAmount(null);
      setAddedCount(c => Math.max(0, c - 1));
    } finally {
      addingPlayerRef.current = false;
    }
  };

  // Assigns the latest handler into the ref declared above (Rules of Hooks — see there).
  selectSavedRef.current = (id: string) => {
    const p = savedPlayers.find(x => x.id === id);
    if (p) handleSelectSaved(p);
  };

  // Editing the name un-selects any tapped saved player.
  const handleNameChange = (text: string) => {
    setNewPlayerName(text);
    setSelectedSavedId(null);
    setForceUnlinked(false);
  };

  // The '‹ Adding {name}' header taps back to Browse (un-picks the saved row).
  //
  // Follows the SAME rule as a completed add (postAddFocusTarget): a pick that began from a
  // search returns the caret to the now-empty search box, because the host was mid-search and
  // is most likely to resume it; a pick made while browsing leaves the keyboard down so the
  // tall browse card comes back.
  //
  // tapOrigin is passed as a literal `true`, and that is not a shortcut: this control renders
  // only inside the `committingTapped ?` branch of the modal's pinned header, so it is
  // unreachable unless a row was tapped.
  //
  // The dismiss branch is not a no-op even though the buy-in field unmounts along with the
  // subject: on the 0-buy-in path that field holds focus, and dismissing explicitly makes the
  // browse-origin outcome independent of unmount timing.
  const clearSubject = () => {
    const focusTarget = postAddFocusTarget(true, tapFromSearchRef.current);
    tapFromSearchRef.current = false;
    setNewPlayerName('');
    setSelectedSavedId(null);
    if (focusTarget === 'search') {
      requestAnimationFrame(() => nameInputRef.current?.focus());
    } else {
      Keyboard.dismiss();
    }
  };

  const commitAddPlayer = async (tapped?: SavedPlayer) => {
    if (addingPlayerRef.current) return;

    // Captured HERE, before the reset block near the end of this function calls
    // setSelectedSavedId(null) — reading it after the reset would report every add as
    // typed-origin. Drives where focus goes once the add completes.
    //
    // Both tap paths are covered: `tapped` is the default-buy-in fast path, and
    // selectedSavedId is set by handleSelectSaved for the row-tap -> buy-in -> Add path.
    // Nothing clears selectedSavedId between those two points except `handleNameChange`
    // (the host editing the search text, which genuinely IS a typed-origin add),
    // `clearSubject`, and closing the modal — all of which abandon the add.
    //
    // tapFromSearchRef is the same kind of capture one step EARLIER in the flow: this line
    // survives the reset below, but the search query does not survive handleSelectSaved's
    // own setNewPlayerName. Both feed postAddFocusTarget at the end of this function.
    const tapOrigin = tapped != null || selectedSavedId != null;

    // Cap gate: free caps at 12, Pro at 20 (see utils/tierLimits). Enforced on EVERY
    // add because the modal stays open for multiple adds (not just when opening it).
    if (!canAddMorePlayers(activeGame.players.length, isPro)) {
      setShowAddPlayer(false);
      setPendingBankerDesignation(false);
      if (isPro) {
        Alert.alert('Player Limit', playerCapHint(activeGame.players.length, true));
      } else {
        setPaywallMessage(PLAYERS_PAYWALL_MESSAGE);
        setShowPaywall(true);
      }
      return;
    }

    const name = (tapped?.name ?? newPlayerName).trim();
    if (!name) {
      Alert.alert('Error', 'Please enter a player name');
      return;
    }
    if (gameDefaultBuyIn === 0) {
      if (newPlayerBuyIn.trim() && !isValidNumericInput(newPlayerBuyIn)) {
        Alert.alert('Error', 'Please enter a valid numeric amount (digits and decimal point only) or leave it empty');
        return;
      }
    }
    const buyInAmount = gameDefaultBuyIn > 0 ? gameDefaultBuyIn : parseFloat(newPlayerBuyIn);
    if (gameDefaultBuyIn === 0 && newPlayerBuyIn.trim() && (isNaN(buyInAmount) || buyInAmount < 0)) {
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
    let bound: SavedPlayer | null = tapped
      ? tapped
      : selectedSavedId
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
      setLastAddedAmount(gameDefaultBuyIn > 0 ? gameDefaultBuyIn : null);
      showAddedPill();
      setNewPlayerName('');
      setNewPlayerBuyIn('');
      setSelectedSavedId(null);
      setSavePlayerToggle(true);
      setForceUnlinked(false);
      // Where the keyboard goes next is decided by where this add came from — see
      // postAddFocusTarget. Three cases: typed -> search box; tap from a search -> search
      // box (the host is most likely about to search again); tap while browsing -> keyboard
      // stays down, which is the state the tall browse card exists for.
      //
      // Not-dismissing would not be enough on the 0-default-buy-in path: the buy-in field
      // unmounts as part of the reset above and takes the keyboard down with it, so the
      // search box has to be focused explicitly to keep it up.
      const focusTarget = postAddFocusTarget(tapOrigin, tapFromSearchRef.current);
      tapFromSearchRef.current = false;
      if (focusTarget === 'search') {
        requestAnimationFrame(() => nameInputRef.current?.focus());
      } else {
        Keyboard.dismiss();
      }
    } finally {
      addingPlayerRef.current = false;
    }
  };

  const handleAddTransaction = async () => {
    if (!selectedPlayer) return;

    // An untouched (empty) field is a no-op — close silently, same as confirming
    // the unchanged current total. Prevents parseFloat('') === NaN from erroring.
    if (transactionAmount.trim() === '') {
      setTransactionAmount('');
      setShowAddTransaction(false);
      setSelectedPlayer(null);
      return;
    }

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

    // No lower limit constraint - a buy-in can be less than the cash out when the player wins
    // (mirror of the cashout rule below; both directions of that old cap are retired)

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

      // Count profile stats only on the FIRST completion. Reopening a game
      // leaves statsCounted set, so a re-completion won't double-count. Set the
      // flag before this persist so the existing updateGame writes it.
      const alreadyCounted = activeGame.statsCounted === true;
      if (!alreadyCounted) activeGame.statsCounted = true;

      GameService.cacheSettlements(activeGame, result);
      await updateGame(activeGame);

      // Fire-and-forget review games counter
      AsyncStorage.getItem('review_games_completed').then(val => {
        const count = parseInt(val ?? '0', 10);
        AsyncStorage.setItem('review_games_completed', String(count + 1));
      }).catch(() => {});

      // Fire-and-forget profile stat increment — only on first completion
      if (!alreadyCounted && user?.uid) {
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

  // The completion modal's error mode is otherwise a dead end (a lone OK button),
  // and since removePlayer stopped resetting the mode, "no banker" is the error a
  // host is most likely to hit. Detected structurally rather than by matching the
  // error string, so re-wording the message cannot silently disable the button.
  const completionBlockedOnBanker =
    activeGame.settlementMode === 'banker' && !GameService.hasRememberedBanker(activeGame);

  const resolvedCashUnit = resolveCashUnit(activeGame.cashUnit, currency);
  // Exact value — expanded settings list AND the a11y summary.
  const roundingLabel =
    resolvedCashUnit === EXACT_CASH_UNIT ? 'Exact' : formatAmount(resolvedCashUnit);
  // Collapsed-row value only. Kept separate so the expanded list and the screen
  // reader keep the precise amount the host picked.
  const roundingRowLabel =
    resolvedCashUnit === EXACT_CASH_UNIT
      ? 'Exact'
      : formatAmountCompactScaled(resolvedCashUnit);

  const gameDefaultBuyIn = activeGame.defaultBuyIn ?? 0;
  const defaultBuyInLabel = gameDefaultBuyIn > 0 ? formatAmount(gameDefaultBuyIn) : 'Off';
  // Bare COMPACT amount, rendered as-is by the collapsed-row segment. null when
  // off, so the segment is omitted entirely rather than showing a zero.
  const buyInValueLabel =
    gameDefaultBuyIn > 0 ? formatAmountCompactScaled(gameDefaultBuyIn) : null;
  // Collapsed-row a11y segment. Spoken as "Buy-in $1,500.00" while the row shows
  // a bare "$1.5k" beside a cash icon — a screen reader has no icon to
  // disambiguate it from the rounding value, and no way to expand the row for
  // the precise figure. Derived from formatAmount directly, NOT from
  // buyInValueLabel, or compacting the row would silently compact this too.
  const buyInSummaryLabel =
    gameDefaultBuyIn > 0 ? `Buy-in ${formatAmount(gameDefaultBuyIn)}` : undefined;

  const resolvedTolerance = resolveTolerance(activeGame.imbalanceTolerance, currency);
  // Expanded-row value (always shown, plain like the Rounding value).
  const toleranceValueLabel =
    resolvedTolerance === 0 ? 'Exact' : formatAmount(resolvedTolerance);
  // Exact caption — a11y label only. Always emitted (like rounding), so the
  // summary stays consistent at the currency default instead of dropping it.
  const toleranceLabel = toleranceCaption(resolvedTolerance, formatAmount);
  // Compact caption — collapsed row only. toleranceCaption already takes an
  // injected formatter, so no change to settingsSummary.ts is needed.
  const toleranceRowLabel = toleranceCaption(resolvedTolerance, formatAmountCompactScaled);

  const settingsSummary = formatSettingsSummary(
    activeGame.settlementMode === 'banker',
    bankerName,
    roundingLabel,
    toleranceLabel,
    buyInSummaryLabel,
  );

  const applySettlementMode = async (mode: 'optimal' | 'banker', bankerId?: string) => {
    GameService.setSettlementMode(activeGame, mode, bankerId);
    await updateGame(activeGame);
  };

  const handleSaveDefaultBuyIn = async () => {
    const raw = defaultBuyInInput.trim();
    if (raw !== '' && !isValidNumericInput(raw)) {
      Alert.alert('Error', 'Please enter a valid numeric amount (digits and decimal point only) or leave it empty');
      return;
    }
    const n = raw === '' ? 0 : parseFloat(raw);
    if (isNaN(n) || n < 0) {
      Alert.alert('Error', 'Please enter a valid amount or leave it empty');
      return;
    }
    activeGame.defaultBuyIn = n; // in-place + updateGame, matching the tolerance/cashUnit handlers
    await updateGame(activeGame);
    setShowDefaultBuyInModal(false);
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
  // leaves settlementMode untouched, so this path never creates a banker-without-banker state.
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
    // Default-named games open with an empty field so the user types straight away;
    // named games pre-fill the real name for typo fixes.
    setEditedTitle(activeGame.name === DEFAULT_GAME_NAME ? '' : activeGame.name);
    setIsEditingTitle(true);
  };

  const handleTitleBlur = async () => {
    const trimmedTitle = editedTitle.trim();

    // Validation: empty title
    if (!trimmedTitle) {
      // A default-named game dismissed without typing is expected — keep the default
      // silently. Only warn when the user cleared a real name.
      if (activeGame.name !== DEFAULT_GAME_NAME) {
        Alert.alert('Error', 'Game name cannot be empty');
      }
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

  // Pick-first saved list — Browse + typing only; hidden on decisive pick, and when a typed
  // query matches no saved player.
  const showSavedPicker = !committingTapped && savedPlayers.length > 0 && filteredSaved.length > 0;

  // Where the post-add ✓ goes. Browse view only — while a name is being entered the card
  // shows no status messages between the name box and the buy-in box: only the name control,
  // the (filtered) saved list, the buy-in box, the save-player slot, and the Add button. This
  // confirmation would land between the name box and the buy-in box, which is the reported defect.
  //
  // savedPlayers.length, NOT filteredSaved.length, and the two are not interchangeable in
  // general — they are only equal in the browse view, which is the only place this can
  // return anything but 'none'. In browse the query is empty and filterSavedByQuery returns
  // its input unchanged, so filteredSaved IS the saved roster. Passing filteredSaved would
  // read as though the filter mattered here; it does not.
  //
  // Height-independent, so the two-state card does not affect it: pickerViewport has
  // flexShrink 1 and no flexGrow, so with short content it collapses to content height and
  // the pill sits over the last row in both the tall and short states.
  const confirmationPlacement = addedConfirmationPlacement(
    shouldShowAddedConfirmation(addedConfirmLabel, lastAddedAmount, lastAddedName, visibleSaved, activeGame.players),
    hasSubject,
    savedPlayers.length,
  );

  // Header/footer are ELEMENTS, never inline arrows. `ListHeaderComponent={() => <X/>}`
  // creates a new component TYPE every render, so React unmounts and remounts the subtree;
  // this header sits beside a focused text input, which makes a remount user-visible.
  // A new element of a stable type only re-renders, which is what we want.
  //
  // Everything the modal body used to hold now lives in the list's content container so
  // there is exactly ONE scroll container covering the whole body. That is a design
  // invariant, not a hard arithmetic necessity: the buy-in TextInput and the Save-player
  // toggle slot only render while committing an add, and committing always raises the
  // keyboard (the buy-in field is explicitly focused), so those two elements only ever
  // exist while the card is in its SHORT (keyboard-up, 50%-of-window) state. Keeping one
  // scroll container is what keeps them reachable in that state — splitting the header
  // into pinned and scrolling pieces would need per-state layout math instead.
  // Only the in-flow confirmation remains here, and only in the browse view with fewer than
  // two saved players (see confirmationPlacement above) — elsewhere in the browse view it is
  // the pill, and while a name is being entered there is no confirmation at all. The SAVED · N
  // label and the banker hint moved to the modal's PINNED header: the scroll indicator's track
  // spans the FlatList frame, so anything rendered inside that frame above the rows makes the
  // track appear to start above the row panel — which is exactly what it looked like. With
  // them out, the track's top edge coincides with the panel's.
  //
  // When the confirmation is inactive this renders a zero-height View, which has no
  // effect on the frame.
  const savedPickerHeader = (
    <View style={styles.pickerBlock}>
      {confirmationPlacement === 'inline' && (
        <Text style={styles.addedConfirm}>✓ {addedConfirmLabel}</Text>
      )}
    </View>
  );

  const savedPickerFooter = (
    /* pickerFooterGap replaces the 16pt the dropped styles.pickerList marginBottom used to
       put between the last row and the buy-in field. Only applied when rows are present. */
    <View style={[styles.pickerBlock, showSavedPicker && styles.pickerFooterGap]}>
      {/* Buy-in — only once a subject exists (Commit). */}
      {hasSubject && gameDefaultBuyIn === 0 && (
        <TextInput
          ref={buyInInputRef}
          style={styles.input}
          value={newPlayerBuyIn}
          onChangeText={setNewPlayerBuyIn}
          placeholder="Buy-In"
          placeholderTextColor="#666"
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={() => commitAddPlayer()}
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
                  setPaywallMessage(savedCapPaywallMessage(savedPlayers.length, isPro));
                  setShowPaywall(true);
                }}
              >
                <Ionicons name="lock-closed" size={14} color="#B072BB" />
                <Text style={styles.saveToggleFullText} numberOfLines={1}>
                  {savedCapModalNotice(savedPlayers.length, isPro)}
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
    </View>
  );

  // An ELEMENT, not an inline arrow component. `ListHeaderComponent={() => …}` is a new
  // component type on every render, which remounts the header — and this header holds the
  // autoFocus title TextInput, so a remount mid-edit drops the user's cursor.
  const listHeader = (
    <>
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
              onPress={() => {
                setDefaultBuyInInput(gameDefaultBuyIn > 0 ? String(gameDefaultBuyIn) : '');
                setShowDefaultBuyInModal(true);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="cash-outline" size={18} color="rgba(255,255,255,0.5)" />
                <Text style={styles.menuItemLabel}>Default buy-in</Text>
              </View>
              <View style={styles.menuItemRight}>
                <Text style={styles.menuItemValue}>{defaultBuyInLabel}</Text>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.4)" />
              </View>
            </TouchableOpacity>

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
            {/* Mode group — the only shrinking group, so a long banker name ellipsizes
                here rather than pushing the row past its width. The "Banker · " prefix
                is deliberately NOT rendered: the person-outline icon already carries it,
                and dropping it frees 61pt, which is what makes all four segments fit a
                353pt iPhone 16 row. The a11y label (formatSettingsSummary) still speaks
                the prefix in full. */}
            <View style={[styles.settingsSummaryGroup, styles.settingsSummaryModeGroup]}>
              <Ionicons
                name={activeGame.settlementMode === 'banker' ? 'person-outline' : 'swap-horizontal'}
                size={15}
                color="rgba(255,255,255,0.5)"
              />
              {activeGame.settlementMode === 'banker' ? (
                <Text
                  style={[
                    // Muted label colour for the placeholder so it reads as "nothing
                    // chosen yet" rather than as a player literally named "Set banker".
                    bankerName ? styles.settingsSummaryValue : styles.settingsSummaryLabel,
                    styles.settingsSummaryModeText,
                  ]}
                  numberOfLines={1}
                >
                  {bankerName ?? 'Set banker'}
                </Text>
              ) : (
                <Text
                  style={[styles.settingsSummaryValue, styles.settingsSummaryModeText]}
                  numberOfLines={1}
                >
                  Direct
                </Text>
              )}
            </View>

            {/* Default buy-in — omitted entirely when off (0), since that means the
                feature is disabled rather than sitting at a default value. */}
            {gameDefaultBuyIn > 0 && (
              <>
                <Text style={styles.settingsSummaryDot}>·</Text>
                <View style={styles.settingsSummaryGroup}>
                  <Ionicons name="cash-outline" size={15} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.settingsSummaryValue} numberOfLines={1}>
                    {buyInValueLabel}
                  </Text>
                </View>
              </>
            )}

            {/* Separator + rounding — always shown. These three used to be suppressed
                while banker mode had no banker chosen, which was fine when that state
                could not persist; since 2026-08-07 it can last a whole game, so hiding
                the host's rounding and tolerance that long is worse than a longer row. */}
            <Text style={styles.settingsSummaryDot}>·</Text>
            <View style={styles.settingsSummaryGroup}>
              <Ionicons name="options-outline" size={15} color="rgba(255,255,255,0.5)" />
              <Text style={styles.settingsSummaryValue} numberOfLines={1}>
                {roundingRowLabel}
              </Text>
            </View>

            {/* Tolerance — always shown, like rounding. */}
            <Text style={styles.settingsSummaryDot}>·</Text>
            <View style={styles.settingsSummaryGroup}>
              <Ionicons name="git-compare-outline" size={15} color="rgba(255,255,255,0.5)" />
              <Text style={styles.settingsSummaryValue} numberOfLines={1}>
                {toleranceRowLabel}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      </View>
    </>
  );

  return (
    <View style={styles.container}>
      <HelpHint visible={hintVisible} onDismiss={dismissHint} />
      <FlatList
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeader}
        style={styles.scrollView}
        contentContainerStyle={styles.listContent}
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        windowSize={5}
        /* PlayerCardActive/Completed wrap a Reanimated Swipeable, which misbehaves under
           Android's default removeClippedSubviews={true}. index.tsx:211 does the same. */
        removeClippedSubviews={false}
      />

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
        onClose={closeAddModal}
        contentStyle={appModalStyles.centeredContent}
        cardStyle={addPlayerCardStyle}
        scrollBody={false}
        header={
          <>
            {/* Subject header (decisive pick) OR search field (Browse / typing).
                Pinned: typing filters the list below, so it must stay visible. */}
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
                accessibilityLabel="Search saved players or type a new name"
                autoCapitalize="words"
                returnKeyType="next"
              />
            )}

            {/* Shown for as long as the game is at cap, so it is PINNED, not floated over the
                list. Floating it made it cover the SAVED · N label and read as though it were
                squeezing the rows.

                Hidden while a name is being entered: pinned directly under the name control,
                it otherwise lands between the name box and the buy-in box, and while typing
                the card shows no status messages there — only the name control, the (filtered)
                saved list, the buy-in box, the save-player slot, and the Add button; this
                banner is one of the status messages that stays hidden. The gate used to be
                !committingTapped, which addressed the row-tap case (at cap that was a guard
                rather than an observable behaviour, since every row is already disabled there)
                but left it wedged for a typed name; !hasSubject is the same rule for both.
                Accepted cost: the host no longer sees "you are blocked" while composing a
                name that will be rejected. They still get the paywall on Add, and at cap
                every row is marked disabled by buildAddPlayerPickerListData, so the browse
                view — where this still shows — is where the information actually changes
                what they do. */}
            {atPlayerCap && !hasSubject && (
              <View style={styles.pickerCapBanner}>
                <Text style={styles.pickerCapBannerText}>
                  {playerCapBanner(activeGame.players.length, isPro)}
                </Text>
              </View>
            )}

            {/* Both of these are PINNED rather than rendered as part of the list's
                ListHeaderComponent, and the reason is the scroll indicator, not taste:
                its track spans the FlatList frame, so either one rendered inside that
                frame makes the track start above the row panel. */}

            {/* !hasSubject for the same reason as the cap banner above: while a name is being
                entered the card shows no status messages between the name box and the buy-in
                box — only the name control, the (filtered) saved list, the buy-in box, the
                save-player slot, and the Add button — and this hint is one of those status
                messages, so it hides too. This one is a deliberate trade — the hint describes
                the add in progress, so hiding it during the pick loses a genuinely relevant
                reassurance.
                A single exception-free rule was chosen over a locally-better one, because an
                invariant with one exception is two rules to hold and two things to QA.
                Expect on device: with a default buy-in the hint stays up until the tap that
                adds the player; when typing a name it disappears on the first keystroke. */}
            {pendingBankerDesignation && !hasSubject && (
              <Text style={styles.bankerPendingHint}>This person will be set as banker</Text>
            )}

            {showSavedPicker && (
              <Text style={styles.pickerLabel}>SAVED · {savedPlayers.length}</Text>
            )}
          </>
        }
        footer={
          /* Pinned: this is the whole point of the change — the Done/Add button
             must never scroll out of reach behind a long saved-player list. */
          <View style={styles.modalButtons}>
            {hasSubject ? (
              <ModalButton variant="confirm" title="Add" onPress={() => commitAddPlayer()} />
            ) : (
              <ModalButton variant="cancel" title="Done" onPress={closeAddModal} />
            )}
          </View>
        }
      >
        {/* Rendered UNCONDITIONALLY so there is always exactly one scroll container over
            the whole body — when the picker is hidden the list is simply empty and only
            the header/footer show. The bordered styles.pickerList box is deliberately
            gone: once header and footer share the content container it can no longer wrap
            only the rows. That is an approved design decision, not an oversight. */}
        <View style={styles.pickerViewport}>
          <Reanimated.FlatList
            data={showSavedPicker ? savedPickerListData : []}
            renderItem={renderSavedPickerItem}
            keyExtractor={savedPickerKeyExtractor}
            ListHeaderComponent={savedPickerHeader}
            ListFooterComponent={savedPickerFooter}
            style={styles.pickerListFlex}
            onScroll={pickerScrollHandler}
            scrollEventThrottle={16}
            /* The scroll handler only fires while scrolling, so content shorter than the
               viewport would never set the values. These two are infrequent and JS-side,
               and cover that case. */
            onLayout={e => { pickerViewportH.value = e.nativeEvent.layout.height; }}
            onContentSizeChange={(_w, h) => { pickerContentH.value = h; }}
            /* No contentContainerStyle: the dropped styles.pickerList carried no padding or
               gap to move here (width/background/border/radius/marginBottom/overflow only),
               and every gap in this body comes from the children's own marginBottom. */
            keyboardShouldPersistTaps="handled"
            bounces={false}
            /* DELIBERATE reversal of the ScrollView-parity contract documented on AppModal's
               scrollBody prop (that comment records this exception). The indicator alone is
               not sufficient — on both platforms it appears only during a drag, so it
               confirms scrolling rather than advertising it. The fade is what answers the
               actual complaint; the indicator is the confirmation once a drag starts. */
            showsVerticalScrollIndicator={true}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={5}
          />

          {/* 5 stacked 6pt bands in the card colour at stepped opacity, most opaque at the
              bottom. NOT expo-linear-gradient: that is not a dependency and there is no
              gradient anywhere in the app, so adding it means a new native module and a
              fresh EAS build immediately after the 2.0.2 bump. At 30pt the stack is
              visually indistinguishable from a gradient. */}
          <Reanimated.View style={[styles.pickerFade, pickerFadeStyle]} pointerEvents="none">
            <View style={[styles.pickerFadeBand, { opacity: 0.2 }]} />
            <View style={[styles.pickerFadeBand, { opacity: 0.4 }]} />
            <View style={[styles.pickerFadeBand, { opacity: 0.6 }]} />
            <View style={[styles.pickerFadeBand, { opacity: 0.8 }]} />
            <View style={[styles.pickerFadeBand, { opacity: 1 }]} />
          </Reanimated.View>

          {/* Confirmation pill — pinned to the BOTTOM of the list viewport, directly above
              but NOT inside the pinned button bar, so Done never moves. Putting it in the
              button bar would shove Done downward as it appeared (the button jumping under a
              thumb mid-tap, exactly what saveToggleSlot's fixed 30pt height exists to
              prevent) or require a permanently reserved strip in a modal already over budget.
              The shouldShowAddedConfirmation gate itself is UNCHANGED, but two suppressions
              now sit on top of it: confirmationPlacement returns 'none' while a name is being
              entered, and showAddedPill nulls lastAddedName once the fade completes. */}
          {confirmationPlacement === 'pill' && (
            <Reanimated.View style={[styles.pickerConfirmPill, pillStyle]} pointerEvents="none">
              <Text style={styles.pickerConfirmPillText} numberOfLines={1}>✓ {addedConfirmLabel}</Text>
            </Reanimated.View>
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
                completionBlockedOnBanker ? (
                  <View style={styles.modalButtons}>
                    <ModalButton
                      variant="cancel"
                      title="Cancel"
                      onPress={() => setShowCompletionModal(false)}
                    />
                    <ModalButton
                      variant="success"
                      title="Choose Banker"
                      onPress={() => {
                        // Close this modal and open the picker in ONE state batch — iOS
                        // renders a single native Modal at a time. Same constraint that
                        // handleAddBanker (:1313-1320) already works around.
                        setShowCompletionModal(false);
                        setShowSettlementModePicker(true);
                      }}
                    />
                  </View>
                ) : (
                  <ModalButton
                    variant="cancel"
                    title="OK"
                    onPress={() => setShowCompletionModal(false)}
                    fullWidth
                  />
                )
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

      <AppModal
        visible={showDefaultBuyInModal}
        title="Default Buy-In"
        onClose={() => setShowDefaultBuyInModal(false)}
      >
        <Text style={styles.pickHint}>
          Auto-applied when adding players to this game. Leave empty or 0 to turn off.
        </Text>
        <TextInput
          style={styles.input}
          value={defaultBuyInInput}
          onChangeText={setDefaultBuyInInput}
          placeholder="Amount"
          placeholderTextColor="#666"
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={handleSaveDefaultBuyIn}
        />
        <View style={styles.modalButtons}>
          <ModalButton variant="cancel" title="Cancel" onPress={() => setShowDefaultBuyInModal(false)} />
          <ModalButton variant="confirm" title="Save" onPress={handleSaveDefaultBuyIn} />
        </View>
      </AppModal>

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
  // padding moved to listContent: RN documents contentContainerStyle as the place for a
  // list's inner padding; padding on a FlatList's `style` insets the scroll frame itself.
  scrollView: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    // 28 (the last section's marginBottom, genuinely destroyed by flattening)
    // + 20 (the old ScrollView's bottom padding) = 48.
    //
    // The last card's 8pt is deliberately NOT part of this sum. playerCardWrap below puts
    // marginBottom: 8 on EVERY card including the last one — that is the whole reason it is
    // an item style rather than an ItemSeparatorComponent — so the 8pt survives flattening
    // and is already on screen. Adding it here too would double-count it and leave 64pt
    // below the last card where the old ScrollView had 56pt. Do not re-derive this as 56.
    paddingBottom: 48,
  },
  // Replaces the inline <View style={{ marginBottom: 8, backgroundColor: 'transparent' }}>
  // each card used to sit in. Kept on the item rather than an ItemSeparatorComponent,
  // because a separator does not reproduce the trailing 8pt the last card gets.
  playerCardWrap: {
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  // Re-creates the players section's marginBottom: 28, which used to sit between the last
  // active card and the Completed header.
  completedSectionHeader: {
    marginTop: 28,
    backgroundColor: 'transparent',
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
  // flexShrink + numberOfLines={1} at the call site, matching identityUsingText and
  // identityUnlinkedText — the other two occupants of the fixed-height saveToggleSlot.
  // Without it this text overflows the card horizontally on a narrow phone.
  saveToggleFullText: { fontSize: 13, color: '#B072BB', fontFamily: 'SpaceMono', flexShrink: 1 },
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
  // Third link in a three-level flex chain: staticBody (flexShrink:1) → pickerViewport
  // (flexShrink:1, minHeight:0) → FlatList (this style, flexShrink:1). The card itself is
  // maxHeight-bounded (addPlayerCardStyle), and RN defaults flexShrink to 0 at every level,
  // so without flexShrink here the FlatList refuses to yield height to pickerViewport no
  // matter what pickerViewport itself allows. See pickerViewport's comment below for why
  // that middle level is also required and what breaks — silently — if it is skipped.
  //
  // width is load-bearing now that styles.pickerList is gone: the modal passes
  // contentStyle={appModalStyles.centeredContent} (alignItems: 'center'), so without an
  // explicit width the list collapses to its content width and the rows stop spanning the card.
  pickerListFlex: { width: '100%', flexShrink: 1 },
  // A THIRD level in the flex chain: staticBody (flexShrink:1) → pickerViewport →
  // FlatList (pickerListFlex, flexShrink:1). RN defaults flexShrink to 0, so without
  // flexShrink + minHeight this level refuses to yield height — the list keeps its full
  // content height and pushes the pinned Add/Done footer out of the height-capped card
  // instead of scrolling. That failure is SILENT: no warning, no test failure in this
  // environment, the button is simply gone. Device QA is the only thing that sees it.
  //
  // backgroundColor: 'transparent' because this is a Themed View, which otherwise paints
  // an opaque themed background over the card (same reason pickerBlock, saveToggleSlot
  // and modalButtons set it).
  pickerViewport: {
    width: '100%',
    flexShrink: 1,
    minHeight: 0,
    backgroundColor: 'transparent',
  },
  pickerFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 30,
  },
  pickerFadeBand: { height: 6, backgroundColor: '#1A1A1A' },
  // Pinned in the modal's header, not absolutely positioned over the list viewport.
  // backgroundColor 'transparent' because this is a Themed View, which otherwise paints
  // an opaque themed background over the card (same reason pickerBlock, saveToggleSlot
  // and modalButtons set it). It was '#1A1A1A' only to make the float opaque.
  pickerCapBanner: {
    width: '100%',
    paddingVertical: 6,
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  pickerCapBannerText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    backgroundColor: 'transparent',
  },
  // Sits at the viewport's bottom edge, above the fade added in the fade task (later in
  // the tree = higher z). Centred so it reads as a floating confirmation, not a row.
  pickerConfirmPill: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  pickerConfirmPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#00D66F',
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  // Themed View defaults to an opaque themed background, hence transparent (same reason
  // saveToggleSlot and modalButtons set it).
  pickerBlock: { width: '100%', backgroundColor: 'transparent' },
  pickerFooterGap: { marginTop: 16 },
  pickHint: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    alignSelf: 'flex-start',
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
  // The mode group above shrinks, but its Text did not: Yoga defaults flexShrink to
  // 0 (unlike CSS), so the text kept full measured width and spilled past the group
  // edge onto the separator dot instead of ellipsizing. Applied ONLY to the mode
  // text — the trailing value segments must stay unshrinkable so they take natural
  // width and the name absorbs exactly the remainder. No maxWidth (it would truncate
  // when there is room) and no overflow:'hidden' (it would hide the evidence).
  settingsSummaryModeText: { flexShrink: 1, minWidth: 0 },
  settingsSummaryLabel: { fontSize: 15, color: 'rgba(255,255,255,0.5)' },
  settingsSummaryValue: { fontSize: 15, color: 'rgba(255,255,255,0.75)' },
  settingsSummaryDot: { fontSize: 15, color: 'rgba(255,255,255,0.3)', marginHorizontal: 8 },
});
