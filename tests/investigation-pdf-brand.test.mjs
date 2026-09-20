import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { buildInvestigationBrandedCover } = await vite.ssrLoadModule('/lib/investigation-pdf-brand.ts');

function installCanvasAndLogo() {
  const originalDocument = globalThis.document;
  const originalImage = globalThis.Image;
  const drawnText = [];
  const loadedImages = [];
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
    set src(value) { loadedImages.push(value); queueMicrotask(() => this.onload?.()); }
  };
  return {
    drawnText,
    loadedImages,
    get drawnLogoCount() { return drawnLogoCount; },
    restore() {
      if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
      if (originalImage === undefined) delete globalThis.Image; else globalThis.Image = originalImage;
    },
  };
}

test('REP-01 cover loads the actual app logo and renders counts from selected report evidence', async () => {
  const fixture = installCanvasAndLogo();
  try {
    const page = await buildInvestigationBrandedCover({
      serverId: 2,
      from: '2026-09-19T00:00:00.000Z',
      to: '2026-09-20T00:00:00.000Z',
      generatedAt: '2026-09-20T02:00:00.000Z',
      events: [
        { result: { groupId: 'si-1', scoredFrameCount: 4, missingFrameCount: 1 } },
        { result: { groupId: 'si-1', scoredFrameCount: 7, missingFrameCount: 2 } },
        { result: { groupId: 'so-2', scoredFrameCount: 3, missingFrameCount: 0 } },
      ],
    });
    assert.deepEqual(fixture.loadedImages, ['/favicon.svg']);
    assert.equal(fixture.drawnLogoCount, 1);
    assert.equal(page.width, 1190);
    assert.equal(page.height, 1684);
    assert.deepEqual([...page.jpeg], [255, 216, 255, 217]);
    for (const expected of ['זאב כחול', 'דוח תחקור אירועים', 'שרת 2', 'אירועים', '3', 'קבוצות', '2', 'מסגרות עם ציון', '14', 'מסגרות חסרות']) {
      assert.ok(fixture.drawnText.includes(expected), `cover must render ${expected}`);
    }
    assert.ok(fixture.drawnText.includes('נתוני האירועים בטווח שנבחר') === false, 'do not assert an exact optional subtitle');
  } finally {
    fixture.restore();
  }
});
