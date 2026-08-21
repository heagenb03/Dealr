import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  StyleSheet,
  FlatList,
  ListRenderItemInfo,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AppModal, { appModalStyles } from '@/components/AppModal';
import ModalButton from '@/components/ModalButton';
import PaymentEditorModal, { PaymentEditorContent } from '@/components/PaymentEditorModal';
import PaywallModal from '@/components/PaywallModal';
import SavedPlayerCard from '@/components/SavedPlayerCard';
import { useAuth } from '@/contexts/AuthContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import {
  savePlayer,
  updateSavedPlayer,
  deleteSavedPlayerById,
  deleteSavedPlayersByIds,
  getSavedPlayersByName,
  loadSavedPlayers,
  renameSavedPlayer,
  savedCapFor,
  canAddMoreSavedPlayers,
  SavedPlayer,
} from '@/services/savedPlayersService';
import { PaymentCarrier, Player } from '@/types/game';
import { getPaymentMethodMeta } from '@/constants/PaymentMethods';
import { formatHandleForDisplay } from '@/utils/paymentLinks';
import { resolvePayment, paymentWriteBackPatch } from '@/utils/paymentMethods';
import { savedCapCounter, savedCapPaywallMessage } from '@/utils/capCopy';
import { buildSavedPlayersListData, SavedPlayersListItem } from '@/utils/savedPlayersListData';

// Exported so the reference-stability test can import the real discriminant type used by
// usePaymentEditorTarget below (see __tests__/saved-players-payment-editor.test.tsx).
export type PaymentTarget =
  | { kind: 'edit'; player: SavedPlayer }
  | { kind: 'add' }
  | null;

/**
 * Builds the payment editor's target object. Exported (and pulled out of the component) so
 * the reference-stability test can exercise the REAL hook — including its real deps array —
 * rather than a hand-copied reproduction of it. See
 * __tests__/saved-players-payment-editor.test.tsx, which renders a probe component that
 * calls this hook directly and asserts on the reference it returns.
 *
 * useMemo keyed on `paymentTarget` ALONE (not addName/addPayment — eslint-disable below)
 * gives a STABLE reference across unrelated re-renders — most concretely, the user typing
 * in the add-name field while the 'add' overlay is open, but also e.g. AuthContext's
 * trial-timer tick. paymentTarget's identity only changes when setPaymentTarget is actually
 * called (the editor opening/closing), never as a side effect of some other state changing.
 * PaymentEditorContent's re-seed effect keys on [visible, player] (PaymentEditorModal.tsx),
 * so a fresh object literal minted on every render would re-fire that effect and wipe
 * whatever the user is mid-typing into the payment rows.
 */
