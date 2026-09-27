import assert from 'node:assert/strict';

const validPosition = point => point && typeof point === 'object' &&
  Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
  Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
const validScore = value => Number.isFinite(value) && value >= 0 && value <= 100;

/**
 * An operational proof must come from ONE scored group at ONE current source
 * observation. Independent `some()` checks over members, routes and events
 * could formerly combine unrelated groups (or an older, carried-forward group)
 * into a false positive. This is deliberately a prerequisite, not release QA.
 */
export function assertCoherentLiveGroupEvidence(snapshot, serverId, nowMs = Date.now()) {
  assert.equal(snapshot?.schemaVersion, 'bluewolf.live-runtime.v1');
  assert.equal(snapshot?.serverId, String(serverId));
  assert.equal(snapshot?.source?.kind, 'python-core');
  assert.equal(snapshot?.source?.health, 'healthy');
  const topTime = Date.parse(snapshot?.observedAt ?? '');
  assert.ok(Number.isFinite(topTime) && Math.abs(nowMs - topTime) < 20_000,
    'Core snapshot must be tied to a recent source observation');
  const groups = Array.isArray(snapshot?.groupList) ? snapshot.groupList : Object.values(snapshot?.groups ?? {});
  assert.ok(groups.length > 0, `server ${serverId}: no operational Core group`);
  const proven = groups.find(group => {
    if (!group || typeof group.id !== 'string' || !group.id.trim()) return false;
    if (group.family !== 'SI' && group.family !== 'SO') return false;
    const groupTime = Date.parse(group.observedAt ?? '');
    if (!Number.isFinite(groupTime) || groupTime > topTime || topTime - groupTime > 20_000 ||
        Math.abs(nowMs - groupTime) >= 20_000) return false;
    if (group.scoreValid !== true || !validScore(group.total) || !validScore(group.sync) ||
        !validScore(group.route)) return false;
    if (typeof group.templateId !== 'string' || !group.templateId.trim() ||
        group.templateId === '__unselected__') return false;
    if (!group.event || typeof group.event.id !== 'string' || !group.event.id.trim() ||
        group.event.active !== true) return false;
    const eventStart = Date.parse(group.event.startedAt ?? '');
    if (!Number.isFinite(eventStart) || eventStart > groupTime) return false;
    if (!Array.isArray(group.members) || !group.members.some(member =>
      Number.isSafeInteger(member?.id) && member.id >= 0 && member.scoreValid === true &&
      validScore(member.score) && validPosition(member))) return false;
    if (!Array.isArray(group.detectedRoutes) || !group.detectedRoutes.some(route =>
      typeof route?.routeId === 'string' && route.routeId.trim() &&
      Array.isArray(route.centerline) && route.centerline.length >= 3 &&
      route.centerline.every(validPosition))) return false;
    return true;
  });
  assert.ok(proven, `server ${serverId}: no SINGLE current Core group contains a valid group score, template, observed vehicle GPS/score, detected WGS84 route and active event`);
  return { groupId: proven.id, family: proven.family, eventId: proven.event.id, observedAt: proven.observedAt };
}
