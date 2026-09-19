import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const renderer = await vite.ssrLoadModule('/lib/investigation-pdf-browser.ts');

function event(eventId, groupId, offsetMinutes = 0) {
  const base = Date.parse('2026-09-15T06:00:00Z') + offsetMinutes * 60_000;
  const at = (seconds) => new Date(base + seconds * 1000).toISOString();
  return {
    result: {
      schemaVersion: 'bluewolf.event-recompute.v1',
      runId: `run-${eventId}`,
      scenarioId: `scenario-${eventId}`,
      eventId,
      serverId: 7,
      groupId,
      templateId: 'tpl-a',
      templateVersion: 'tpl-v1',
      codeVersion: 'sha-rep02',
      configVersion: 'cfg-rep02',
      startAt: at(0),
      endAt: at(15),
      frameCount: 4,
      scoredFrameCount: 4,
      missingFrameCount: 0,
      routes: [],
      summary: { sync: 90, route: 91, total: 90 },
      rootCauses: [],
      points: [0, 5, 10, 15].map((seconds, index) => ({
        observedAt: at(seconds),
        pendingReason: null,
        group: { valid: true, sync: 90, route: 91, total: 90 },
        members: [{ memberId: 'v1', routeInstanceId: 'r1', slotId: 'a', expectedPhase: 0, positionErrorCycle: 0, valid: true, sync: 90, route: 91, total: 90, primaryReason: null }],
        navigation: [{ memberId: 'v1', vehicleIdentifier: 101, latitude: 32 + index * 0.0001, longitude: 34.8 + index * 0.0001, altitudeM: 10, velocityNorthMps: 1, velocityEastMps: 0, headingDeg: 0, active: true, reliability: 1 }],
      })),
    },
    arena: null,
    note: null,
  };
}

function installFakeCanvas() {
  const originalDocument = globalThis.document;
  class FakeContext {
    constructor() { this.direction = 'ltr'; this.textAlign = 'left'; this.font = ''; this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; this.textBaseline = 'alphabetic'; }
    save() {}
    restore() {}
    fillRect() {}
    beginPath() {}
    moveTo() {}
    lineTo() {}
    stroke() {}
    roundRect() {}
    fill() {}
    measureText(value) { return { width: String(value).length * 9 }; }
    fillText() {}
  }
  class FakeCanvas {
    constructor() { this.width = 0; this.height = 0; this.context = new FakeContext(); }
    getContext(kind) { return kind === '2d' ? this.context : null; }
    toDataURL() { return `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`; }
  }
  globalThis.document = { fonts: { ready: Promise.resolve() }, createElement(name) { if (name !== 'canvas') throw new Error(`unexpected element ${name}`); return new FakeCanvas(); } };
  return () => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  };
}

test('REP-02 assigns a unique deterministic event color across the 200-event report limit', () => {
  const colors = Array.from({ length: 200 }, (_, index) => renderer.investigationEventColor(index));
  assert.equal(new Set(colors).size, 200);
  assert.equal(renderer.investigationEventColor(17), colors[17]);
  assert.throws(() => renderer.investigationEventColor(-1), /non-negative integer/);
});

test('REP-02 summary navigation is clipped to the selected report range', () => {
  const item = event('event-range', 'g-range');
  const report = {
    serverId: 7,
    from: '2026-09-15T06:00:05Z',
    to: '2026-09-15T06:00:10Z',
    generatedAt: '2026-09-15T07:00:00Z',
    events: [item],
  };
  assert.deepEqual(renderer.investigationSummaryFrameTimes(item, report), [
    '2026-09-15T06:00:05.000Z',
    '2026-09-15T06:00:10.000Z',
  ]);
});

test('REP-02 creates a complete legend page when the report has more than eight events', async () => {
  const restore = installFakeCanvas();
  try {
    const report = {
      serverId: 7,
      from: '2026-09-15T06:00:00Z',
      to: '2026-09-15T07:00:00Z',
      generatedAt: '2026-09-15T07:01:00Z',
      events: Array.from({ length: 9 }, (_, index) => event(`event-${index + 1}`, `group-${index + 1}`, index * 2)),
    };
    const pdf = await renderer.buildInvestigationPdfBrowser(report);
    const latin = Buffer.from(pdf).toString('latin1');
    const pageCount = Number(latin.match(/\/Count (\d+)/)?.[1] || 0);
    // cover + summary map + complete legend + 2 pages per event (main + detail)
    assert.equal(pageCount, 21);
  } finally {
    restore();
  }
});
