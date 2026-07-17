import { formatSettingsSummary, toleranceCaption } from '../settingsSummary';

describe('formatSettingsSummary', () => {
  it('direct mode shows mode and rounding', () => {
    expect(formatSettingsSummary(false, undefined, 'Exact')).toBe('Direct · Exact');
    expect(formatSettingsSummary(false, undefined, '$5')).toBe('Direct · $5');
  });

  it('banker mode with no banker drops rounding', () => {
    expect(formatSettingsSummary(true, undefined, 'Exact')).toBe('Banker · Choose banker');
    expect(formatSettingsSummary(true, undefined, '$5')).toBe('Banker · Choose banker');
  });

  it('banker mode with a banker shows name and rounding', () => {
    expect(formatSettingsSummary(true, 'Alex', '$5')).toBe('Banker · Alex · $5');
    expect(formatSettingsSummary(true, 'Alex', 'Exact')).toBe('Banker · Alex · Exact');
  });

  it('appends the tolerance label when one is provided', () => {
    expect(formatSettingsSummary(false, undefined, '$5', '±$10')).toBe('Direct · $5 · ±$10');
  });

  it('omits the tolerance segment when no label is provided (default tolerance)', () => {
    expect(formatSettingsSummary(false, undefined, '$5')).toBe('Direct · $5');
  });

  it('banker mode with no banker drops tolerance too, matching the visible row', () => {
    // The collapsed row suppresses BOTH rounding and tolerance in this state,
    // so the a11y label must not announce a tolerance the user cannot see.
    expect(formatSettingsSummary(true, undefined, '$5', '±$10')).toBe('Banker · Choose banker');
  });

  it('banker mode with a banker keeps the tolerance', () => {
    expect(formatSettingsSummary(true, 'Alex', '$5', '±$10')).toBe('Banker · Alex · $5 · ±$10');
  });
});

describe('toleranceCaption', () => {
  const fmt = (n: number) => `$${n}`;

  it('captions a positive tolerance with a ± prefix', () => {
    expect(toleranceCaption(10, fmt)).toBe('±$10');
  });

  it('captions the currency default (not just overrides) so the summary always shows it', () => {
    // Regression: at the default $2.50 the collapsed summary used to omit
    // tolerance while rounding/mode stayed — this asymmetry was the bug.
    expect(toleranceCaption(2.5, fmt)).toBe('±$2.5');
  });

  it('captions Exact (0) as "Exact", not "±$0"', () => {
    expect(toleranceCaption(0, fmt)).toBe('Exact');
  });
});
