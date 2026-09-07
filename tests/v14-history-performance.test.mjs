import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("24h history is reduced before Influx transfer and indexed inside Python Core", () => {
  const source = read("components/bluewolf/v12/data-source.ts");
  const influx = read("app/api/influx/query/route.ts");
  const history = read("core/src/bluewolf_core/application_analysis_v22.py");
  const worker = read("core/src/bluewolf_core/worker_v22.py");
  const service = read("core/service/http_service.py");

  assert.match(source, /targetPoints: Math\.max\(1_000/);
  assert.match(source, /targetPoints/);
  assert.match(influx, /aggregateWindow\(every: \$\{aggregateSeconds\}s, fn: last/);
  assert.match(influx, /queriedRecordCount/);
  assert.match(influx, /queryMs/);
  assert.match(influx, /joinMs/);
  assert.match(history, /bisect_left/);
  assert.match(history, /bisect_right/);
  assert.match(history, /indexed_times/);
  assert.doesNotMatch(history, /for timestamp in selected:[\s\S]*for sample in samples if start <=/);
  assert.match(worker, /build_analysis_history = _application_analysis_v22\.build_analysis_history/);
  assert.match(service, /worker_v22/);
});

test("browser acceptance enforces the user's sub-minute 24h load target", () => {
  const browser = read("tests/browser-v12.spec.mjs");
  assert.match(browser, /historical 24h range derives events\/PDF within 60 seconds/);
  assert.match(browser, /analysisElapsedMs/);
  assert.match(browser, /toBeLessThan\(60_000\)/);
});
