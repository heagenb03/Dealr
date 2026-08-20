/**
 * "Shared today" / "Shared yesterday" / "Shared N days ago" for the shared-game
 * route's header.
 *
 * The snapshot FREEZES at share time. A host who adds a late buy-in and does
 * not re-share leaves a recipient paying an amount that is silently wrong, with
 * nothing on screen to suggest it. This line is that suggestion.
 *
 * Compares CALENDAR DAYS in local time, not elapsed milliseconds: a share sent
 * at 11pm last night and read at 1am must say "yesterday", not "today".
 *
 * Hand-rolled rather than Intl.RelativeTimeFormat on purpose — this repo has
 * already shipped a broken no-Intl degradation path through three clean
 * reviews, and three output strings are not worth that exposure.
 *
 * No react-native import: unit-testable under jest-expo/node.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight of the day `d` falls on. */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function formatSharedAgo(createdAt: Date, now: Date): string {
  // Math.round, not Math.floor: at a DST boundary the gap between two
  // consecutive local midnights is 23 or 25 hours, and floor() would report the
  // 23-hour case as 0 days — "today" for a share sent yesterday.
  const days = Math.round(
    (startOfLocalDay(now).getTime() - startOfLocalDay(createdAt).getTime()) / DAY_MS,
  );

  // <= 0 rather than === 0: clock skew can put createdAt slightly ahead of now.
  if (days <= 0) return 'Shared today';
  if (days === 1) return 'Shared yesterday';
  return `Shared ${days} days ago`;
}
