import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const runtime = await vite.ssrLoadModule("/lib/live-runtime.ts");
const history = await vite.ssrLoadModule("/lib/live-runtime-history.ts");

function snapshot(observedAt, total = 80, health = "healthy") {
  const group = {
    key: "so",
    id: "g1",
    family: "SO",
    name: "SO live",
    subtitle: "Python Core",
    total,
    sync: total,
    route: total,
    confidence: 95,
    color: "#4378e8",
    templateId: "tpl-so-h",
    reason: "runtime",
    success: "valid",
    scoreValid: health !== "unavailable",
    observedAt,
    members: [{ id: 11, typeId: "A", score: total, sync: total, route: total, confidence: 95, phase: 0, scoreValid: true }],
  };
  return {
    schemaVersion: runtime.LIVE_RUNTIME_SCHEMA_VERSION,
    serverId: "1",
    arena: "A",
    status: "runtime",
    observedAt,
    source: { kind: "python-core", health },
    groups: { so: group },
    groupList: [group],
  };
}

function point(observedAt, total = 80, event) {
  return {
    schemaVersion: history.LIVE_RUNTIME_HISTORY_SCHEMA_VERSION,
    serverId: "1",
    observedAt,
    groups: [{
      id: "g1",
      name: "SO live",
      color: "#4378e8",
      total,
      sync: total,
      route: total,
      scoreValid: true,
      ...(event ? { event } : {}),
    }],
  };
}

beforeEach(() => history.clearLiveRuntimeHistory());

test("compact history payload is normalized, ordered and deduplicated by observedAt", () => {
  const older = point("2026-09-09T12:00:00.000Z", 70);
  const newer = point("2026-09-09T12:00:10.000Z", 90);
  const replacement = point("2026-09-09T12:00:00.000Z", 75);
  const rows = history.normalizeLiveRuntimeHistoryPayload({
    schemaVersion: history.LIVE_RUNTIME_HISTORY_SCHEMA_VERSION,
    serverId: "1",
    points: [newer, older, replacement],
  }, "1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].observedAt, older.observedAt);
  assert.equal(rows[0].groups[0].total, 75);
  assert.equal(rows[1].observedAt, newer.observedAt);
  assert.equal(rows[0].groups[0].members, undefined);
});

test("late history bootstrap cannot overwrite a newer live snapshot", () => {
  const oldRows = [
    point("2026-09-09T12:00:00.000Z", 70),
    point("2026-09-09T12:00:05.000Z", 75),
  ];
  const live = runtime.normalizeLiveRuntimeSnapshot(snapshot("2026-09-09T12:00:10.000Z", 90), "1");
  history.appendLiveRuntimeHistory(live);
  history.applyLiveRuntimeHistory("1", oldRows);
  const rows = history.getLiveRuntimeHistory("1");
  assert.deepEqual(rows.map((item) => item.observedAt), [
    "2026-09-09T12:00:00.000Z",
    "2026-09-09T12:00:05.000Z",
    "2026-09-09T12:00:10.000Z",
  ]);
  assert.equal(rows.at(-1).groups[0].total, 90);
});

test("Web history retention is based on 30 minutes rather than point count", () => {
  history.applyLiveRuntimeHistory("1", [
    point("2026-09-09T11:59:59.000Z", 60),
    point("2026-09-09T12:00:00.000Z", 70),
    point("2026-09-09T12:15:00.000Z", 80),
    point("2026-09-09T12:30:00.000Z", 90),
  ]);
  const rows = history.getLiveRuntimeHistory("1");
  assert.deepEqual(rows.map((item) => item.observedAt), [
    "2026-09-09T12:00:00.000Z",
    "2026-09-09T12:15:00.000Z",
    "2026-09-09T12:30:00.000Z",
  ]);
});

test("unavailable fallback snapshots are not appended to operational history", () => {
  const healthy = runtime.normalizeLiveRuntimeSnapshot(snapshot("2026-09-09T12:00:00.000Z", 80), "1");
  const unavailable = runtime.normalizeLiveRuntimeSnapshot(snapshot("2026-09-09T12:00:05.000Z", 0, "unavailable"), "1");
  history.appendLiveRuntimeHistory(healthy);
  history.appendLiveRuntimeHistory(unavailable);
  const rows = history.getLiveRuntimeHistory("1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].groups[0].total, 80);
});

test("history fetch uses the same-origin proxy and validates the server", async () => {
  const payload = {
    schemaVersion: history.LIVE_RUNTIME_HISTORY_SCHEMA_VERSION,
    serverId: "1",
    points: [point("2026-09-09T12:00:00.000Z", 80)],
  };
  let requested = "";
  const fakeFetch = async (url) => {
    requested = String(url);
    return {
      ok: true,
      async json() { return payload; },
    };
  };
  const rows = await history.fetchLiveRuntimeHistory("1", 12, fakeFetch);
  assert.equal(requested, "/api/live-runtime/history?serverId=1&limit=12");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].serverId, "1");
  assert.equal(rows[0].groups[0].total, 80);
});
