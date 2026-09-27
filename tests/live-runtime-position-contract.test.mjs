import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const runtime = await vite.ssrLoadModule("/lib/live-runtime.ts");

function payloadWithMember(member) {
  const group = {
    key: "so",
    id: "SO-position-1",
    family: "SO",
    name: "SO position",
    subtitle: "Python Core",
    total: 88,
    sync: 87,
    route: 91,
    confidence: 96,
    color: "#4378e8",
    templateId: "tpl-so-h",
    reason: "valid",
    success: "valid",
    scoreValid: true,
    observedAt: "2026-09-09T12:00:00.000Z",
    members: [member],
  };
  return {
    schemaVersion: runtime.LIVE_RUNTIME_SCHEMA_VERSION,
    serverId: "1",
    arena: "test-arena",
    status: "position test",
    observedAt: "2026-09-09T12:00:00.000Z",
    source: { kind: "python-core", health: "healthy" },
    groups: { so: group },
    groupList: [group],
  };
}

const baseMember = {
  id: 101,
  typeId: "test-type",
  score: 88,
  sync: 87,
  route: 91,
  confidence: 96,
  phase: 0.25,
  scoreValid: true,
};

test("normalizes explicit position and navigation heading", () => {
  const snapshot = runtime.normalizeLiveRuntimeSnapshot(
    payloadWithMember({
      ...baseMember,
      latitude: 12.3456,
      longitude: 56.789,
      headingDeg: 370,
    }),
    "1",
  );
  const member = snapshot.groupList[0].members[0];
  assert.equal(member.latitude, 12.3456);
  assert.equal(member.longitude, 56.789);
  assert.equal(member.headingDeg, 10);
});

test("rejects half-present or out-of-range positions", () => {
  assert.throws(
    () => runtime.normalizeLiveRuntimeSnapshot(
      payloadWithMember({ ...baseMember, latitude: 12.0 }),
      "1",
    ),
    /invalid runtime group/,
  );
  assert.throws(
    () => runtime.normalizeLiveRuntimeSnapshot(
      payloadWithMember({ ...baseMember, latitude: 95.0, longitude: 34.0 }),
      "1",
    ),
    /invalid runtime group/,
  );
});
