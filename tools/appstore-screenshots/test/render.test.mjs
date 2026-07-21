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
// Reproduces the reviewer's defect: a template whose inline script throws
// (e.g. slide 3's `reactions: { count: 3 }` missing `emoji`, which broke
// `SLIDE.reactions.emoji.join` and silently killed the Delivered receipt
// and every reply) still screenshotted at the exact viewport size, because
// PNG dimensions come from the viewport, not the content. renderSlide must
// surface the page error by rejecting instead of resolving with a
// half-rendered PNG.
test('renderSlide rejects when the template throws', async () => {
  const out = path.join(here, 'out', 'throws.png');
  await rm(path.dirname(out), { recursive: true, force: true });
  const browser = await puppeteer.launch();
  try {
    await assert.rejects(
      renderSlide(browser, {
        template: path.join(here, 'fixtures', 'throws.html'),
        data: { headline: 'HELLO-TOKEN' },
        width: 1290,
        height: 2796,
        outPath: out,
      }),
      /threw during render.*boom/,
    );
  } finally {
    await browser.close();
  }
});

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
      slide.timestamp ?? '',
      slide.preface ? `${slide.preface.from} ${slide.preface.text}` : '',
      ...(slide.replies ?? []).flatMap((r) => [r.from, r.text]),
    ].join(' ');
    assert.ok(!copy.includes('—'), `slide ${slide.n} contains an em-dash: ${copy}`);
  }
});

test('preface message is rail-agnostic and em-dash free', async () => {
  const { SLIDES } = await import('../slides.config.mjs');
  // Same reasoning as the reply contract: the preface renders directly above
  // the share text, so naming a rail there can contradict it.
  const RAILS = /venmo|zelle|paypal|cash ?app|apple pay/i;
  const prefaces = SLIDES.filter((s) => s.preface).map((s) => s.preface);
  assert.ok(prefaces.length > 0, 'expected at least one slide with a preface');
  for (const p of prefaces) {
    assert.ok(!RAILS.test(p.text), `preface names a payment rail: "${p.text}"`);
    assert.ok(!`${p.from} ${p.text}`.includes('—'), `preface contains an em-dash: "${p.text}"`);
  }
});

