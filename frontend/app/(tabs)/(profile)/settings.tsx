import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text, View } from '@/components/Themed';
import HudSectionHeader from '@/components/HudSectionHeader';
import ModalButton from '@/components/ModalButton';
import PaywallModal from '@/components/PaywallModal';
import AppModal, { appModalStyles } from '@/components/AppModal';
import {
  updateDisplayName,
  updateUserPassword,
  reauthenticateUser,
  callDeleteUserData,
  linkGoogleCredential,
  linkAppleCredential,
} from '@/services/firebaseService';
import { getCustomerManagementURL } from '@/services/revenueCatService';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import CurrencyPickerModal from '@/components/CurrencyPickerModal';
import CashUnitPickerModal from '@/components/CashUnitPickerModal';
import SettlementModeDefaultPicker from '@/components/SettlementModeDefaultPicker';
import TolerancePickerModal from '@/components/TolerancePickerModal';
import { useGameDefaults } from '@/contexts/GameDefaultsContext';
import { resolveCashUnit, EXACT_CASH_UNIT } from '@/constants/CashUnits';
import { resolveTolerance, EXACT_TOLERANCE } from '@/constants/Tolerances';
import { CurrencyCode } from '@/constants/Currencies';
import { SUPPORT_EMAIL } from '@/constants/Links';
import { getTrialLabel } from '@/utils/trialUtils';
import { useOAuthPrompt, isOAuthCancel } from '@/hooks/useOAuthPrompt';

// ---------------------------------------------------------------------------
// Error message helper
// ---------------------------------------------------------------------------

