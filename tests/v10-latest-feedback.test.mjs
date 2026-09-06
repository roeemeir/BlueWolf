import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("official SRS includes latest-wins v1.2 amendment", () => {
  const current = read("docs/BLUE_WOLF_SRS_CURRENT.md");
  const amendment = read("docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_2.md");
  assert.match(current, /V1_2/);
  assert.match(current, /v1\.2 overrides v1\.1/);
  assert.match(amendment, /vehicle type is not a semantic dimension/i);
  assert.match(amendment, /\+20°/);
  assert.match(amendment, /Double supports four logical vehicle slots/);
});

test("SO builder is generic, smile-based, directional and duplicate-aware", () => {
  const source = read("components/bluewolf/v10/template-builder.tsx");
  assert.match(source, /const stepWidth = .*\? 1 : 2/);
  assert.match(source, /steps\[index\] \* 20/);
  assert.match(source, /const capacity = .*\? 2 : 4/);
  assert.match(source, /flipDirection/);
  assert.match(source, /canonicalSo/);
  assert.match(source, /נמצאה תבנית זהה/);
  assert.match(source, /החלף קיימת/);
  assert.match(source, /ללא תלות בסוג רכב/);
  assert.doesNotMatch(source, /relation-editors/);
});

test("live map uses group identity and continuous score colorbar", () => {
  const map = read("components/bluewolf/v10/map.tsx");
  const operator = read("components/bluewolf/v10/operator.tsx");
  assert.match(map, /GROUP_COLORS\[item\.groupKey\]/);
  assert.match(map, /GROUP_COLORS\[group\]/);
  assert.match(map, /v10-score-gradient/);
  assert.match(map, /continuousScoreColor/);
  assert.match(operator, /trailHistoryMinutes \?\? 30/);
  assert.match(operator, /v10-group-stack/);
  assert.match(operator, /visibleGroups/);
  assert.match(operator, /V10Timeline/);
});

test("investigation includes event-specific evidence, centroid labels and detailed Hebrew causes", () => {
  const source = read("components/bluewolf/v10/investigation.tsx");
  assert.match(source, /EVENT_COLORS/);
  assert.match(source, /centroid/);
  assert.match(source, /samples\.reduce/);
  assert.match(source, /סיבת התחלה/);
  assert.match(source, /סיבת סיום/);
  assert.match(source, /64\.2.*78\.3.*22\.0%/s);
  assert.match(source, /96 מ׳.*70 מ׳.*42 שניות/s);
});

test("wind estimation exists in UI and Python core", () => {
  const ui = read("components/bluewolf/v10/wind.ts");
  const core = read("core/src/bluewolf_core/wind.py");
  const tests = read("core/tests/test_wind.py");
  assert.match(ui, /estimatedKnots/);
  assert.match(ui, /estimatedBearingDeg/);
  assert.match(ui, /syncPenalty/);
  assert.match(core, /KNOTS_PER_MPS/);
  assert.match(core, /estimate_wind_from_navigation/);
  assert.match(tests, /known_east_wind/);
});

test("GT exposes map layers, live angle and ruler", () => {
  const source = read("components/bluewolf/v10/gt.tsx");
  assert.match(source, /mapMode/);
  assert.match(source, /realMaps/);
  assert.match(source, /v10-live-angle/);
  assert.match(source, /correctedAngle\.toFixed\(1\)/);
  assert.match(source, /rulerPoints/);
  assert.match(source, /distance\(rulerPoints/);
  assert.match(source, /bearing\(rulerPoints/);
});
