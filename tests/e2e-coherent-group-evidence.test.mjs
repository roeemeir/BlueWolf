import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCoherentLiveGroupEvidence } from '../scripts/e2e-coherent-group-evidence.mjs';

const now = Date.now();
const iso = offset => new Date(now + offset).toISOString();
const point = (latitude = 32.1, longitude = 34.8) => ({ latitude, longitude });
const route = () => ({ routeId: 'confirmed-by-core', centerline: [point(), point(32.11, 34.81), point(32.12, 34.82)] });
const group = (overrides = {}) => ({
  id: 'group-1', family: 'SO', observedAt: iso(-1_000), scoreValid: true,
  total: 85, sync: 86, route: 84, templateId: 'bound-template',
  members: [{ id: 101, scoreValid: true, score: 85, ...point() }],
  detectedRoutes: [route()],
  event: { id: 'core-event-1', active: true, startedAt: iso(-12_000) },
  ...overrides,
});
const snapshot = (groups = [group()], overrides = {}) => ({
  schemaVersion: 'bluewolf.live-runtime.v1', serverId: '1', observedAt: iso(-1_000),
  source: { kind: 'python-core', health: 'healthy' }, groupList: groups, ...overrides,
});

test('E2E requires a valid scored member, confirmed route, template and active event in the SAME current Core group', () => {
  assert.deepEqual(assertCoherentLiveGroupEvidence(snapshot(), '1', now), {
    groupId: 'group-1', family: 'SO', eventId: 'core-event-1', observedAt: iso(-1_000),
  });
  const memberOnly = group({ id: 'member-only', detectedRoutes: [], event: undefined });
  const routeOnly = group({ id: 'route-only', members: [], event: undefined });
  const eventOnly = group({ id: 'event-only', members: [], detectedRoutes: [] });
  assert.throws(() => assertCoherentLiveGroupEvidence(snapshot([memberOnly, routeOnly, eventOnly]), '1', now), /no SINGLE current Core group/);
});

test('E2E refuses a stale carried-forward group under a newer top-level server timestamp', () => {
  assert.throws(() => assertCoherentLiveGroupEvidence(snapshot([group({ observedAt: iso(-90_000) })]), '1', now), /no SINGLE/);
  assert.throws(() => assertCoherentLiveGroupEvidence(snapshot([group({ observedAt: iso(2_000) })]), '1', now), /no SINGLE/);
  assert.throws(() => assertCoherentLiveGroupEvidence(snapshot(), '2', now));
});

test('E2E refuses invalid scores, missing bound template or an unstarted/closed event', () => {
  for (const changes of [
    { scoreValid: false }, { total: NaN }, { route: 101 },
    { templateId: '__unselected__' }, { templateId: '' },
    { event: { id: 'core-event', active: false, startedAt: iso(-12_000) } },
    { event: { id: 'core-event', active: true, startedAt: iso(3_000) } },
  ]) assert.throws(() => assertCoherentLiveGroupEvidence(snapshot([group(changes)]), '1', now), /no SINGLE/);
});

test('E2E refuses unsupported member fixes and unsupported or corrupted Core route geometry', () => {
  for (const changes of [
    { members: [{ id: 101, scoreValid: false, score: 85, ...point() }] },
    { members: [{ id: 101, scoreValid: true, score: 85, ...point(100, 34.8) }] },
    { detectedRoutes: [{ ...route(), centerline: [point(), point()] }] },
    { detectedRoutes: [{ ...route(), centerline: [point(), point(32.11, 34.81), point(32.12, 999)] }] },
    { detectedRoutes: [{ centerline: route().centerline }] },
  ]) assert.throws(() => assertCoherentLiveGroupEvidence(snapshot([group(changes)]), '1', now), /no SINGLE/);
});
