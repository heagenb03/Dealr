import { keyboardEventNames } from '@/utils/keyboardEvents';

describe('keyboardEventNames', () => {
  // iOS emits the `will` events at the START of the keyboard's own animation, which is
  // what lets a layout change land underneath the incoming keyboard rather than after it.
  it('uses the will- events on iOS', () => {
    expect(keyboardEventNames('ios')).toEqual({
      show: 'keyboardWillShow',
      hide: 'keyboardWillHide',
    });
  });

  // Android NEVER emits the `will` events. Subscribing to them there yields a hook that
  // silently never fires, so the card would stay at its browse height under the keyboard.
  it('uses the did- events on Android', () => {
    expect(keyboardEventNames('android')).toEqual({
      show: 'keyboardDidShow',
      hide: 'keyboardDidHide',
    });
  });

  // react-native-web emits the did- events only. This is also the value this test
  // environment itself reports, since jest-expo/node aliases react-native to
  // react-native-web (bug-341) — which is precisely why this logic lives in a pure
  // function instead of inside the hook, where it would be untestable.
  it('uses the did- events on web', () => {
    expect(keyboardEventNames('web')).toEqual({
      show: 'keyboardDidShow',
      hide: 'keyboardDidHide',
    });
  });
});
