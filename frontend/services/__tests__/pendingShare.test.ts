import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PENDING_SHARE_KEY,
  setPendingShare,
  consumePendingShare,
  hydratePendingShare,
  clearPendingShare,
  __resetPendingShareForTests,
} from '@/services/pendingShare';

const ID = 'aB3dEfGh1JkLmN0pQrSt';
const OTHER = 'zZ9yYxXwWvVuUtTsSrRq';

beforeEach(async () => {
  __resetPendingShareForTests();
  await AsyncStorage.clear();
});

describe('consume-once semantics', () => {
  it('returns null when nothing is pending', () => {
    expect(consumePendingShare()).toBeNull();
  });

  it('returns the id ONCE and null thereafter', () => {
    // The redirect effect in _layout.tsx re-fires on every segments change. If
    // consume did not clear, every subsequent navigation would bounce the user
    // back to the shared game and they could never reach the tabs.
    setPendingShare(ID);
    expect(consumePendingShare()).toBe(ID);
    expect(consumePendingShare()).toBeNull();
    expect(consumePendingShare()).toBeNull();
  });

  it('returns a plain value synchronously, not a Promise (would break if consumePendingShare were ever made async)', () => {
    // The preceding test already checks the correct VALUE comes back. This one
    // checks the SHAPE of what comes back, immediately, with no await anywhere
    // in the test. An async implementation returns a pending Promise object at
    // this point in the microtask queue — typeof would read 'object', and
    // instanceof Promise would read true — so this fails discriminately if the
    // sync contract is ever violated, independent of what the eventual
    // resolved value would have been.
    setPendingShare(ID);
    const result: unknown = consumePendingShare();
    expect(result instanceof Promise).toBe(false);
    expect(typeof result).toBe('string');
    expect(result).toBe(ID);
  });

  it('lets a later set replace an earlier unconsumed one', () => {
    setPendingShare(ID);
    setPendingShare(OTHER);
    expect(consumePendingShare()).toBe(OTHER);
  });

  it('ignores a malformed id', () => {
    setPendingShare('not-a-share-id');
    expect(consumePendingShare()).toBeNull();
  });
});

describe('clearPendingShare', () => {
  it('drops a pending id without returning it', () => {
    setPendingShare(ID);
    clearPendingShare();
    expect(consumePendingShare()).toBeNull();
  });
});

describe('AsyncStorage mirror', () => {
  it('persists the id so it survives process death', async () => {
    setPendingShare(ID);
    // setPendingShare fires the write without awaiting; let it settle.
    await Promise.resolve();
    expect(await AsyncStorage.getItem(PENDING_SHARE_KEY)).toBe(ID);
  });

  it('hydrates a stored id back into memory on launch', async () => {
    await AsyncStorage.setItem(PENDING_SHARE_KEY, ID);
    await hydratePendingShare();
    expect(consumePendingShare()).toBe(ID);
  });

  it('clears the stored copy when the id is consumed', async () => {
    setPendingShare(ID);
    await Promise.resolve();
    consumePendingShare();
    await Promise.resolve();
    expect(await AsyncStorage.getItem(PENDING_SHARE_KEY)).toBeNull();
  });

  it('skips the read entirely when a link is already pending before hydrate is called', async () => {
    // This pins the FIRST guard in hydratePendingShare (`if (pending !== null)
    // return;`, checked before the AsyncStorage read even starts) — a link that
    // arrived before hydrate was ever invoked must not be touched by hydrate at
    // all. It does NOT exercise the second guard below.
    await AsyncStorage.setItem(PENDING_SHARE_KEY, ID);
    setPendingShare(OTHER);
    await hydratePendingShare();
    expect(consumePendingShare()).toBe(OTHER);
  });

  it('does NOT let a link that arrives WHILE the read is in flight clobber it', async () => {
    // This is the race the module exists to defend against: a cold start racing
    // a deep link. hydratePendingShare is suspended mid-await on the AsyncStorage
    // read, and the link arrives (setPendingShare) before that read resolves —
    // this pins the SECOND guard, the post-await re-check at pendingShare.ts:66.
    // The prior test above only proves the pre-call guard; it cannot reach this
    // one, because pending is already non-null before hydrate's await is ever
    // scheduled.
    //
    // NOTE: we swap AsyncStorage.getItem by direct property assignment and
    // restore it the same way, rather than jest.spyOn(...).mockRestore(). The
    // async-storage-mock's methods are already jest.fn()s internally, and
    // mockRestore() on a spy over an already-mock function does not reinstate
    // the working implementation here — it leaves getItem returning undefined
    // for every subsequent call, silently corrupting any test that runs after
    // it in this file (confirmed empirically). Direct property swap/restore
    // does not touch spy machinery at all, so it does not have this failure
    // mode.
    const originalGetItem = AsyncStorage.getItem;
    let resolveRead!: (value: string | null) => void;
    const deferredRead = new Promise<string | null>((resolve) => {
      resolveRead = resolve;
    });
    (AsyncStorage as { getItem: typeof AsyncStorage.getItem }).getItem = jest.fn(
      () => deferredRead
    );

    const hydrate = hydratePendingShare(); // suspended at `await AsyncStorage.getItem`
    setPendingShare(OTHER); // the link arrives while that read is still in flight
    resolveRead(ID); // the read resolves with the stale stored id
    await hydrate;

    (AsyncStorage as { getItem: typeof AsyncStorage.getItem }).getItem = originalGetItem;

    expect(consumePendingShare()).toBe(OTHER);
  });

  it('ignores a malformed stored value', async () => {
    await AsyncStorage.setItem(PENDING_SHARE_KEY, 'garbage');
    await hydratePendingShare();
    expect(consumePendingShare()).toBeNull();
  });

  it('survives an AsyncStorage read failure', async () => {
    // Same rationale as above: direct property swap/restore instead of
    // jest.spyOn(...).mockRestore(), which corrupts this mock for any test
    // that runs afterward in this file.
    const originalGetItem = AsyncStorage.getItem;
    (AsyncStorage as { getItem: typeof AsyncStorage.getItem }).getItem = jest.fn(() =>
      Promise.reject(new Error('boom'))
    );

    await expect(hydratePendingShare()).resolves.toBeUndefined();

    (AsyncStorage as { getItem: typeof AsyncStorage.getItem }).getItem = originalGetItem;

    expect(consumePendingShare()).toBeNull();
  });
});
