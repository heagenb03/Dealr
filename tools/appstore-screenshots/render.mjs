import puppeteer from 'puppeteer';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Hydrate an HTML template with slide data and screenshot it at exact size.
 * The hydrated file is written NEXT TO the template (as .tmp-<name>) so the
 * template's relative asset URLs (base.css, node_modules fonts) still resolve.
 */
export async function renderSlide(browser, { template, data, width, height, outPath }) {
  const raw = await readFile(template, 'utf8');
  const token = '/*__SLIDE_JSON__*/null';
  if (!raw.includes(token)) throw new Error(`Template ${template} is missing the ${token} token`);
  const html = raw.replace(token, JSON.stringify(data));

  const tmp = path.join(path.dirname(template), `.tmp-${path.basename(template)}`);
  await writeFile(tmp, html);
  const page = await browser.newPage();
  try {
    // A screenshot's PNG dimensions come from the VIEWPORT, not the content --
    // so a template whose inline script throws partway (e.g. a typo like
    // `SLIDE.reactions.emoji.join` when `emoji` is missing) still produces an
    // exact-size PNG with the broken half silently missing, and nothing here
    // would otherwise notice. Collect page errors and fail loudly instead.
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    if (pageErrors.length > 0) {
      throw new Error(`Template ${template} threw during render: ${pageErrors[0].message}`);
    }
    await mkdir(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath });
  } finally {
    await page.close();
    await rm(tmp, { force: true });
  }
}

// ---- CLI ----------------------------------------------------------------
function parseArgs(argv) {
  const args = { config: 'slides.config.mjs', slides: null, devices: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') args.config = argv[++i];
    if (argv[i] === '--slides') args.slides = argv[++i].split(',').map(Number);
    if (argv[i] === '--devices') args.devices = argv[++i].split(',');
  }
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const { DEVICES, SLIDES } = await import(pathToFileURL(path.resolve(here, args.config)).href);
  const browser = await puppeteer.launch();
  try {
    for (const [deviceId, device] of Object.entries(DEVICES)) {
      if (args.devices && !args.devices.includes(deviceId)) continue;
      for (const slide of SLIDES) {
        if (args.slides && !args.slides.includes(slide.n)) continue;
        const outPath = path.join(here, 'dist', device.dir, `slide-${slide.n}.png`);
        await renderSlide(browser, {
          template: path.join(here, 'templates', slide.template),
          data: { ...slide, device: deviceId, ...(slide.perDevice?.[deviceId] ?? {}) },
          width: device.width,
          height: device.height,
          outPath,
        });
        console.log(`rendered ${outPath}`);
      }
    }
  } finally {
    await browser.close();
  }
}
