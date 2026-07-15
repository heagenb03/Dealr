import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';

// expo-web-browser / expo-auth-session require a native module that is absent in
// Expo Go, so load them via dynamic require and fall back to a no-op hook. OAuth
// then simply stays unavailable in Expo Go; email/password still works.
type GoogleAuthHook = (config: {
  iosClientId?: string;
  androidClientId?: string;
  webClientId?: string;
}) => [
  unknown,
  { type: string; params: { id_token?: string } } | null,
  () => Promise<void>,
];

let useGoogleAuth: GoogleAuthHook = (_config) => [null, null, async () => {}];

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('expo-web-browser').maybeCompleteAuthSession();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useGoogleAuth = require('expo-auth-session/providers/google').useIdTokenAuthRequest;
} catch {
  // Expo Go — OAuth disabled.
}

/** Rejection reason used when the user cancels/dismisses an OAuth prompt. */
export const OAUTH_CANCELLED = 'oauth/cancelled';

export function isOAuthCancel(err: unknown): boolean {
  return (
    err === OAUTH_CANCELLED ||
    (typeof err === 'object' && err !== null && (err as { code?: string }).code === OAUTH_CANCELLED)
  );
}

type GoogleResolver = { resolve: (idToken: string) => void; reject: (reason: unknown) => void };

export interface OAuthPrompt {
  /** Launch Google OAuth; resolves the id_token, rejects with OAUTH_CANCELLED on dismiss. */
  promptGoogle: () => Promise<string>;
  /** Launch Apple sign-in; resolves { identityToken, fullName }, rejects with OAUTH_CANCELLED on dismiss. */
  promptApple: () => Promise<{ identityToken: string; fullName: string | null }>;
  /** True once the Google auth request is initialized (disable the button until then). */
  googleReady: boolean;
  /** Apple sign-in is only offered on iOS. */
  appleAvailable: boolean;
}

export function useOAuthPrompt(): OAuthPrompt {
  const [request, response, promptAsync] = useGoogleAuth({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

  // promptAsync() resolves when the browser dismisses, BEFORE `response` updates,
  // so the id_token arrives here in this effect — not from the promptAsync() call.
  // A stored resolver bridges the two. This is the single home for that gotcha.
  const googleResolver = useRef<GoogleResolver | null>(null);

  useEffect(() => {
    const resolver = googleResolver.current;
    if (!resolver || response == null) return;
    googleResolver.current = null;
    if (response.type === 'success' && response.params.id_token) {
      resolver.resolve(response.params.id_token);
    } else if (response.type === 'success') {
      resolver.reject(new Error('Google did not return an id_token.'));
    } else if (response.type === 'error') {
      resolver.reject(new Error('Google sign-in failed.'));
    } else {
      resolver.reject(OAUTH_CANCELLED);
    }
  }, [response]);

  const promptGoogle = (): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      googleResolver.current = { resolve, reject };
      promptAsync().catch((err) => {
        googleResolver.current = null;
        reject(err);
      });
    });

  const promptApple = async (): Promise<{ identityToken: string; fullName: string | null }> => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        throw new Error('Apple did not return an identity token.');
      }
      const fullName =
        [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ') || null;
      return { identityToken: credential.identityToken, fullName };
    } catch (err) {
      if ((err as { code?: string })?.code === 'ERR_REQUEST_CANCELED') throw OAUTH_CANCELLED;
      throw err;
    }
  };

  return {
    promptGoogle,
    promptApple,
    googleReady: !!request,
    appleAvailable: Platform.OS === 'ios',
  };
}
