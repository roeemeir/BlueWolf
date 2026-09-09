import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const runtime = await vite.ssrLoadModule("/lib/live-runtime.ts");
const bluewolf = await vite.ssrLoadModule("/lib/bluewolf.ts");

test("simulation runtime preserves the deterministic operator scenario", () => {
  const original = structuredClone(bluewolf.getServerScenario("1"));
  const snapshot = runtime.simulationRuntimeSnapshot("1", "2026-09-09T12:00:00.000Z");
  assert.equal(snapshot.source.kind, "simulation");
  assert.equal(snapshot.source.health, "healthy");
  assert.equal(snapshot.groups.so.total, original.groups.so.total);
  assert.equal(snapshot.groups.si.members.length, original.groups.si.members.length);
  assert.equal(snapshot.groupList.length, 2);
});

test("an unavailable Python runtime never leaves demo scores looking operational", () => {
  const snapshot = runtime.unavailableRuntimeSnapshot("1", "core offline", "2026-09-09T12:00:00.000Z");
  const scenario = runtime.scenarioFromRuntimeSnapshot(snapshot);
  assert.equal(snapshot.source.kind, "python-core");
  assert.equal(snapshot.source.health, "unavailable");
  assert.equal(scenario.status, "CORE RUNTIME UNAVAILABLE");
  assert.equal(scenario.groups.so.total, 0);
  assert.equal(scenario.groups.si.total, 0);
  assert.equal(scenario.groups.so.confidence, 0);
  assert.equal(scenario.groups.so.alert, undefined);
  assert.ok(scenario.groups.so.members.every((member) => member.score === 0 && member.scoreValid === false));
});

test("a partial Python snapshot keeps missing groups explicitly invalid", () => {
  const payload = {
    schemaVersion: runtime.LIVE_RUNTIME_SCHEMA_VERSION,
    serverId: "1",
    arena: "זירה א׳",
    status: "SO runtime active",
    observedAt: "2026-09-09T12:00:00.000Z",
    source: { kind: "python-core", health: "healthy" },
    groups: {
      so: {
        key: "so",
        id: "SO-live-1",
        family: "SO",
        name: "SO live",
        subtitle: "Python Core",
        total: 82,
        sync: 79,
        route: 91,
        confidence: 96,
        color: "#4378e8",
        templateId: "tpl-so-h",
        reason: "phase stable",
        success: "route fit valid",
        scoreValid: true,
        observedAt: "2026-09-09T12:00:00.000Z",
        members: [
          { id: 111, typeId: "storm", score: 84, sync: 80, route: 94, confidence: 97, phase: 0.1, scoreValid: true },
        ],
        event: { id: "event-1", contextKey: "ctx-1", startedAt: "2026-09-09T11:58:00.000Z", active: true },
        recommendation: { templateId: "tpl-so-mixed", activeTemplateId: "tpl-so-h", dimension: "sync", improvementPoints: 34, sustainedSeconds: 121, ready: true },
      },
    },
  };
  const snapshot = runtime.normalizeLiveRuntimeSnapshot(payload, "1");
  const scenario = runtime.scenarioFromRuntimeSnapshot(snapshot);
  assert.equal(scenario.groups.so.total, 82);
  assert.equal(snapshot.groups.so.recommendation.ready, true);
  assert.equal(snapshot.groups.so.event.contextKey, "ctx-1");
  assert.equal(snapshot.groupList.length, 1);
  assert.equal(scenario.groups.si.total, 0);
  assert.equal(scenario.groups.si.scoreValid, false);
});

test("groupList preserves multiple SO groups without family-key overwrite", () => {
  const group = (id, vehicleId, total, color) => ({
    key: "so",
    id,
    family: "SO",
    name: id,
    subtitle: "Python Core",
    total,
    sync: total,
    route: total,
    confidence: 95,
    color,
    templateId: "tpl-so-h",
    reason: "valid",
    success: "valid",
    scoreValid: true,
    observedAt: "2026-09-09T12:00:00.000Z",
    members: [
      { id: vehicleId, typeId: "storm", score: total, sync: total, route: total, confidence: 95, phase: 0.1, scoreValid: true },
    ],
  });
  const g1 = group("SO-1", 101, 91, "#4378e8");
  const g2 = group("SO-2", 202, 77, "#8a63d2");
  const payload = {
    schemaVersion: runtime.LIVE_RUNTIME_SCHEMA_VERSION,
    serverId: "1",
    arena: "זירה א׳",
    status: "2 SO groups",
    observedAt: "2026-09-09T12:00:00.000Z",
    source: { kind: "python-core", health: "healthy" },
    groups: { so: g1 },
    groupList: [g1, g2],
  };

  const snapshot = runtime.normalizeLiveRuntimeSnapshot(payload, "1");
  assert.deepEqual(snapshot.groupList.map((item) => item.id), ["SO-1", "SO-2"]);
  runtime.applyLiveRuntimeSnapshot(snapshot);
  assert.deepEqual(runtime.getRuntimeGroups("1").map((item) => item.id), ["SO-1", "SO-2"]);
  assert.equal(bluewolf.getServerScenario("1").groups.so.id, "SO-1");
});

test("groupList rejects duplicate group ids", () => {
  const group = {
    key: "so",
    id: "dup",
    family: "SO",
    name: "dup",
    subtitle: "Python Core",
    total: 80,
    sync: 80,
    route: 80,
    confidence: 90,
    color: "#4378e8",
    templateId: "tpl-so-h",
    reason: "valid",
    success: "valid",
    scoreValid: true,
    observedAt: "2026-09-09T12:00:00.000Z",
    members: [],
  };
  const payload = {
    schemaVersion: runtime.LIVE_RUNTIME_SCHEMA_VERSION,
    serverId: "1",
    observedAt: "2026-09-09T12:00:00.000Z",
    source: { kind: "python-core", health: "healthy" },
    groups: { so: group },
    groupList: [group, group],
  };
  assert.throws(() => runtime.normalizeLiveRuntimeSnapshot(payload, "1"), /duplicate runtime group id/);
});

test("runtime contract rejects a snapshot for the wrong server", () => {
  const payload = {
    schemaVersion: runtime.LIVE_RUNTIME_SCHEMA_VERSION,
    serverId: "2",
    observedAt: "2026-09-09T12:00:00.000Z",
    source: { kind: "python-core", health: "healthy" },
    groups: {},
  };
  assert.throws(() => runtime.normalizeLiveRuntimeSnapshot(payload, "1"), /serverId does not match/);
});

test("switching back to simulation restores the immutable demo baseline and group list", () => {
  const baseline = structuredClone(bluewolf.getServerScenario("1"));
  runtime.applyLiveRuntimeSnapshot(runtime.unavailableRuntimeSnapshot("1", "offline"));
  assert.equal(bluewolf.getServerScenario("1").groups.so.total, 0);
  runtime.restoreSimulationScenario("1");
  assert.equal(bluewolf.getServerScenario("1").groups.so.total, baseline.groups.so.total);
  assert.equal(bluewolf.getServerScenario("1").groups.si.total, baseline.groups.si.total);
  assert.deepEqual(runtime.getRuntimeGroups("1").map((group) => group.id).sort(), Object.values(baseline.groups).map((group) => group.id).sort());
});
