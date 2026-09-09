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
    members: [],
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

beforeEach(() => history.clearLiveRuntimeHistory());

test("history payload is normalized, ordered and deduplicated by observedAt", () => {
  const older = snapshot("2026-09-09T12:00:00.000Z", 70);
  const newer = snapshot("2026-09-09T12:00:10.000Z", 90);
  const replacement = snapshot("2026-09-09T12:00:00.000Z", 75);
  const rows = history.normalizeLiveRuntimeHistoryPayload({
    schemaVersion: runtime.LIVE_RUNTIME_SCHEMA_VERSION,
    serverId: "1",
    snapshots: [newer, older, replacement],
  }, "1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].observedAt, older.observedAt);
  assert.equal(rows[0].groupList[0].total, 75);
  assert.equal(rows[1].observedAt, newer.observedAt);
});

test("late history bootstrap cannot overwrite a newer live snapshot", () => {
  const oldRows = [
    runtime.normalizeLiveRuntimeSnapshot(snapshot("2026-09-09T12:00:00.000Z", 70), "1"),
    runtime.normalizeLiveRuntimeSnapshot(snapshot("2026-09-09T12:00:05.000Z", 75), "1"),
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
  assert.equal(rows.at(-1).groupList[0].total, 90);
});

test("unavailable fallback snapshots are not appended to operational history", () => {
  const healthy = runtime.normalizeLiveRuntimeSnapshot(snapshot("2026-09-09T12:00:00.000Z", 80), "1");
  const unavailable = runtime.normalizeLiveRuntimeSnapshot(snapshot("2026-09-09T12:00:05.000Z", 0, "unavailable"), "1");
  history.appendLiveRuntimeHistory(healthy);
  history.appendLiveRuntimeHistory(unavailable);
  const rows = history.getLiveRuntimeHistory("1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source.health, "healthy");
});

test("history fetch uses the same-origin proxy and validates the server", async () => {
  const payload = {
    schemaVersion: runtime.LIVE_RUNTIME_SCHEMA_VERSION,
    serverId: "1",
    snapshots: [snapshot("2026-09-09T12:00:00.000Z", 80)],
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
});
