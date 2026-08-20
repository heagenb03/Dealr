import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveAuthRedirect, resolveAuthGateNavigation, __resetAuthGateForTests } from '@/utils/authRedirect';
import { setPendingShare, consumePendingShare, __resetPendingShareForTests } from '@/services/pendingShare';

const ID = 'aB3dEfGh1JkLmN0pQrSt';
const OTHER = 'zZ9yYxXwWvVuUtTsSrRq';

// ---------------------------------------------------------------------------
// resolveAuthRedirect — pure function
// ---------------------------------------------------------------------------

// Baseline: exactly what app/_layout.tsx did before shared links existed.
// These three blocks are REGRESSION PINS. If any of them changes, the auth gate
// changed, and that is a defect regardless of how the share path behaves.
describe('no pending share — behaviour must be byte-identical to before', () => {
  it('sends a signed-out user off an auth screen to login', () => {
    expect(resolveAuthRedirect({ seg0: '(tabs)', hasUser: false, mustVerify: false, pendingShareId: null }))
      .toBe('/(auth)/login');
  });

  it('leaves a signed-out user already on an auth screen alone', () => {
    expect(resolveAuthRedirect({ seg0: '(auth)', hasUser: false, mustVerify: false, pendingShareId: null }))
      .toBeNull();
  });

  it('blocks an unverified user behind the verify screen', () => {
    expect(resolveAuthRedirect({ seg0: '(tabs)', hasUser: true, mustVerify: true, pendingShareId: null }))
      .toBe('/verify-email');
  });

  it('leaves an unverified user already on the verify screen alone', () => {
    expect(resolveAuthRedirect({ seg0: 'verify-email', hasUser: true, mustVerify: true, pendingShareId: null }))
      .toBeNull();
  });

  it('sends a verified user off an auth screen to the tabs', () => {
    expect(resolveAuthRedirect({ seg0: '(auth)', hasUser: true, mustVerify: false, pendingShareId: null }))
      .toBe('/(tabs)');
    expect(resolveAuthRedirect({ seg0: 'verify-email', hasUser: true, mustVerify: false, pendingShareId: null }))
      .toBe('/(tabs)');
  });

  it('leaves a verified user in the app alone', () => {
    expect(resolveAuthRedirect({ seg0: '(tabs)', hasUser: true, mustVerify: false, pendingShareId: null }))
      .toBeNull();
    expect(resolveAuthRedirect({ seg0: 'how-it-works', hasUser: true, mustVerify: false, pendingShareId: null }))
      .toBeNull();
  });
});

describe('with a pending share', () => {
  it('sends a verified user leaving an auth screen to the shared game', () => {
    // THE WHOLE POINT. Without this the third branch replaces the destination
    // with /(tabs) and the install funnel dead-ends on a home screen.
    expect(resolveAuthRedirect({ seg0: '(auth)', hasUser: true, mustVerify: false, pendingShareId: ID }))
      .toBe(`/g/${ID}`);
  });

  it('sends a verified user leaving the verify screen to the shared game', () => {
    expect(resolveAuthRedirect({ seg0: 'verify-email', hasUser: true, mustVerify: false, pendingShareId: ID }))
      .toBe(`/g/${ID}`);
  });

  it('still sends a signed-out user to login first', () => {
    // The stash is consumed on the way OUT of the gate, not on the way in.
    expect(resolveAuthRedirect({ seg0: '(tabs)', hasUser: false, mustVerify: false, pendingShareId: ID }))
      .toBe('/(auth)/login');
  });

  it('still blocks an unverified user behind the verify screen', () => {
    expect(resolveAuthRedirect({ seg0: '(tabs)', hasUser: true, mustVerify: true, pendingShareId: ID }))
      .toBe('/verify-email');
  });

  it('does NOT redirect an unverified user already on the verify screen', () => {
    // Distinguishes "must go to verify-email" from "already there" — without
    // this pin, a resolver that always returns '/verify-email' when mustVerify
    // is true (ignoring onVerifyScreen) would still pass every other test here.
    expect(resolveAuthRedirect({ seg0: 'verify-email', hasUser: true, mustVerify: true, pendingShareId: ID }))
      .toBeNull();
  });

  it('does NOT redirect a user already settled in the app', () => {
    // Only the third branch consults the stash. A pending id must never yank a
    // user out of the tabs mid-session.
    expect(resolveAuthRedirect({ seg0: '(tabs)', hasUser: true, mustVerify: false, pendingShareId: ID }))
      .toBeNull();
  });

  it('does NOT redirect a user already on the shared route', () => {
    expect(resolveAuthRedirect({ seg0: 'g', hasUser: true, mustVerify: false, pendingShareId: ID }))
      .toBeNull();
  });
});

