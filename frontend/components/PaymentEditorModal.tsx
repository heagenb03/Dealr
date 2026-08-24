import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Reanimated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { isScrolledToEnd } from '@/utils/scrollFade';
import { PaymentCarrier, PaymentHandles, PaymentMethod } from '@/types/game';
import { PAYMENT_METHODS, PaymentMethodMeta } from '@/constants/PaymentMethods';
import { normalizeHandle } from '@/utils/paymentLinks';
import { applyPaymentInvariant, resolveDefaultMethod } from '@/utils/paymentMethods';
import { AppModalCard } from '@/components/AppModal';
import ModalButton from '@/components/ModalButton';
import { modalLayoutStyles } from '@/styles/modal';

/**
 * The editor's target: a real carrier-bearing entity (Player or SavedPlayer), OR a
 * synthetic not-yet-created one (saved-players.tsx's "Add player" flow, which has no
 * id/name yet). id/name are optional and unused here — the editor only reads methods/
 * defaultMethod — but kept on the type so callers can pass their real object as-is.
 */
type EditorTarget = (PaymentCarrier & { id?: string; name?: string }) | null;

interface PaymentEditorModalProps {
  visible: boolean;
  player: EditorTarget;
  onSave: (payment: PaymentCarrier) => void;
  onClose: () => void;
}

interface PaymentEditorContentProps {
  player: EditorTarget;
  onSave: (payment: PaymentCarrier) => void;
  onClose: () => void;
  /**
   * Whether the editor is being presented. Drives the re-seed effect.
   * Defaults to true for callers (e.g. the in-place overlay inside another
   * modal) that mount this component only while it is shown.
   */
  visible?: boolean;
}

/**
 * The default to fall back on when the current one is removed: the first remaining method
 * carrying a real handle, else a remaining handle-less one (only Cash).
 *
 * The second branch is not redundant with the first. applyPaymentInvariant keeps a
 * handle-less method ONLY when it is the default, so a lone surviving Cash row with no
 * default lands in the save as nothing at all.
 */
function fallbackDefault(map: PaymentHandles): PaymentMethod | undefined {
  const filled = PAYMENT_METHODS.find(
    m => m.key in map && normalizeHandle(m.key, map[m.key]) !== '',
  );
  if (filled) return filled.key;
  return PAYMENT_METHODS.find(m => m.key in map && !m.takesHandle)?.key;
}

/**
 * The editor's UI without a `<Modal>` wrapper. Rendered as an absolute-fill
 * overlay so it can be presented either inside `PaymentEditorModal`'s own
 * native modal OR directly inside another already-open modal (iOS can only
 * present one native modal at a time, so a second `<Modal>` would be silently
 * dropped — see the Add-players flow in saved-players.tsx).
 *
 * A GestureHandlerRootView ancestor must be provided by the caller (the modal
 * wrapper or the host modal) so the gesture-based ModalButtons work.
 *
 * Add-then-fill, not fill-seven-rows: only the methods the player actually has get a row,
 * and each row's input spans the full card width. Showing all seven at once left the
 * PayPal field — `paypal.me/` plus a 12pt-padded affix box on a row already spending
 * ~114pt of ~287pt on a dot and a fixed label column — too narrow to type a username into.
 */
