import {
  needsVerification,
  verifyCooldownRemaining,
  formatCooldownLabel,
  VERIFY_RESEND_COOLDOWN_MS,
} from '../emailVerification';

describe('needsVerification', () => {
  it('is false when signed out (null user)', () => {
    expect(needsVerification(null, false)).toBe(false);
    expect(needsVerification(undefined, false)).toBe(false);
  });

  it('is true for a signed-in, unverified user', () => {
    expect(needsVerification({ emailVerified: false }, false)).toBe(true);
  });

  it('is false for a signed-in, verified user (password or OAuth)', () => {
    expect(needsVerification({ emailVerified: true }, true)).toBe(false);
  });

  it('keys off the reactive emailVerified flag, not the user object', () => {
    // emailVerified state is the source of truth (user object is mutated in place)
    expect(needsVerification({ emailVerified: false }, true)).toBe(false);
    expect(needsVerification({ emailVerified: true }, false)).toBe(true);
  });
});

describe('verifyCooldownRemaining', () => {
  it('is 0 when nothing has been sent yet', () => {
    expect(verifyCooldownRemaining(null, 1000)).toBe(0);
  });

  it('is 0 exactly at the end of the window', () => {
    expect(verifyCooldownRemaining(0, 60_000, 60_000)).toBe(0);
  });

  it('is 0 after the window has elapsed', () => {
    expect(verifyCooldownRemaining(0, 90_000, 60_000)).toBe(0);
  });

  it('rounds remaining time up to whole seconds', () => {
    expect(verifyCooldownRemaining(0, 15_000, 60_000)).toBe(45);
    expect(verifyCooldownRemaining(0, 59_500, 60_000)).toBe(1);
  });

  it('defaults to the 60s window constant', () => {
    expect(VERIFY_RESEND_COOLDOWN_MS).toBe(60_000);
    expect(verifyCooldownRemaining(0, 0)).toBe(60);
  });
});

describe('formatCooldownLabel', () => {
  it('zero-pads seconds', () => {
    expect(formatCooldownLabel(45)).toBe('0:45');
    expect(formatCooldownLabel(5)).toBe('0:05');
    expect(formatCooldownLabel(0)).toBe('0:00');
  });

  it('rolls into minutes', () => {
    expect(formatCooldownLabel(60)).toBe('1:00');
    expect(formatCooldownLabel(75)).toBe('1:15');
  });
});
