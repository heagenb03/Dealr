/**
 * Launch-time deferred deep link.
 *
 * A recipient who did NOT have the app when they tapped a share link got
 * `CC-<shareId>` written to their clipboard by public/g/index.html on the way to
 * the store. This is where that gets picked back up.
 *
 * Runs ONCE per mount, only when there is a usable session — the clipboard read
 * itself shows a system paste banner on iOS 16+, and firing it on a signed-out
 * launch would spend that prompt before the user can act on it.
 *
 * PRIVACY: the raw clipboard string never leaves this effect. It is read once,
 * fed straight into pickClipboardShare (which returns either a validated
 * shareId or null), and dropped — never logged, never stored, never included in
 * an error message. Only the extracted shareId is persisted (to
 * @cashcage:lastOfferedShare, so the same id is never re-offered) or shown in
 * this component's own state.
 *
 * Untestable by jest (expo-clipboard is a native module); the decision it makes
 * lives in the pure, tested pickClipboardShare. Covered by device QA.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';

import { Text } from '@/components/Themed';
import AppModal, { appModalStyles } from '@/components/AppModal';
import ModalButton from '@/components/ModalButton';
import { useAuth } from '@/contexts/AuthContext';
import { needsVerification } from '@/utils/emailVerification';
import { pickClipboardShare } from '@/utils/clipboardHandoff';

const LAST_OFFERED_KEY = '@cashcage:lastOfferedShare';

export default function ClipboardShareHandoff() {
  const { user, emailVerified, isLoading } = useAuth();
  const router = useRouter();
  const [offeredId, setOfferedId] = useState<string | null>(null);
  const hasCheckedRef = useRef(false);

  const canView = !!user && !needsVerification(user, emailVerified);

  useEffect(() => {
    if (isLoading || !canView || hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const [text, lastOfferedId] = await Promise.all([
          Clipboard.getStringAsync(),
          AsyncStorage.getItem(LAST_OFFERED_KEY),
        ]);
        // `text` (the raw clipboard string) is consumed here and nowhere else —
        // it is never logged, stored, or passed to anything but this pure
        // picker, which returns only a validated shareId or null.
        const candidate = pickClipboardShare({ clipboardText: text, lastOfferedId });
        if (cancelled || !candidate) return;
        // Record BEFORE showing, so a dismissed prompt does not return next launch.
        await AsyncStorage.setItem(LAST_OFFERED_KEY, candidate);
        if (!cancelled) setOfferedId(candidate);
      } catch {
        // A clipboard read can be denied outright. The documented recovery is to
        // re-tap the original link in the group chat, which now works because
        // the app is installed. Never surface the underlying error — it could
        // echo clipboard content on some platforms.
      }
    })();

    return () => { cancelled = true; };
  }, [isLoading, canView]);

  if (!offeredId) return null;

  return (
    <AppModal
      visible
      onClose={() => setOfferedId(null)}
      dismissOnBackdrop
      title="Open the shared game?"
      contentStyle={appModalStyles.centeredContent}
    >
      <Text style={styles.message}>Someone shared a Cash Cage game with you.</Text>
      <View style={styles.buttonRow}>
        <ModalButton title="Not now" variant="cancel" onPress={() => setOfferedId(null)} />
        <ModalButton
          title="Open"
          variant="confirm"
          onPress={() => {
            const id = offeredId;
            setOfferedId(null);
            router.push(`/g/${id}` as any);
          }}
        />
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  message: {
    fontSize: 15,
    textAlign: 'center',
    color: '#FFFFFF',
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
});