function friendlyFirebaseError(err: any): string {
  const code: string = err?.code ?? '';
  switch (code) {
    case 'auth/requires-recent-login':
      return 'Please sign out and sign back in, then try again.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Password is incorrect.';
    case 'auth/email-already-in-use':
      return 'That email address is already in use.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 8 characters.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/user-not-found':
    case 'auth/user-disabled':
      return 'Account not found or disabled. Please contact support.';
    case 'auth/credential-already-in-use':
    case 'auth/account-exists-with-different-credential':
      return 'That account is already linked to a different Cash Cage account.';
    case 'auth/provider-already-linked':
      return 'That provider is already connected.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

// ---------------------------------------------------------------------------
// Modal state types
// ---------------------------------------------------------------------------

type ActiveModal =
  | 'none'
  | 'editName'
  | 'changePassword'
  | 'signOutConfirm'
  | 'deleteAccountConfirm'
  | 'deleteAccountReauth';

// ---------------------------------------------------------------------------
// Settings Screen
// ---------------------------------------------------------------------------

export default function SettingsScreen() {
  const router = useRouter();
  const { user, userDoc, isPro, isTrialing, trialDaysRemaining, trialExpired, signOut, refreshUserDoc, reloadUser } = useAuth();

  // Derive auth providers from the full list. Reading only `providerData[0]` is
  // unreliable: linking a provider (e.g. Google) appends an entry and Firebase
  // does not guarantee order, so a positional check can hide the Change Password
  // affordance from a linked account whose password credential still works.
  const providerIds = user?.providerData?.map((p) => p.providerId) ?? [];
  const hasPassword = providerIds.includes('password');

  const { promptGoogle, promptApple, googleReady, appleAvailable } = useOAuthPrompt();
  const [linkingProvider, setLinkingProvider] = useState<null | 'google' | 'apple'>(null);

  const handleLinkGoogle = useCallback(async () => {
    if (linkingProvider) return;
    setLinkingProvider('google');
    try {
      const idToken = await promptGoogle();
      await linkGoogleCredential(idToken);
      await reloadUser();
    } catch (err) {
      if (!isOAuthCancel(err)) {
        Alert.alert('Link failed', friendlyFirebaseError(err));
      }
    } finally {
      setLinkingProvider(null);
    }
  }, [linkingProvider, promptGoogle, reloadUser]);

  const handleLinkApple = useCallback(async () => {
    if (linkingProvider) return;
    setLinkingProvider('apple');
    try {
      const { identityToken } = await promptApple();
      await linkAppleCredential(identityToken);
      await reloadUser();
    } catch (err) {
      if (!isOAuthCancel(err)) {
        Alert.alert('Link failed', friendlyFirebaseError(err));
      }
    } finally {
      setLinkingProvider(null);
    }
  }, [linkingProvider, promptApple, reloadUser]);

  const displayName = userDoc?.displayName || user?.displayName || '';
  const email = userDoc?.email || user?.email || '';

  // ---------------------------------------------------------------------------
  // Modal state
  // ---------------------------------------------------------------------------

  const { currency, setCurrency, meta, formatAmount } = useCurrency();
  const { defaultCashUnit, defaultSettlementMode, defaultTolerance, setDefaultCashUnit, setDefaultSettlementMode, setDefaultTolerance } =
    useGameDefaults();
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showRoundingPicker, setShowRoundingPicker] = useState(false);
  const [showModePicker, setShowModePicker] = useState(false);
  const [showTolerancePicker, setShowTolerancePicker] = useState(false);

  const [showPaywall, setShowPaywall] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>('none');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  // Edit name
  const [nameInput, setNameInput] = useState('');

  // Change password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Delete account confirm
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');

  // Delete account reauth
  const [reauthPassword, setReauthPassword] = useState('');

  const openModal = useCallback((modal: ActiveModal) => {
    setModalError('');
    setModalLoading(false);

    // Pre-fill inputs
    if (modal === 'editName') setNameInput(displayName);
    if (modal === 'changePassword') {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
    if (modal === 'deleteAccountConfirm') setDeleteConfirmInput('');
    if (modal === 'deleteAccountReauth') setReauthPassword('');

    setActiveModal(modal);
  }, [displayName]);

  const closeModal = useCallback(() => {
    setActiveModal('none');
    setModalError('');
    setModalLoading(false);
    // Clear all sensitive state so passwords don't linger in memory
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setReauthPassword('');
  }, []);

  // ---------------------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------------------

  const handleSaveName = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setModalError('Display name cannot be empty.');
      return;
    }
    setModalLoading(true);
    setModalError('');
    try {
      await updateDisplayName(trimmed);
      await refreshUserDoc();
      closeModal();
    } catch (err: any) {
      setModalError(friendlyFirebaseError(err));
    } finally {
      setModalLoading(false);
    }
  }, [nameInput, refreshUserDoc, closeModal]);

  const handleChangePassword = useCallback(async () => {
    if (!currentPassword) {
      setModalError('Please enter your current password.');
      return;
    }
    if (!newPassword) {
      setModalError('Please enter a new password.');
      return;
    }
    if (newPassword.length < 8) {
      setModalError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setModalError('New passwords do not match.');
      return;
    }
    setModalLoading(true);
    setModalError('');
    try {
      await reauthenticateUser(email, currentPassword);
      await updateUserPassword(newPassword);
      closeModal();
    } catch (err: any) {
      setModalError(friendlyFirebaseError(err));
    } finally {
      setModalLoading(false);
    }
  }, [currentPassword, newPassword, confirmPassword, email, closeModal]);

  const handleSignOut = useCallback(async () => {
    setModalLoading(true);
    try {
      await signOut();
      // Navigation is handled by _layout.tsx AuthNavigator
    } catch (err: any) {
      setModalError(friendlyFirebaseError(err));
      setModalLoading(false);
    }
  }, [signOut]);

  // handleDeleteAccount must be defined before handleDeleteConfirm and
  // handleDeleteAccountWithReauth so they can include it in their deps.
  const handleDeleteAccount = useCallback(async () => {
    setModalLoading(true);
    setModalError('');
    try {
      // Calls the Cloud Function which recursively deletes Firestore data
      // and then deletes the Firebase Auth user server-side.
      await callDeleteUserData();
      // The Cloud Function deletes the user server-side, but onAuthStateChanged
      // doesn't fire for server-side deletions — the local auth token remains
      // valid until it expires. Sign out locally to clear auth state and trigger
      // the AuthNavigator redirect to login.
      await signOut();
    } catch (err: any) {
      setModalError(friendlyFirebaseError(err));
      setModalLoading(false);
    }
  }, [signOut]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteConfirmInput !== 'DELETE') return;
    closeModal();

    if (hasPassword) {
      // Email accounts require re-authentication before deletion
      openModal('deleteAccountReauth');
    } else {
      // Social sign-in: skip re-auth for Phase 1B
      // NOTE: Re-auth for Google/Apple requires additional implementation (Phase 1C)
      handleDeleteAccount();
    }
  }, [deleteConfirmInput, hasPassword, closeModal, openModal, handleDeleteAccount]);

  const handleDeleteAccountWithReauth = useCallback(async () => {
    if (!reauthPassword) {
      setModalError('Please enter your password.');
      return;
    }
    setModalLoading(true);
    setModalError('');
    try {
      await reauthenticateUser(email, reauthPassword);
      await handleDeleteAccount();
    } catch (err: any) {
      setModalError(friendlyFirebaseError(err));
      setModalLoading(false);
    }
  }, [reauthPassword, email, handleDeleteAccount]);

  const handleHelpPress = useCallback(() => {
    const subject = 'Cash Cage Support Request';
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
    Linking.openURL(mailto).catch((err) => {
      console.error('Failed to open email client:', err);
    });
  }, []);

  const handleAboutPress = useCallback(() => {
    router.push('/(tabs)/(profile)/about' as any);
  }, [router]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const roundingDefaultUnit = resolveCashUnit(defaultCashUnit, currency as CurrencyCode);
  const roundingDefaultLabel =
    roundingDefaultUnit === EXACT_CASH_UNIT ? 'Exact' : formatAmount(roundingDefaultUnit);
  const modeDefaultLabel = defaultSettlementMode === 'banker' ? 'Banker' : 'Direct';
  const resolvedToleranceDefault = resolveTolerance(defaultTolerance, currency as CurrencyCode);
  const toleranceDefaultLabel =
    resolvedToleranceDefault === EXACT_TOLERANCE ? 'Exact' : formatAmount(resolvedToleranceDefault);

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

        {/* Profile section */}
        <View style={styles.section}>
          <HudSectionHeader label="Profile" centered={true} />
          <View style={styles.menuCard}>
            {/* Display Name */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => openModal('editName')}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="person-outline" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>Display Name</Text>
              </View>
              <View style={styles.menuItemRight}>
                <Text style={styles.menuItemValue} numberOfLines={1}>
                  {displayName}
                </Text>
                <Ionicons name="chevron-forward" size={20} color="#666" />
              </View>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            {/* Email (read-only) */}
            <View style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="mail-outline" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>Email</Text>
              </View>
              <View style={styles.menuItemRight}>
                <Text style={styles.menuItemValue} numberOfLines={1}>
                  {email}
                </Text>
              </View>
            </View>

            <View style={styles.menuDivider} />

            {/* Saved Players */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/(tabs)/(profile)/saved-players' as any)}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="people-outline" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>Saved Players</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#666" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Game Defaults section */}
        <View style={styles.section}>
          <HudSectionHeader label="Game Defaults" centered={true} />
          <View style={styles.menuCard}>
            {/* Currency */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => setShowCurrencyPicker(true)}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="cash-outline" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>Currency</Text>
              </View>
              <View style={styles.menuItemRight}>
                <Text style={styles.menuItemValue}>{meta.symbol} {currency}</Text>
                <Ionicons name="chevron-forward" size={20} color="#666" />
              </View>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            {/* Settlement mode */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => setShowModePicker(true)}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="swap-horizontal" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>Settlement Mode</Text>
              </View>
              <View style={styles.menuItemRight}>
                <Text style={styles.menuItemValue}>{modeDefaultLabel}</Text>
                <Ionicons name="chevron-forward" size={20} color="#666" />
              </View>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            {/* Rounding */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => setShowRoundingPicker(true)}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="options-outline" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>Rounding</Text>
              </View>
              <View style={styles.menuItemRight}>
                <Text style={styles.menuItemValue}>{roundingDefaultLabel}</Text>
                <Ionicons name="chevron-forward" size={20} color="#666" />
              </View>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            {/* Tolerance */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => setShowTolerancePicker(true)}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="git-compare-outline" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>Tolerance</Text>
              </View>
              <View style={styles.menuItemRight}>
                <Text style={styles.menuItemValue}>{toleranceDefaultLabel}</Text>
                <Ionicons name="chevron-forward" size={20} color="#666" />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Subscription section */}
        <View style={styles.section}>
          <HudSectionHeader label="Subscription" centered={true} />
          <View style={styles.menuCard}>
            {/* Current Plan */}
            <View style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="layers-outline" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>Current Plan</Text>
              </View>
              <View style={styles.menuItemRight}>
                <Text style={[
                  styles.menuItemValue,
                  isTrialing && styles.menuItemValueTrial,
                  isPro && !isTrialing && styles.menuItemValuePro,
                ]}>
                  {isTrialing ? `Trial \u2014 ${getTrialLabel(trialDaysRemaining)}` : isPro ? 'Pro' : 'Free'}
                </Text>
              </View>
            </View>

            <View style={styles.menuDivider} />

            {isPro && !isTrialing ? (
              /* Manage Subscription — opens RC management URL */
              <TouchableOpacity
                style={styles.menuItem}
                onPress={async () => {
                  const url = await getCustomerManagementURL();
                  Linking.openURL(url).catch(() => {});
                }}
                activeOpacity={0.7}
              >
                <View style={styles.menuItemLeft}>
                  <Ionicons name="card-outline" size={24} color="#B072BB" />
                  <Text style={styles.menuItemLabel}>Manage Subscription</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#666" />
              </TouchableOpacity>
            ) : (
              /* Upgrade to Pro — opens RevenueCat paywall */
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => setShowPaywall(true)}
                activeOpacity={0.7}
              >
                <View style={styles.menuItemLeft}>
                  <Ionicons name="star-outline" size={24} color="#B072BB" />
                  <Text style={[styles.menuItemLabel, styles.menuItemLabelPurple]}>
                    {isTrialing ? 'Upgrade Now' : 'Upgrade to Pro'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#B072BB" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Account section */}
        <View style={styles.section}>
          <HudSectionHeader label="Account" centered={true} />
          <View style={styles.menuCard}>

            {/* Sign-in methods */}
            <View style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="mail-outline" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>Email &amp; Password</Text>
              </View>
              <View style={styles.menuItemRight}>
                <Text style={styles.menuItemValue}>{hasPassword ? 'Connected' : 'Not connected'}</Text>
              </View>
            </View>

            <View style={styles.menuDivider} />

            {/* Google */}
            <View style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="logo-google" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>Google</Text>
              </View>
              <View style={styles.menuItemRight}>
                {providerIds.includes('google.com') ? (
                  <Text style={[styles.menuItemValue, styles.providerConnected]}>Connected</Text>
                ) : linkingProvider === 'google' ? (
                  <ActivityIndicator size="small" color="#B072BB" />
                ) : (
                  <TouchableOpacity
                    onPress={handleLinkGoogle}
                    disabled={!googleReady || !!linkingProvider}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.menuItemValue, styles.menuItemLabelPurple]}>Connect</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Apple — link only on iOS; on other platforms show the row only if already connected */}
            {(appleAvailable || providerIds.includes('apple.com')) && (
              <>
                <View style={styles.menuDivider} />
                <View style={styles.menuItem}>
                  <View style={styles.menuItemLeft}>
                    <Ionicons name="logo-apple" size={24} color="#B072BB" />
                    <Text style={styles.menuItemLabel}>Apple</Text>
                  </View>
                  <View style={styles.menuItemRight}>
                    {providerIds.includes('apple.com') ? (
                      <Text style={[styles.menuItemValue, styles.providerConnected]}>Connected</Text>
                    ) : linkingProvider === 'apple' ? (
                      <ActivityIndicator size="small" color="#B072BB" />
                    ) : (
                      <TouchableOpacity
                        onPress={handleLinkApple}
                        disabled={!!linkingProvider}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.menuItemValue, styles.menuItemLabelPurple]}>Connect</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </>
            )}

            <View style={styles.menuDivider} />

            {/* Change Password — shown whenever a password credential exists,
                including linked accounts (email/password + Google/Apple). */}
            {hasPassword && (
              <>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => openModal('changePassword')}
                  activeOpacity={0.7}
                >
                  <View style={styles.menuItemLeft}>
                    <Ionicons name="lock-closed-outline" size={24} color="#B072BB" />
                    <Text style={styles.menuItemLabel}>Change Password</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#666" />
                </TouchableOpacity>
              </>
            )}

            {hasPassword && <View style={styles.menuDivider} />}

            {/* Sign Out */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => openModal('signOutConfirm')}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="log-out-outline" size={24} color="#C04657" />
                <Text style={[styles.menuItemLabel, styles.menuItemLabelDanger]}>Sign Out</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#666" />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            {/* Delete Account */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => openModal('deleteAccountConfirm')}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="trash-outline" size={24} color="#C04657" />
                <Text style={[styles.menuItemLabel, styles.menuItemLabelDanger]}>
                  Delete Account
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#666" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Other section */}
        <View style={styles.section}>
          <HudSectionHeader label="Other" centered={true} />
          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/how-it-works' as any)}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="book-outline" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>How It Works</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#666" />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleHelpPress}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="help-circle-outline" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>Help</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#666" />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleAboutPress}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="information-circle-outline" size={24} color="#B072BB" />
                <Text style={styles.menuItemLabel}>About</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#666" />
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>

      {/* ------------------------------------------------------------------- */}
      {/* Modal: Edit Display Name                                             */}
      {/* ------------------------------------------------------------------- */}
      <AppModal visible={activeModal === 'editName'} onClose={closeModal}>
        <Ionicons name="person-outline" size={32} color="#B072BB" style={styles.modalIcon} />
        <Text style={appModalStyles.title}>Display Name</Text>
        <Text style={styles.modalSubtitle}>Enter your new display name.</Text>

        <TextInput
          style={styles.textInput}
          value={nameInput}
          onChangeText={setNameInput}
          placeholder="Display name"
          placeholderTextColor="rgba(255,255,255,0.3)"
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={50}
          editable={!modalLoading}
        />

        {modalError ? (
          <Text style={styles.modalError}>{modalError}</Text>
        ) : null}

        <View style={styles.modalButtons}>
          <ModalButton
            title="Cancel"
            variant="cancel"
            onPress={closeModal}
            disabled={modalLoading}
          />
          <ModalButton
            title={modalLoading ? 'Saving…' : 'Save'}
            variant="confirm"
            onPress={handleSaveName}
            disabled={modalLoading || !nameInput.trim()}
          />
        </View>
      </AppModal>

      {/* ------------------------------------------------------------------- */}
      {/* Modal: Change Password                                               */}
      {/* ------------------------------------------------------------------- */}
      <AppModal visible={activeModal === 'changePassword'} onClose={closeModal}>
        <Ionicons
          name="lock-closed-outline"
          size={32}
          color="#B072BB"
          style={styles.modalIcon}
        />
        <Text style={appModalStyles.title}>Change Password</Text>

        <TextInput
          style={styles.textInput}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          placeholder="Current password"
          placeholderTextColor="rgba(255,255,255,0.3)"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!modalLoading}
        />
        <TextInput
          style={styles.textInput}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="New password"
          placeholderTextColor="rgba(255,255,255,0.3)"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!modalLoading}
        />
        <TextInput
          style={styles.textInput}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Confirm new password"
          placeholderTextColor="rgba(255,255,255,0.3)"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!modalLoading}
        />

        {modalError ? (
          <Text style={styles.modalError}>{modalError}</Text>
        ) : null}

        <View style={styles.modalButtons}>
          <ModalButton
            title="Cancel"
            variant="cancel"
            onPress={closeModal}
            disabled={modalLoading}
          />
          <ModalButton
            title={modalLoading ? 'Saving…' : 'Save'}
            variant="confirm"
            onPress={handleChangePassword}
            disabled={modalLoading || !currentPassword || !newPassword || !confirmPassword}
          />
        </View>
      </AppModal>

      {/* ------------------------------------------------------------------- */}
      {/* Modal: Sign Out Confirmation                                          */}
      {/* ------------------------------------------------------------------- */}
      <AppModal visible={activeModal === 'signOutConfirm'} onClose={closeModal}>
        <Ionicons
          name="log-out-outline"
          size={32}
          color="#C04657"
          style={styles.modalIcon}
        />
        <Text style={appModalStyles.title}>Sign Out</Text>
        <Text style={styles.modalBody}>
          Sign out of {email}?{'\n'}Your games will remain on this device.
        </Text>

        {modalError ? (
          <Text style={styles.modalError}>{modalError}</Text>
        ) : null}

        {modalLoading ? (
          <ActivityIndicator color="#B072BB" style={styles.modalSpinner} />
        ) : (
          <View style={styles.modalButtons}>
            <ModalButton title="Cancel" variant="cancel" onPress={closeModal} />
            <ModalButton
              title="Sign Out"
              variant="destructive"
              onPress={handleSignOut}
            />
          </View>
        )}
      </AppModal>

      {/* ------------------------------------------------------------------- */}
      {/* Modal: Delete Account — Step 1 (Type DELETE confirmation)            */}
      {/* ------------------------------------------------------------------- */}
      <AppModal
        visible={activeModal === 'deleteAccountConfirm'}
        onClose={closeModal}
        dismissOnBackdrop={false}
      >
        <Ionicons
          name="warning-outline"
          size={32}
          color="#C04657"
          style={styles.modalIcon}
        />
        <Text style={appModalStyles.title}>Delete Account</Text>
        <Text style={styles.modalBody}>
          This will permanently delete your account and all associated data. This action cannot be undone.
        </Text>
        <Text style={styles.modalSubtitle}>Type DELETE to confirm.</Text>

        <TextInput
          style={styles.textInput}
          value={deleteConfirmInput}
          onChangeText={setDeleteConfirmInput}
          placeholder="DELETE"
          placeholderTextColor="rgba(255,255,255,0.3)"
          autoCapitalize="characters"
          autoCorrect={false}
        />

        <View style={styles.modalButtons}>
          <ModalButton title="Cancel" variant="cancel" onPress={closeModal} />
          <ModalButton
            title="Continue"
            variant="destructive"
            onPress={handleDeleteConfirm}
            disabled={deleteConfirmInput !== 'DELETE'}
          />
        </View>
      </AppModal>

      {/* ------------------------------------------------------------------- */}
      {/* Modal: Delete Account — Step 2 (Re-authentication for email accounts)*/}
      {/* ------------------------------------------------------------------- */}
      <AppModal
        visible={activeModal === 'deleteAccountReauth'}
        onClose={closeModal}
        dismissOnBackdrop={false}
      >
        <Ionicons
          name="shield-checkmark-outline"
          size={32}
          color="#C04657"
          style={styles.modalIcon}
        />
        <Text style={appModalStyles.title}>Confirm Identity</Text>
        <Text style={styles.modalBody}>
          For your security, please enter your password to continue.
        </Text>

        <TextInput
          style={[styles.textInput, styles.textInputDisabled]}
          value={email}
          editable={false}
          selectTextOnFocus={false}
        />
        <TextInput
          style={styles.textInput}
          value={reauthPassword}
          onChangeText={setReauthPassword}
          placeholder="Password"
          placeholderTextColor="rgba(255,255,255,0.3)"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!modalLoading}
        />

        {modalError ? (
          <Text style={styles.modalError}>{modalError}</Text>
        ) : null}

        {modalLoading ? (
          <ActivityIndicator color="#C04657" style={styles.modalSpinner} />
        ) : (
          <View style={styles.modalButtons}>
            <ModalButton title="Cancel" variant="cancel" onPress={closeModal} />
            <ModalButton
              title="Delete Account"
              variant="destructive"
              onPress={handleDeleteAccountWithReauth}
              disabled={!reauthPassword}
            />
          </View>
        )}
      </AppModal>

      <CurrencyPickerModal
        visible={showCurrencyPicker}
        currentCode={currency}
        onSelect={(code) => setCurrency(code)}
        onClose={() => setShowCurrencyPicker(false)}
      />

      <CashUnitPickerModal
        visible={showRoundingPicker}
        currentUnit={defaultCashUnit}
        currency={currency as CurrencyCode}
        onSelect={(unit) => { setDefaultCashUnit(unit); }}
        onClose={() => setShowRoundingPicker(false)}
      />

      <SettlementModeDefaultPicker
        visible={showModePicker}
        currentMode={defaultSettlementMode ?? 'optimal'}
        onSelect={(mode) => { setDefaultSettlementMode(mode); }}
        onClose={() => setShowModePicker(false)}
      />

      <TolerancePickerModal
        visible={showTolerancePicker}
        currentTolerance={defaultTolerance}
        currency={currency as CurrencyCode}
        onSelect={(tol) => { setDefaultTolerance(tol); }}
        onClose={() => setShowTolerancePicker(false)}
      />

      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        trialExpired={trialExpired}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 28,
    backgroundColor: 'transparent',
  },

  // Menu card
  menuCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.2)',
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: 'transparent',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: 'transparent',
    flex: 1,
  },
  menuItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '50%',
    backgroundColor: 'transparent',
  },
  menuItemLabel: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
    backgroundColor: 'transparent',
  },
  menuItemLabelDanger: {
    color: '#C04657',
  },
  menuItemLabelPurple: {
    color: '#B072BB',
  },
  menuItemValue: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    backgroundColor: 'transparent',
    flexShrink: 1,
  },
  menuItemValuePro: {
    color: '#B072BB',
    fontWeight: '600',
  },
  menuItemValueTrial: {
    color: '#FFB547',
    fontWeight: '600',
  },
  providerConnected: {
    color: '#00D66F',
  },
  menuDivider: {
    height: 1,
    backgroundColor: 'rgba(176,114,187,0.1)',
    marginHorizontal: 20,
  },

  // Modal shared
  modalIcon: {
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginBottom: 16,
    backgroundColor: 'transparent',
  },
  modalBody: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
    backgroundColor: 'transparent',
  },
  modalError: {
    fontSize: 13,
    color: '#C04657',
    textAlign: 'center',
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    backgroundColor: 'transparent',
  },
  modalSpinner: {
    marginTop: 16,
  },

  // Text inputs
  textInput: {
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.3)',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#FFFFFF',
    marginBottom: 12,
  },
  textInputDisabled: {
    color: 'rgba(255,255,255,0.4)',
    borderColor: 'rgba(255,255,255,0.1)',
  },
});
