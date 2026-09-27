import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { traceWithEventRecompute } = await vite.ssrLoadModule('/lib/operator-retroactive-result.ts');

const time = '2026-09-18T12:00:00.000Z';
const at = Date.parse(time);
const first = { timeMs: at, groupId: 'group-a', eventId: 'shared-event', vehicleId: 11, latitude: 32, longitude: 34, sync: 20 };
const otherGroup = { timeMs: at, groupId: 'group-b', eventId: 'shared-event', vehicleId: 21, latitude: 33, longitude: 35, sync: 80 };
const otherEvent = { timeMs: at, groupId: 'group-a', eventId: 'prior-event', vehicleId: 31, latitude: 34, longitude: 36, sync: 65 };

function recomputation() {
  return {
    groupId: 'group-a', eventId: 'shared-event',
    points: [{ observedAt: time,
      members: [{ memberId: '11', sync: 95 }],
      navigation: [{ memberId: '11', vehicleIdentifier: 11, latitude: 32.001, longitude: 34.001 }],
    }],
  };
}

test('OP-04 replaces only the selected group-event trace and does not erase same-ID evidence in other groups', () => {
  const previous = [first, otherGroup, otherEvent];
  const before = structuredClone(previous);
  const next = traceWithEventRecompute(previous, recomputation());
  assert.deepEqual(previous, before, 'source evidence must remain unmodified');
  assert.equal(next.length, 3);
  assert.deepEqual(next.filter((row) => row.groupId === 'group-b'), [otherGroup]);
  assert.deepEqual(next.filter((row) => row.eventId === 'prior-event'), [otherEvent]);
  const corrected = next.find((row) => row.groupId === 'group-a' && row.eventId === 'shared-event');
  assert.ok(corrected);
  assert.equal(corrected.sync, 95);
  assert.equal(corrected.latitude, 32.001);
  assert.notDeepEqual(corrected, first);
});

test('OP-04 group and event IDs must BOTH match before deleting a prior trace', () => {
  const result = { ...recomputation(), groupId: 'group-c', points: [] };
  assert.deepEqual(traceWithEventRecompute([first, otherGroup, otherEvent], result), [first, otherGroup, otherEvent]);
});
