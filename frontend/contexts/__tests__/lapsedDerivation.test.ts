import { deriveLapsed } from '../authDerivations';

describe('deriveLapsed', () => {
  it('is false for someone who never purchased', () => {
    expect(deriveLapsed(false, null)).toBe(false);
    expect(deriveLapsed(false, undefined)).toBe(false);
  });

  it('is false while still a paid subscriber', () => {
    expect(deriveLapsed(true, new Date('2024-01-01'))).toBe(false);
  });

  it('is true for a churned subscriber', () => {
    expect(deriveLapsed(false, new Date('2024-01-01'))).toBe(true);
  });

  // The case trialExpired misses entirely: signed up before the trial feature
  // existed, so trialEndsAt is null and no banner renders today.
  it('is true for a legacy subscriber with no trial record', () => {
    expect(deriveLapsed(false, new Date('2023-05-05'))).toBe(true);
  });
});
