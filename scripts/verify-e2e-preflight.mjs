import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyCoreProxyParity } from './e2e-core-proxy-parity.mjs';
import { assertCoherentLiveGroupEvidence } from './e2e-coherent-group-evidence.mjs';

// Prerequisite smoke only, NOT full acceptance. Do not publish a QA URL
// without actual archive/recompute, PDF, restart and browser/iPhone evidence.
export function assertOperationalReady(payload) {
  assert.equal(payload?.ok, true, 'operational Core readiness is not healthy');
  assert.equal(payload?.mode, 'operational', 'transport-only QA is never a Core');
  assert.equal(payload?.running, true, 'operational loop is not running');
  assert.ok(Number.isSafeInteger(payload?.tickCount) && payload.tickCount >= 2, 'Core has not polled twice');
  assert.ok(Array.isArray(payload?.serverErrors) && payload.serverErrors.length === 0, 'Core reports source errors');
}

export function assertObservedCoreSnapshot(payload, serverId, nowMs = Date.now()) {
  assert.equal(payload?.schemaVersion, 'bluewolf.live-runtime.v1');
  assert.equal(payload?.serverId, serverId);
  assert.equal(payload?.source?.kind, 'python-core', 'browser/simulator data is not Core evidence');
  assert.equal(payload?.source?.health, 'healthy', 'Core source is stale or unavailable');
  const observedMs = Date.parse(payload?.observedAt ?? '');
  assert.ok(Number.isFinite(observedMs) && Math.abs(nowMs - observedMs) < 20_000, 'Core source time is not current');
  const groups = Array.isArray(payload.groupList) ? payload.groupList : Object.values(payload.groups ?? {});
  assert.ok(groups.length > 0, 'Core did not publish any group');
  assert.ok(groups.some(group => Array.isArray(group?.members) && group.members.some(member =>
    member?.scoreValid === true && Number.isFinite(member.latitude) && Math.abs(member.latitude) <= 90 &&
    Number.isFinite(member.longitude) && Math.abs(member.longitude) <= 180
  )), 'no genuinely observed vehicle with a valid Core score and WGS84 fix');
  assert.ok(groups.some(group => Array.isArray(group?.detectedRoutes) && group.detectedRoutes.some(route =>
    Array.isArray(route.centerline) && route.centerline.length >= 3
  )), 'no Core-detected route with real geometry');
  assert.ok(groups.some(group => typeof group?.event?.id === 'string' && group.event.id.length > 0), 'no Core event');
  return observedMs;
}

