import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const windowState = await vite.ssrLoadModule("/lib/operator-shared-window.ts");

const mapSource = await readFile(fileURLToPath(new URL("../components/bluewolf/operational-live-map.tsx", import.meta.url)), "utf8");
const timelineSource = await readFile(fileURLToPath(new URL("../components/bluewolf/operational-timeline.tsx", import.meta.url)), "utf8");

test("one per-server operator time window publishes 30/60/90 to all subscribers and isolates other servers", () => {
  const serverOne = [];
  const serverTwo = [];
  const unsubscribeOne = windowState.subscribeOperatorWindow("1", (minutes) => serverOne.push(minutes));
  const unsubscribeTwo = windowState.subscribeOperatorWindow("2", (minutes) => serverTwo.push(minutes));
  assert.equal(windowState.operatorWindowForServer("1"), 30);
  windowState.setOperatorWindowForServer("1", 60);
  windowState.setOperatorWindowForServer("1", 90);
  windowState.setOperatorWindowForServer("1", 90);
  assert.deepEqual(serverOne, [60, 90]);
  assert.deepEqual(serverTwo, []);
  assert.equal(windowState.operatorWindowForServer("1"), 90);
  assert.equal(windowState.operatorWindowForServer("2"), 30);
  assert.throws(() => windowState.setOperatorWindowForServer("1", 45), /30, 60 or 90/);
  windowState.resetOperatorWindow("1");
  assert.equal(windowState.operatorWindowForServer("1"), 30);
  assert.deepEqual(serverOne, [60, 90, 30]);
  unsubscribeOne();
  unsubscribeTwo();
});

test("map owns the sole 30/60/90 selector outside map layers; score timeline subscribes without a duplicate selector", () => {
  assert.match(mapSource, /data-testid="operator-shared-time-window"/);
  assert.match(mapSource, /setOperatorWindowForServer\(serverId, minutes\)/);
  assert.match(mapSource, /filterTraceWindow\(clippedTrace, traceWindowMinutes\)/);
  assert.match(timelineSource, /subscribeOperatorWindow\(serverId, setWindowMinutes\)/);
  assert.match(timelineSource, /filterByDataWindow\(displayHistory, windowMinutes\)/);
  assert.doesNotMatch(timelineSource, /OPERATOR_TIMELINE_WINDOWS\.map/);
});

test("SO groups do not draw inter-vehicle convex hulls; labels require a saved SO template and two observed routes", () => {
  assert.match(mapSource, /runtimeGroups\.filter\(\(group\) => group\.family === "SI"\)/);
  assert.match(mapSource, /soTemplate && routeEvidence\.length > 1/);
  assert.match(mapSource, /data-testid="so-adjacent-relations"/);
  assert.match(mapSource, /SO_RELATION_LABELS\[relationFromCode\(code\)\]/);
});
