import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';

interface HelpContextValue {
  /** Register a handler that opens the current screen's help sheet. Returns an unregister fn. */
  registerHelp: (handler: () => void) => () => void;
  /** Invoke the most-recently-registered handler (the focused screen), if any. */
  requestHelp: () => void;
}

const HelpContext = createContext<HelpContextValue | null>(null);

export function HelpProvider({ children }: { children: React.ReactNode }) {
  // Map of id -> handler. Highest id = most recently registered = the focused screen.
  const handlersRef = useRef<Map<number, () => void>>(new Map());
  const nextIdRef = useRef(0);

  const registerHelp = useCallback((handler: () => void) => {
    const id = ++nextIdRef.current;
    handlersRef.current.set(id, handler);
    return () => {
      handlersRef.current.delete(id);
    };
  }, []);

  const requestHelp = useCallback(() => {
    const handlers = handlersRef.current;
    if (handlers.size === 0) return;
    const latest = Math.max(...handlers.keys());
    handlers.get(latest)?.();
  }, []);

  const value = useMemo(() => ({ registerHelp, requestHelp }), [registerHelp, requestHelp]);

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export function useHelp(): HelpContextValue {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error('useHelp must be used within a HelpProvider');
  return ctx;
}
