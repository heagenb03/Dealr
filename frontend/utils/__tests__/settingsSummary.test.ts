import { formatSettingsSummary } from '../settingsSummary';

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
});
