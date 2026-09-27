import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = process.cwd();
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { simulationRuntimeSnapshot } = await vite.ssrLoadModule("/lib/live-runtime.ts");
const { currentRuntimeNotifications } = await vite.ssrLoadModule("/lib/live-notifications.ts");

function snapshot(kind = "python-core", health = "healthy", serverId = "1") {
  const value = simulationRuntimeSnapshot(serverId);
  value.source = { kind, health };
  const target = value.groupList[0];
  target.alert = { id: "alert-123", title: "סטייה מהנתיב", detail: "רכב 42 חרג מהמסלול", severity: "critical", activeSince: "2026-09-19T10:00:00Z" };
  return value;
}

test("notification drawer displays only active alerts with source, server and group provenance", () => {
  const current = currentRuntimeNotifications(snapshot());
  assert.ok(current.some((entry) => entry.alertId === "alert-123" && entry.sourceLabel === "CORE" && entry.serverId === "1"));
  assert.ok(current.some((entry) => entry.key === `1:SI-01:alert-123` || entry.key.includes(":alert-123")));
  assert.ok(current.every((entry) => entry.key.startsWith(`${entry.serverId}:`)));
});

test("stale, disconnected and unknown snapshots do not display historical alerts as live", () => {
  assert.deepEqual(currentRuntimeNotifications(null), []);
  assert.deepEqual(currentRuntimeNotifications(snapshot("python-core", "stale")), []);
  assert.deepEqual(currentRuntimeNotifications(snapshot("python-core", "unavailable")), []);
});

test("simulation alerts are explicitly SIM; duplicate group alert ids do not double count", () => {
  const source = snapshot("simulation");
  const first = source.groupList[0];
  source.groupList.push(first);
  const all = currentRuntimeNotifications(source);
  assert.ok(all.some((entry) => entry.alertId === "alert-123" && entry.sourceLabel === "SIM"));
  assert.equal(all.filter((entry) => entry.alertId === "alert-123").length, 1);
});
