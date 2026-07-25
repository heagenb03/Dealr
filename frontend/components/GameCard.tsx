import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View as RNView } from 'react-native';
import { Text, View } from '@/components/Themed';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';
import { Game } from '@/types/game';
import { useCurrency } from '@/contexts/CurrencyContext';
import { calculateBuyinTotal } from '@/utils/gamePot';

interface GameCardProps {
  game: Game;
  onPress: (gameId: string, isCompleted: boolean) => void;
  onDelete: (game: { id: string; name: string }) => void;
  isCompleted?: boolean;
  reduceMotion: boolean;
  entryIndex?: number;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const GameCard: React.FC<GameCardProps> = ({ game, onPress, onDelete, isCompleted = false, reduceMotion, entryIndex }) => {
  const swipeableRef = useRef<SwipeableMethods>(null);
  const { formatAmount } = useCurrency();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  // Capture whether this card should animate at mount time — prevents opacity
  // from dropping to 0 if entryIndex changes due to sibling deletion.
  const shouldEntryAnimate = useRef(entryIndex !== undefined && !reduceMotion);
  const entryAnim = useRef(new Animated.Value(shouldEntryAnimate.current ? 0 : 1)).current;

  useEffect(() => {
    if (shouldEntryAnimate.current && entryIndex !== undefined) {
      Animated.timing(entryAnim, {
        toValue: 1,
        duration: 280,
        delay: entryIndex * 60,
        useNativeDriver: true,
      }).start();
    }
  }, []);

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
    onPress(game.id, isCompleted);
  }, [onPress, game.id, isCompleted]);

  const tapGesture = useMemo(() => Gesture.Tap()
    .maxDuration(200)
    .maxDistance(10)
    .onBegin(() => {
      runOnJS(animateScaleDown)();
    })
    .onFinalize((_, success) => {
      if (success) {
        runOnJS(handleTapSuccess)();
        runOnJS(animateScaleUp)(-0.5);
      } else {
        runOnJS(animateScaleUp)(0);
      }
    }), [animateScaleDown, animateScaleUp, handleTapSuccess]);

  // Recomputed every render on purpose — see calculateBuyinTotal. Mutators
  // rewrite game.transactions in place, so its reference is not a change signal.
  const totalPot = calculateBuyinTotal(game.transactions);

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={() => (
        <TouchableOpacity
          style={styles.deleteAction}
          onPress={() => {
            swipeableRef.current?.close();
            setTimeout(() => {
              onDelete({ id: game.id, name: game.name });
            }, 100);
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="trash" size={22} color="rgba(192,70,87,0.85)" />
        </TouchableOpacity>
      )}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
      rightThreshold={40}
    >
      <GestureDetector gesture={tapGesture}>
        <Animated.View
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`${game.name}, ${formatDate(game.date)}, ${game.players.length} players`}
          accessibilityHint={isCompleted ? "View game summary" : "Open active game"}
          style={[
            styles.gameCard,
            isCompleted && styles.completedCard,
            !reduceMotion && {
              opacity: shouldEntryAnimate.current ? entryAnim : 1,
              transform: [
                { scale: scaleAnim },
                ...(shouldEntryAnimate.current ? [{
                  translateY: entryAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [18, 0]
                  })
                }] : [])
              ]
            }
          ]}
        >
          <RNView style={styles.gameCardHeader}>
            <Text style={styles.gameCardTitle}>{game.name}</Text>
            {isCompleted && <Ionicons name="checkmark-circle" size={18} color="rgba(176,114,187,0.5)" />}
          </RNView>

          {/* Data row */}
          <RNView style={styles.dataRow}>
            <RNView style={styles.dataItem}>
              <Text style={styles.dataLabel}>Players</Text>
              <Text style={styles.dataValue}>{game.players.length}</Text>
            </RNView>
            <RNView style={styles.dataDivider} />
            <RNView style={styles.dataItem}>
              <Text style={styles.dataLabel}>Pot</Text>
              <Text style={styles.dataValue}>{formatAmount(totalPot)}</Text>
            </RNView>
            <RNView style={styles.dataDivider} />
            <RNView style={[styles.dataItem, styles.dateDataItem]}>
              <Text style={styles.dataLabel}>Date</Text>
              <Text style={styles.dataValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{formatDate(game.date)}</Text>
            </RNView>
          </RNView>
        </Animated.View>
      </GestureDetector>
    </Swipeable>
  );
};

const styles = StyleSheet.create({
  gameCard: {
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 8,
    marginBottom: 10,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#242424',
    borderTopColor: 'rgba(176,114,187,0.2)',
  },
  completedCard: {
    backgroundColor: '#111111',
    borderTopColor: 'rgba(176,114,187,0.1)',
  },
  gameCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  gameCardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  dataItem: {
    flex: 1,
    alignItems: 'flex-start',
  },
  dateDataItem: {
    flex: 1.5,
  },
  dataLabel: {
    fontSize: 9,
    color: 'rgba(176,114,187,0.65)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 3,
  },
  dataValue: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    fontFamily: 'SpaceMono',
  },
  dataDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#2A2A2A',
    marginHorizontal: 12,
  },
  deleteAction: {
    backgroundColor: '#1A1414',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 6,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(192,70,87,0.25)',
  },
});

// Default shallow compare — do NOT add a custom comparator. React does not
// snapshot props: after an in-place mutation the previous and next props hold
// the SAME players/transactions arrays, so any hand-rolled field compare reads
// one array against itself and reports "unchanged". The reliable signal
// is the game object identity, which GameContext.updateGame replaces on every
// edit, and which this default compare already checks. The list items are built
// in a useMemo keyed on [games, isPro], so unedited cards still skip re-render.
export default React.memo(GameCard);
