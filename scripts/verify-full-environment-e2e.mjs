import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const web = (process.env.BLUEWOLF_E2E_WEB_URL || '').trim().replace(/\/$/, '');
const configPath = (process.env.BLUEWOLF_OPERATIONAL_CONFIG || '').trim();
const statePath = resolve(process.env.BLUEWOLF_E2E_STATE_FILE || '/tmp/bluewolf-full-e2e.json');

assert.ok(web.startsWith('http'), 'BLUEWOLF_E2E_WEB_URL is required');
assert.ok(configPath, 'BLUEWOLF_OPERATIONAL_CONFIG is required');

const cfg = JSON.parse(await readFile(resolve(configPath), 'utf8'));
const serverIds = (cfg.servers || []).map(row => Number(row.id));
assert.ok(serverIds.length >= 3 && serverIds.every(Number.isInteger), 'three numeric server IDs are required');

async function request(path, init = {}, timeoutMs = 120000) {
  const response = await fetch(web + path, { ...init, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : new Uint8Array(await response.arrayBuffer());
  return { response, body };
}

function eventChoice(listing, serverId) {
  assert.equal(listing?.schemaVersion, 'bluewolf.investigation-events.v1');
  assert.equal(Number(listing?.serverId), serverId);
  assert.ok(Array.isArray(listing.events) && listing.events.length > 0, 'server ' + serverId + ': no archived events');
  const event = listing.events.find(item => typeof item?.activeTemplateId === 'string' && item.activeTemplateId.length > 0);
  assert.ok(event, 'server ' + serverId + ': no event with archived active template provenance');
  assert.ok(typeof event.eventId === 'string' && event.eventId);
  assert.ok(typeof event.groupId === 'string' && event.groupId);
  assert.ok(event.family === 'SI' || event.family === 'SO');
  return event;
}

async function verifyPersisted(expected) {
  for (const item of expected) {
    const listingResult = await request('/api/investigation/events?serverId=' + encodeURIComponent(item.serverId));
    assert.equal(listingResult.response.status, 200, 'server ' + item.serverId + ': event archive unavailable after restart');
    assert.ok(listingResult.body.events.some(event => event.eventId === item.eventId), 'server ' + item.serverId + ': event did not survive restart');
    const historyResult = await request('/api/investigation/recomputations?eventId=' + encodeURIComponent(item.eventId) + '&limit=50');
    assert.equal(historyResult.response.status, 200, 'server ' + item.serverId + ': recompute history unavailable after restart');
    assert.equal(historyResult.body.eventId, item.eventId);
    assert.ok(historyResult.body.runs.some(run => run.runId === item.runId), 'server ' + item.serverId + ': recompute run did not survive restart');
  }
  console.log('PASS full-environment restart persistence: ' + expected.length + ' archived events and recompute runs survived Core/Web restart');
}

if (process.env.BLUEWOLF_E2E_VERIFY_PERSISTED === '1') {
  const expected = JSON.parse(await readFile(statePath, 'utf8'));
  assert.ok(Array.isArray(expected) && expected.length >= 3, 'persisted E2E state file is incomplete');
  await verifyPersisted(expected);
  process.exit(0);
}

const expected = [];
for (const serverId of serverIds) {
  const listed = await request('/api/investigation/events?serverId=' + encodeURIComponent(serverId));
  assert.equal(listed.response.status, 200, 'server ' + serverId + ': event list HTTP ' + listed.response.status);
  const event = eventChoice(listed.body, serverId);

  const recomputed = await request('/api/investigation/recompute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      eventId: event.eventId,
      templateId: event.activeTemplateId,
      serverId,
      groupId: event.groupId,
      family: event.family,
      scenarioId: 'full-e2e:' + (process.env.GITHUB_RUN_ID || 'local') + ':' + serverId,
    }),
  });
  assert.equal(recomputed.response.status, 200, 'server ' + serverId + ': recompute failed: ' + JSON.stringify(recomputed.body));
  assert.equal(recomputed.body.eventId, event.eventId);
  assert.equal(recomputed.body.serverId, serverId);
  assert.equal(recomputed.body.groupId, event.groupId);
  assert.equal(recomputed.body.family, event.family);
  assert.ok(typeof recomputed.body.runId === 'string' && recomputed.body.runId);
  assert.ok(typeof recomputed.body.evidenceVersion === 'string' && recomputed.body.evidenceVersion);
  assert.ok(typeof recomputed.body.codeVersion === 'string' && recomputed.body.codeVersion);
  assert.ok(typeof recomputed.body.configVersion === 'string' && recomputed.body.configVersion);
  assert.ok(Array.isArray(recomputed.body.points) && recomputed.body.points.some(point => point?.group?.valid === true));

  const history = await request('/api/investigation/recomputations?eventId=' + encodeURIComponent(event.eventId) + '&limit=50');
  assert.equal(history.response.status, 200, 'server ' + serverId + ': recompute history HTTP ' + history.response.status);
  assert.equal(history.body.eventId, event.eventId);
  assert.ok(history.body.runs.some(run => run.runId === recomputed.body.runId), 'server ' + serverId + ': recompute history missing current run');

  const overrides = [{
    eventId: event.eventId,
    templateId: event.activeTemplateId,
    requiredCodeVersion: recomputed.body.codeVersion,
    requiredConfigVersion: recomputed.body.configVersion,
    requiredTemplateVersion: recomputed.body.templateVersion,
  }];
  const reportRequest = { source: 'core', serverId, from: event.startAt, to: event.endAt, overrides };
  const report = await request('/api/investigation/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...reportRequest, format: 'data' }),
  });
  assert.equal(report.response.status, 200, 'server ' + serverId + ': report data failed: ' + JSON.stringify(report.body));
  assert.equal(report.body.schemaVersion, 'bluewolf.investigation-report-data.v1');
  assert.equal(report.body.source, 'core-event-archive');
  assert.equal(report.body.codeVersion, recomputed.body.codeVersion);
  assert.equal(report.body.configVersion, recomputed.body.configVersion);
  assert.ok(Array.isArray(report.body.report?.events) && report.body.report.events.some(row => row.result?.eventId === event.eventId));

  const pdf = await request('/api/investigation/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...reportRequest, format: 'pdf' }),
  }, 180000);
  assert.equal(pdf.response.status, 200, 'server ' + serverId + ': PDF HTTP ' + pdf.response.status);
  assert.match(pdf.response.headers.get('content-type') || '', /^application\/pdf/);
  assert.ok(pdf.body instanceof Uint8Array && pdf.body.length > 1000, 'server ' + serverId + ': PDF is unexpectedly small');
  assert.equal(Buffer.from(pdf.body.subarray(0, 4)).toString('ascii'), '%PDF');

  expected.push({ serverId, eventId: event.eventId, runId: recomputed.body.runId });
  console.log('PASS server ' + serverId + ': event ' + event.eventId + ' -> recompute ' + recomputed.body.runId + ' -> history -> report data/PDF');
}

await writeFile(statePath, JSON.stringify(expected, null, 2), 'utf8');
console.log('PASS full-environment evidence chain for ' + expected.length + ' servers; state saved for restart verification');
