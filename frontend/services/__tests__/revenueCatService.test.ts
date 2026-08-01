// The service captures its API keys into module-level constants at load time,
// so the env vars must exist BEFORE the module is first required. A top-level
// `import` cannot satisfy that: babel hoists the require above these
// assignments. Each test therefore resets the module registry and re-requires
// the service (see beforeEach) so the constants are re-captured.
//
// Both platform keys are set deliberately. `isConfigured()` picks its key via
// `Platform.OS === 'ios' ? IOS_API_KEY : ANDROID_API_KEY`, and under the
// `jest-expo/node` preset babel aliases `react-native` to `react-native-web`,
// so Platform.OS is 'web' — the Android branch. Setting both keys keeps these
// tests correct regardless of which branch the preset takes.
process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY = 'appl_test_key';
process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY = 'goog_test_key';

// Mock react-native-purchases. The factory re-runs after every module registry
// reset, so each test gets fresh jest.fn()s.
jest.mock('react-native-purchases', () => {
  const mock = {
    configure: jest.fn(),
    setLogLevel: jest.fn(),
    logIn: jest.fn().mockResolvedValue(undefined),
    logOut: jest.fn().mockResolvedValue(undefined),
    isAnonymous: jest.fn().mockResolvedValue(false),
    getCustomerInfo: jest.fn(),
    getOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
  };
  return {
    __esModule: true,
    default: mock,
    LOG_LEVEL: { DEBUG: 'DEBUG' },
  };
});

let logoutPurchases: () => Promise<void>;
let Purchases: { logOut: jest.Mock; isAnonymous: jest.Mock };

beforeEach(() => {
  // Load-bearing: the reset re-runs the mock factory, which is what gives each
  // test fresh jest.fn()s (there is no clearAllMocks here). Do NOT hoist these
  // requires out of beforeEach — the mocks would then be shared and call counts
  // would leak between tests.
  jest.resetModules();
  // Both must come from the same fresh registry, or the service would hold a
  // different mock instance than the one asserted against.
  Purchases = require('react-native-purchases').default;
  ({ logoutPurchases } = require('../revenueCatService'));
});

// ---------------------------------------------------------------------------
// logoutPurchases
// ---------------------------------------------------------------------------

describe('logoutPurchases', () => {
  it('reaches the SDK (the isConfigured guard is not short-circuiting)', async () => {
    // Guards the rest of the file: if isConfigured() ever returns false again,
    // the "does NOT call" assertions below pass vacuously. Fail loudly instead.
    await logoutPurchases();

    expect(Purchases.isAnonymous).toHaveBeenCalled();
  });

  it('does NOT call Purchases.logOut() when user is anonymous', async () => {
    Purchases.isAnonymous.mockResolvedValue(true);

    await logoutPurchases();

    expect(Purchases.isAnonymous).toHaveBeenCalled();
    expect(Purchases.logOut).not.toHaveBeenCalled();
  });

  it('calls Purchases.logOut() when user is NOT anonymous', async () => {
    Purchases.isAnonymous.mockResolvedValue(false);

    await logoutPurchases();

    expect(Purchases.isAnonymous).toHaveBeenCalled();
    expect(Purchases.logOut).toHaveBeenCalled();
  });

  it('suppresses errors from Purchases.isAnonymous()', async () => {
    Purchases.isAnonymous.mockRejectedValue(new Error('SDK not initialized'));

    // Should not throw
    await expect(logoutPurchases()).resolves.toBeUndefined();
    expect(Purchases.isAnonymous).toHaveBeenCalled();
    expect(Purchases.logOut).not.toHaveBeenCalled();
  });

  it('suppresses errors from Purchases.logOut()', async () => {
    Purchases.isAnonymous.mockResolvedValue(false);
    Purchases.logOut.mockRejectedValue(new Error('logOut failed'));

    // Should not throw
    await expect(logoutPurchases()).resolves.toBeUndefined();
    expect(Purchases.logOut).toHaveBeenCalled();
  });
});
