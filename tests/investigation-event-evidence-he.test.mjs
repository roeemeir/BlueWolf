import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { recordedLifecycleReason, investigationEventFacts } = await vite.ssrLoadModule('/lib/investigation-event-evidence-he.ts');
const { buildInvestigationEventSynopsisPages } = await vite.ssrLoadModule('/lib/investigation-pdf-event-synopsis.ts');

const sample = {
  result: {
    eventId: 'event-real-7', groupId: 'group-real-9',
    startAt: '2026-09-19T11:00:00Z', endAt: '2026-09-19T11:01:00Z',
    lifecycle: { openingReason: 'group_became_active', endingReason: 'nonstandard-source-code' },
    summary: { total: 64, sync: 45, route: 91 },
    rootCauses: [{ reason: 'unmapped-measured-cause', occurrences: 3 }],
    codeVersion: 'core-hash', configVersion: 'config-hash', runId: 'run-88',
    points: [
      { observedAt: '2026-09-19T11:00:10Z', members: [
        { memberId: '17', slotId: 'A', total: 61, sync: 50, route: 74, primaryReason: 'source-a' },
        { memberId: '42', slotId: 'B', total: 65, sync: 60, route: 79, primaryReason: null },
      ] },
      { observedAt: '2026-09-19T11:00:20Z', members: [
        { memberId: '42', slotId: 'B', total: 69, sync: 65, route: 81, primaryReason: 'source-b' },
      ] },
    ],
  },
};

test('lifecycle codes must be recorded or left unmapped; no guessed causes', () => {
  assert.match(recordedLifecycleReason('group_became_active').label, /הקבוצה הפכה לפעילה/);
  assert.equal(recordedLifecycleReason('group_became_active').provenance, 'lifecycle-code');
  assert.equal(recordedLifecycleReason('nonstandard-source-code').provenance, 'unmapped-source-code');
  assert.match(recordedLifecycleReason('nonstandard-source-code').label, /nonstandard-source-code/);
  assert.equal(recordedLifecycleReason(null).provenance, 'missing');
  assert.match(recordedLifecycleReason(null).operatorMeaning, /לא ניתן לקבוע/);
});

test('every observed vehicle retains its OWN latest available frame and source reason', () => {
  const facts = investigationEventFacts(sample);
  assert.equal(facts.eventId, 'event-real-7');
  assert.equal(facts.groupId, 'group-real-9');
  assert.deepEqual(facts.scores, { total: 64, sync: 45, route: 91 });
  assert.equal(facts.members.length, 2);
  assert.equal(facts.members[0].observedAt, '2026-09-19T11:00:10Z');
  assert.equal(facts.members[0].total, 61);
  assert.equal(facts.members[1].observedAt, '2026-09-19T11:00:20Z');
  assert.equal(facts.members[1].total, 69);
  assert.equal(facts.members[1].reason, 'source-b');
  assert.deepEqual(facts.sourceReasons, [{ reason: 'unmapped-measured-cause', occurrences: 3 }]);
});

test('PDF synopsis renders the actual group scores, source reason, missing lifecycle, and all vehicle rows', () => {
  const originalDocument = globalThis.document;
  const drawn = [];
  const context = {
    save() {}, restore() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {},
    fillRect() {}, moveTo() {}, lineTo() {},
    fillText(value) { drawn.push(value); },
    measureText(value) { return { width: value.length * 8 }; },
  };
  globalThis.document = { createElement(tag) {
    assert.equal(tag, 'canvas');
    return { width: 0, height: 0, getContext() { return context; },
      toDataURL() { return `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 217]).toString('base64')}`; },
    };
  } };
  try {
    const pages = buildInvestigationEventSynopsisPages(sample, 1, 3);
    assert.ok(pages.length >= 1);
    assert.equal(pages[0].width, 1190);
    assert.ok(drawn.some((entry) => entry.includes('event-real-7')));
    assert.ok(drawn.some((entry) => entry.includes('כולל: 64.0')));
    assert.ok(drawn.some((entry) => entry.includes('unmapped-measured-cause')));
    assert.ok(drawn.some((entry) => entry.includes('nonstandard-source-code')));
    assert.ok(drawn.some((entry) => entry.includes('רכב 17')));
    assert.ok(drawn.some((entry) => entry.includes('רכב 42')));
    assert.ok(drawn.some((entry) => entry.includes('69.0')));
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
