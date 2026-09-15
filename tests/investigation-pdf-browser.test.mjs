import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const browserPdf = await vite.ssrLoadModule('/lib/investigation-pdf-browser.ts');
const reportData = await vite.ssrLoadModule('/lib/investigation-report-data.ts');

function recomputePayload() {
  return {
    schemaVersion: 'bluewolf.event-recompute.v1', runId: 'run-rtl', scenarioId: 'report:event-rtl', eventId: 'event-rtl', serverId: 7, groupId: 'g1',
    templateId: 'tpl-a', templateVersion: 'tpl-v1', codeVersion: 'sha-rtl', configVersion: 'cfg-rtl',
    startAt: '2026-09-15T06:00:00Z', endAt: '2026-09-15T06:00:05Z', frameCount: 1, scoredFrameCount: 1, missingFrameCount: 0,
    summary: { sync: 90, route: 91, total: 90 }, rootCauses: [{ reason: 'so_template_phase', occurrences: 1 }],
    points: [{
      observedAt: '2026-09-15T06:00:05Z', pendingReason: null,
      group: { valid: true, sync: 90, route: 91, total: 90 },
      members: [{ memberId: 'v1', routeInstanceId: 'r1', slotId: 'a', expectedPhase: 0, positionErrorCycle: 0, valid: true, sync: 90, route: 91, total: 90, primaryReason: 'so_template_phase' }],
      navigation: [{ memberId: 'v1', vehicleIdentifier: 101, latitude: 32, longitude: 34.8, altitudeM: 10, velocityNorthMps: 1, velocityEastMps: 0, headingDeg: 0, active: true, reliability: 1 }],
    }],
  };
}

test('local JPEG page wrapper creates a structurally valid multi-page PDF without external libraries', () => {
  const fakeJpegA = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 0xff, 0xd9]);
  const fakeJpegB = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 4, 5, 6, 0xff, 0xd9]);
  const pdf = browserPdf.jpegPagesToPdf([
    { jpeg: fakeJpegA, width: 20, height: 30 },
    { jpeg: fakeJpegB, width: 20, height: 30 },
  ]);
  const latin = Buffer.from(pdf).toString('latin1');
  assert.ok(latin.startsWith('%PDF-1.4'));
  assert.match(latin, /\/Count 2/);
  assert.equal((latin.match(/\/DCTDecode/g) || []).length, 2);
  assert.match(latin, /xref\n0 9/);
  assert.match(latin, /startxref\n\d+\n%%EOF/);
});

test('report data contract preserves Hebrew metadata and refuses provenance mismatch', () => {
  const envelope = reportData.normalizeInvestigationReportData({
    schemaVersion: 'bluewolf.investigation-report-data.v1',
    source: 'core-event-archive',
    codeVersion: 'sha-rtl',
    configVersion: 'cfg-rtl',
    report: {
      serverId: 7,
      from: '2026-09-15T06:00:00Z',
      to: '2026-09-15T07:00:00Z',
      generatedAt: '2026-09-15T07:01:00Z',
      events: [{ result: recomputePayload(), arena: 'זירה צפונית', note: 'טקסט תחקור בעברית' }],
    },
  });
  assert.equal(envelope.report.events[0].arena, 'זירה צפונית');
  assert.equal(envelope.report.events[0].note, 'טקסט תחקור בעברית');
  assert.equal(envelope.report.events[0].result.codeVersion, 'sha-rtl');
  assert.throws(() => reportData.normalizeInvestigationReportData({
    ...envelope,
    codeVersion: 'different-sha',
  }), /code version mismatch/);
});

