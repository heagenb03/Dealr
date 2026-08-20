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

  it('does NOT let hydrate clobber an id set this session', async () => {
    // A cold start racing a deep link: the link arrives and sets OTHER while the
    // launch-time hydrate of a stale ID is still in flight. The fresher intent wins.
    await AsyncStorage.setItem(PENDING_SHARE_KEY, ID);
    setPendingShare(OTHER);
    await hydratePendingShare();
    expect(consumePendingShare()).toBe(OTHER);
  });

  it('ignores a malformed stored value', async () => {
    await AsyncStorage.setItem(PENDING_SHARE_KEY, 'garbage');
    await hydratePendingShare();
    expect(consumePendingShare()).toBeNull();
  });

  it('survives an AsyncStorage read failure', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('boom'));
    await expect(hydratePendingShare()).resolves.toBeUndefined();
    expect(consumePendingShare()).toBeNull();
    spy.mockRestore();
  });
});
