import { useState, useEffect } from 'react';
import { Keyboard, Platform } from 'react-native';
import { keyboardEventNames } from '@/utils/keyboardEvents';

let cachedValue = false;
let showSub: ReturnType<typeof Keyboard.addListener> | null = null;
let hideSub: ReturnType<typeof Keyboard.addListener> | null = null;
const listeners = new Set<(value: boolean) => void>();

function publish(value: boolean) {
  cachedValue = value;
  listeners.forEach((cb) => cb(value));
}

function subscribe(callback: (value: boolean) => void) {
  listeners.add(callback);

  if (listeners.size === 1) {
    // Event names are platform-dependent and NOT interchangeable — see keyboardEvents.ts.
    const names = keyboardEventNames(Platform.OS);
    showSub = Keyboard.addListener(names.show, () => publish(true));
    hideSub = Keyboard.addListener(names.hide, () => publish(false));
  }

  return () => {
    listeners.delete(callback);

    if (listeners.size === 0) {
      showSub?.remove();
      hideSub?.remove();
      showSub = null;
      hideSub = null;
      // Reset, unlike useReduceMotion, which caches a device setting that stays true.
      // A stale `true` here would open the next Add Players modal at the SHORT height
      // with no keyboard on screen, and nothing would correct it until the next
      // show/hide pair.
      cachedValue = false;
    }
  };
}

/**
 * Whether the software keyboard is currently on screen.
 *
 * Initial value is false, which is correct for the Add Players modal: it opens with the
 * keyboard down (the search field has no autoFocus).
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(cachedValue);

  useEffect(() => {
    return subscribe(setVisible);
  }, []);

  return visible;
}
