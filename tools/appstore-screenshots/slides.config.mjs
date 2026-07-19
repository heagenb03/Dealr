export const DEVICES = {
  iphone: { width: 1290, height: 2796, dir: 'iphone-6_9' },
};

// Demo game: "Friday Night Poker", pot $2,100 (staged 2026-07-18).
// SHARE_TEXT is the app's real Share output for the completed staged game, pasted by
// Heagen 2026-07-18. Single blank lines between sections. No "Settled with Cash Cage"
// footer — Heagen intentionally omitted it (no promo inside a promo screenshot).
const SHARE_TEXT = `Friday Night Poker

Total Pot: $2,100.00

Settlements:
• Doyle (Venmo @doylethewhale): $400.00 from Daniel
• Maria (Venmo @mariahluvpoker): $300.00 from Johnny, $80.00 from Wolfgang
• Phil (Zelle (123)456-7890): $220.00 from Wolfgang`;

export const SLIDES = [
  {
    // Device-only (no popped card): the completed-summary capture already shows the
    // full expanded Doyle settlement (Venmo handle, RECEIVES $400, FROM Daniel, Pay ->)
    // AND the $2,100 total pot, so a popped card would only duplicate + clip at the
    // bottom edge. Approved by Heagen 2026-07-18 over two popped-card variants.
    n: 1, template: 'device-slide.html', layout: 'hero',
    kicker: 'Settle Up', headline: ['Who Pays Who', 'And How'],
    capture: '../captures/slide1-summary.png',
    deviceWidth: '88%', deviceY: '6%',
    cards: [],
  },
  {
    // Settings panel expanded over the populated game: Direct|Banker toggle
    // (Banker selected) + Banker row + Rounding + Imbalance tolerance, players
    // below. The panel is the subject — no popped card; the device alone shows it.
    n: 2, template: 'device-slide.html', layout: 'left',
    kicker: 'Two Ways to Settle', headline: ['Direct Or Banker', 'Your Call'],
    capture: '../captures/slide3-settings-new.png',
    deviceWidth: '94%', deviceY: '-6%',
    cards: [],
  },
  {
    n: 3, template: 'message-slide.html',
    kicker: 'Share It', headline: ['Get Paid In', 'The Group Chat'],
    shareText: SHARE_TEXT, tilt: false, cards: [],
  },
  {
    n: 4, template: 'device-slide.html', layout: 'right',
    kicker: 'Saved Players', headline: ['Your Table,', 'On Every Device'],
    capture: '../captures/slide4-saved-players.png',
    deviceWidth: '86%', deviceY: '4%',
    cards: [],
  },
  {
    // Active game, Direct mode — IN/OUT/NET tracking with a completed player.
    // Legacy filename (kept to avoid a rename): the "-banker" suffix is historical;
    // this capture is the Direct-mode tracking screen.
    n: 5, template: 'device-slide.html', layout: 'top',
    kicker: 'Game Night', headline: ['Track Every', 'Buy-In & Cashout'],
    capture: '../captures/slide5-active-banker.png',
    deviceWidth: '92%', deviceY: '-30%',
    cards: [],
  },
];
