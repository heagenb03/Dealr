import { formatSharedAgo } from '@/utils/sharedAgo';

// Dates are built with the LOCAL-COMPONENT constructor, never ISO-with-Z: the
// helper compares calendar days in local time, so an ISO literal would make
// these cases pass or fail depending on the runner's timezone.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h);

describe('formatSharedAgo', () => {
  it('reads "today" for the same calendar day', () => {
    expect(formatSharedAgo(at(2026, 7, 20, 9), at(2026, 7, 20, 21))).toBe('Shared today');
  });

  it('reads "yesterday" across a midnight boundary', () => {
    // 11pm last night to 1am today is TWO HOURS of elapsed time and ONE
    // calendar day. Comparing elapsed milliseconds would call this "today".
    expect(formatSharedAgo(at(2026, 7, 19, 23), at(2026, 7, 20, 1))).toBe('Shared yesterday');
  });

  it('reads "yesterday" for a nearly-24-hour gap on the previous day', () => {
    expect(formatSharedAgo(at(2026, 7, 19, 0), at(2026, 7, 20, 23))).toBe('Shared yesterday');
  });

  it('counts whole calendar days beyond that', () => {
    expect(formatSharedAgo(at(2026, 7, 16), at(2026, 7, 20))).toBe('Shared 4 days ago');
  });

  it('counts across a month boundary', () => {
    expect(formatSharedAgo(at(2026, 6, 29), at(2026, 7, 3))).toBe('Shared 5 days ago');
  });

  it('reads "today" when createdAt is ahead of now', () => {
    // Client clock skew, or a server timestamp a moment in the future. Never
    // render "Shared -1 days ago".
    expect(formatSharedAgo(at(2026, 7, 21), at(2026, 7, 20))).toBe('Shared today');
  });
});