export function assertOperationalConfig(config, tokenAvailable) {
  assert.ok(tokenAvailable, 'missing E2E Influx token');
  assert.ok(config && typeof config === 'object' && !Array.isArray(config));
  assert.ok(config.influx && typeof config.influx.url === 'string' && /^https?:\/\//.test(config.influx.url), 'invalid Influx URL');
  assert.ok(!config.influx.url.includes('influxdb2.internal'), 'example Influx URL cannot be used for E2E');
  const servers = config.servers;
  assert.ok(Array.isArray(servers) && servers.length >= 3, 'E2E must configure all three servers');
  const ids = servers.map(row => String(row?.id));
  assert.equal(new Set(ids).size, ids.length, 'duplicate Core server ID');
  assert.ok(servers.every(row => typeof row.tag === 'string' && row.tag.trim() && Array.isArray(row.groups) && row.groups.length > 0), 'server tags/groups must be configured');
  return ids;
}

const getJson = async (base, path, headers = {}) => {
  const response = await fetch(`${base}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(7_000), headers });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
};

/** A genuine active Core typically polls every ~5 seconds, not every 1.2s.
 * Wait for an actual newer source observation, not simply a successful HTTP
 * response or another transport-only readiness tick. Bound the wait and fail
 * closed if the feed stays static. Injectable read/sleep keep this testable.
 */
export async function awaitNewCoreObservation({
  firstObservedMs, serverId, read, sleep = ms => new Promise(done => setTimeout(done, ms)),
  pollSeconds = 5, maxWaitMs = 30_000,
}) {
  assert.ok(Number.isFinite(firstObservedMs), 'initial Core timestamp is invalid');
  assert.ok(Number.isFinite(pollSeconds) && pollSeconds > 0, 'poll cadence must be positive');
  assert.ok(Number.isFinite(maxWaitMs) && maxWaitMs >= 1_000, 'observation wait must be bounded');
  const stepMs = Math.min(1_000, maxWaitMs);
  const attempts = Math.ceil(maxWaitMs / stepMs);
  let latestObserved = firstObservedMs;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(stepMs);
    const candidate = await read();
    const observedMs = assertObservedCoreSnapshot(candidate, serverId);
    // An advancing server clock is insufficient: the new source observation
    // must still contain a complete, coherent, fresh scored Core group.
    if (observedMs > firstObservedMs) {
      assertCoherentLiveGroupEvidence(candidate, serverId);
      return observedMs;
    }
    latestObserved = observedMs;
  }
  throw new Error(`Core feed did not advance for server ${serverId} within ${maxWaitMs}ms (poll cadence ${pollSeconds}s; latest ${latestObserved})`);
}

export async function runE2EPreflight(env = process.env) {
  const configPath = env.BLUEWOLF_OPERATIONAL_CONFIG?.trim();
  assert.ok(configPath, 'E2E operational configuration path is missing');
  const config = JSON.parse(await readFile(resolve(configPath), 'utf8'));
  const tokenName = config.influx?.tokenEnv || 'BLUEWOLF_INFLUX_TOKEN';
  const serverIds = assertOperationalConfig(config, Boolean(env[tokenName]?.trim()));
  const coreUrl = env.BLUEWOLF_CORE_API_URL?.trim().replace(/\/$/, '');
  const webUrl = env.BLUEWOLF_E2E_WEB_URL?.trim().replace(/\/$/, '');
  assert.ok(coreUrl?.startsWith('http') && webUrl?.startsWith('http'), 'E2E Core/Web origins are required');
  assert.ok(env.BLUEWOLF_SQLITE_PATH && env.BLUEWOLF_WORKSPACE_DB &&
    resolve(env.BLUEWOLF_SQLITE_PATH) === resolve(env.BLUEWOLF_WORKSPACE_DB),
    'Web SQLite and Core workspace bridge must use the same file');
  const coreHeaders = env.BLUEWOLF_CORE_API_TOKEN?.trim() ? { authorization: `Bearer ${env.BLUEWOLF_CORE_API_TOKEN.trim()}` } : {};
  const readiness = await getJson(coreUrl, '/readyz');
  assertOperationalReady(readiness);
  const workspace = await getJson(webUrl, '/api/workspace');
  assert.equal(workspace?.storage, 'sqlite', 'Web is not using the required SQLite backend');
  assert.ok(workspace?.state && typeof workspace.state === 'object');
  const savedJoin = workspace.state.influx?.stream;
  assert.deepEqual(savedJoin, config.influx?.stream, 'Core and saved SQLite Influx join columns are not identical');
  assert.ok(Number.isSafeInteger(workspace.revision) && workspace.revision >= 1,
    'E2E Core boot requires a committed SQLite Workspace revision');
  const profile = workspace.state.settings?.defaultMap;
  assert.ok(typeof profile === 'string' && profile.length, 'SQLite map profile is not initialized');
  const scopeSuffix = env.BLUEWOLF_E2E_SCOPE_SUFFIX?.trim();
  const scopeId = `e2e-${env.GITHUB_RUN_ID || process.pid}${scopeSuffix ? `-${scopeSuffix}` : ''}`;
  const scopeUrl = `/api/workspace/scope?type=server&id=${scopeId}`;
  const previous = await getJson(webUrl, scopeUrl);
  assert.equal(previous.state, null, 'E2E scoped probe must use a new isolation key');
  assert.equal(previous.revision, 0);
  const save = await fetch(`${webUrl}/api/workspace/scope`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(7_000),
    body: JSON.stringify({ scopeType: 'server', scopeId, state: { mapProfile: profile }, expectedRevision: 0, category: 'qa', action: 'e2e-preflight', detail: 'SQLite save/read' }),
  });
  assert.equal(save.status, 200, 'SQLite scoped write failed');
  const saved = await save.json();
  assert.equal(saved.ok, true);
  assert.equal(saved.revision, 1);
  const persisted = await getJson(webUrl, scopeUrl);
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.state?.mapProfile, profile, 'SQLite read after write does not match');
  for (const id of serverIds) {
    const path = `/v1/live-runtime?serverId=${encodeURIComponent(id)}`;
    const first = await getJson(coreUrl, path, coreHeaders);
    const old = assertObservedCoreSnapshot(first, id);
    assertCoherentLiveGroupEvidence(first, id);
    const fromWeb = await verifyCoreProxyParity({
      serverId: id,
      readCore: () => getJson(coreUrl, path, coreHeaders),
      readWeb: () => getJson(webUrl, `/api/live-runtime?serverId=${encodeURIComponent(id)}`),
    });
    const webObserved = assertObservedCoreSnapshot(fromWeb, id);
    assertCoherentLiveGroupEvidence(fromWeb, id);
    assert.ok(webObserved >= old, 'Web delivered an older Core observation');
    await awaitNewCoreObservation({
      firstObservedMs: old, serverId: id,
      read: () => getJson(coreUrl, path, coreHeaders),
      pollSeconds: config.polling?.activePollSeconds ?? 5,
      maxWaitMs: Math.min(60_000, Math.max(20_000, (config.polling?.activePollSeconds ?? 5) * 3_000)),
    });
  }
  return { serverCount: serverIds.length, sqliteRevision: persisted.revision, mode: readiness.mode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runE2EPreflight();
    console.log(`E2E prerequisite PASS: ${result.serverCount} Core-fed servers; SQLite round trip; operational mode. Not a public URL acceptance.`);
  } catch (error) {
    console.error(`E2E prerequisite BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