export const PaymentEditorContent: React.FC<PaymentEditorContentProps> = ({
  player,
  onSave,
  onClose,
  visible = true,
}) => {
  const [handles, setHandles] = useState<PaymentHandles>(() => ({ ...(player?.methods ?? {}) }));
  const [defaultMethod, setDefaultMethod] = useState<PaymentMethod | undefined>(
    () => resolveDefaultMethod(player ?? undefined),
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  // Bottom scroll-fade. A visible scroll indicator does not answer "I could not tell it
  // scrolls": on both platforms it appears only during a drag, so it confirms scrolling to
  // someone already dragging rather than advertising it to someone who is not. The fade is
  // what answers it; the indicator is the confirmation once a drag starts. Same reasoning and
  // same band stack as the Add Players picker (active.tsx, `pickerFadeStyle`).
  //
  // All three start at 0, which isScrolledToEnd reads as at-end → fade hidden. That is the
  // correct initial state: it must not flash on for the frame before the first layout pass.
  // Everything below runs on the UI thread, so scrolling costs zero JS re-renders.
  const reduceMotion = useReduceMotion();
  const scrollY = useSharedValue(0);
  const viewportH = useSharedValue(0);
  const contentH = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler(e => {
    scrollY.value = e.contentOffset.y;
    viewportH.value = e.layoutMeasurement.height;
    contentH.value = e.contentSize.height;
  });

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: withTiming(
      isScrolledToEnd(scrollY.value, viewportH.value, contentH.value) ? 0 : 1,
      { duration: reduceMotion ? 0 : 150 },
    ),
  }), [reduceMotion]);

  // Re-seed local state from the target's saved methods each time the editor opens.
  // (The useState initializers above cover the mount-fresh-each-open case; this covers
  // the overlay that stays mounted across opens, e.g. saved-players.tsx's Add-player flow.)
  useEffect(() => {
    if (!visible) return;
    setHandles({ ...(player?.methods ?? {}) });
    setDefaultMethod(resolveDefaultMethod(player ?? undefined));
    setPickerOpen(false);
  }, [visible, player]);

  // A key present in `handles` IS the row — which is also exactly what handleSave iterates,
  // so adding and removing rows needs no separate state and no change to the save path.
  const added = PAYMENT_METHODS.filter(m => m.key in handles);
  const available = PAYMENT_METHODS.filter(m => !(m.key in handles));
  // Forced open on the empty state: with no rows there is nothing else on screen, so an add
  // control the user still has to find would be the entire modal.
  const showPicker = available.length > 0 && (pickerOpen || added.length === 0);
  // Gates whether the dot is INTERACTIVE, not whether it is drawn — the column is always
  // drawn (see the row below). One row is the default by having no competition, so a
  // tappable dot there would be a control that cannot change anything.
  const showDefaultControl = added.length > 1;

  const addMethod = (m: PaymentMethodMeta) => {
    setHandles(prev => ({ ...prev, [m.key]: prev[m.key] ?? '' }));
    setPickerOpen(false);
    // Cash takes no handle, so adding it is the whole statement the user can make about it
    // and no later keystroke is coming to claim the default. Handle-taking methods keep the
    // typing-gated rule below — adding one must NOT claim the default, or a row added and
    // left blank sends a handle-less method everywhere the default is read.
    if (!m.takesHandle) setDefaultMethod(prev => prev ?? m.key);
  };

  const removeMethod = (key: PaymentMethod) => {
    const next = { ...handles };
    delete next[key];
    setHandles(next);
    if (defaultMethod === key) setDefaultMethod(fallbackDefault(next));
  };

  const setHandle = (key: PaymentMethod, raw: string) => {
    setHandles(prev => ({ ...prev, [key]: raw }));
    // Auto-default: the first handle typed becomes the default, so the common case
    // (one player, one Venmo) needs no second tap.
    //
    // Gated on the NORMALIZED value, not the raw text. Raw text that normalizes to ''
    // (a bare affix — '@' typed out of habit in the Venmo field) saves no handle, yet
    // the default is sticky: it is only ever assigned while `prev === undefined`, and
    // the per-row dot can move it but never unset it. Claiming the default for a row
    // that then saves nothing sends the wrong method out everywhere the default is
    // read — the card badge, the share message and the published /g/ snapshot.
    setDefaultMethod(prev => (prev === undefined && normalizeHandle(key, raw) !== '' ? key : prev));
  };

  const handleSave = () => {
    const normalized: PaymentHandles = {};
    for (const m of PAYMENT_METHODS) {
      const raw = handles[m.key];
      if (raw === undefined) continue;
      normalized[m.key] = m.takesHandle ? normalizeHandle(m.key, raw) : '';
    }
    // applyPaymentInvariant is the single place that decides what survives: the default
    // is always kept (handle or not), every other row only if it has a non-empty handle.
    onSave(applyPaymentInvariant({ methods: normalized, defaultMethod }));
  };

  return (
    <AppModalCard
      onClose={onClose}
      cardStyle={styles.card}
      title="Payment methods"
      // The body ScrollView below is this component's own. Without scrollBody={false},
      // AppModalCard wraps title + rows + buttons in a SECOND ScrollView that (with no
      // header/footer to trigger bodyShrinkable) sizes to full content height inside a
      // height-capped card — the same unbounded-ScrollView shape as the HelpSheet bug.
      scrollBody={false}
      header={
        showPicker ? (
          // Only once there is a list to go back to. On the empty state the picker IS the
          // modal, so a Done would dismiss everything and leave a card with one control on it.
          added.length > 0 ? (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Add a method</Text>
              <TouchableOpacity
                testID="payment-picker-done"
                onPress={() => setPickerOpen(false)}
                activeOpacity={0.7}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Done adding methods"
              >
                <Text style={styles.sectionAction}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : null
        ) : null
      }
      footer={
        <View style={[modalLayoutStyles.modalButtons, styles.buttons]}>
          <ModalButton variant="cancel" title="Cancel" onPress={onClose} />
          <ModalButton variant="confirm" title="Save" onPress={handleSave} />
        </View>
      }
    >
      {/* A THIRD level in the flex chain: staticBody (flexShrink:1) → rowsViewport →
          ScrollView (flexShrink:1). RN defaults flexShrink to 0, so without flexShrink +
          minHeight this level refuses to yield height — the list keeps its full content
          height and pushes the pinned Cancel/Save footer out of the height-capped card
          instead of scrolling. That failure is SILENT: no warning and no test failure in
          this environment, the buttons are simply gone. Device QA is the only thing that
          sees it. Copied from active.tsx's pickerViewport, which documents the same trap.
          The wrapper also gives the absolutely-positioned fade something to sit in. */}
      <View style={styles.rowsViewport}>
      {/* flexShrink is load-bearing: a ScrollView inside a maxHeight card does not
          scroll on iOS without it, and the last rows are silently cut off. The visible
          indicator is the deliberate reversal AppModal documents for scrollBody={false}
          callers; the fade below is what actually advertises that the list scrolls.

          onLayout/onContentSizeChange are not redundant with onScroll: the scroll handler
          only fires while scrolling, so a list shorter than the viewport would never set
          the values at all. Both are infrequent and JS-side. */}
      <Reanimated.ScrollView
        style={styles.rows}
        contentContainerStyle={styles.rowsContent}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        showsVerticalScrollIndicator
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onLayout={e => { viewportH.value = e.nativeEvent.layout.height; }}
        onContentSizeChange={(_w: number, h: number) => { contentH.value = h; }}
      >
        {/* One viewport, two modes. The picker REPLACES the method list rather than
            stacking below it: stacked, the height cap would push the rows the user came
            here to edit out of view the moment the picker opened, and the pinned "Add
            method" row would sit above a list it no longer applied to. */}
        {showPicker ? available.map((m, i) => (
          <TouchableOpacity
            key={m.key}
            testID={`payment-add-${m.key}`}
            onPress={() => addMethod(m)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Add ${m.label}`}
            style={[styles.pickerRow, i > 0 && styles.pickerRowDivided]}
          >
            <Text style={styles.pickerLabel}>{m.label}</Text>
            <Ionicons name="add" size={18} color="#B072BB" />
          </TouchableOpacity>
        )) : added.map((m) => {
          const isDefault = defaultMethod === m.key;
          return (
            <View key={m.key} style={styles.methodRow}>
              <View style={styles.methodHeader}>
                {/* The dot column is present from the FIRST method so nothing shifts
                    sideways when a second arrives — adding one used to slide every label
                    right 26pt at the same moment an instruction line appeared above the
                    list, which under the height cap reads as the modal glitching.
                    With one row it is a marker, not a control: hollow until a handle is
                    typed, filled once there is one. Deliberately NOT tappable there —
                    tapping would claim the default for a blank handle-taking row, which
                    is exactly the handle-less-Venmo save the affix-only rule prevents. */}
                {showDefaultControl ? (
                  <TouchableOpacity
                    testID={`payment-default-${m.key}`}
                    onPress={() => setDefaultMethod(m.key)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Make ${m.label} the default`}
                    accessibilityState={{ selected: isDefault }}
                    style={[styles.defaultDot, isDefault && styles.defaultDotOn]}
                  />
                ) : (
                  <View
                    testID={`payment-default-marker-${m.key}`}
                    style={[styles.defaultDot, isDefault && styles.defaultDotOn]}
                  />
                )}
                <Text style={[styles.methodLabel, isDefault && styles.methodLabelDefault]}>
                  {m.label}
                </Text>
                {isDefault ? <Text style={styles.defaultTag}>Default</Text> : null}
                <View style={styles.headerSpacer} />
                <TouchableOpacity
                  testID={`payment-remove-${m.key}`}
                  onPress={() => removeMethod(m.key)}
                  activeOpacity={0.7}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${m.label}`}
                >
                  <Ionicons name="close" size={16} color="rgba(255,255,255,0.55)" />
                </TouchableOpacity>
              </View>
              {m.takesHandle ? (
                <View style={styles.handleRow}>
                  {m.affix ? (
                    <View style={styles.affixBox}>
                      <Text style={styles.affixText}>{m.affix}</Text>
                    </View>
                  ) : null}
                  <TextInput
                    testID={`payment-input-${m.key}`}
                    value={handles[m.key] ?? ''}
                    onChangeText={(t) => setHandle(m.key, t)}
                    placeholder={m.handlePlaceholder}
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, m.affix ? styles.inputWithAffix : styles.inputPlain]}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </Reanimated.ScrollView>

      {/* 5 stacked 6pt bands in the card colour at stepped opacity, most opaque at the
          bottom. NOT expo-linear-gradient: that is not a dependency and there is no
          gradient anywhere in the app, so adding it means a new native module and a fresh
          EAS build. At 30pt the stack is visually indistinguishable from a gradient.
          pointerEvents="none" is required, not cosmetic — this sits over the bottom 30pt
          of the list, which is exactly where a row's input lands at the end of a scroll. */}
      <Reanimated.View
        testID="payment-scroll-fade"
        style={[styles.fade, fadeStyle]}
        pointerEvents="none"
      >
        <View style={[styles.fadeBand, { opacity: 0.2 }]} />
        <View style={[styles.fadeBand, { opacity: 0.4 }]} />
        <View style={[styles.fadeBand, { opacity: 0.6 }]} />
        <View style={[styles.fadeBand, { opacity: 0.8 }]} />
        <View style={[styles.fadeBand, { opacity: 1 }]} />
      </Reanimated.View>
      </View>

      {/* Pinned OUTSIDE the scroll view, directly above the Cancel/Save footer. Inside it,
          this was a line the user had to scroll to the bottom of the list to reach, and it
          read as a caption rather than a control. It never renders in picker mode — the
          picker's own header carries Done — so its label is fixed and nothing here toggles. */}
      {!showPicker && available.length > 0 ? (
        <TouchableOpacity
          testID="payment-add-toggle"
          onPress={() => setPickerOpen(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          style={styles.addRow}
        >
          <Ionicons name="add" size={16} color="#B072BB" />
          <Text style={styles.addRowText}>Add method</Text>
        </TouchableOpacity>
      ) : null}
    </AppModalCard>
  );
};

const PaymentEditorModal: React.FC<PaymentEditorModalProps> = ({ visible, player, onSave, onClose }) => {
  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <PaymentEditorContent visible={visible} player={player} onSave={onSave} onClose={onClose} />
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 20,
  },
  rowsViewport: {
    width: '100%',
    flexShrink: 1,
    minHeight: 0,
    // The cap that stops the card growing with the list. A handle-bearing row is ~83pt
    // (18pt header + 6pt gap + a ~45pt input + 14pt margin), so three of them plus the
    // 4pt content padding is ~253 and fits exactly: three methods do not scroll, a fourth
    // does. It is a HEIGHT, not a row count — a Cash row has no input and is ~38pt, so a
    // cash-heavy list shows more than three. In picker mode the same cap holds ~5.5 of
    // the 46pt method rows.
    maxHeight: 258,
  },
  rows: {
    flexShrink: 1,
  },
  rowsContent: {
    // Deliberately NOT padded to clear the fade. Obscuring content is the fade's whole job
    // while there is more below, and at the end of the scroll it has faded out — so padding
    // would buy nothing there and cost a 30pt gap above the buttons on the common short list.
    paddingBottom: 4,
  },
  fade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 30,
  },
  fadeBand: { height: 6, backgroundColor: '#1A1A1A' },
  methodRow: {
    marginBottom: 14,
  },
  methodHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  headerSpacer: {
    flex: 1,
  },
  defaultDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  defaultDotOn: {
    borderColor: '#B072BB',
    backgroundColor: '#B072BB',
  },
  methodLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
  },
  methodLabelDefault: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  defaultTag: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: '#B072BB',
  },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  affixBox: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: '#2A2A2A',
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  affixText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.6)',
  },
  input: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    padding: 12,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  inputPlain: {
    borderRadius: 6,
  },
  inputWithAffix: {
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)',
  },
  sectionAction: {
    fontSize: 14,
    fontWeight: '600',
    color: '#B072BB',
  },
  // Full-width rows with a hairline divider, matching CurrencyPickerModal and
  // TolerancePickerModal — the app's only other pickers, and the idiom the outlined
  // chip grid this replaced was the sole departure from. No paddingHorizontal: the
  // card's own 20pt padding supplies it, so the divider spans the content width the
  // way those sheets' 20pt-inset dividers span theirs.
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  pickerRowDivided: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(176,114,187,0.1)',
  },
  pickerLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  addRowText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#B072BB',
  },
  buttons: {
    marginTop: 20,
  },
});

export default PaymentEditorModal;
