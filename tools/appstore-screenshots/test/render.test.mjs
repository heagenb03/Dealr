import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import { renderSlide } from '../render.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// PNG stores width/height big-endian at fixed IHDR offsets.
export function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('renderSlide produces an exact-size PNG with injected data', async () => {
  const out = path.join(here, 'out', 'minimal.png');
  await rm(path.dirname(out), { recursive: true, force: true });
  const browser = await puppeteer.launch();
  try {
    await renderSlide(browser, {
      template: path.join(here, 'fixtures', 'minimal.html'),
      data: { headline: 'HELLO-TOKEN' },
      width: 1290,
      height: 2796,
      outPath: out,
    });
  } finally {
    await browser.close();
  }
  const buf = await readFile(out);
  assert.deepEqual(pngSize(buf), { width: 1290, height: 2796 });
});

// NOTE: this exercises the render ENGINE at two sizes (incl. iPad dims) on purpose —
// it proves the template renders at any viewport. Product scope is iPhone-only (see
// DEVICES in slides.config.mjs); this test does not read DEVICES and is not product scope.
test('device-slide renders at iPhone and iPad sizes', async () => {
  const browser = await puppeteer.launch();
  try {
    // Bootstrap a placeholder capture with Puppeteer itself (no image deps).
    const cap = path.join(here, 'fixtures', 'placeholder-capture.png');
    const p = await browser.newPage();
    await p.setViewport({ width: 1179, height: 2556 });
    await p.setContent('<body style="margin:0;background:#111;color:#B072BB;font:60px sans-serif">CAPTURE</body>');
    await p.screenshot({ path: cap });
    await p.close();

    for (const [w, h, device] of [[1290, 2796, 'iphone'], [2048, 2732, 'ipad']]) {
      const out = path.join(here, 'out', `device-${device}.png`);
      await renderSlide(browser, {
        template: path.join(here, '..', 'templates', 'device-slide.html'),
        data: {
          kicker: 'Settle Up',
          headline: ['Who Pays Who', 'And How'],
          capture: '../test/fixtures/placeholder-capture.png',
          device, tilt: true,
          cards: [{ x: 0, y: 0, w: 1179, h: 400, left: 60, top: 1400, scale: 0.9 }],
        },
        width: w, height: h, outPath: out,
      });
      const buf = await readFile(out);
      assert.deepEqual(pngSize(buf), { width: w, height: h });
    }
  } finally {
    await browser.close();
  }
});

test('full config renders 5 slides at correct sizes (placeholder captures)', async () => {
  const { DEVICES, SLIDES } = await import('../slides.config.mjs');
  assert.equal(SLIDES.length, 5);
  const browser = await puppeteer.launch();
  try {
    const cap = path.join(here, 'fixtures', 'placeholder-capture.png');
    for (const [deviceId, device] of Object.entries(DEVICES)) {
      for (const slide of SLIDES) {
        const out = path.join(here, 'out', device.dir, `slide-${slide.n}.png`);
        await renderSlide(browser, {
          template: path.join(here, '..', 'templates', slide.template),
          // capture LAST so the placeholder wins over perDevice's real (absent) paths
          data: { ...slide, device: deviceId, ...(slide.perDevice?.[deviceId] ?? {}), capture: '../test/fixtures/placeholder-capture.png' },
          width: device.width, height: device.height, outPath: out,
        });
        const buf = await readFile(out);
        assert.deepEqual(pngSize(buf), { width: device.width, height: device.height });
      }
    }
  } finally {
    await browser.close();
  }
});

test('no slide copy contains an em-dash', async () => {
  const { SLIDES } = await import('../slides.config.mjs');
  for (const slide of SLIDES) {
    const copy = [
      slide.kicker,
      ...(slide.headline ?? []),
      slide.shareText ?? '',
      slide.chat?.title ?? '',
      ...(slide.replies ?? []).flatMap((r) => [r.from, r.text]),
    ].join(' ');
    assert.ok(!copy.includes('—'), `slide ${slide.n} contains an em-dash: ${copy}`);
  }
});

