import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    const copy = [slide.kicker, ...(slide.headline ?? []), slide.shareText ?? ''].join(' ');
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

test('captureZoom scales the capture and defaults to inert', async () => {
  const browser = await puppeteer.launch();
  try {
    // Bootstrap a placeholder capture with Puppeteer itself (no image deps).
    const cap = path.join(here, 'fixtures', 'placeholder-capture.png');
    const p = await browser.newPage();
    await p.setViewport({ width: 1179, height: 2556 });
    await p.setContent('<body style="margin:0;background:#111;color:#B072BB;font:60px sans-serif">CAPTURE</body>');
    await p.screenshot({ path: cap });
    await p.close();

    const base = {
      kicker: 'Saved Players',
      headline: ['Your Table,', 'On Every Device'],
      capture: '../test/fixtures/placeholder-capture.png',
      device: 'iphone',
      // layout:'hero' is deliberate, and empirical rather than principled. The
      // edge-anchored layouts (left/right, which set transform-origin to an edge)
      // differed by +/-1 per channel in every measured render of identical input;
      // hero was byte-stable across 8 back-to-back renders. Do NOT assume "3D
      // rotation" is the cause -- hero is 3D-rotated too, and layout-top is not
      // 3D-rotated at all. captureZoom is layout-independent, so hero exercises
      // the same wiring. If this test ever flakes, replace the byte comparison
      // with a computed-style assertion rather than widening a tolerance.
      layout: 'hero',
      cards: [],
    };
    const render = async (name, extra) => {
      const out = path.join(here, 'out', `zoom-${name}.png`);
      await renderSlide(browser, {
        template: path.join(here, '..', 'templates', 'device-slide.html'),
        data: { ...base, ...extra },
        width: 1290,
        height: 2796,
        outPath: out,
      });
      return readFile(out);
    };

    const omitted = await render('omitted', {});
    const explicitOne = await render('one', { captureZoom: 1 });
    const zoomed = await render('two', { captureZoom: 2 });

    // Omitting captureZoom and passing exactly 1 must both be fully inert —
    // neither emits a transform — which is what keeps slides 1, 2, 3 and 5
    // rendering byte-for-byte unchanged from before this feature existed.
    assert.deepEqual(omitted, explicitOne, 'captureZoom must default to 1');
    // A non-default zoom must actually reach the DOM. Without this the
    // template wiring could regress silently and every other test stays green.
    assert.notDeepEqual(omitted, zoomed, 'captureZoom: 2 must change rendered pixels');
  } finally {
    await browser.close();
  }
});
