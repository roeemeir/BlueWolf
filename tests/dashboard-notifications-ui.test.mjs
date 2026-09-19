import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile("components/bluewolf/dashboard-app.tsx", "utf8");

test("the operator bell is sourced only from the selected server and current runtime snapshot", () => {
  assert.match(dashboard, /currentRuntimeNotifications\(notificationSnapshot\)/);
  assert.match(dashboard, /simulationRuntimeSnapshot\(serverValue\)/);
  assert.match(dashboard, /coreSnapshot\?\.serverId === serverValue/);
  assert.match(dashboard, /coreSnapshot\.source\.health === "healthy"/);
  assert.match(dashboard, /setCoreSnapshot\(snapshot\.source\.kind === "python-core" && snapshot\.source\.health === "healthy" \? snapshot : null\)/);
});

test("a server or source change, disconnection or stale Core clears formerly live alerts", () => {
  assert.match(dashboard, /const changeDataMode = \(mode: DataMode\) => \{[^}]*setCoreSnapshot\(null\)/);
  assert.match(dashboard, /const changeServer = \(value: string\) => \{[^}]*setCoreSnapshot\(null\)/);
  assert.match(dashboard, /applyLiveRuntimeSnapshot\(unavailableRuntimeSnapshot\(serverValue, detail\)\);\s*setCoreSnapshot\(null\)/);
  assert.doesNotMatch(dashboard, /SO-02 · התראה חיה|לפני 4 דק׳/);
});

test("SIM notifications are visibly separate from Core, with explicit no-alert/no-Core state", () => {
  assert.match(dashboard, /SIM · סימולציה/);
  assert.match(dashboard, /התרעות תרחיש הדמיה בלבד/);
  assert.match(dashboard, /אין נתוני התראות תקפים מה־Core/);
  assert.match(dashboard, /item\.sourceLabel/);
  assert.match(dashboard, /item\.groupId/);
  assert.match(dashboard, /aria-label=\{`התראות/);
});