test('preface and timestamp are optional in the template', async () => {
  const html = await readFile(path.join(here, '..', 'templates', 'chat-slide.html'), 'utf8');
  // Guarded, because the 'chat-slide renders at iPhone size' test builds slide
  // data without either field.
  assert.ok(html.includes('if (SLIDE.preface)'), 'preface rendering must be guarded');
  assert.ok(html.includes('if (SLIDE.timestamp)'), 'timestamp rendering must be guarded');
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
    'SLIDE.preface',
    'SLIDE.timestamp',
    'SLIDE.reactions',
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

test('chat surface is a bleeding, top-clipping panel', async () => {
  const css = await readFile(path.join(here, '..', 'templates', 'base.css'), 'utf8');
  const html = await readFile(path.join(here, '..', 'templates', 'chat-slide.html'), 'utf8');

  // The panel is the positioned root of the chat scene.
  assert.ok(html.includes('class="surface"'), 'chat-slide.html must wrap the scene in .surface');
  // Note the closing quote: this does NOT match the `class="thread-head"` that
  // stays in the template, only a bare `class="thread"` wrapper.
  assert.ok(!html.includes('class="thread"'), '.thread is replaced by .surface');

  // Surface colour is a shared custom property: the avatar border (Task 5) must
  // match it exactly, so it cannot be duplicated as a literal.
  assert.ok(css.includes('--surface: #141016'), 'base.css must define --surface');
  assert.ok(css.includes('--surface-line:'), 'base.css must define --surface-line');

  // Bleeds off the bottom edge, so its bottom corners are never in frame.
  assert.match(css, /\.surface\s*\{[^}]*bottom:\s*-60px/s, '.surface must bleed past the bottom edge');
  assert.match(css, /\.surface\s*\{[^}]*border-radius:\s*56px 56px 0 0/s, '.surface has top corners only');

  // Load-bearing: clipping + a bottom-anchored, shrinkable list is what makes
  // surplus content clip at the TOP instead of becoming whitespace.
  assert.match(css, /\.surface\s*\{[^}]*overflow:\s*hidden/s, '.surface must clip');
  assert.match(css, /\.msgs\s*\{[^}]*min-height:\s*0/s, '.msgs needs min-height:0 or the panel overflows itself');
  assert.match(css, /\.msgs\s*\{[^}]*justify-content:\s*flex-end/s, '.msgs must be bottom-anchored');
  assert.ok(!/\.msgs\s*\{[^}]*margin-top:\s*auto/s.test(css), 'margin-top:auto is replaced by justify-content');
});

test('chat surface has a compose bar pinned to its bottom row', async () => {
  const html = await readFile(path.join(here, '..', 'templates', 'chat-slide.html'), 'utf8');
  const css = await readFile(path.join(here, '..', 'templates', 'base.css'), 'utf8');

  assert.ok(html.includes('class="compose"'), 'chat-slide.html must render a compose bar');
  assert.ok(html.includes('Message'), 'compose bar needs a placeholder');

  // Fixed row: it must not absorb slack, or it competes with .msgs for the
  // space and the panel stops filling.
  assert.match(css, /\.compose\s*\{[^}]*flex:\s*0 0 auto/s, '.compose must be a fixed row');

  // Judged at thumbnail scale, so the placeholder cannot go below 40px.
  const field = css.match(/\.compose \.field\s*\{([^}]*)\}/s);
  assert.ok(field, 'base.css must style .compose .field');
  const size = Number(field[1].match(/font-size:\s*(\d+)px/)[1]);
  assert.ok(size >= 40, `.compose .field font-size is ${size}px, must be >= 40px`);
});

test('sent-side replies are supported and stay rail-agnostic', async () => {
  const { SLIDES } = await import('../slides.config.mjs');
  const html = await readFile(path.join(here, '..', 'templates', 'chat-slide.html'), 'utf8');

  // Absent `side` must keep the existing received styling: the
  // 'chat-slide renders at iPhone size' test passes replies without it.
  assert.ok(html.includes("r.side === 'sent'"), 'template must branch on reply side');

  const sent = SLIDES.flatMap((s) => s.replies ?? []).filter((r) => r.side === 'sent');
  assert.equal(sent.length, 1, 'exactly one sent-side reply, to balance the bottom-right');
  // The global rail contract applies to every reply regardless of side; this
  // asserts the sent-side one is not accidentally exempted.
  assert.ok(!/venmo|zelle|paypal|cash ?app|apple pay/i.test(sent[0].text));
});

test('share bubble is grouped with its reaction pill and receipt', async () => {
  const html = await readFile(path.join(here, '..', 'templates', 'chat-slide.html'), 'utf8');
  const css = await readFile(path.join(here, '..', 'templates', 'base.css'), 'utf8');

  assert.ok(html.includes('sent-group'), 'share bubble must live in a .sent-group');
  assert.ok(html.includes('Delivered'), 'template must render a delivery receipt');
  assert.ok(html.includes('if (SLIDE.reactions)'), 'reactions must be guarded');

  // The group has no gap, so the pill's negative margin is an exact overlap
  // rather than being partly eaten by .msgs' 28px gap.
  assert.match(css, /\.sent-group\s*\{[^}]*align-items:\s*flex-end/s, '.sent-group is right-aligned');
  assert.ok(!/\.sent-group\s*\{[^}]*gap:/s.test(css), '.sent-group must not set a gap');
});

test('avatars are legible and punched out of the surface', async () => {
  const css = await readFile(path.join(here, '..', 'templates', 'base.css'), 'utf8');
  const av = css.match(/\.avatars \.av\s*\{([^}]*)\}/s);
  assert.ok(av, 'base.css must style .avatars .av');

  // -34px on 84px circles mashed D/M/P/W into an unreadable blob.
  const overlap = Number(av[1].match(/margin-left:\s*-(\d+)px/)[1]);
  assert.ok(overlap <= 22, `avatar overlap is -${overlap}px, must be <= -22px to stay legible`);

  // The avatars now sit on the panel, not the gradient. The border must match
  // the surface exactly or the punched-out effect breaks -- hence the shared
  // custom property rather than a duplicated literal.
  assert.match(av[1], /border:[^;]*var\(--surface\)/, 'avatar border must use var(--surface)');
});

// Hydrate the real device template and read the CSSOM. Deliberately no
// screenshot: this allocates no large buffers, so a failing assertion cannot
// trigger Node's buffer diff formatter (see the captureZoom test's note above).
async function probeStyles(browser, { data, tmpName, evaluate }) {
  const template = path.join(here, '..', 'templates', 'device-slide.html');
  const raw = await readFile(template, 'utf8');
  const html = raw.replace('/*__SLIDE_JSON__*/null', JSON.stringify(data));
  const tmp = path.join(path.dirname(template), `.tmp-${tmpName}.html`);
  await writeFile(tmp, html);
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1290, height: 2796, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
    return await page.evaluate(evaluate);
  } finally {
    await page.close();
    await rm(tmp, { force: true });
  }
}

const BASE_SLIDE = {
  kicker: 'Settle Up',
  headline: ['Who Pays Who', 'And How'],
  capture: '../test/fixtures/placeholder-capture.png',
  device: 'iphone',
  layout: 'hero',
  cards: [],
};

