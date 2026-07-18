export const DEVICES = {
  iphone: { width: 1290, height: 2796, dir: 'iphone-6_9' },
};

// Demo game: "Friday Night Poker", pot $2,100 (staged 2026-07-18).
// SHARE_TEXT is the LITERAL output of the app's Share action on the COMPLETED
// staged game. It is pasted verbatim by Heagen in Task 2 — do NOT hand-author or
// compute it (the summary capture only shows one recipient in full). The value
// below is a loud placeholder so renders/tests work before Task 2; it must be
// replaced before the set is approved.
const SHARE_TEXT = `PLACEHOLDER — replace verbatim in Task 2 with the app's real Share output`;

export const SLIDES = [
  {
    n: 1, template: 'device-slide.html',
    kicker: 'Settle Up', headline: ['Who Pays Who —', 'And How'],
    capture: '../captures/slide1-summary.png', tilt: true,
    cards: [
      // Expanded Doyle settlement card (Venmo + Pay). Tune x/y/w/h on the real
      // capture in Task 2; set captureWidth if the capture isn't 1179px wide.
      { x: 40, y: 900, w: 1100, h: 620, left: 40, top: 1450, scale: 0.95 },
    ],
  },
  {
    // Settings panel expanded over the populated game: Direct|Banker toggle
    // (Banker selected) + Banker row + Rounding + Imbalance tolerance, players
    // below. The panel is the subject — no popped card; the device alone shows it.
    n: 2, template: 'device-slide.html',
    kicker: 'Two Ways to Settle', headline: ['Direct Or Banker —', 'Your Call'],
    capture: '../captures/slide3-settings-new.png', tilt: true,
    cards: [],
  },
  {
    n: 3, template: 'message-slide.html',
    kicker: 'Share It', headline: ['Get Paid In', 'The Group Chat'],
    shareText: SHARE_TEXT, tilt: false, cards: [],
  },
  {
    n: 4, template: 'device-slide.html',
    kicker: 'Saved Players', headline: ['Your Table,', 'On Every Device'],
    capture: '../captures/slide4-saved-players.png', tilt: true,
    cards: [],
  },
  {
    // Active game, Direct mode — IN/OUT/NET tracking with a completed player.
    // Legacy filename (kept to avoid a rename): the "-banker" suffix is historical;
    // this capture is the Direct-mode tracking screen.
    n: 5, template: 'device-slide.html',
    kicker: 'Game Night', headline: ['Track Every', 'Buy-In & Cashout'],
    capture: '../captures/slide5-active-banker.png', tilt: true,
    cards: [],
  },
];