test('every device slide declares a layout with a matching CSS block', async () => {
  const { SLIDES } = await import('../slides.config.mjs');
  const css = await readFile(path.join(here, '..', 'templates', 'base.css'), 'utf8');
  const deviceSlides = SLIDES.filter((s) => s.template === 'device-slide.html');
  assert.ok(deviceSlides.length > 0, 'expected at least one device slide');
  for (const slide of deviceSlides) {
    assert.ok(slide.layout, `slide ${slide.n} is missing a layout`);
    assert.ok(
      css.includes(`body.layout-${slide.layout}`),
      `slide ${slide.n} uses layout "${slide.layout}" but base.css has no body.layout-${slide.layout} rule`,
    );
  }
});

test('device layout geometry is driven by custom properties, not hardcoded per slide', async () => {
  const css = await readFile(path.join(here, '..', 'templates', 'base.css'), 'utf8');
  assert.ok(css.includes('var(--device-width'), 'base.css must size .device from --device-width');
  assert.ok(css.includes('var(--device-y'), 'base.css must position .device from --device-y');
});

test('chat-slide renders at iPhone size', async () => {
  const out = path.join(here, 'out', 'chat-iphone.png');
  const browser = await puppeteer.launch();
  try {
    await renderSlide(browser, {
      template: path.join(here, '..', 'templates', 'chat-slide.html'),
      data: {
        device: 'iphone',
        kicker: 'Share It',
        headline: ['Get Paid In', 'The Group Chat'],
        shareText:
          'Friday Night Poker\n\nTotal Pot: $2,100.00\n\nSettlements:\n' +
          '• Doyle (Venmo @doylethewhale): $400.00 from Daniel\n' +
          '• Phil (Zelle (123)456-7890): $220.00 from Wolfgang',
        chat: { title: 'Friday Night Poker', members: ['D', 'M', 'P', 'W'], count: 6 },
        replies: [
          { from: 'Daniel', text: 'sent' },
          { from: 'Wolfgang', text: 'paid Maria + Phil' },
        ],
      },
      width: 1290,
      height: 2796,
      outPath: out,
    });
  } finally {
    await browser.close();
  }
  const buf = await readFile(out);
  assert.deepEqual(pngSize(buf), { width: 1290, height: 2796 });
});

test('chat-slide template wires every SLIDE field it is given', async () => {
  const html = await readFile(path.join(here, '..', 'templates', 'chat-slide.html'), 'utf8');
  for (const ref of [
    'SLIDE.chat.members',
    'SLIDE.chat.title',
    'SLIDE.chat.count',
    'SLIDE.replies',
    'SLIDE.shareText',
    'SLIDE.sentStyle',
  ]) {
    assert.ok(html.includes(ref), `chat-slide.html must read ${ref}`);
  }
});

test('reply copy names no payment rail', async () => {
  const { SLIDES } = await import('../slides.config.mjs');
  // A reply naming a rail can contradict the share text rendered directly above
  // it: Wolfgang pays Maria by Venmo but Phil by Zelle, and the handle
  // highlighting makes "Zelle (123)456-7890" one of the most prominent strings
  // on the slide. Replies stay rail-agnostic ("sent", "paid ...").
  const RAILS = /venmo|zelle|paypal|cash ?app|apple pay/i;
  for (const slide of SLIDES) {
    for (const r of slide.replies ?? []) {
      assert.ok(
        !RAILS.test(r.text),
        `slide ${slide.n} reply from ${r.from} names a payment rail: "${r.text}"`,
      );
    }
  }
});

