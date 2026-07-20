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