test('REP-01 renderer sends Hebrew metadata to RTL canvas and paginates long detail tables', async () => {
  const originalDocument = globalThis.document;
  const rendered = [];
  const canvases = [];
  class FakeContext {
    constructor() {
      this.direction = 'ltr';
      this.textAlign = 'left';
      this.font = '';
      this.fillStyle = '#000';
      this.strokeStyle = '#000';
      this.lineWidth = 1;
      this.textBaseline = 'alphabetic';
    }
    save() {}
    restore() {}
    fillRect() {}
    beginPath() {}
    moveTo() {}
    lineTo() {}
    stroke() {}
    roundRect() {}
    fill() {}
    measureText(value) { return { width: String(value).length * 10 }; }
    fillText(value) { rendered.push({ text: String(value), direction: this.direction, align: this.textAlign, font: this.font }); }
  }
  class FakeCanvas {
    constructor() { this.width = 0; this.height = 0; this.context = new FakeContext(); canvases.push(this); }
    getContext(kind) { return kind === '2d' ? this.context : null; }
    toDataURL() { return `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`; }
  }
  globalThis.document = {
    fonts: { ready: Promise.resolve() },
    createElement(name) { if (name !== 'canvas') throw new Error(`unexpected element ${name}`); return new FakeCanvas(); },
  };
  try {
    const result = recomputePayload();
    result.rootCauses = Array.from({ length: 18 }, (_, index) => ({ reason: `reason-${index + 1}`, occurrences: index + 1 }));
    result.points[0].members = Array.from({ length: 65 }, (_, index) => ({
      memberId: `v${index + 1}`,
      routeInstanceId: `r${index + 1}`,
      slotId: `slot-${index + 1}`,
      expectedPhase: (index % 4) / 4,
      positionErrorCycle: 0.01,
      valid: true,
      sync: 88,
      route: 91,
      total: 89,
      primaryReason: 'so_template_phase',
    }));
    result.points[0].navigation = Array.from({ length: 65 }, (_, index) => ({
      memberId: `v${index + 1}`,
      vehicleIdentifier: 1000 + index,
      latitude: 32 + index * 0.00001,
      longitude: 34.8 + index * 0.00001,
      altitudeM: 10,
      velocityNorthMps: 1,
      velocityEastMps: 0,
      headingDeg: 0,
      active: true,
      reliability: 1,
    }));
    const report = {
      serverId: 7,
      from: '2026-09-15T06:00:00Z',
      to: '2026-09-15T07:00:00Z',
      generatedAt: '2026-09-15T07:01:00Z',
      events: [{ result, arena: 'זירה צפונית', note: 'טקסט תחקור בעברית ללא חיתוך' }],
    };
    const pdf = await browserPdf.buildInvestigationPdfBrowser(report);
    const latin = Buffer.from(pdf).toString('latin1');
    const count = Number(latin.match(/\/Count (\d+)/)?.[1] || 0);
    assert.ok(count >= 5, `expected long report to paginate to at least five pages, got ${count}`);
    assert.equal(canvases.length, count);
    assert.ok(rendered.some((item) => item.text.includes('זאב כחול — דוח תחקור הנדסי') && item.direction === 'rtl'));
    assert.ok(rendered.some((item) => item.text.includes('זירה צפונית') && item.direction === 'rtl'));
    assert.ok(rendered.some((item) => item.text.includes('טקסט תחקור בעברית ללא חיתוך') && item.direction === 'rtl'));
    assert.ok(rendered.some((item) => item.text.includes('רכב v65') && item.direction === 'rtl'));
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('REP-01 renderer is local, RTL-first, Hebrew-bearing, paginated, and avoids the legacy ASCII replacement path', async () => {
  const source = await readFile('lib/investigation-pdf-browser.ts', 'utf8');
  const panel = await readFile('components/bluewolf/investigation-report-panel.tsx', 'utf8');
  assert.match(source, /זאב כחול — דוח תחקור הנדסי/);
  assert.match(source, /ctx\.direction = options\.dir \?\? "rtl"/);
  assert.match(source, /Noto Sans Hebrew/);
  assert.match(source, /document\.fonts\.ready/);
  assert.match(source, /toDataURL\("image\/jpeg"/);
  assert.match(source, /eventDetailPages/);
  assert.doesNotMatch(source, /\[\^\\x20-\\x7E\]/);
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /window\.print/);
  assert.match(panel, /format: "data"/);
  assert.match(panel, /normalizeInvestigationReportData/);
  assert.match(panel, /buildInvestigationPdfBrowser/);
  assert.match(panel, /אין CDN/);
});