// This test asserts COMPUTED STYLE, not screenshot bytes, and that is load-bearing.
//
// It used to render three PNGs and compare the buffers. That was unsound: the
// renderer is nondeterministic. Identical input differs by +/-1 per channel
// between runs, and measurement showed this happens on layout:'hero' too --
// roughly 1 render in 3 -- contradicting an earlier note here that claimed hero
// was byte-stable. So the byte assertion failed intermittently on correct code.
//
// The failure mode was far worse than a flake. When assert.deepEqual fails on two
// ~324KB Buffers, Node formats them into a diff with maxArrayLength: Infinity,
// which exhausts the 4GB heap and aborts the ENTIRE test file with exit 134
// before any result is reported. That looked like "a render OOM" and was
// misattributed to slide 4's config, which this test never even reads.
//
// Computed style is invariant to rasterization noise, so this version is
// deterministic by construction rather than by luck, allocates nothing large,
// and asserts the wiring contract more directly than bytes did. If you are
// tempted to go back to comparing images, don't -- and if you must compare
// buffers anywhere, use Buffer.equals inside assert.ok so a failure cannot
// trigger Node's buffer diff formatter.
test('captureZoom scales the capture and defaults to inert', async () => {
  const browser = await puppeteer.launch();
  try {
    const base = {
      kicker: 'Saved Players',
      headline: ['Your Table,', 'On Every Device'],
      capture: '../test/fixtures/placeholder-capture.png',
      device: 'iphone',
      // captureZoom is layout-independent, so any layout exercises the same
      // wiring; hero is kept purely for continuity with the previous version.
      layout: 'hero',
      cards: [],
    };

    // Hydrate and load the real template, then read the CSSOM. Deliberately no
    // screenshot: there is no large buffer anywhere in this test.
    const template = path.join(here, '..', 'templates', 'device-slide.html');
    const raw = await readFile(template, 'utf8');
    const probe = async (extra) => {
      const html = raw.replace('/*__SLIDE_JSON__*/null', JSON.stringify({ ...base, ...extra }));
      const tmp = path.join(path.dirname(template), '.tmp-capture-zoom-probe.html');
      await writeFile(tmp, html);
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1290, height: 2796, deviceScaleFactor: 1 });
        await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
        return await page.evaluate(() => {
          const cap = document.querySelector('.capture');
          const cs = getComputedStyle(cap);
          return {
            zoomAttr: document.querySelector('.device').hasAttribute('data-zoom'),
            transform: cs.transform,
            transformOrigin: cs.transformOrigin,
            captureWidth: cap.clientWidth,
          };
        });
      } finally {
        await page.close();
        await rm(tmp, { force: true });
      }
    };

    const omitted = await probe({});
    const explicitOne = await probe({ captureZoom: 1 });
    const zoomed = await probe({ captureZoom: 2 });

    // Omitting captureZoom and passing exactly 1 must both be fully inert:
    // no [data-zoom] hook and NO transform at all. An identity transform is not
    // a no-op -- it promotes .capture to its own compositing layer -- which is
    // what keeps slides 1, 2, 3 and 5 rendering unchanged from before this
    // feature existed. Asserting transform === 'none' checks that directly,
    // where the old byte comparison could only check it by side effect.
    const inert = ({ zoomAttr, transform }) => ({ zoomAttr, transform });
    assert.deepEqual(inert(omitted), { zoomAttr: false, transform: 'none' },
      'omitting captureZoom must emit no transform');
    assert.deepEqual(inert(explicitOne), { zoomAttr: false, transform: 'none' },
      'captureZoom: 1 must be treated exactly like omitting it');

    // A non-default zoom must actually reach the DOM and the CSSOM. Without
    // this the template wiring could regress silently and every other test
    // stays green.
    assert.equal(zoomed.zoomAttr, true, 'captureZoom: 2 must set [data-zoom]');
    assert.equal(zoomed.transform, 'matrix(2, 0, 0, 2, 0, 0)',
      'captureZoom: 2 must apply scale(2) to .capture');

    // The knob's whole documented semantic -- pin the status bar, push the
    // surplus past the frame's BOTTOM edge -- lives in transform-origin, not
    // in the scale. Flipping it to `center` silently converts this into a
    // symmetric crop that also eats the top, and every other assertion in
    // this test stays green. Assert the origin rather than the scale alone.
    const [originX, originY] = zoomed.transformOrigin.split(' ');
    assert.equal(originY, '0px',
      'captureZoom must scale from the TOP edge, not the element centre');
    assert.ok(Math.abs(parseFloat(originX) - zoomed.captureWidth / 2) < 1,
      `captureZoom must scale from the horizontal centre (origin x ${originX}, `
      + `capture width ${zoomed.captureWidth})`);
  } finally {
    await browser.close();
  }
});
