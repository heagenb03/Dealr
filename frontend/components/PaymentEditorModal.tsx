import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaymentCarrier, PaymentHandles, PaymentMethod } from '@/types/game';
import { PAYMENT_METHODS } from '@/constants/PaymentMethods';
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
 * The editor's UI without a `<Modal>` wrapper. Rendered as an absolute-fill
 * overlay so it can be presented either inside `PaymentEditorModal`'s own
 * native modal OR directly inside another already-open modal (iOS can only
 * present one native modal at a time, so a second `<Modal>` would be silently
 * dropped — see the Add-players flow in saved-players.tsx).
 *
 * A GestureHandlerRootView ancestor must be provided by the caller (the modal
 * wrapper or the host modal) so the gesture-based ModalButtons work.
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

  // Re-seed local state from the target's saved methods each time the editor opens.
  // (The useState initializers above cover the mount-fresh-each-open case; this covers
  // the overlay that stays mounted across opens, e.g. saved-players.tsx's Add-player flow.)
  useEffect(() => {
    if (!visible) return;
    setHandles({ ...(player?.methods ?? {}) });
    setDefaultMethod(resolveDefaultMethod(player ?? undefined));
  }, [visible, player]);

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
    <AppModalCard onClose={onClose} cardStyle={styles.card}>
      <Text style={styles.title}>Payment methods</Text>

      {/* flexShrink is load-bearing: a ScrollView inside a maxHeight card does not
          scroll on iOS without it, and the last rows are silently cut off. */}
      <ScrollView style={styles.rows} contentContainerStyle={styles.rowsContent}>
        {PAYMENT_METHODS.map((m) => {
          const isDefault = defaultMethod === m.key;
          return (
            <View key={m.key} style={styles.methodRow}>
              <TouchableOpacity
                testID={`payment-default-${m.key}`}
                onPress={() => setDefaultMethod(m.key)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: isDefault }}
                style={[styles.defaultDot, isDefault && styles.defaultDotOn]}
              />
              <Text style={[styles.methodLabel, isDefault && styles.methodLabelDefault]}>
                {m.label}
              </Text>
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
      </ScrollView>

      <View style={[modalLayoutStyles.modalButtons, styles.buttons]}>
        <ModalButton variant="cancel" title="Cancel" onPress={onClose} />
        <ModalButton variant="confirm" title="Save" onPress={handleSave} />
      </View>
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
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 14,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  rows: {
    flexShrink: 1,
  },
  rowsContent: {
    paddingBottom: 4,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  defaultDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  defaultDotOn: {
    borderColor: '#B072BB',
    backgroundColor: '#B072BB',
  },
  methodLabel: {
    width: 78,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
  },
  methodLabelDefault: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  handleRow: {
    flex: 1,
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
  buttons: {
    marginTop: 20,
  },
});

export default PaymentEditorModal;
