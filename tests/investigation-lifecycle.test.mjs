import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const contract = await vite.ssrLoadModule('/lib/investigation-contract.ts');
const lifecyclePdf = await vite.ssrLoadModule('/lib/investigation-pdf-lifecycle.ts');
const basePdf = await vite.ssrLoadModule('/lib/investigation-pdf-browser.ts');

function lifecycle(status = 'closed') {
  return {
    status,
    openedAt: '2026-09-16T10:00:00Z',
    openingReason: 'group_became_active',
    endedAt: status === 'active' ? null : '2026-09-16T10:00:20Z',
    endingReason: status === 'active' ? null : 'structural_group_ended',
    finalizeAt: status === 'active' ? null : '2026-09-16T10:02:20Z',
    closedAt: status === 'closed' ? '2026-09-16T10:02:20Z' : null,
    changes: [
      { occurredAt: '2026-09-16T10:00:00Z', kind: 'event_opened', serverId: 7, groupId: 'g1', details: { reason: 'group_became_active' } },
      { occurredAt: '2026-09-16T10:00:08Z', kind: 'alert_opened', serverId: 7, groupId: 'g1', details: { alert_type: 'low_score', score: 42, threshold: 50 } },
      { occurredAt: '2026-09-16T10:00:12Z', kind: 'template_suggested', serverId: 7, groupId: 'g1', details: { active_template_id: 'tpl-a', suggested_template_id: 'tpl-b', advantage: 35 } },
      ...(status === 'active' ? [] : [
        { occurredAt: '2026-09-16T10:00:20Z', kind: 'event_ending', serverId: 7, groupId: 'g1', details: { reason: 'structural_group_ended', finalize_at_utc: '2026-09-16T10:02:20Z' } },
      ]),
      ...(status === 'closed' ? [
        { occurredAt: '2026-09-16T10:00:20Z', kind: 'event_closed', serverId: 7, groupId: 'g1', details: { reason: 'structural_group_ended', finalized_time_utc: '2026-09-16T10:02:20Z' } },
      ] : []),
    ],
  };
}

function recomputeResult() {
  return {
    schemaVersion: 'bluewolf.event-recompute.v1',
    runId: 'run-lifecycle', scenarioId: 'report:event-1', eventId: 'event-1', serverId: 7, groupId: 'g1',
    templateId: 'tpl-a', templateVersion: 'tpl-v1', codeVersion: 'sha-lifecycle', configVersion: 'cfg-lifecycle',
    startAt: '2026-09-16T10:00:00Z', endAt: '2026-09-16T10:00:20Z', frameCount: 1, scoredFrameCount: 1, missingFrameCount: 0,
    routes: [{
      routeInstanceId: 'r1', routeId: 'route-1', family: 'so', subtype: 'hippodrome', topology: 'simple',
      centerLatitude: 32, centerLongitude: 34.8, lengthM: 800, longAxisAM: 120, shortAxisBM: 40, orientationDeg: 0,
      estimatedPeriodS: 100, direction: 'clockwise', detectionQuality: 0.98,
      centerline: [
        { latitude: 32, longitude: 34.799 },
        { latitude: 32.0005, longitude: 34.8 },
        { latitude: 32, longitude: 34.801 },
        { latitude: 31.9995, longitude: 34.8 },
      ],
    }],
    lifecycle: lifecycle('closed'),
    summary: { sync: 88, route: 90, total: 89 },
    rootCauses: [{ reason: 'so_template_phase', occurrences: 1 }],
    points: [{
      observedAt: '2026-09-16T10:00:05Z', pendingReason: null,
      group: { valid: true, sync: 88, route: 90, total: 89 },
      members: [{ memberId: 'v1', routeInstanceId: 'r1', slotId: 'a', expectedPhase: 0, positionErrorCycle: 0, valid: true, sync: 88, route: 90, total: 89, primaryReason: 'so_template_phase' }],
      navigation: [{ memberId: 'v1', vehicleIdentifier: 101, latitude: 32, longitude: 34.8, altitudeM: 10, velocityNorthMps: 1, velocityEastMps: 0, headingDeg: 0, active: true, reliability: 1 }],
    }],
  };
}

