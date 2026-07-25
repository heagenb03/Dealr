# producthunt-gallery

Renders the five 1270×760 Product Hunt gallery images for Cash Cage, plus nothing else.

```bash
npm run render              # all five
node render.mjs --only 3    # just image 3
```

Output lands in `dist/` (gitignored build output, like the App Store deck's).

## Relationship to `../appstore-screenshots`

This tool **reads from** that one and never writes to it. It does not import its config,
templates, or tests, and its 27-test suite is unaffected by anything here.

`node_modules` is a **directory junction** to `../appstore-screenshots/node_modules`
(puppeteer + @fontsource/inter). On a fresh clone, recreate it:

```bash
# Windows
mklink /J node_modules ..\appstore-screenshots\node_modules
# POSIX
ln -s ../appstore-screenshots/node_modules node_modules
```

## Why it does not just crop the App Store slides

The first attempt composited the finished `dist/slide-N.png` files and was wrong twice
over: every slide has its own kicker and headline baked into the render, so the result
showed two competing headlines; and the slides deliberately rotate the phone and bleed it
off their own canvas edge, which clips badly in a landscape frame.

So `mode: 'phone'` images composite from `../appstore-screenshots/captures/*.png` instead:
raw 1179×2556 app screenshots with no caption, no frame and no rotation. This tool draws
the phone frame itself, reusing the graphite rail recipe from that deck's `base.css`.

`mode: 'panel'` exists for image 3 only. Slide 3 of the deck is the group-chat scene, which
is generated HTML with no capture behind it and is frameless by design. That image crops
the chat surface out of the finished render, leaving its caption behind. The crop box in
`gallery.config.mjs` was measured by scanning for pixels differing from the canvas colour,
not eyeballed.

## Things that will bite you

**The graphite rail is a two-box clip, not a border.** A transparent border plus two
background layers clipped to different boxes (screen → `padding-box`, rail → `border-box`),
both at `background-origin: border-box`. A solid border takes one colour and `border-image`
does not follow `border-radius`. Do not "simplify" it.

**The suits watermark is at 0.022 opacity, not the deck's 0.04.** The tile is a fixed
560px, so this 1270×760 canvas shows about four tiles where the deck scatters them across
1290×2796. At 0.04 the suits sit behind the headline and fight it.

**Headlines are designed as exactly two lines** and `render.mjs` fails the render if one
wraps to three. Shorten the copy first; `headlineSize` per image is the escape hatch and
image 1 uses it, because its headline is the landing page's hero line.

## What the render guards catch

`render.mjs` fails loudly rather than writing a wrong-but-correctly-sized PNG. A
screenshot's dimensions come from the viewport, so almost every failure mode still yields a
perfect 1270×760 file. Each guard below corresponds to something that actually happened
while building this:

| Guard | Catches |
|---|---|
| `pageerror` collection | Template script throwing partway through |
| source `readFile` | A missing or renamed capture / render |
| `imgLoaded` | Art that failed to decode |
| `artBox` minimum size | Art collapsed to 0×0 (a stray `*/` once made the `.panel` rule invalid CSS, and the image shipped as text on an empty canvas) |
| `artFits` / `headlineFits` / `subheadFits` | Anything clipped by the canvas edge |
| `headlineLines === 2` | Headline wrapping to three lines |
| `waitForSelector[data-cropped]` | Screenshotting before panel mode finishes sizing itself |

The two most important guards are mutation-tested: forcing `.panel { width: 0 }` fails with
the collapsed-art message, and lengthening a headline past two lines fails with the wrap
message.

**No guard checks whether the images look good.** As with the App Store deck, human eyes on
the rendered PNG are the only real gate. "It rendered" is not approval.
