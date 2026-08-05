/**
 * TEMPORARY DIAGNOSTIC — Phase 0 of the 2026-08-05 active-game memory
 * investigation. Task 11 of that plan DELETES this file and both call sites.
 * Nothing here may ship.
 *
 * Probe 3 (mount census): counts how many instances of a screen route are live
 * at once. Answers "does a walk cycle leave instances behind?" without relying
 * on Expo Router's internal stack semantics.
 *
 * Probe 4 (blurred re-render): logs every render with a stable per-instance id,
 * so a render line from instance #1 while #2 is focused proves a blurred screen
 * is re-rendering.
 */
import { useEffect, useRef } from 'react';

let instanceSeq = 0;
const liveCounts: Record<string, number> = {};

/** Test-only: reset module state between cases. */
export function __resetScreenProbeForTests(): void {
  instanceSeq = 0;
  Object.keys(liveCounts).forEach((k) => delete liveCounts[k]);
}

/** Test-only: read the census. */
export function __getLiveCountForTests(screen: string): number {
  return liveCounts[screen] ?? 0;
}

export function useScreenProbe(screen: string, gameId: string | undefined): void {
  const idRef = useRef(0);
  if (idRef.current === 0) {
    instanceSeq += 1;
    idRef.current = instanceSeq;
  }
  const id = idRef.current;

  // Render-body log — Probe 4. Deliberately not in an effect: an effect would
  // not fire for a render that produced no committed change.
  if (__DEV__) {
    console.log(`[probe4] ${screen}#${id} render game=${gameId ?? '-'}`);
  }

  useEffect(() => {
    liveCounts[screen] = (liveCounts[screen] ?? 0) + 1;
    if (__DEV__) {
      console.log(`[probe3] ${screen}#${id} MOUNT live=${liveCounts[screen]} game=${gameId ?? '-'}`);
    }
    return () => {
      liveCounts[screen] = (liveCounts[screen] ?? 1) - 1;
      if (__DEV__) {
        console.log(`[probe3] ${screen}#${id} UNMOUNT live=${liveCounts[screen]}`);
      }
    };
    // Mount/unmount only — gameId is captured for the log line and must not
    // re-run this effect, or the census would count re-renders as mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