export function usePaymentEditorTarget(
  paymentTarget: PaymentTarget,
  addName: string,
  addPayment: PaymentCarrier | undefined,
): Player | null {
  return useMemo(() => {
    if (!paymentTarget) return null;
    if (paymentTarget.kind === 'edit') {
      const p = paymentTarget.player;
      // p carries methods/defaultMethod directly (preferredPayment is a derived-only field,
      // always undefined in memory) — pass them straight through so the editor opens seeded
      // with the player's FULL method set, not just the resolved default.
      return { id: p.name, name: p.name, methods: p.methods, defaultMethod: p.defaultMethod };
    }
    // kind === 'add' — snapshot the add form's payment-so-far at open time.
    return { id: 'add', name: addName || 'Player', methods: addPayment?.methods, defaultMethod: addPayment?.defaultMethod };
    // addName/addPayment intentionally omitted: capture at open time only. Widening this
    // array reintroduces the mid-typing wipe bug described above — the reference-stability
    // test in __tests__/saved-players-payment-editor.test.tsx imports THIS hook and WILL
    // fail if you do this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentTarget]);
}

// SavedPlayer no longer carries preferredPayment in memory (it's derived only at the
// storage/Firestore serialize boundary — see savedPlayersService.ts) — read the resolved
// default through resolvePayment instead of the field directly.
function badgeText(p: SavedPlayer): string | null {
  const legacy = resolvePayment(p);
  if (!legacy) return null;
  const { method, handle } = legacy;
  const label = getPaymentMethodMeta(method).label;
  return handle ? `${label} · ${formatHandleForDisplay(method, handle)}` : label;
}

const  BULK_PAYWALL_MESSAGE = 'Upgrade to Pro to bulk-manage your saved players.';

export default function SavedPlayersScreen() {
  const { user, isPro } = useAuth();
  const uid = user?.uid ?? null;
  const cap = savedCapFor(isPro);
  const reduceMotion = useReduceMotion();

  const [players, setPlayers] = useState<SavedPlayer[]>([]);
  const reload = useCallback(() => {
    if (!uid) return;
    loadSavedPlayers(uid, setPlayers)
      .then(setPlayers)
      .catch(() => Alert.alert('Error', 'Could not load saved players.'));
  }, [uid]);
  // Reload on every focus (not just mount) so a saved player created elsewhere — e.g. the
  // active-game add-player flow (active.tsx) writing to the same uid-scoped store — shows up
  // when the user switches back to this already-mounted screen. `reload` is memoized on
  // [uid], so this runs on first focus and again on each refocus. (bug: stale list until
  // backing out and re-entering.)
  useFocusEffect(reload);

  const listData = useMemo(() => buildSavedPlayersListData(players), [players]);

  const [paymentTarget, setPaymentTarget] = useState<PaymentTarget>(null);
  const [renameTarget, setRenameTarget] = useState<SavedPlayer | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedPlayer | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPayment, setAddPayment] = useState<PaymentCarrier | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  // Separate guard for doCreate, reentered internally (e.g. rapid double-submit of handleAdd).
  const creatingRef = useRef(false);

  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallMessage, setPaywallMessage] = useState(BULK_PAYWALL_MESSAGE);
  // Bulk delete is the only action select mode offers. A free user stranded over
  // the cap after a downgrade needs it to get back under — gating it behind the
  // paywall that the over-cap state itself triggers is a dead end.
  const requirePro = useCallback(
    (action: () => void) => {
      if (isPro || players.length > cap) action();
      else {
        setPaywallMessage(BULK_PAYWALL_MESSAGE);
        setShowPaywall(true);
      }
    },
    [isPro, players.length, cap],
  );

  const toggleSelected = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);
  const handleBulkDelete = useCallback(() => {
    if (!uid) return;
    const ids = players.filter(p => selected.has(p.id)).map(p => p.id);
    if (ids.length === 0) {
      exitSelectMode();
      return;
    }
    deleteSavedPlayersByIds(uid, ids)
      .then(() => {
        exitSelectMode();
        reload();
      })
      .catch(() => {
        exitSelectMode();
        Alert.alert('Error', 'Could not delete the selected players.');
      });
  }, [uid, players, selected, exitSelectMode, reload]);

  const openRename = useCallback((p: SavedPlayer) => {
    setRenameTarget(p);
    setRenameName(p.name);
  }, []);

  const handleRename = useCallback(async () => {
    if (renaming) return;
    if (!uid || !renameTarget) return;
    const trimmed = renameName.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Player name cannot be empty.');
      return;
    }
    if (trimmed === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    setRenaming(true);
    try {
      const res = await renameSavedPlayer(uid, renameTarget.id, trimmed);
      if (!res.ok) {
        if (res.reason === 'duplicate') {
          Alert.alert(
            'Name already used',
            `You already have a saved player named "${trimmed}". Add a last initial (e.g. "${trimmed} R") so you can tell them apart.`,
          );
        } else {
          Alert.alert('Error', 'Could not rename this player.');
        }
        return; // keep the rename modal open so the user can edit the name
      }
      setRenameTarget(null);
      reload();
    } finally {
      setRenaming(false);
    }
  }, [uid, renameTarget, renameName, renaming, reload]);

  const handleConfirmDelete = useCallback(() => {
    if (!uid || !deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    deleteSavedPlayerById(uid, id)
      .then(reload)
      .catch(() => Alert.alert('Error', 'Could not delete this player.'));
  }, [uid, deleteTarget, reload]);

  const openAdd = useCallback(() => {
    setAddName('');
    setAddPayment(undefined);
    setPaymentTarget(null);
    setShowAdd(true);
  }, []);
  const handleAddPress = useCallback(() => {
    if (canAddMoreSavedPlayers(players.length, isPro)) {
      openAdd();
    } else if (isPro) {
      Alert.alert('Saved Players Full', savedCapPaywallMessage(players.length, isPro));
    } else {
      setPaywallMessage(savedCapPaywallMessage(players.length, isPro));
      setShowPaywall(true);
    }
  }, [players.length, isPro, openAdd]);
  // Create a distinct-named saved player. Uses savePlayer's deterministic legacy:<name> id so a
  // same-name entry that exists only remotely (other device / pre-sync) reconciles by id on the
  // next merge instead of duplicating. handleAdd guarantees the name is not already used locally.
  const doCreate = useCallback(
    async (name: string, payment?: PaymentCarrier) => {
      if (!uid) return;
      if (creatingRef.current) return;
      creatingRef.current = true;
      setAdding(true);
      try {
        if (!canAddMoreSavedPlayers(players.length, isPro)) {
          Alert.alert('Saved Players Full', savedCapPaywallMessage(players.length, isPro));
          setShowAdd(false);
          return;
        }
        // savePlayer's merge is `payment?.methods ?? existing?.methods`, which would
        // silently restore a stale map if `payment` were a cleared carrier (`{}`, no
        // `methods` key) AND an `existing` same-name entry were found. Neither can happen
        // here: handleAdd already rejected any name that matches an existing saved player
        // before calling doCreate, so `existing` inside savePlayer is always undefined —
        // there is nothing for the fallback to (wrongly) restore. No paymentWriteBackPatch
        // needed at this call site.
        await savePlayer(uid, name, payment, cap);
        setShowAdd(false);
        reload();
      } catch {
        setShowAdd(false);
        Alert.alert('Error', 'Could not add player. Please try again.');
      } finally {
        setAdding(false);
        creatingRef.current = false;
      }
    },
    [uid, cap, players.length, isPro, reload],
  );

  const handleAdd = useCallback(async () => {
    if (addingRef.current) return;
    addingRef.current = true;
    try {
      const name = addName.trim();
      if (!name) {
        setShowAdd(false);
        return;
      }
      if (!uid) return;
      const existing = await getSavedPlayersByName(uid, name);
      if (existing.length > 0) {
        // Saved names must stay distinct so the picker is never ambiguous. Ask for a distinct
        // name (keep the modal open so the user can edit) instead of creating a same-name twin.
        Alert.alert(
          'Name already used',
          `You already have a saved player named "${name}". Add a last initial (e.g. "${name} R") so you can tell them apart.`,
        );
        return;
      }
      await doCreate(name, addPayment);
    } finally {
      addingRef.current = false;
    }
  }, [uid, addName, addPayment, doCreate]);

  // See usePaymentEditorTarget above the component for the full rationale (reference
  // stability across unrelated re-renders, e.g. the add-name field, while the overlay is
  // open) and the test that exercises this exact hook.
  const paymentPlayer: Player | null = usePaymentEditorTarget(paymentTarget, addName, addPayment);
  const handlePaymentSave = useCallback(
    (payment: PaymentCarrier) => {
      if (!paymentTarget) return;
      if (paymentTarget.kind === 'edit') {
        // updateSavedPlayer's whole-map-replace treats an ABSENT `methods` key as "don't
        // touch payment" (its own recency-bump convention, updateSavedPlayer(uid, sid, {})).
        // A bare {} (no `methods` key) is what a fully-cleared editor result looks like too,
        // but applyPaymentInvariant only produces it when the target had NO resolvable
        // default to begin with — and the editor's defaultMethod is sticky (setHandle only
        // auto-assigns a default when none is set yet; the default-dot can move it but never
        // unset it), so a target seeded with an existing default can never clear back down to
        // a bare {} in one editing session. That means wrapping with paymentWriteBackPatch is
        // a NO-OP on every path actually reachable from this screen: whenever payment is {},
        // this same saved player's own stored entry had no payment either, so there is
        // nothing to lose either way. It is kept here only for consistency with active.tsx's
        // handleSavePayment write-back, which needs the wrap for a real reason (there, the
        // editor's target and the write-back's target are genuinely different objects — a
        // live game player vs. its separately-looked-up bound saved player — so they CAN
        // diverge). Note the trade-off this carries over unwrapped: in the narrow case where
        // a background sync lands a DIFFERENT device's payment for this same id while the
        // editor sits open and empty, the wrap means Save silently overwrites that incoming
        // payment with {} even though the user cleared nothing — unwrapped, prev.methods
        // would have survived. Kept anyway for idiom consistency, not because it is a fix.
        if (uid) updateSavedPlayer(uid, paymentTarget.player.id, paymentWriteBackPatch(payment)).then(() => {
          setPaymentTarget(null);
          reload();
        });
      } else {
        setAddPayment(payment);
        setPaymentTarget(null);
      }
    },
    [uid, paymentTarget, reload],
  );

  const counterText = savedCapCounter(players.length, isPro);
  // "+ Payment" button label — shows only the resolved default method (matches badgeText's
  // single-line style below); a full multi-method summary is Task 8's concern.
  const addPaymentResolved = resolvePayment(addPayment);

  // selectMode / selected are deliberately NOT in the item objects: putting them there
  // would rebuild the entire data array on every checkbox tap. Keeping them out gives the
  // list a stable `data` identity and stable keys, so a tap never unmounts/remounts cells
  // or resets the scroll offset. It does NOT buy per-cell render skipping — CellRenderer
  // is a PureComponent but FlatList's `strictMode` defaults to false, so a fresh
  // `renderProp` is minted every render and every mounted cell re-renders regardless.
  // They are read here instead and published to the cells via `extraData`.
  const keyExtractor = useCallback((item: SavedPlayersListItem<SavedPlayer>) => item.key, []);

  const selectExtra = useMemo(() => ({ selectMode, selected }), [selectMode, selected]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SavedPlayersListItem<SavedPlayer>>) => {
      if (item.type === 'empty') {
        return (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={40} color="#3A3A3A" />
            <Text style={styles.emptyText}>No saved players yet</Text>
            <Text style={styles.emptySub}>Players you add to games are saved here for quick reuse.</Text>
          </View>
        );
      }

      const p = item.player;

      if (selectMode) {
        const isSel = selected.has(p.id);
        const badge = badgeText(p);
        return (
          <TouchableOpacity style={styles.row} onPress={() => toggleSelected(p.id)} activeOpacity={0.7}>
            <Ionicons
              name={isSel ? 'checkbox' : 'square-outline'}
              size={22}
              color={isSel ? '#B072BB' : '#666'}
              style={styles.checkbox}
            />
            <View style={styles.rowTextWrap}>
              <Text style={styles.rowName}>{p.name}</Text>
              {badge ? (
                <Text style={styles.rowBadge} numberOfLines={1}>{badge}</Text>
              ) : (
                <Text style={styles.rowBadgeMuted}>No payment set</Text>
              )}
            </View>
          </TouchableOpacity>
        );
      }

      return (
        <SavedPlayerCard
          player={p}
          onRename={openRename}
          onEditPayment={pl => setPaymentTarget({ kind: 'edit', player: pl })}
          onDelete={pl => setDeleteTarget(pl)}
          reduceMotion={reduceMotion}
        />
      );
    },
    [selectMode, selected, toggleSelected, openRename, reduceMotion],
  );

  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.topSide}>
          {selectMode ? (
            <TouchableOpacity onPress={exitSelectMode}>
              <Text style={styles.topAction}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => requirePro(() => setSelectMode(true))}>
              <Text style={styles.topAction}>Select</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.title}>Saved Players</Text>
        <View style={[styles.topSide, styles.topSideRight]}>
          {!selectMode && (
            <TouchableOpacity
              onPress={handleAddPress}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="add" size={26} color="#B072BB" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!isPro && !canAddMoreSavedPlayers(players.length, isPro) ? (
        <TouchableOpacity
          onPress={() => {
            setPaywallMessage(savedCapPaywallMessage(players.length, isPro));
            setShowPaywall(true);
          }}
        >
          <Text style={[styles.capCounter, styles.capCounterFull]}>{counterText}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.capCounter}>{counterText}</Text>
      )}

      <FlatList
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={selectExtra}
        contentContainerStyle={styles.scrollContent}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={5}
        /* SavedPlayerCard wraps a Reanimated Swipeable, which misbehaves under Android's
           default removeClippedSubviews={true}. index.tsx:211 does the same for GameCard.
           This forgoes some native-view detach savings and keeps all the JS mount savings. */
        removeClippedSubviews={false}
      />

      {selectMode && (
        <View style={styles.bulkBar}>
          <ModalButton
            variant="destructive"
            title={`Delete (${selected.size})`}
            onPress={() => setShowBulkDeleteConfirm(true)}
            disabled={selected.size === 0}
            fullWidth
          />
        </View>
      )}

      <AppModal
        visible={showAdd}
        title="Add player"
        onClose={() => setShowAdd(false)}
        overlay={
          <>
            {/* Payment editor rendered IN PLACE (not a second <Modal>) — iOS presents one modal at a time. */}
            {paymentTarget?.kind === 'add' && (
              <PaymentEditorContent
                player={paymentPlayer}
                onSave={handlePaymentSave}
                onClose={() => setPaymentTarget(null)}
              />
            )}
          </>
        }
      >
        <View style={styles.addRow}>
          <TextInput
            style={styles.addRowInput}
            value={addName}
            onChangeText={setAddName}
            placeholder="Name"
            placeholderTextColor="rgba(255,255,255,0.3)"
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />
          <TouchableOpacity
            style={styles.rowPayBtn}
            onPress={() => setPaymentTarget({ kind: 'add' })}
          >
            <Text style={styles.rowPayText} numberOfLines={1}>
              {addPaymentResolved ? getPaymentMethodMeta(addPaymentResolved.method).label : '+ Payment'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.modalButtons, styles.addModalButtons]}>
          <ModalButton variant="cancel" title="Cancel" onPress={() => setShowAdd(false)} />
          <ModalButton variant="confirm" title="Add" onPress={handleAdd} disabled={adding} />
        </View>
      </AppModal>

      {/* Edit path (tapping a saved player) has no other modal open, so it uses
          its own native modal. The 'row' path is handled in-place above. */}
      <PaymentEditorModal
        visible={paymentTarget?.kind === 'edit'}
        player={paymentPlayer}
        onSave={handlePaymentSave}
        onClose={() => setPaymentTarget(null)}
      />

      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        triggerMessage={paywallMessage}
      />

      <AppModal
        visible={renameTarget !== null}
        title="Rename Player"
        onClose={() => setRenameTarget(null)}
      >
        <TextInput
          style={styles.renameInput}
          value={renameName}
          onChangeText={setRenameName}
          placeholder="New name"
          placeholderTextColor="rgba(255,255,255,0.3)"
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleRename}
        />
        <View style={styles.modalButtons}>
          <ModalButton variant="cancel" title="Cancel" onPress={() => setRenameTarget(null)} />
          <ModalButton variant="confirm" title="Save" onPress={handleRename} disabled={renaming} />
        </View>
      </AppModal>

      <AppModal
        visible={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        dismissOnBackdrop={false}
        contentStyle={appModalStyles.centeredContent}
      >
        <Ionicons name="warning" size={48} color="#C04657" style={styles.warningIcon} />
        <Text style={appModalStyles.title}>Delete Player?</Text>
        <Text style={styles.deleteWarningText}>
          This will remove {deleteTarget?.name} from your saved players.
          {'\n\n'}This action cannot be undone.
        </Text>
        <View style={styles.modalButtons}>
          <ModalButton variant="cancel" title="Cancel" onPress={() => setDeleteTarget(null)} />
          <ModalButton variant="destructive" title="Delete" onPress={handleConfirmDelete} />
        </View>
      </AppModal>

      <AppModal
        visible={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        dismissOnBackdrop={false}
        contentStyle={appModalStyles.centeredContent}
      >
        <Ionicons name="warning" size={48} color="#C04657" style={styles.warningIcon} />
        <Text style={appModalStyles.title}>
          Delete {selected.size} saved {selected.size === 1 ? 'player' : 'players'}?
        </Text>
        <Text style={styles.deleteWarningText}>
          This action cannot be undone.
        </Text>
        <View style={styles.modalButtons}>
          <ModalButton
            variant="cancel"
            title="Cancel"
            onPress={() => setShowBulkDeleteConfirm(false)}
          />
          <ModalButton
            variant="destructive"
            title="Delete"
            onPress={() => {
              setShowBulkDeleteConfirm(false);
              handleBulkDelete();
            }}
          />
        </View>
      </AppModal>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  topSide: { width: 70, alignItems: 'flex-start' },
  topSideRight: { alignItems: 'flex-end' },
  topAction: { fontSize: 15, color: '#B072BB', fontWeight: '600' },
  title: { fontSize: 18, fontWeight: 'bold', color: '#FFFFFF', letterSpacing: 1 },
  capCounter: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    fontFamily: 'SpaceMono',
    letterSpacing: 1,
    paddingBottom: 4,
  },
  capCounterFull: { color: '#B072BB' },
  scrollContent: { padding: 20, paddingTop: 8, paddingBottom: 40, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#242424',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  checkbox: { marginRight: 2 },
  rowTextWrap: { flex: 1, gap: 3 },
  rowName: { fontSize: 16, color: '#FFFFFF', fontWeight: '600' },
  rowBadge: { fontSize: 12, color: 'rgba(176,114,187,0.9)', fontFamily: 'SpaceMono' },
  rowBadgeMuted: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },
  empty: { alignItems: 'center', paddingVertical: 64, gap: 10 },
  emptyText: { fontSize: 16, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  emptySub: { fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center', paddingHorizontal: 24 },
  bulkBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    backgroundColor: '#0A0A0A',
  },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 10, alignItems: 'stretch' },
  addRowInput: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.3)',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#FFFFFF',
  },
  rowPayBtn: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.3)',
    borderRadius: 10,
    minWidth: 96,
    alignItems: 'center',
  },
  rowPayText: { fontSize: 12, color: 'rgba(176,114,187,0.9)' },
  modalButtons: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  addModalButtons: { marginTop: 16 },
  renameInput: {
    width: '100%',
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.3)',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#FFFFFF',
    marginBottom: 16,
  },
  warningIcon: { alignSelf: 'center', marginBottom: 12 },
  deleteWarningText: {
    fontSize: 15,
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
    opacity: 0.8,
  },
});
