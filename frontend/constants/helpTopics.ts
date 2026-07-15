export type HelpTopicId =
  | 'settlement-modes'
  | 'rounding'
  | 'saved-players'
  | 'swipe-actions'
  | 'sharing'
  | 'summary-why-direct'
  | 'summary-why-banker';

export interface HelpTopic {
  /** Stable id used for subset selection. */
  id: HelpTopicId;
  /** Row title. */
  title: string;
  /** Ionicons name. */
  icon: string;
  /** Body copy, one string per paragraph. */
  paragraphs: string[];
  /** Marks the one topic that renders a static visual instead of plain paragraphs alone. */
  visual?: 'swipe';
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'settlement-modes',
    title: 'Direct vs Banker settlement',
    icon: 'git-compare-outline',
    paragraphs: [
      'Cash Cage can settle a game two ways. You pick the mode before you settle.',
      'Direct: the app finds the fewest possible payments between players. Winners get paid directly by losers, so the total number of transfers is as small as possible.',
      'Banker: one player is the banker. Everyone who lost pays the banker, and the banker pays everyone who won. Use this when one person is handling all the cash.',
    ],
  },
  {
    id: 'rounding',
    title: 'What does rounding mean?',
    icon: 'cash-outline',
    paragraphs: [
      'Rounding snaps each payment to a cash-friendly amount so nobody is stuck making change.',
      'A $5 unit rounds every transfer to the nearest $5. "Exact" keeps payments to the cent.',
      'Because payments are rounded, the totals shown can shift a little from the raw buy-in and cash-out math. Cash Cage keeps the overall settlement balanced.',
    ],
  },
  {
    id: 'saved-players',
    title: 'Saved players',
    icon: 'people-outline',
    paragraphs: [
      'Players you add are remembered, so you can reuse them in future games without retyping names.',
      'When adding a player, tap a saved name to drop them straight into the game.',
      'Free accounts remember up to 15 players; Pro remembers up to 200. Manage or delete saved players any time from Account → Saved Players.',
    ],
  },
  {
    id: 'swipe-actions',
    title: 'Swiping player cards',
    icon: 'swap-horizontal-outline',
    visual: 'swipe',
    paragraphs: [
      'Swipe a player card to reveal quick actions — no menus needed.',
      'Active players: swipe one way to mark them complete (they cashed out and left), and the other way to delete. To rename, just tap their name.',
      'Completed players: swipe to reactivate them back into the game, or to delete.',
    ],
  },
  {
    id: 'sharing',
    title: 'Sharing & getting paid',
    icon: 'share-social-outline',
    paragraphs: [
      'Once a game is settled, tap Share to send the results — who pays who, and how much.',
      'If players saved a preferred payment method (like Venmo or PayPal), Cash Cage includes their handle so everyone can pay up fast.',
    ],
  },
  {
    id: 'summary-why-direct',
    title: 'Why these payments?',
    icon: 'git-compare-outline',
    paragraphs: [
      'These payments come from Direct settlement: the app minimized the number of transfers so the group settles in as few payments as possible.',
      'Each row is one payment, from a player who owes to a player who is owed.',
    ],
  },
  {
    id: 'summary-why-banker',
    title: 'Why these payments?',
    icon: 'person-outline',
    paragraphs: [
      'These payments run through the banker. Everyone who lost pays the banker, and the banker pays out everyone who won.',
      'That keeps all the cash flowing through one person.',
    ],
  },
];

/** Topics shown in the active-game (?) sheet. */
export const ACTIVE_GAME_TOPIC_IDS: HelpTopicId[] = [
  'settlement-modes',
  'rounding',
  'saved-players',
  'swipe-actions',
];

/** Topics shown in the full Guide, in display order. */
export const GUIDE_TOPIC_IDS: HelpTopicId[] = [
  'settlement-modes',
  'rounding',
  'saved-players',
  'swipe-actions',
  'sharing',
];

/** Topics shown in the summary (?) sheet, branched on settlement mode. */
export function getSummaryTopicIds(mode?: 'optimal' | 'banker'): HelpTopicId[] {
  const why: HelpTopicId =
    mode === 'banker' ? 'summary-why-banker' : 'summary-why-direct';
  return [why, 'rounding', 'sharing'];
}

/** Resolve ids to topics, preserving order and dropping any unknown id. */
export function getTopicsByIds(ids: HelpTopicId[]): HelpTopic[] {
  return ids
    .map((id) => HELP_TOPICS.find((t) => t.id === id))
    .filter((t): t is HelpTopic => !!t);
}
