/**
 * The auth gate's routing decision, as a pure function.
 *
 * Lifted out of app/_layout.tsx so it can be tested exhaustively — it is
 * auth-critical, and every existing branch is pinned by a regression test in
 * utils/__tests__/authRedirect.test.ts. The behaviour with no pending share is
 * byte-identical to what shipped before shared links existed.
 *
 * The addition is ONE line of logic: a verified user leaving the auth or verify
 * screen goes to a pending shared game if one is stashed, instead of
 * unconditionally to the tabs. Without it, a fresh installer who taps a share
 * link is bounced to login, bounced to verify, and then dumped on a home screen
 * with the share silently discarded — the whole install funnel dead-ends.
 *
 * Returns the path to router.replace, or null for "stay put".
 */
export function resolveAuthRedirect(params: {
  seg0: string | undefined;
  hasUser: boolean;
  mustVerify: boolean;
  /** Already consumed by the caller. Null when nothing is stashed. */
  pendingShareId: string | null;
}): string | null {
  const { seg0, hasUser, mustVerify, pendingShareId } = params;

  const inAuthGroup = seg0 === '(auth)';
  const onVerifyScreen = seg0 === 'verify-email';

  if (!hasUser && !inAuthGroup) {
    // Not signed in and not on an auth screen — go to login.
    return '/(auth)/login';
  }

  if (mustVerify && !onVerifyScreen) {
    // Signed in but email not verified — block behind the verify screen.
    return '/verify-email';
  }

  if (hasUser && !mustVerify && (inAuthGroup || onVerifyScreen)) {
    // Verified (or OAuth) but still on an auth/verify screen. This is the ONLY
    // branch that consults the stash: a pending share must never yank a user
    // out of the tabs mid-session.
    return pendingShareId ? `/g/${pendingShareId}` : '/(tabs)';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Gate orchestration — owns the hydrate-ordering guard and the post-consume
// latch. Both are STATE, and deliberately live here rather than in
// app/_layout.tsx, so they are unit-testable without rendering the app tree
// (rendering pulls in a FlatList transitively via the tabs stack, which hangs
// under jest-expo/node — see the "no FlatList" constraint on this task).
// ---------------------------------------------------------------------------

/**
 * True once a navigation to a shared game has been issued and `segments`
 * hasn't yet caught up to reflect it.
 *
 * THE CLOBBER this exists to prevent: `router.replace(...)` does not update
 * `segments` synchronously, and the redirect effect in app/_layout.tsx
 * re-fires on every `segments` change — but its dependency list also includes
 * `user` and `emailVerified`, BOTH of which are mutated by `refreshVerification`
 * during exactly this transition. So the effect can re-fire with `seg0` still
 * looking like the gate ('(auth)' or 'verify-email') even though a share
 * navigation was already issued. `consumePendingShare()` clears on read, so the
 * second call returns null, and resolveAuthRedirect's third branch falls back
 * to '/(tabs)' — silently discarding the share navigation. That is the exact
 * failure this whole feature exists to prevent.
 *
 * Keyed on `segments` alone, not on the auth booleans that wobble during this
 * transition (`hasUser`, `mustVerify`) — those are exactly what's in motion
 * here, so gating release on them reopens the race. The latch also only
 * suppresses the specific '/(tabs)' fallback, never '/(auth)/login' or
 * '/verify-email' — a genuine sign-out or a lapsed verification must still
 * route correctly even while a stale gate re-fire is in flight.
 */
let gateLatched = false;

/**
 * Orchestrates one redirect-effect firing: gates on `hydrated` (see the header
 * on services/pendingShare.ts for the race this prevents — consuming before
 * hydrate lands strands the id in memory forever), consumes the pending share
 * only on the branch that can act on it, and latches against the clobber
 * described above.
 *
 * `consumePendingShareFn` is injected so this stays testable with a fake stash
 * instead of the real AsyncStorage-backed module.
 */
export function resolveAuthGateNavigation(
  params: {
    isLoading: boolean;
    hydrated: boolean;
    seg0: string | undefined;
    hasUser: boolean;
    mustVerify: boolean;
  },
  consumePendingShareFn: () => string | null,
): string | null {
  const { isLoading, hydrated, seg0, hasUser, mustVerify } = params;

  // Gated on `hydrated`, NOT just isLoading. hydratePendingShare is async, and
  // on a cold start after process death these two operations have similar
  // latency and RACE: auth resolves, seg0 is '(auth)' (initialRouteName), so
  // this branch could consume before the AsyncStorage read has landed. By
  // returning before calling consumePendingShareFn at all, the in-memory id
  // (if any) is left untouched — it survives until hydrate flips this to true
  // and the effect re-fires (segments/user/emailVerified are all unchanged by
  // hydration, but `hydrated` itself is a dependency of the caller's effect).
  if (isLoading || !hydrated) return null;

  const onGateScreen = seg0 === '(auth)' || seg0 === 'verify-email';

  // Segments are the only thing this latch tracks. Release it the moment they
  // reflect having left the gate screens, regardless of what the auth booleans
  // are doing in the meantime.
  if (!onGateScreen) {
    gateLatched = false;
  }

  // Only the branch that can act on a stash should ever consume it.
  // consumePendingShareFn clears as it reads, so calling it unconditionally
  // would burn the id on every unrelated segments/auth change.
  const wouldLeaveGate = hasUser && !mustVerify && onGateScreen;
  const pendingShareId = wouldLeaveGate ? consumePendingShareFn() : null;
  const destination = resolveAuthRedirect({ seg0, hasUser, mustVerify, pendingShareId });

  if (gateLatched && onGateScreen && destination === '/(tabs)') {
    // The clobber, caught: a share navigation is already in flight, segments
    // haven't caught up, and this stale re-fire would otherwise overwrite it
    // with the tabs. Stay put and let the in-flight navigation land.
    return null;
  }

  if (pendingShareId && destination === `/g/${pendingShareId}`) {
    gateLatched = true;
  }

  return destination;
}

/** Test-only: drop the latch between cases. */
export function __resetAuthGateForTests(): void {
  gateLatched = false;
}
