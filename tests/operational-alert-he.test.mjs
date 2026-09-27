import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = process.cwd();
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { operatorAlertWording } = await vite.ssrLoadModule("/lib/operational-alert-he.ts");
const { currentRuntimeNotifications } = await vite.ssrLoadModule("/lib/live-notifications.ts");
const { simulationRuntimeSnapshot } = await vite.ssrLoadModule("/lib/live-runtime.ts");

test("operator guidance translates recognized English Core causes into Hebrew without changing source evidence", () => {
  const examples = [
    ["route deviation", "vehicle 201 cross-track error", "סטייה מהנתיב", "בדקו במפה"],
    ["turn timing", "vehicle 201 late turn", "אי־התאמה בתזמון הפנייה", "בדקו את זמני ההגעה"],
    ["period drift", "cycle time mismatch", "פער בזמן המחזור", "בדקו את זמן המחזור"],
    ["heading mismatch", "vehicle 301 tangent error", "אי־התאמה בכיוון התנועה", "בדקו במפה"],
    ["phase mismatch", "vehicle 101 angle difference", "פער בסנכרון המיקום היחסי", "בדקו את מיקום"],
    ["missing navigation", "no data", "נתוני ניווט חסרים או לא עדכניים", "בדקו את רציפות"],
  ];
  for (const [sourceTitle, sourceDetail, expectedTitle, guidance] of examples) {
    const result = operatorAlertWording(sourceTitle, sourceDetail);
    assert.equal(result.title, expectedTitle);
    assert.ok(result.detail.includes(guidance), `${sourceTitle}: missing Hebrew guidance`);
    assert.equal(result.sourceTitle, sourceTitle);
    assert.equal(result.sourceDetail, sourceDetail);
    assert.equal(result.recognized, true);
    assert.ok(/[\u0590-\u05ff]/u.test(result.title));
  }
});

test("unrecognized English alert never gets fabricated route or synchronization attribution", () => {
  const result = operatorAlertWording("unmapped internal fault", "telemetry exception x-94");
  assert.equal(result.recognized, false);
  assert.match(result.title, /טרם זוהתה/);
  assert.match(result.detail, /אין להסיק סיבה ספציפית/);
  assert.equal(result.sourceTitle, "unmapped internal fault");
  assert.equal(result.sourceDetail, "telemetry exception x-94");
  assert.doesNotMatch(result.title + result.detail, /x-94|unmapped|exception/);
});

test("recognized Hebrew cause keeps the observed detail and adds only operator guidance", () => {
  const result = operatorAlertWording("סטייה מהנתיב", "רכב 201 חרג מהנתיב בפנייה");
  assert.match(result.detail, /^רכב 201 חרג מהנתיב בפנייה/);
  assert.match(result.detail, /בדקו במפה/);
  assert.equal(result.sourceDetail, "רכב 201 חרג מהנתיב בפנייה");
  assert.equal(result.recognized, true);
});

test("live drawer obtains Hebrew guidance from the selected server alert, not demo text or a stale Core", () => {
  const snapshot = simulationRuntimeSnapshot("2");
  snapshot.source = { kind: "python-core", health: "healthy" };
  snapshot.groupList[0].alert = { id: "from-core", title: "period mismatch", detail: "vehicle 101", severity: "warning" };
  const entries = currentRuntimeNotifications(snapshot);
  const alert = entries.find((entry) => entry.alertId === "from-core");
  assert.ok(alert);
  assert.equal(alert.serverId, "2");
  assert.equal(alert.sourceLabel, "CORE");
  assert.equal(alert.title, "פער בזמן המחזור");
  assert.match(alert.detail, /בדקו את זמן המחזור/);
  assert.equal(alert.sourceTitle, "period mismatch");
  assert.equal(alert.sourceDetail, "vehicle 101");
  snapshot.source.health = "stale";
  assert.deepEqual(currentRuntimeNotifications(snapshot), []);
});