test('investigation contract preserves lifecycle and leaves legacy events unknown', () => {
  const legacy = contract.normalizeInvestigationEvents({
    schemaVersion: 'bluewolf.investigation-events.v1', serverId: 7, templates: [],
    events: [{ eventId: 'legacy', serverId: 7, groupId: 'g1', startAt: '2026-09-16T10:00:00Z', endAt: '2026-09-16T10:00:01Z', frameCount: 1, activeTemplateId: null }],
  });
  assert.equal(legacy.events[0].lifecycle.status, 'unknown');
  assert.equal(legacy.events[0].lifecycle.changes.length, 0);

  const current = contract.normalizeInvestigationEvents({
    schemaVersion: 'bluewolf.investigation-events.v1', serverId: 7, templates: [],
    events: [{ eventId: 'current', serverId: 7, groupId: 'g1', startAt: '2026-09-16T10:00:00Z', endAt: '2026-09-16T10:00:20Z', frameCount: 2, activeTemplateId: 'tpl-a', lifecycle: lifecycle('finalizing') }],
  });
  assert.equal(current.events[0].lifecycle.status, 'finalizing');
  assert.equal(current.events[0].lifecycle.endingReason, 'structural_group_ended');
  assert.equal(current.events[0].lifecycle.finalizeAt, '2026-09-16T10:02:20Z');

  assert.throws(() => contract.normalizeInvestigationEvents({
    schemaVersion: 'bluewolf.investigation-events.v1', serverId: 7, templates: [],
    events: [{ eventId: 'bad', serverId: 7, groupId: 'g1', startAt: '2026-09-16T10:00:00Z', endAt: '2026-09-16T10:00:20Z', frameCount: 1, activeTemplateId: null, lifecycle: { ...lifecycle(), status: 'guessed' } }],
  }), /lifecycle status is invalid/);
});

test('lifecycle PDF appends RTL pages and renders EVENT_CLOSED at actual finalization time', async () => {
  const originalDocument = globalThis.document;
  const rendered = [];
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
    fillText(value) { rendered.push({ text: String(value), direction: this.direction }); }
  }
  class FakeCanvas {
    constructor() { this.width = 0; this.height = 0; this.context = new FakeContext(); }
    getContext(kind) { return kind === '2d' ? this.context : null; }
    toDataURL() { return `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`; }
  }
  globalThis.document = { fonts: { ready: Promise.resolve() }, createElement(name) { if (name !== 'canvas') throw new Error(`unexpected ${name}`); return new FakeCanvas(); } };
  try {
    const report = {
      serverId: 7, from: '2026-09-16T09:59:00Z', to: '2026-09-16T10:03:00Z', generatedAt: '2026-09-16T10:04:00Z',
      events: [{ result: contract.normalizeEventRecompute(recomputeResult()), arena: 'זירה צפונית', note: 'בדיקת lifecycle' }],
    };
    const base = await basePdf.buildInvestigationPdfBrowser(report);
    const baseCount = Number(Buffer.from(base).toString('latin1').match(/\/Count (\d+)/)?.[1] || 0);
    const pdf = await lifecyclePdf.buildInvestigationPdfWithLifecycle(report);
    const finalCount = Number(Buffer.from(pdf).toString('latin1').match(/\/Count (\d+)/)?.[1] || 0);
    assert.ok(finalCount > baseCount, `expected lifecycle pages after ${baseCount} base pages, got ${finalCount}`);
    assert.ok(rendered.some((row) => row.text.includes('Lifecycle אירוע') && row.direction === 'rtl'));
    assert.ok(rendered.some((row) => row.text.includes('סטטוס: סגור') && row.direction === 'rtl'));
    assert.ok(rendered.some((row) => row.text.includes('הקבוצה הפכה לפעילה') && row.direction === 'rtl'));
    assert.ok(rendered.some((row) => row.text.includes('המלצה: tpl-a → tpl-b') && row.direction === 'rtl'));
    assert.ok(rendered.some((row) => row.text === '2026-09-16T10:02:20Z'), 'EVENT_CLOSED row must use finalized_time_utc');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('JPEG page extractor preserves every Canvas page from the established PDF renderer', () => {
  const first = Uint8Array.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  const second = Uint8Array.from([0xff, 0xd8, 3, 4, 0xff, 0xd9]);
  const pdf = basePdf.jpegPagesToPdf([{ jpeg: first, width: 20, height: 30 }, { jpeg: second, width: 20, height: 30 }]);
  const extracted = lifecyclePdf.extractCanvasJpegPages(pdf);
  assert.equal(extracted.length, 2);
  assert.deepEqual(Array.from(extracted[0].jpeg), Array.from(first));
  assert.deepEqual(Array.from(extracted[1].jpeg), Array.from(second));
});

test('REP-03/04 UI and PDF remain archive-backed and contain no inferred demo lifecycle', async () => {
  const panel = await readFile('components/bluewolf/investigation-lifecycle-panel.tsx', 'utf8');
  const reportPanel = await readFile('components/bluewolf/investigation-report-panel.tsx', 'utf8');
  const pdf = await readFile('lib/investigation-pdf-lifecycle.ts', 'utf8');
  assert.match(panel, /data-requirements="REP-03 REP-04"/);
  assert.match(panel, /\/api\/investigation\/events/);
  assert.match(panel, /Lifecycle לא קיים בארכיון/);
  assert.match(panel, /אינה מסיקה שהוא פעיל/);
  assert.match(reportPanel, /InvestigationLifecyclePanel/);
  assert.match(reportPanel, /buildInvestigationPdfWithLifecycle/);
  assert.match(reportPanel, /REP-03 REP-04/);
  assert.match(pdf, /finalized_time_utc/);
  assert.doesNotMatch(panel, /buildEvents|getServerScenario/);
  assert.doesNotMatch(pdf, /window\.print|fetch\(/);
});
