import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({
  appType: 'custom', configFile: false, root,
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});
after(async () => { await vite.close(); });
const { buildInvestigationReleasePdf } = await vite.ssrLoadModule('/lib/investigation-pdf-release.ts');
const { extractCanvasJpegPages } = await vite.ssrLoadModule('/lib/investigation-pdf-lifecycle.ts');

function event(eventId, memberId, vehicleIdentifier, latitude, longitude) {
  const observedAt = '2026-09-19T12:00:05Z';
  return { result: {
    eventId, groupId: `group-${eventId}`, serverId: 1,
    startAt: '2026-09-19T12:00:00Z', endAt: '2026-09-19T12:00:10Z',
    runId: `run-${eventId}`, codeVersion: 'core-sha', configVersion: 'config-hash',
    templateId: 'template-actual', templateVersion: 'v1',
    frameCount: 1, scoredFrameCount: 1, missingFrameCount: 0,
    summary: { total: 72, sync: 67, route: 82 }, rootCauses: [], routes: [],
    lifecycle: { status: 'unknown', openedAt: null, openingReason: null,
      endedAt: null, endingReason: null, finalizeAt: null, closedAt: null, changes: [] },
    points: [{ observedAt, group: { valid: true, total: 72, sync: 67, route: 82 },
      pendingReason: null,
      members: [{ memberId, slotId: 'slot-a', routeInstanceId: 'r0', valid: true,
        sync: 67, route: 82, total: 72, primaryReason: null }],
      navigation: [{ memberId, vehicleIdentifier, latitude, longitude, reliability: 1, active: true }],
    }],
  } };
}

/** The emitted JPEG payload is tagged by the canvas's ACTUALLY DRAWN text.
 * This exercises the complete release compositor and decoded page order;
 * unlike regexp checks it fails if the map is appended to the wrong event. */
function fakeBrowser() {
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  const previousWindow = globalThis.window;
  let pages = 0;
  class Context {
    labels = [];
    save() {} restore() {} fillRect() {} beginPath() {} roundRect() {}
    fill() {} stroke() {} strokeRect() {} moveTo() {} lineTo() {}
    arc() {} drawImage() {} clip() {}
    measureText(value) { return { width: String(value).length * 8 }; }
    fillText(value) { this.labels.push(String(value)); }
    createLinearGradient() { return { addColorStop() {} }; }
  }
  class Canvas {
    constructor() { this.width = 0; this.height = 0; this.context = new Context(); pages += 1; }
    getContext(kind) { assert.equal(kind, '2d'); return this.context; }
    toDataURL() {
      const content = Buffer.from(this.context.labels.join(' | '), 'utf8');
      const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), content, Buffer.from([0xff, 0xd9])]);
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    }
  }
  globalThis.document = {
    fonts: { ready: Promise.resolve() },
    createElement(kind) { assert.equal(kind, 'canvas'); return new Canvas(); },
  };
  // WMTS profile cannot be inferred offline: this is the honest engineering
  // grid path, not fake web map tiles or a network dependency.
  delete globalThis.window;
  globalThis.Image = class {
    set src(_value) { queueMicrotask(() => this.onload?.()); }
  };
  return {
    get pages() { return pages; },
    restore() {
      if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
      if (previousImage === undefined) delete globalThis.Image; else globalThis.Image = previousImage;
      if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    },
  };
}

test('release PDF renders each source event, Hebrew synopsis and its own WMTS map consecutively', async () => {
  const browser = fakeBrowser();
  try {
    const report = {
      serverId: 1, from: '2026-09-19T12:00:00Z', to: '2026-09-19T12:01:00Z',
      generatedAt: '2026-09-20T05:00:00Z',
      events: [event('observed-event-A', 'vehicle-A', 101, 31.25, 34.45),
        event('observed-event-B', 'vehicle-B', 202, 32.25, 35.45)],
    };
    const bytes = await buildInvestigationReleasePdf(report);
    const pages = extractCanvasJpegPages(bytes)
      .map(({ jpeg }) => Buffer.from(jpeg).toString('utf8'));
    const find = (text) => pages.findIndex((page) => page.includes(text));
    const ordered = [
      'דוח תחקור אירועים',
      'מפה מסכמת לכל טווח התחקור',
      'מפת רקע מבצעית — טווח התחקור',
      'אירוע 1 מתוך 2',
      'תחקור מקצועי · אירוע 1 מתוך 2',
      'מפת WMTS · אירוע 1',
      'אירוע 2 מתוך 2',
      'תחקור מקצועי · אירוע 2 מתוך 2',
      'מפת WMTS · אירוע 2',
      'Lifecycle אירוע 1 מתוך 2',
      'Lifecycle אירוע 2 מתוך 2',
    ];
    const positions = ordered.map(find);
    assert.ok(positions.every((position) => position >= 0), `missing page: ${ordered.filter((_, i) => positions[i] < 0).join(', ')}`);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'PDF chapters must retain the correct event-to-map relationship');
    assert.equal(positions[5] + 1, positions[6], 'event B must immediately follow event A map');
    assert.ok(pages[positions[4]].includes('observed-event-A'));
    assert.ok(pages[positions[7]].includes('observed-event-B'));
    assert.ok(pages[positions[5]].includes('תחילה · רכב 101'));
    assert.ok(pages[positions[8]].includes('סוף · רכב 202'));
    assert.equal(Number(Buffer.from(bytes).toString('latin1').match(/\/Count (\d+)/)?.[1]), pages.length);
    assert.ok(browser.pages >= pages.length - 1);
  } finally { browser.restore(); }
});
