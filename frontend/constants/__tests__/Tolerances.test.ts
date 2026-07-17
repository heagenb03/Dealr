import {
  EXACT_TOLERANCE,
  getToleranceOptions,
  getDefaultTolerance,
  resolveTolerance,
  toleranceSemantic,
} from '@/constants/Tolerances';

describe('Tolerances', () => {
  it('options start with Exact (0) and are ascending', () => {
    const opts = getToleranceOptions('USD');
    expect(opts[0]).toBe(EXACT_TOLERANCE);
    expect(opts).toEqual([...opts].sort((a, b) => a - b));
  });

  it('USD default is 2.5 (preserves current behavior)', () => {
    expect(getDefaultTolerance('USD')).toBe(2.5);
  });

  it('JPY default is a yen-scaled value, not 2.5', () => {
    expect(getDefaultTolerance('JPY')).toBe(250);
    expect(getToleranceOptions('JPY')).toContain(0);
  });

  it('resolveTolerance returns a valid stored option unchanged', () => {
    expect(resolveTolerance(10, 'USD')).toBe(10);
    expect(resolveTolerance(0, 'USD')).toBe(0);
  });

  it('resolveTolerance falls back to currency default when undefined', () => {
    expect(resolveTolerance(undefined, 'USD')).toBe(2.5);
    expect(resolveTolerance(undefined, 'JPY')).toBe(250);
  });

  it('resolveTolerance falls back when the value is not an option for the currency', () => {
    // 2.5 is a USD option but not a JPY option
    expect(resolveTolerance(2.5, 'JPY')).toBe(250);
  });

  it('toleranceSemantic labels the extremes and default', () => {
    expect(toleranceSemantic(0, 'USD')).toBe('Exact');
    expect(toleranceSemantic(2.5, 'USD')).toBe('Normal');
    expect(toleranceSemantic(50, 'USD')).toBe('Loose');
  });
});