describe('undefined segment (first render, before routing settles)', () => {
  it('treats it as not-an-auth-screen', () => {
    expect(resolveAuthRedirect({ seg0: undefined, hasUser: false, mustVerify: false, pendingShareId: null }))
      .toBe('/(auth)/login');
    expect(resolveAuthRedirect({ seg0: undefined, hasUser: true, mustVerify: false, pendingShareId: null }))
      .toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveAuthGateNavigation — stateful orchestration (hydrate gate + latch)
// ---------------------------------------------------------------------------

describe('resolveAuthGateNavigation', () => {
  beforeEach(async () => {
    __resetAuthGateForTests();
    __resetPendingShareForTests();
    await AsyncStorage.clear();
  });

  describe('hydrate ordering (RULING: the invariant Task 4 half-owns)', () => {
    it('ordering A — auth resolves before hydrate completes: does not strand the id, consumes it once hydrate catches up', () => {
      setPendingShare(ID);

      // isLoading has resolved, but hydratePendingShare() has not finished yet.
      const beforeHydrate = resolveAuthGateNavigation(
        { isLoading: false, hydrated: false, seg0: '(auth)', hasUser: true, mustVerify: false },
        consumePendingShare,
      );
      // Discriminates the hydrate gate: if it were missing, this call would
      // consume immediately and return `/g/${ID}` right here instead of null.
      expect(beforeHydrate).toBeNull();

      // hydrate flips true; the effect re-fires with the same auth state.
      const afterHydrate = resolveAuthGateNavigation(
        { isLoading: false, hydrated: true, seg0: '(auth)', hasUser: true, mustVerify: false },
        consumePendingShare,
      );
      // Proves the id survived untouched through the first call.
      expect(afterHydrate).toBe(`/g/${ID}`);
    });

    it('ordering B — hydrate completes before auth resolves: does not act while isLoading, then consumes correctly', () => {
      setPendingShare(ID);

      // hydratePendingShare() has already landed, but isLoading is still true.
      const beforeAuth = resolveAuthGateNavigation(
        { isLoading: true, hydrated: true, seg0: '(auth)', hasUser: true, mustVerify: false },
        consumePendingShare,
      );
      // Discriminates the isLoading gate the same way as above.
      expect(beforeAuth).toBeNull();

      const afterAuth = resolveAuthGateNavigation(
        { isLoading: false, hydrated: true, seg0: '(auth)', hasUser: true, mustVerify: false },
        consumePendingShare,
      );
      expect(afterAuth).toBe(`/g/${ID}`);
    });
  });

  describe('the post-consume clobber (RULING 2 — the headline bug)', () => {
    it('does not fall back to /(tabs) on a stale re-fire after the share navigation was already issued', () => {
      setPendingShare(ID);

      const first = resolveAuthGateNavigation(
        { isLoading: false, hydrated: true, seg0: '(auth)', hasUser: true, mustVerify: false },
        consumePendingShare,
      );
      expect(first).toBe(`/g/${ID}`);

      // Simulate the re-fire: router.replace('/g/<id>') has not updated
      // `segments` yet, but `user`/`emailVerified` changed (refreshVerification
      // runs during exactly this transition), so the effect fires again with
      // the SAME stale seg0. consumePendingShare is the real module here, not
      // a mock — it genuinely has nothing left because the first call above
      // actually consumed it.
      const second = resolveAuthGateNavigation(
        { isLoading: false, hydrated: true, seg0: '(auth)', hasUser: true, mustVerify: false },
        consumePendingShare,
      );
      expect(second).toBeNull();
      expect(second).not.toBe('/(tabs)');
    });

    it('still routes a genuine verification lapse to /verify-email while the latch is held', () => {
      // The latch must suppress ONLY the '/(tabs)' fallback, not every
      // navigation — otherwise a real auth-state change mid-transition would
      // wedge the user on the gate screen with nowhere to go.
      setPendingShare(ID);
      const issued = resolveAuthGateNavigation(
        { isLoading: false, hydrated: true, seg0: '(auth)', hasUser: true, mustVerify: false },
        consumePendingShare,
      );
      expect(issued).toBe(`/g/${ID}`);

      const lapsed = resolveAuthGateNavigation(
        { isLoading: false, hydrated: true, seg0: '(auth)', hasUser: true, mustVerify: true },
        consumePendingShare,
      );
      expect(lapsed).toBe('/verify-email');
    });

    it('releases the latch once segments catch up, and does not wedge a later share', () => {
      setPendingShare(ID);
      const issued = resolveAuthGateNavigation(
        { isLoading: false, hydrated: true, seg0: '(auth)', hasUser: true, mustVerify: false },
        consumePendingShare,
      );
      expect(issued).toBe(`/g/${ID}`);

      // segments finally reflect the navigation.
      const settled = resolveAuthGateNavigation(
        { isLoading: false, hydrated: true, seg0: 'g', hasUser: true, mustVerify: false },
        consumePendingShare,
      );
      expect(settled).toBeNull();

      // A second share, later in the same app session, must still work — the
      // latch is not a one-shot permanent block.
      setPendingShare(OTHER);
      const again = resolveAuthGateNavigation(
        { isLoading: false, hydrated: true, seg0: '(auth)', hasUser: true, mustVerify: false },
        consumePendingShare,
      );
      expect(again).toBe(`/g/${OTHER}`);
    });
  });

  describe('no pending share — matches resolveAuthRedirect once hydrated', () => {
    it('sends a signed-out user to login', () => {
      expect(
        resolveAuthGateNavigation(
          { isLoading: false, hydrated: true, seg0: '(tabs)', hasUser: false, mustVerify: false },
          consumePendingShare,
        ),
      ).toBe('/(auth)/login');
    });

    it('sends a verified user off an auth screen to the tabs when nothing is pending', () => {
      expect(
        resolveAuthGateNavigation(
          { isLoading: false, hydrated: true, seg0: '(auth)', hasUser: true, mustVerify: false },
          consumePendingShare,
        ),
      ).toBe('/(tabs)');
    });
  });
});
