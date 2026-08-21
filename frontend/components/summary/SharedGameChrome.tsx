/**
 * The frame around a shared game: the CASH CAGE bar on top, the route's own
 * content in the middle, one Done button pinned at the bottom.
 *
 * WHY THIS EXISTS: /g/[shareId] renders outside (tabs), under a root Stack with
 * `headerShown: false`, and nothing in this app mounts a SafeAreaView — there is
 * not one `SafeAreaView` or `SafeAreaProvider` in app/ or components/, only the
 * `useSafeAreaInsets()` call in (tabs)/_layout.tsx. So that route had no chrome
 * and no safe-area handling at all, and compensated with a hardcoded
 * `paddingTop: 60` INSIDE the list's `padding: 20` content inset. That put the
 * title's top edge at a fixed y=80 from the physical top of the display on every
 * device: 21pt of clearance under an iPhone 15/16 Pro's 59pt Dynamic Island
 * inset, 56pt of dead space under a 24pt Android status bar. The insets read
 * here replace that constant, at both ends.
 *
 * NOT DynamicCashCageHeader ((tabs)/_layout.tsx). That component switches on
 * `pathname` for /game/, /settings, /about and /saved-players — none of which
 * match /g/ — and carries the offline strip plus `router.dismissAll()` back
 * semantics that are wrong for an ephemeral route outside the tabs. The wordmark
 * VALUES below are copied from it deliberately (22 / bold / letterSpacing 3, and
 * the 40x2 purple rule with its glow) so the two bars read as the same bar. They
 * are not shared code; keep them in sync by hand if that header's type changes.
 *
 * Deliberately no back button and no help "?". The screen's `handleClose`
 * already covers both exits (`router.back()`, or `replace('/(tabs)')` on a cold
 * deep-link start where there is no history), and the Done row is a SIBLING of
 * the list rather than a footer inside it, so it is on screen at every scroll
 * position. A header back would be a second control doing the identical thing.
 * Help is absent because getSummaryTopicIds covers reopen, share, the fallback
 * banner and the rounding note — none of which exist on a read-only snapshot.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, View } from '@/components/Themed';
import Button from '@/components/Button';

export interface SharedGameChromeProps {
  children: React.ReactNode;
  /** Leaves the shared game. Wired to the screen's handleClose. */
  onClose: () => void;
}

export default function SharedGameChrome({ children, onClose }: SharedGameChromeProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.bar, { paddingTop: insets.top }]}>
        <View style={styles.barRow}>
          <Text style={styles.wordmark}>CASH CAGE</Text>
          <View style={styles.rule} />
        </View>
      </View>

      <View style={styles.content}>{children}</View>

      {/* Math.max, NOT `insets.bottom + 20`: on an iPhone the 34pt home-indicator
          inset is already the right amount of room, and adding to it would sit
          Done 54pt off the bottom. The floor covers hardware reporting a 0
          bottom inset, where the raw value would put the button on the edge. */}
      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <Button
          onPress={onClose}
          title="Done"
          variant="primary"
          accessibilityHint="Closes this shared game"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  bar: { backgroundColor: '#0A0A0A' },
  barRow: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  wordmark: {
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 3,
    color: '#FFFFFF',
  },
  rule: {
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
  },
  content: { flex: 1, backgroundColor: 'transparent' },
  actions: {
    paddingHorizontal: 20,
    paddingTop: 20,
    backgroundColor: 'transparent',
  },
});
