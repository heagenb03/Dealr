/**
 * Product Hunt gallery images for Cash Cage.
 *
 * Product Hunt's recommended gallery size is 1270x760 LANDSCAPE. The App Store deck in
 * ../appstore-screenshots renders 1290x2796 PORTRAIT. This tool reads from that tool's
 * assets and composites them onto a landscape canvas. It never writes there and does not
 * import its config, templates, or tests.
 *
 * SOURCE CHOICE, AND WHY IT IS NOT dist/slide-N.png
 * -------------------------------------------------
 * The first attempt composited the finished dist/ slides and was WRONG on two counts:
 * each slide has its own kicker+headline baked into the render (so the composite showed
 * two competing headlines), and the slides deliberately rotate and bleed the phone off
 * their own canvas edge, which clips badly once dropped into a landscape frame.
 *
 * So `phone` images composite from ../appstore-screenshots/captures/*.png instead: raw
 * 1179x2556 app screenshots, no caption, no frame, no rotation. This tool draws the phone
 * frame itself, reusing the graphite rail recipe from that deck's base.css so the two sets
 * look related (see template.html for the two-box clip construction, which must not be
 * "simplified" back to a solid border).
 *
 * Slide 3 of the deck is the group-chat scene, which is generated HTML with no capture
 * behind it and is deliberately frameless. Image 3 therefore uses mode 'panel' and crops
 * the chat surface straight out of dist/iphone-6_9/slide-3.png, leaving its caption behind.
 * Crop box was measured, not eyeballed, by scanning for pixels that differ from the
 * canvas colour.
 *
 * COPY RULES (house style, mirrors the App Store deck):
 *   - No em-dashes. Enforced by test on the deck (see 4b71129); applied here by hand.
 *   - Quantitative claims must be visibly true OF THE IMAGE THEY SIT ON. "Six players.
 *     Four payments." is on image 3 because that panel literally shows four payment lines
 *     across six named players (Doyle, Daniel, Maria, Johnny, Wolfgang, Phil). It is the
 *     same worked example the live landing page uses. Do not move that headline onto an
 *     image where the numbers are not visible, and do not generalise it to "usually".
 */

export const CANVAS = { width: 1270, height: 760 };

/** Brand tokens, identical to the App Store deck's --canvas / accent / rail. */
export const THEME = {
  canvas: '#2A0A33',
  headline: '#FFFFFF',
  accent: '#B072BB',
  subhead: 'rgba(255,255,255,0.62)',
  railHi: '#6e6e78',
  railLo: '#141417',
};

export const CAPTURE_DIR = '../appstore-screenshots/captures';
export const DIST_DIR = '../appstore-screenshots/dist/iphone-6_9';

export const IMAGES = [
  {
    n: 1,
    mode: 'phone',
    source: `${CAPTURE_DIR}/slide1-summary.png`,
    side: 'left',
    headline: 'Game ends.',
    headlineAccent: 'Everyone gets paid.',
    // This is the landing page's hero line, so it is worth scaling rather than
    // rewording. At the default 84px "Everyone gets paid." wraps to a third line,
    // which the render guard rejects.
    headlineSize: 68,
    subhead: 'The pot, who owes who, and a Pay button next to each one.',
  },
  {
    n: 2,
    mode: 'phone',
    source: `${CAPTURE_DIR}/slide5-active-banker.png`,
    side: 'right',
    headline: 'Log it',
    headlineAccent: 'at the table',
    subhead: 'Buy-ins and cash-outs in a tap. Works offline, so a basement with no signal is fine.',
  },
  {
    n: 3,
    mode: 'panel',
    source: `${DIST_DIR}/slide-3.png`,
    // Measured from the render by scanning for non-canvas pixels. If slide 3 is
    // ever re-rendered with a different panel inset, re-measure rather than nudge.
    crop: { left: 65, top: 577, right: 1235, bottom: 2796 },
    side: 'left',
    headline: 'Six players.',
    headlineAccent: 'Four payments.',
    subhead: 'A solver finds the fewest transfers that square the table, with every handle attached.',
  },
  {
    n: 4,
    mode: 'phone',
    source: `${CAPTURE_DIR}/slide4-saved-players.png`,
    side: 'right',
    headline: 'Your regulars,',
    headlineAccent: 'saved',
    subhead: 'Save each player once with how they like to get paid. Synced across your devices.',
  },
  {
    n: 5,
    mode: 'phone',
    source: `${CAPTURE_DIR}/slide3-settings-new.png`,
    side: 'left',
    headline: 'Or name',
    headlineAccent: 'a banker',
    subhead: 'Skip direct settlement and have the whole table pay out through one person.',
  },
];
