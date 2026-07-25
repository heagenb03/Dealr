import puppeteer from 'puppeteer';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { CANVAS, THEME, IMAGES } from './gallery.config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Composite one approved phone render onto a 1270x760 Product Hunt gallery canvas.
 *
 * The phone PNG is inlined as a data URI rather than referenced by path. A file://
 * page CAN load a sibling file, but the source lives outside this tool's directory
 * (../appstore-screenshots/dist), and a relative URL that escapes the template's own
 * folder is exactly the kind of thing that silently resolves to nothing and yields a
 * correctly-sized PNG with no phone in it. Inlining makes a missing source a hard
 * failure at read time instead.
 */
async function renderImage(browser, image) {
  const sourcePath = path.resolve(here, image.source);
  const png = await readFile(sourcePath); // throws loudly if the source is missing
  const sourceDataUri = `data:image/png;base64,${png.toString('base64')}`;

  const raw = await readFile(path.join(here, 'template.html'), 'utf8');
  for (const token of ['/*__IMAGE_JSON__*/null', '/*__THEME_JSON__*/null']) {
    if (!raw.includes(token)) throw new Error(`template.html is missing the ${token} token`);
  }
  const html = raw
    .replace('/*__IMAGE_JSON__*/null', JSON.stringify({ ...image, sourceDataUri }))
    .replace('/*__THEME_JSON__*/null', JSON.stringify(THEME));

  // Written next to the template so the node_modules font URLs still resolve.
  const tmp = path.join(here, '.tmp-template.html');
  await writeFile(tmp, html);

  const page = await browser.newPage();
  try {
    // A screenshot's dimensions come from the VIEWPORT, so a template whose script
    // throws halfway still produces a perfectly-sized PNG with content missing and
    // nothing here would notice. Fail loudly instead. (Same lesson as 9767670 on
    // the App Store deck.)
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.setViewport({ ...CANVAS, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    // Panel mode sizes itself in an image load handler, so the screenshot must not
    // race it. A panel that never crops would render at its uncropped height and
    // still produce a perfectly-sized PNG.
    if (image.mode === 'panel') {
      await page.waitForSelector('#shot[data-cropped="1"]', { timeout: 5000 });
    }

    // Guard the ways this can render "successfully" but wrong. Nothing below is
    // cosmetic: each one has already happened at least once during development.
    const check = await page.evaluate(() => {
      const img = document.getElementById('shot');
      const art = document.getElementById('art');
      const hl = document.querySelector('.headline');
      const sub = document.querySelector('.subhead');
      const fits = (el) => {
        const r = el.getBoundingClientRect();
        return r.top >= -0.5 && r.left >= -0.5 &&
               r.right <= window.innerWidth + 0.5 &&
               r.bottom <= window.innerHeight + 0.5;
      };
      return {
        imgLoaded: img.complete && img.naturalWidth > 0,
        headlineText: hl.textContent.trim(),
        subheadText: sub.textContent.trim(),
        artFits: fits(art),
        // A collapsed box passes every "does it fit" test. This actually happened:
        // a stray */ in template.html made the .panel rule invalid CSS, so the art
        // rendered at 0x0 and the image shipped as text on an empty canvas.
        artBox: [art.getBoundingClientRect().width, art.getBoundingClientRect().height],
        headlineFits: fits(hl),
        subheadFits: fits(sub),
        // The headline is designed as exactly two lines. Derive the count from the
        // rendered box rather than trusting the copy to be short enough.
        headlineLines: Math.round(
          hl.getBoundingClientRect().height /
          (parseFloat(getComputedStyle(hl).fontSize) * 1.05)
        ),
      };
    });
    if (pageErrors.length > 0) throw new Error(`template threw: ${pageErrors[0].message}`);
    if (!check.imgLoaded) throw new Error(`image ${image.n}: source failed to decode`);
    if (!check.headlineText) throw new Error(`image ${image.n}: headline rendered empty`);
    if (!check.subheadText) throw new Error(`image ${image.n}: subhead rendered empty`);
    if (check.artBox[0] < 200 || check.artBox[1] < 300) {
      throw new Error(
        `image ${image.n}: the phone/panel rendered at ${check.artBox[0]}x${check.artBox[1]}, ` +
        `which is collapsed or missing. Check template.html's CSS is still valid.`
      );
    }
    if (!check.artFits) throw new Error(`image ${image.n}: the phone/panel is clipped by the canvas`);
    if (!check.headlineFits) throw new Error(`image ${image.n}: headline overflows the canvas`);
    if (!check.subheadFits) throw new Error(`image ${image.n}: subhead overflows the canvas`);
    if (check.headlineLines !== 2) {
      throw new Error(
        `image ${image.n}: headline wrapped to ${check.headlineLines} lines, expected 2. ` +
        `Shorten the copy, or set headlineSize on this image if it truly cannot be shortened.`
      );
    }

    const outPath = path.join(here, 'dist', `ph-gallery-${image.n}.png`);
    await mkdir(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath });
    return outPath;
  } finally {
    await page.close();
    await rm(tmp, { force: true });
  }
}

// ---- CLI ----------------------------------------------------------------
const args = process.argv.slice(2);
const only = args.includes('--only')
  ? args[args.indexOf('--only') + 1].split(',').map(Number)
  : null;

const browser = await puppeteer.launch();
try {
  for (const image of IMAGES) {
    if (only && !only.includes(image.n)) continue;
    const out = await renderImage(browser, image);
    console.log(`rendered ${out}`);
  }
} finally {
  await browser.close();
}
