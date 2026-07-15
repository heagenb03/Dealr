import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/contexts/AuthContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { sendVerificationEmail } from '@/services/firebaseService';
import {
  verifyCooldownRemaining,
  formatCooldownLabel,
  VERIFY_RESEND_COOLDOWN_MS,
} from '@/utils/emailVerification';

// One-time explainer flag (device-scoped). Shown once to cushion the existing-user wave.
const INTRO_SEEN_KEY = 'email_verify_intro_seen';

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const { user, refreshVerification, signOut } = useAuth();
  const { isOnline } = useNetwork();

  const [sentAt, setSentAt] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(false);

  const sentOnMountRef = useRef(false);

  // One-time explainer -------------------------------------------------------
  useEffect(() => {
    AsyncStorage.getItem(INTRO_SEEN_KEY)
      .then((val) => { if (!val) setShowIntro(true); })
      .catch(() => {});
  }, []);

  const dismissIntro = useCallback(() => {
    setShowIntro(false);
    AsyncStorage.setItem(INTRO_SEEN_KEY, '1').catch(() => {});
  }, []);

  // Send helper --------------------------------------------------------------
  const doSend = useCallback(async () => {
    if (!isOnline) {
      setNotice('You’re offline — connect to the internet to verify.');
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      await sendVerificationEmail();
      setSentAt(Date.now());
    } catch (err: any) {
      if (err?.code === 'auth/too-many-requests') {
        setNotice('Too many attempts — try again in a few minutes.');
        setSentAt(Date.now()); // start the cooldown so the button isn’t spammable
      } else if (err?.code === 'auth/network-request-failed') {
        setNotice('You’re offline — connect to the internet to verify.');
      } else {
        setNotice('Couldn’t send the email. Please try again.');
      }
    } finally {
      setSending(false);
    }
  }, [isOnline]);

  // Send once on entry -------------------------------------------------------
  useEffect(() => {
    if (sentOnMountRef.current) return;
    sentOnMountRef.current = true;
    doSend();
  }, [doSend]);

  // Cooldown ticker ----------------------------------------------------------
  useEffect(() => {
    const tick = () =>
      setCooldown(verifyCooldownRemaining(sentAt, Date.now(), VERIFY_RESEND_COOLDOWN_MS));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  // Auto-check on refocus ----------------------------------------------------
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') refreshVerification();
    });
    return () => sub.remove();
  }, [refreshVerification]);

  // Handlers -----------------------------------------------------------------
  const handleCheck = useCallback(async () => {
    setChecking(true);
    setNotice(null);
    const verified = await refreshVerification();
    setChecking(false);
    if (!verified) {
      setNotice('Not verified yet — check your inbox (and spam).');
    }
    // If verified, AuthNavigator redirects into the app automatically (Task 5).
  }, [refreshVerification]);

  const handleSignOut = useCallback(() => {
    signOut().catch(() => {});
  }, [signOut]);

  const resendDisabled = sending || cooldown > 0 || !isOnline;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name="mail-unread-outline" size={40} color="#B072BB" />
        </View>

        <Text style={styles.title}>Verify your email</Text>
        <Text style={styles.body}>We sent a verification link to</Text>
        <Text style={styles.email}>{user?.email ?? 'your email'}</Text>
        <Text style={styles.body}>
          Tap the link, then come back — we’ll let you in automatically.
        </Text>

        {showIntro && (
          <View style={styles.introCard}>
            <Text style={styles.introText}>
              We added email verification to keep your account secure. It only takes a moment.
            </Text>
            <TouchableOpacity onPress={dismissIntro} activeOpacity={0.7}>
              <Text style={styles.introDismiss}>Got it</Text>
            </TouchableOpacity>
          </View>
        )}

        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#C04657" />
            <Text style={styles.offlineText}>You’re offline — connect to verify.</Text>
          </View>
        )}

        {notice && <Text style={styles.notice}>{notice}</Text>}

        <TouchableOpacity
          style={[styles.primaryButton, (checking || !isOnline) && styles.buttonDisabled]}
          onPress={handleCheck}
          disabled={checking || !isOnline}
          activeOpacity={0.85}
        >
          {checking ? (
            <ActivityIndicator color="#0A0A0A" />
          ) : (
            <Text style={styles.primaryButtonText}>I’ve verified — continue</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={doSend}
          disabled={resendDisabled}
          activeOpacity={0.7}
        >
          <Text style={[styles.secondaryButtonText, resendDisabled && styles.secondaryTextDisabled]}>
            {sending
              ? 'Sending…'
              : cooldown > 0
                ? `Resend in ${formatCooldownLabel(cooldown)}`
                : 'Resend email'}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.signOutButton, { marginBottom: insets.bottom + 16 }]}
        onPress={handleSignOut}
        activeOpacity={0.7}
      >
        <Text style={styles.signOutText}>Wrong email? Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
  },
  email: {
    fontSize: 16,
    fontWeight: '700',
    color: '#B072BB',
    textAlign: 'center',
  },
  introCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 16,
    marginTop: 8,
    width: '100%',
    gap: 10,
  },
  introText: {
    fontSize: 14,
    color: '#CCCCCC',
    lineHeight: 20,
  },
  introDismiss: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B072BB',
    alignSelf: 'flex-end',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  offlineText: {
    fontSize: 13,
    color: '#C04657',
  },
  notice: {
    fontSize: 14,
    color: '#CCCCCC',
    textAlign: 'center',
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: '#B072BB',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0A0A0A',
    letterSpacing: 0.5,
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#B072BB',
  },
  secondaryTextDisabled: {
    color: '#555',
  },
  signOutButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  signOutText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C04657',
  },
});
