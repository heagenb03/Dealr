import React, { useCallback, useEffect, useRef, useState } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { Text, View, TouchableOpacity, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useNetwork } from '@/contexts/NetworkContext';
import { HelpProvider, useHelp } from '@/contexts/HelpContext';

const AMBER = 'rgba(255, 165, 0, 0.85)';
const AMBER_BG = 'rgba(255, 165, 0, 0.08)';
const AMBER_BORDER = 'rgba(255, 165, 0, 0.15)';

export const unstable_settings = {
  initialRouteName: '(home)',
};

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={28} style={{ marginBottom: -3 }} {...props} />;
}

function DynamicCashCageHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isOnline } = useNetwork();
  const { requestHelp } = useHelp();

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReduceMotion();

  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const prevIsOnlineRef = useRef(isOnline);
  useEffect(() => {
    if (prevIsOnlineRef.current && !isOnline) {
      setOfflineDismissed(false);
    }
    prevIsOnlineRef.current = isOnline;
  }, [isOnline]);

  const showOfflineStrip = !isOnline && !offlineDismissed;

  const animateScaleDown = useCallback((scaleValue: number = 0.9) => {
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

  const isGameScreen = pathname?.includes('/game/');
  const isSettingsScreen = pathname?.includes('/settings');
  const isAboutScreen = pathname?.includes('/about');
  const isSavedPlayersScreen = pathname?.includes('/saved-players');

  return (
    <View style={{
      backgroundColor: '#0A0A0A',
      paddingTop: insets.top,
    }}>
      <View style={{
        flexDirection: 'row',
        height: 48,
        width: '100%',
        alignItems: 'center',
      }}>
        {/* Left column: Back button (76px fixed width) */}
        <View style={{
          width: 76,
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingLeft: 16,
        }}>
          {(isGameScreen || isSettingsScreen || isAboutScreen || isSavedPlayersScreen) && (
            <TouchableOpacity
              onPress={() => {
                if (isGameScreen) {
                  router.dismissAll();
                } else {
                  router.back();
                }
              }}
              style={{
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <FontAwesome name="arrow-left" size={22} color="#B072BB" />
            </TouchableOpacity>
          )}
        </View>

        {/* Center column: CASH CAGE logo (flex) */}
        <View style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Text
            style={{
              fontSize: 22,
              fontWeight: 'bold',
              letterSpacing: 3,
              color: '#FFFFFF',
            }}
          >
            CASH CAGE
          </Text>
          <View
            style={{
              marginTop: 4,
              width: 40,
              height: 2,
              borderRadius: 1,
              backgroundColor: '#B072BB',
              shadowColor: '#B072BB',
              shadowOffset: { width: 0, height: 0 },
              shadowRadius: 6,
              shadowOpacity: 0.7,
              elevation: 4,
            }}
          />
        </View>

        {/* Right column: Help (?) on game screens (76px fixed width) */}
        <View style={{
          width: 76,
          alignItems: 'flex-end',
          justifyContent: 'center',
          paddingRight: 16,
        }}>
          {isGameScreen && (
            <TouchableOpacity
              onPress={requestHelp}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Help"
              accessibilityHint="Opens help for this screen"
            >
              <Ionicons name="help-circle-outline" size={24} color="#B072BB" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {showOfflineStrip && (
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 14,
          height: 32,
          backgroundColor: AMBER_BG,
          borderTopWidth: 1,
          borderTopColor: AMBER_BORDER,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Ionicons name="cloud-offline-outline" size={13} color={AMBER} style={{ marginTop: 1 }} />
            <Text style={{ color: AMBER, fontSize: 11, fontWeight: '500', letterSpacing: 0.2 }}>
              You're offline · changes are saved locally
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setOfflineDismissed(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Dismiss offline banner"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={14} color={AMBER} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <HelpProvider>
      <Tabs
        initialRouteName="(home)"
        screenOptions={{
          tabBarActiveTintColor: Colors.dark.tint,
          tabBarInactiveTintColor: Colors.dark.tabIconDefault,
          tabBarStyle: {
            backgroundColor: '#0A0A0A',
            borderTopColor: '#2A2A2A',
          },
          headerStyle: {
            backgroundColor: '#0A0A0A',
          },
          header: () => <DynamicCashCageHeader />,
        }}>
        <Tabs.Screen
          name="(home)"
          options={{
            tabBarLabel: 'Games',
            tabBarIcon: ({ color }) => <TabBarIcon name="home" color={color} />,
          }}
        />
        <Tabs.Screen
          name="(profile)"
          options={{
            tabBarLabel: 'Account',
            tabBarIcon: ({ color }) => <TabBarIcon name="user" color={color} />,
          }}
        />
      </Tabs>
    </HelpProvider>
  );
}
