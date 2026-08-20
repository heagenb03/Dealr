import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { GameProvider } from '@/contexts/GameContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { GameDefaultsProvider } from '@/contexts/GameDefaultsContext';
import { NetworkProvider } from '@/contexts/NetworkContext';
import { needsVerification } from '@/utils/emailVerification';
import { consumePendingShare, hydratePendingShare } from '@/services/pendingShare';
import { resolveAuthGateNavigation } from '@/utils/authRedirect';

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(auth)',
};

// Keep splash screen up until both fonts and auth state are ready
SplashScreen.preventAutoHideAsync();

// ---------------------------------------------------------------------------
// Custom dark theme
// ---------------------------------------------------------------------------

const CustomDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#B072BB',
    background: '#0A0A0A',
    card: '#1A1A1A',
    text: '#FFFFFF',
    border: '#2A2A2A',
    notification: '#B072BB',
  },
};

// ---------------------------------------------------------------------------
// Root layout — font loading gate
// ---------------------------------------------------------------------------

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={CustomDarkTheme}>
        <NetworkProvider>
          <AuthProvider>
            <AuthNavigator />
          </AuthProvider>
        </NetworkProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

// ---------------------------------------------------------------------------
// AuthNavigator — hides splash screen after auth state resolves and routes
// the user to the correct segment.
// ---------------------------------------------------------------------------

function AuthNavigator() {
  const { user, isLoading, emailVerified } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  // Hide splash screen only after auth state is known — prevents any flash of
  // the wrong screen on cold start.
  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  // A share link tapped before an App Store round trip is stashed in
  // AsyncStorage; pull it back into memory once, at launch. Never overwrites an
  // id set this session — see services/pendingShare.ts.
  //
  // The flag is what ORDERS this before the redirect effect's consume. Set it in
  // `finally`: a storage failure must let the gate proceed, not wedge every user
  // on the splash screen forever. Losing the stash degrades to "lands on the
  // tabs", and the documented recovery is to re-tap the link in the group chat.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hydratePendingShare().finally(() => {
      if (!cancelled) setHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Redirect based on auth + verification state once auth has resolved. The
  // decision itself (including the hydrate-ordering gate and the post-consume
  // latch that guards against a stale re-fire clobbering a share navigation)
  // lives in resolveAuthGateNavigation — see utils/authRedirect.ts — so it is
  // unit-testable without rendering this component tree.
  useEffect(() => {
    const seg0 = (segments as string[])[0];
    const mustVerify = needsVerification(user, emailVerified);

    const destination = resolveAuthGateNavigation(
      { isLoading, hydrated, seg0, hasUser: !!user, mustVerify },
      consumePendingShare,
    );

    // `as any` because typedRoutes cannot narrow a computed path string — the
    // same reason the previous three router.replace calls carried the cast.
    if (destination) router.replace(destination as any);
  }, [user, isLoading, emailVerified, segments, hydrated]);

  // Neutral loading state — splash screen is still showing above this
  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#B072BB" size="large" />
      </View>
    );
  }

  // Main navigation tree — always mounted once auth state is known
  return (
    <CurrencyProvider>
      <GameDefaultsProvider>
        <GameProvider>
          <View style={styles.root}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="verify-email" />
              <Stack.Screen name="g/[shareId]" />
              <Stack.Screen name="how-it-works" options={{ presentation: 'modal' }} />
            </Stack>
          </View>
        </GameProvider>
      </GameDefaultsProvider>
    </CurrencyProvider>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loading: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
