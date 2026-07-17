export type HelpTopicId =
  | 'settlement-modes'
  | 'rounding'
  | 'imbalance-tolerance'
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
      'Cash Cage can settle any game in two ways.',
      'Direct: the app finds the fewest possible payments between the playing players where winners get paid directly by the losers. The summary will showcase exactly who owes who, and how much.',
      'Banker: one player, playing or not, is a designated banker handeling all cash. The summary will showcase who the banker needs to pay, how much, and linked to their preferred payment method just like in a real table. Note it does takes the assumption that the banker has recieved all buy-ins previously to the game ending.',
    ],
  },
  {
    id: 'rounding',
    title: 'What does rounding mean?',
    icon: 'cash-outline',
    paragraphs: [
      'Rounding configures each payment to a friendly desired amount so nobody is stuck making change.',
      'So A $5 unit rounds every payment to the nearest $5 while "Exact" keeps payments down to the cent. This is managed by the app to still ensure the total owed and total paid are equal, even if some individual payments are rounded up or down.',
    ],
  },
  {
    id: 'imbalance-tolerance',
    title: 'Imbalance tolerance',
    icon: 'warning-outline',
    paragraphs: [
      "Imbalance tolerance sets how far a game's books can be off before Cash Cage warns before game completion. When the total cashed out differs from the total bought in by more than this amount, you'll get a heads-up before the game settles.",
      "Pick a tighter limit (or Exact) to catch every discrepancy, or a looser one for casual games where being off by a few dollars is fine.",
      "This is only a warning as you can always finish the game anyway, but the settlements will not be optimized if you proceed.",
    ],
  },
  {
    id: 'saved-players',
    title: 'Saved players',
    icon: 'people-outline',
    paragraphs: [
      'Players you add and their payment information are remembered, so you can reuse them in future games without retyping names.',
      'These players can be saved during an active game, or added/deleted directly in the settings. Free accounts remember up to 15 players, and Pro remembers up to 200.',
    ],
  },
  {
    id: 'swipe-actions',
    title: 'Swiping player cards',
    icon: 'swap-horizontal-outline',
    visual: 'swipe',
    paragraphs: [
      'Swipe a player card to reveal their quick actions.',
      'Active players: tap to rename, swipe right to mark complete (cashed out and left), or swipe left to delete.',
      'Completed players: swipe right to reactivate them back into the game, or swipe left to delete.',
    ],
  },
  {
    id: 'sharing',
    title: 'Sharing & getting paid',
    icon: 'share-social-outline',
    paragraphs: [
      'Once a game is settled, tap Share to send the results to see who pays who, and how much in any group chat.',
      'If players saved a preferred payment method (like Venmo or PayPal), Cash Cage includes their handle in that message.',
    ],
  },
  {
    id: 'summary-why-direct',
    title: 'Why these payments?',
    icon: 'git-compare-outline',
    paragraphs: [
      'These payments come from the Direct or Player-to-Player settlement mode.', 
      'Cash Cage minimized the number of transfers so the group settles in as few payments as possible.',
      'Each player card shows exactly who and how much they need to get paid by.'
    ],
  },
  {
    id: 'summary-why-banker',
    title: 'Why these payments?',
    icon: 'person-outline',
    paragraphs: [
      'These payments run through the designated banker via the Banker settlmenet mode',
      'Eacgh player card shows exactly how much they cashed-out with and an easy pay button to send their payment to their preferred payment method.',
    ],
  },
];

/** Topics shown in the active-game (?) sheet. */
export const ACTIVE_GAME_TOPIC_IDS: HelpTopicId[] = [
  'settlement-modes',
  'rounding',
  'imbalance-tolerance',
  'saved-players',
  'swipe-actions',
];

/** Topics shown in the full Guide, in display order. */
export const GUIDE_TOPIC_IDS: HelpTopicId[] = [
  'settlement-modes',
  'rounding',
  'imbalance-tolerance',
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
