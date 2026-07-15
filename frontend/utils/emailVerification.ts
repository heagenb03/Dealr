// Pure helpers for the mandatory email-verification gate.
// See docs/superpowers/specs/2026-07-15-email-verification-gate-design.md

/** Minimal shape of a Firebase Auth user needed by the gate predicate. */
export type GateUser = { emailVerified?: boolean } | null | undefined;

/**
 * True when a signed-in user still needs to verify their email.
 * `emailVerified` is the reactive value tracked in AuthContext (not read off the
 * stale, in-place-mutated user object). OAuth accounts are always verified, so
 * they never gate.
 */
export function needsVerification(user: GateUser, emailVerified: boolean): boolean {
  return user != null && !emailVerified;
}

/** Resend cooldown window, in milliseconds. */
export const VERIFY_RESEND_COOLDOWN_MS = 60_000;

/**
 * Seconds remaining in the resend cooldown, given when the last email was sent.
 * Returns 0 when nothing has been sent (`sentAt == null`) or the window elapsed.
 */
export function verifyCooldownRemaining(
  sentAt: number | null,
  now: number,
  cooldownMs: number = VERIFY_RESEND_COOLDOWN_MS,
): number {
  if (sentAt == null) return 0;
  const remainingMs = cooldownMs - (now - sentAt);
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 1000);
}

/** Format a seconds count as `m:ss` (e.g. 45 -> "0:45", 75 -> "1:15"). */
export function formatCooldownLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
