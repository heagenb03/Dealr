import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { GameProvider } from '@/contexts/GameContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { NetworkProvider } from '@/contexts/NetworkContext';

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
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  // Hide splash screen only after auth state is known — prevents any flash of
  // the wrong screen on cold start.
  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  // Redirect based on auth state once it has resolved
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = (segments as string[])[0] === '(auth)';

    if (!user && !inAuthGroup) {
      // Not signed in and not on an auth screen — go to login
      router.replace('/(auth)/login' as any);
    } else if (user && inAuthGroup) {
      // Signed in but still on an auth screen — go to main app
      router.replace('/(tabs)' as any);
    }
  }, [user, isLoading, segments]);

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
      <GameProvider>
        <View style={styles.root}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="how-it-works" options={{ presentation: 'modal' }} />
          </Stack>
        </View>
      </GameProvider>
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
