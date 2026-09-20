import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { buildInvestigationBrandedCover } = await vite.ssrLoadModule('/lib/investigation-pdf-brand.ts');
const { OFFLINE_FAVICON_SVG } = await vite.ssrLoadModule('/lib/investigation-pdf-logo-offline.ts');

function installCanvasAndLogo({ failPrimary = false, failAll = false } = {}) {
  const originalDocument = globalThis.document;
  const originalImage = globalThis.Image;
  const originalWarn = console.warn;
  const drawnText = [];
  const loadedImages = [];
  const warnings = [];
  let drawnLogoCount = 0;
  const ctx = {
    save() {}, restore() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {},
    fillRect() {}, moveTo() {}, lineTo() {},
    createLinearGradient() { return { addColorStop() {} }; },
    fillText(value) { drawnText.push(value); },
    drawImage() { drawnLogoCount += 1; },
  };
  globalThis.document = { createElement(tag) {
    assert.equal(tag, 'canvas');
    return { width: 0, height: 0, getContext(kind) { assert.equal(kind, '2d'); return ctx; },
      toDataURL(type) { assert.equal(type, 'image/jpeg'); return `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 217]).toString('base64')}`; },
    };
  } };
  globalThis.Image = class {
    set src(value) {
      loadedImages.push(value);
      queueMicrotask(() => {
        if (failAll || (failPrimary && value === '/favicon.svg')) this.onerror?.();
        else this.onload?.();
      });
    }
  };
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  return {
    drawnText, loadedImages, warnings,
    get drawnLogoCount() { return drawnLogoCount; },
    restore() {
      if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
      if (originalImage === undefined) delete globalThis.Image; else globalThis.Image = originalImage;
      console.warn = originalWarn;
    },
  };
}

const report = {
  serverId: 2,
  from: '2026-09-19T00:00:00.000Z',
  to: '2026-09-20T00:00:00.000Z',
  generatedAt: '2026-09-20T02:00:00.000Z',
  events: [
    { result: { groupId: 'si-1', scoredFrameCount: 4, missingFrameCount: 1 } },
    { result: { groupId: 'si-1', scoredFrameCount: 7, missingFrameCount: 2 } },
    { result: { groupId: 'so-2', scoredFrameCount: 3, missingFrameCount: 0 } },
  ],
};

test('REP-01 cover loads the actual app logo and renders counts from selected report evidence', async () => {
  const fixture = installCanvasAndLogo();
  try {
    const page = await buildInvestigationBrandedCover(report);
    assert.deepEqual(fixture.loadedImages, ['/favicon.svg']);
    assert.equal(fixture.drawnLogoCount, 1);
    assert.equal(page.width, 1190);
    assert.equal(page.height, 1684);
    assert.deepEqual([...page.jpeg], [255, 216, 255, 217]);
    for (const expected of ['זאב כחול', 'דוח תחקור אירועים', 'שרת 2', 'אירועים', '3', 'קבוצות', '2', 'מסגרות עם ציון', '14', 'מסגרות חסרות']) {
      assert.ok(fixture.drawnText.includes(expected), `cover must render ${expected}`);
    }
    assert.deepEqual(fixture.warnings, []);
  } finally { fixture.restore(); }
});

test('offline fallback contains exactly the actual app favicon, not a similarly named placeholder', async () => {
  const favicon = await readFile('public/favicon.svg', 'utf8');
  assert.equal(OFFLINE_FAVICON_SVG, favicon);
  const fixture = installCanvasAndLogo({ failPrimary: true });
  try {
    await buildInvestigationBrandedCover(report);
    assert.equal(fixture.loadedImages[0], '/favicon.svg');
    assert.equal(fixture.loadedImages.length, 2);
    assert.ok(fixture.loadedImages[1].startsWith('data:image/svg+xml;charset=utf-8,'));
    assert.equal(decodeURIComponent(fixture.loadedImages[1].split(',')[1]), favicon);
    assert.equal(fixture.drawnLogoCount, 1);
    assert.ok(fixture.warnings.some((warning) => warning.includes('/favicon.svg unavailable')));
  } finally { fixture.restore(); }
});

test('even when both logo sources fail the PDF remains branded and the failure is reported', async () => {
  const fixture = installCanvasAndLogo({ failAll: true });
  try {
    await buildInvestigationBrandedCover(report);
    assert.equal(fixture.drawnLogoCount, 0);
    assert.ok(fixture.drawnText.includes('זאב כחול'));
    assert.ok(fixture.warnings.some((warning) => warning.includes('embedded favicon failed')));
  } finally { fixture.restore(); }
});