test('canvas background is a flat colour, not a gradient', async () => {
  const browser = await puppeteer.launch();
  try {
    const cs = await probeStyles(browser, {
      data: BASE_SLIDE,
      tmpName: 'bg-probe',
      evaluate: () => {
        const s = getComputedStyle(document.body);
        return { backgroundImage: s.backgroundImage, backgroundColor: s.backgroundColor };
      },
    });
    assert.equal(cs.backgroundImage, 'none', 'body must not paint a gradient');
    assert.equal(cs.backgroundColor, 'rgb(42, 10, 51)', 'body must be flat #2A0A33');
  } finally {
    await browser.close();
  }
});

test('custom properties left dead by the flat background are removed', async () => {
  const css = await readFile(path.join(here, '..', 'templates', 'base.css'), 'utf8');
  for (const dead of ['--bg-top', '--bg-mid', '--bg-glow']) {
    assert.ok(!css.includes(dead), `base.css still references dead property ${dead}`);
  }
});

test('layout-top scrim fades into the flat background colour', async () => {
  const css = await readFile(path.join(here, '..', 'templates', 'base.css'), 'utf8');
  const rule = css.match(/body\.layout-top \.caption::before \{[\s\S]*?\}/);
  assert.ok(rule, 'expected a body.layout-top .caption::before rule');
  assert.ok(
    rule[0].includes('rgba(42,10,51,.98)'),
    'the scrim\'s bottom stop must match the flat background #2A0A33, '
    + `otherwise it bands against it. Rule was:\n${rule[0]}`,
  );
});

// The rail is a gradient BORDER, which plain CSS cannot express: a solid border
// takes one colour, and border-image ignores border-radius. The working
// construction is a transparent border plus two background layers clipped to
// different boxes -- screen to padding-box, rail to border-box. Assert the clip
// pair directly: it is the whole trick, and losing it silently reverts the rail
// to a flat transparent border with the screen bleeding under it.
test('device frame is a gradient rail, not a solid border', async () => {
  const browser = await puppeteer.launch();
  try {
    const cs = await probeStyles(browser, {
      data: BASE_SLIDE,
      tmpName: 'rail-probe',
      evaluate: () => {
        const s = getComputedStyle(document.querySelector('.device'));
        return {
          borderTopWidth: s.borderTopWidth,
          borderTopColor: s.borderTopColor,
          borderTopLeftRadius: s.borderTopLeftRadius,
          backgroundClip: s.backgroundClip || s.webkitBackgroundClip,
          backgroundOrigin: s.backgroundOrigin,
          backgroundImage: s.backgroundImage,
        };
      },
    });

    // This Chrome build snaps border-width to the nearest multiple of 0.8px
    // under the host's 1.25x display scaling (confirmed: 11 -> 10.4, 17 -> 16.8,
    // reproducible on a bare <div style="border:11px solid red">, unrelated to
    // any CSS in this file). A tolerance keeps the assertion meaningful -- it
    // still rejects the old 17px rail -- while staying portable to a 100%-DPI
    // environment where 11px would serialise exactly.
    const railWidth = parseFloat(cs.borderTopWidth);
    assert.ok(Math.abs(railWidth - 11) < 1,
      `rail must be ~11px; got ${cs.borderTopWidth}`);
    assert.equal(cs.borderTopColor, 'rgba(0, 0, 0, 0)',
      'the border itself must be transparent -- the rail is painted by the border-box background layer');
    assert.equal(cs.borderTopLeftRadius, '74px', 'rail radius must be 74px');
    assert.equal(cs.backgroundClip, 'padding-box, border-box',
      'screen layer must clip to padding-box and the rail layer to border-box');
    assert.equal(cs.backgroundOrigin, 'border-box, border-box',
      'both layers must originate at the border box or the rail gradient is offset');

    const layers = cs.backgroundImage.match(/linear-gradient/g) ?? [];
    assert.equal(layers.length, 2,
      `expected exactly 2 background layers (screen + rail), got ${layers.length}: ${cs.backgroundImage}`);
    assert.ok(cs.backgroundImage.includes('138deg'),
      `rail gradient must run at 138deg so the highlight lands on the upper-left edge: ${cs.backgroundImage}`);
  } finally {
    await browser.close();
  }
});

test('rail colours are tunable from custom properties', async () => {
  const css = await readFile(path.join(here, '..', 'templates', 'base.css'), 'utf8');
  // Assert the knob is BOTH declared and wired up. Checking only that the name
  // appears would still pass if someone pasted devtools output back into the
  // gradient (devtools resolves var() away), orphaning the :root declarations
  // and silently killing the documented tuning knob. The computed-style test
  // above cannot catch that either -- it reads var() already resolved to rgb().
  for (const knob of ['--rail-hi', '--rail-lo']) {
    assert.ok(css.includes(`${knob}:`), `base.css must declare ${knob}`);
    assert.ok(css.includes(`var(${knob})`),
      `.device's rail gradient must reference var(${knob}), not a resolved colour`);
  }
  for (const dead of ['--frame', '--screen-bg']) {
    assert.ok(!css.includes(dead), `base.css still references dead property ${dead}`);
  }
});
