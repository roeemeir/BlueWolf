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
