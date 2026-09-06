import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CORE_API_VERSION, analyzeNavigationDataset, buildAnalysisHistory, deriveEvents, siScores, soPairCompatibility } from "../src/index.ts";
import { circleDataset, DEFAULT_CONFIG } from "./fixtures.ts";

test("core API is versioned and deterministic", () => {
  assert.equal(CORE_API_VERSION, "1.0.0");
  const dataset = circleDataset();
  const first = analyzeNavigationDataset(dataset, DEFAULT_CONFIG);
  const second = analyzeNavigationDataset(dataset, DEFAULT_CONFIG);
  assert.deepEqual(first, second);
  assert.equal(first.coreApiVersion, CORE_API_VERSION);
});

test("core has no UI, DB, network or browser dependencies", () => {
  for (const file of ["contracts.ts", "scoring.ts", "grouping.ts", "analyzer.ts", "history.ts", "index.ts"]) {
    const source = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /react|drizzle|@\/|components\//i, `${file} imports application code`);
    assert.doesNotMatch(source, /\bwindow\b|\bdocument\b|\blocalStorage\b|\bfetch\s*\(/, `${file} touches external runtime`);
  }
});

test("missing evidence cannot become a perfect SI score", () => {
  const score = siScores([], [120, 120], DEFAULT_CONFIG.thresholds, DEFAULT_CONFIG.weights, 100, { distance: 100, tangent: 100, curvature: 100 }, 0, 0);
  assert.equal(score.position, 0);
  assert.ok(score.sync < 100);
});

test("raw navigation produces high SI synchronization for a clean 120-degree formation", () => {
  const result = analyzeNavigationDataset(circleDataset(), DEFAULT_CONFIG);
  assert.equal(result.available, true);
  assert.deepEqual(result.groups.si.members, [101, 102, 103]);
  assert.equal(result.groups.si.observedAngles.length, 2);
  for (const angle of result.groups.si.observedAngles) assert.ok(Math.abs(angle - 120) < 5, `angle=${angle}`);
  assert.ok(result.groups.si.score.sync >= 80, `sync=${result.groups.si.score.sync}`);
  assert.ok(result.groups.si.score.route >= 70, `route=${result.groups.si.score.route}`);
});

test("SO projection law accepts aligned proximity and rejects diagonal/angle violation", () => {
  const settings = DEFAULT_CONFIG.groupingSettings;
  const valid = soPairCompatibility(
    { kind: "single", center: { x: 0, y: 0 }, radius: 25, legLength: 100, rotationDeg: 0 },
    { kind: "single", center: { x: 120, y: 5 }, radius: 25, legLength: 100, rotationDeg: 5 },
    settings,
  );
  const invalid = soPairCompatibility(
    { kind: "single", center: { x: 0, y: 0 }, radius: 25, legLength: 100, rotationDeg: 0 },
    { kind: "single", center: { x: 90, y: 70 }, radius: 25, legLength: 100, rotationDeg: 42 },
    settings,
  );
  assert.equal(valid.valid, true, valid.explanation);
  assert.equal(invalid.valid, false, invalid.explanation);
});

test("no navigation means no fallback score or group", () => {
  const empty = circleDataset({ vehicles: [], durationSeconds: 60 });
  const result = analyzeNavigationDataset(empty, DEFAULT_CONFIG);
  assert.equal(result.available, false);
  assert.equal(result.groups.si.members.length, 0);
  assert.equal(result.groups.so.members.length, 0);
  assert.equal(result.groups.si.score.total, 0);
  assert.equal(result.groups.so.score.total, 0);
});

test("history/events are derived from analysis frames rather than scenario labels", () => {
  const dataset = circleDataset({ vehicles: [101, 102, 103, 104], durationSeconds: 900, joinVehicleAtSeconds: { 104: 480 } });
  const history = buildAnalysisHistory(dataset, DEFAULT_CONFIG, 60, 4);
  const events = deriveEvents(history, DEFAULT_CONFIG.thresholds);
  assert.ok(history.length > 10);
  assert.ok(events.length >= 2, `events=${events.length}`);
  assert.ok(events.some((event) => /הצטרפו|שינוי חברות|תחילת טווח/.test(event.startReason)));
  assert.ok(events.every((event) => event.frames.length > 0));
});

test("wind is not a core config input or score multiplier", () => {
  const contracts = fs.readFileSync(new URL("../src/contracts.ts", import.meta.url), "utf8");
  const configBlock = contracts.match(/export type CoreConfig = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  assert.doesNotMatch(configBlock, /wind/i);
  const analyzer = fs.readFileSync(new URL("../src/analyzer.ts", import.meta.url), "utf8");
  assert.doesNotMatch(analyzer, /windPenalty|estimatedWindContribution|syncPenalty/);
});
