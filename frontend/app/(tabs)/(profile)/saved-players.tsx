import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  StyleSheet,
  ScrollView,
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
  FREE_SAVED_CAP,
  PRO_SAVED_CAP,
  SavedPlayer,
} from '@/services/savedPlayersService';
import { PreferredPayment, Player } from '@/types/game';
import { getPaymentMethodMeta } from '@/constants/PaymentMethods';
import { formatHandleForDisplay } from '@/utils/paymentLinks';

type PaymentTarget =
  | { kind: 'edit'; player: SavedPlayer }
  | { kind: 'add' }
  | null;

function badgeText(p: SavedPlayer): string | null {
  if (!p.preferredPayment) return null;
  const { method, handle } = p.preferredPayment;
  const label = getPaymentMethodMeta(method).label;
  return handle ? `${label} · ${formatHandleForDisplay(method, handle)}` : label;
}

const BULK_PAYWALL_MESSAGE = 'Upgrade to Pro to bulk-manage your saved players.';
const CAP_PAYWALL_MESSAGE = `You've saved ${FREE_SAVED_CAP} players — the free limit. Upgrade to Pro to save up to ${PRO_SAVED_CAP}.`;

export default function SavedPlayersScreen() {
  const { user, isPro, trialExpired } = useAuth();
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

  const sorted = [...players].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );

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
  const [addPayment, setAddPayment] = useState<PreferredPayment | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  // Separate guard for doCreate, reentered internally (e.g. rapid double-submit of handleAdd).
  const creatingRef = useRef(false);

  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallMessage, setPaywallMessage] = useState(BULK_PAYWALL_MESSAGE);
  const requirePro = useCallback(
    (action: () => void) => {
      if (isPro) action();
      else {
        setPaywallMessage(BULK_PAYWALL_MESSAGE);
        setShowPaywall(true);
      }
    },
    [isPro],
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
      Alert.alert(
        'Saved Players Full',
        `You've reached the ${PRO_SAVED_CAP}-player limit. Delete some players to add more.`,
      );
    } else {
      setPaywallMessage(CAP_PAYWALL_MESSAGE);
      setShowPaywall(true);
    }
  }, [players.length, isPro, openAdd]);
  // Create a distinct-named saved player. Uses savePlayer's deterministic legacy:<name> id so a
  // same-name entry that exists only remotely (other device / pre-sync) reconciles by id on the
  // next merge instead of duplicating. handleAdd guarantees the name is not already used locally.
  const doCreate = useCallback(
    async (name: string, payment?: PreferredPayment) => {
      if (!uid) return;
      if (creatingRef.current) return;
      creatingRef.current = true;
      setAdding(true);
      try {
        if (!canAddMoreSavedPlayers(players.length, isPro)) {
          Alert.alert('Saved Players Full', `You've reached the ${cap}-player limit.`);
          setShowAdd(false);
          return;
        }
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

  // Shared PaymentEditorModal target → synthetic Player (its player prop is init-only).
  // useMemo keyed on paymentTarget gives a STABLE reference: PaymentEditorModal re-seeds
  // its fields on [visible, player], so a fresh object each render (e.g. from AuthContext's
  // trial-timer re-render) would wipe what the user is typing. The snapshot is captured at
  // open time, which is exactly what a re-seed-on-open editor wants.
  const paymentPlayer: Player | null = useMemo(() => {
    if (!paymentTarget) return null;
    if (paymentTarget.kind === 'edit') {
      const p = paymentTarget.player;
      return { id: p.name, name: p.name, preferredPayment: p.preferredPayment };
    }
    // kind === 'add' — snapshot the add form at open time.
    return { id: 'add', name: addName || 'Player', preferredPayment: addPayment };
    // addName/addPayment intentionally omitted: capture at open time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentTarget]);
  const handlePaymentSave = useCallback(
    (pref: PreferredPayment) => {
      if (!paymentTarget) return;
      if (paymentTarget.kind === 'edit') {
        if (uid) updateSavedPlayer(uid, paymentTarget.player.id, { preferredPayment: pref }).then(() => {
          setPaymentTarget(null);
          reload();
        });
      } else {
        setAddPayment(pref);
        setPaymentTarget(null);
      }
    },
    [uid, paymentTarget, reload],
  );

  const renderRow = (p: SavedPlayer) => {
    const badge = badgeText(p);
    const textBlock = (
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowName}>{p.name}</Text>
        {badge ? (
          <Text style={styles.rowBadge} numberOfLines={1}>{badge}</Text>
        ) : (
          <Text style={styles.rowBadgeMuted}>No payment set</Text>
        )}
      </View>
    );

    if (selectMode) {
      const isSel = selected.has(p.id);
      return (
        <TouchableOpacity key={p.id} style={styles.row} onPress={() => toggleSelected(p.id)} activeOpacity={0.7}>
          <Ionicons
            name={isSel ? 'checkbox' : 'square-outline'}
            size={22}
            color={isSel ? '#B072BB' : '#666'}
            style={styles.checkbox}
          />
          {textBlock}
        </TouchableOpacity>
      );
    }

    return (
      <SavedPlayerCard
        key={p.id}
        player={p}
        onRename={openRename}
        onEditPayment={pl => setPaymentTarget({ kind: 'edit', player: pl })}
        onDelete={pl => setDeleteTarget(pl)}
        reduceMotion={reduceMotion}
      />
    );
  };

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
            setPaywallMessage(CAP_PAYWALL_MESSAGE);
            setShowPaywall(true);
          }}
        >
          <Text style={[styles.capCounter, styles.capCounterFull]}>
            {players.length} / {cap} · Upgrade for {PRO_SAVED_CAP}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.capCounter}>
          {players.length} / {cap} saved
        </Text>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {sorted.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={40} color="#3A3A3A" />
            <Text style={styles.emptyText}>No saved players yet</Text>
            <Text style={styles.emptySub}>Players you add to games are saved here for quick reuse.</Text>
          </View>
        ) : (
          sorted.map(renderRow)
        )}
      </ScrollView>

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
              {addPayment ? getPaymentMethodMeta(addPayment.method).label : '+ Payment'}
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
        trialExpired={trialExpired}
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
