/**
 * Which Keyboard event names to subscribe to for a given platform.
 *
 * iOS emits keyboardWillShow/keyboardWillHide at the START of the keyboard's own
 * animation. Android NEVER emits the `will` events — a listener bound to them there
 * simply never fires — so it must use the `did` pair. react-native-web likewise emits
 * only the `did` pair.
 *
 * Deliberately separated from useKeyboardVisible and kept pure. jest-expo/node aliases
 * `react-native` to `react-native-web`, so Platform.OS is always 'web' in this test
 * environment and `jest.mock('react-native')` is inert (bug-341). The hook is therefore
 * untestable here; this function is not.
 */
export interface KeyboardEventNames {
  show: 'keyboardWillShow' | 'keyboardDidShow';
  hide: 'keyboardWillHide' | 'keyboardDidHide';
}

export function keyboardEventNames(platformOS: string): KeyboardEventNames {
  return platformOS === 'ios'
    ? { show: 'keyboardWillShow', hide: 'keyboardWillHide' }
    : { show: 'keyboardDidShow', hide: 'keyboardDidHide' };
}
