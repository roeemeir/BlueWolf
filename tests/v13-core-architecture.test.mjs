import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("active dashboard declares v0.14 / SRS v1.7 / Python Core", () => {
  const page = read("app/page.tsx");
  const dashboard = read("components/bluewolf/dashboard-app-v12.tsx");
  assert.match(page, /DashboardAppV12/);
  assert.match(dashboard, /v0\.14/);
  assert.match(dashboard, /SRS v1\.7/);
  assert.match(dashboard, /Python Core/);
  assert.match(dashboard, /CORE_API_VERSION/);
});

test("canonical algorithm implementation is isolated Python with language-neutral worker", () => {
  const init = read("core/src/bluewolf_core/__init__.py");
  const worker = read("core/src/bluewolf_core/worker.py");
  const session = read("core/src/bluewolf_core/session_v17.py");
  const service = read("core/service/http_service.py");
  assert.match(init, /IMPLEMENTATION_LANGUAGE = "python"/);
  assert.match(init, /CORE_API_VERSION = "1\.0\.0"/);
  assert.match(worker, /create_session/);
  assert.match(worker, /process_batch/);
  assert.match(worker, /restore_session/);
  assert.match(worker, /analyze_dataset/);
  assert.match(worker, /analyze_history/);
  assert.match(worker, /recoverySamples/);
  assert.match(session, /checkpoint_schema_version/);
  assert.match(session, /hydrate_recovery_history/);
  assert.match(service, /CoreWorker/);
  assert.match(service, /\/rpc/);
  assert.doesNotMatch(worker, /sqlite3|requests|httpx|react|localStorage/i);
});

test("active Web adapter calls Python service and has no TypeScript algorithm fallback", () => {
  const adapter = read("lib/algorithm-core-adapter.ts");
  const proxy = read("app/api/core/rpc/route.ts");
  const analyzer = read("components/bluewolf/v12/navigation-analyzer.ts");
  const history = read("components/bluewolf/v12/navigation-history.ts");
  const operator = read("components/bluewolf/v12/operator.tsx");
  assert.match(adapter, /CORE_IMPLEMENTATION = "python"/);
  assert.match(adapter, /\/api\/core\/rpc/);
  assert.match(adapter, /command: "analyze_dataset"/);
  assert.match(adapter, /command: "analyze_history"/);
  assert.doesNotMatch(adapter, /analyzeNavigationDataset as runCore|packages\/bluewolf-core\/src\/index/);
  assert.match(proxy, /BLUEWOLF_PYTHON_CORE_URL/);
  assert.match(proxy, /\/health/);
  assert.match(proxy, /\/rpc/);
  assert.match(analyzer, /algorithm-core-adapter/);
  assert.match(history, /algorithm-core-adapter/);
  assert.match(operator, /לא מתבצע חישוב חלופי ב־TypeScript/);
});

test("SO grouping production law is implemented in canonical Python analysis", () => {
  const python = read("core/src/bluewolf_core/application_analysis.py");
  const adapter = read("lib/algorithm-core-adapter.ts");
  assert.match(python, /def so_pair_compatibility/);
  assert.match(python, /maxParallelLegs/);
  assert.match(python, /maxLateralLegs/);
  assert.match(python, /maxAngleDeg/);
  assert.match(adapter, /checkSoPairCompatibility/);
});

test("workspace persistence remains separate and compact Core checkpoints are first-class", () => {
  const schema = read("db/schema.ts");
  const route = read("app/api/workspace/route.ts");
  const checkpoint = read("app/api/core/checkpoint/route.ts");
  const context = read("components/bluewolf/app-context.tsx");
  assert.match(schema, /sqliteTable\("workspaces"/);
  assert.match(schema, /sqliteTable\("audit_entries"/);
  assert.match(schema, /sqliteTable\("core_checkpoints"/);
  assert.match(route, /db\.insert\(workspaces\)/);
  assert.match(route, /db\.insert\(auditEntries\)/);
  assert.match(checkpoint, /coreCheckpoints/);
  assert.match(context, /bluewolf-workspace-state/);
  assert.match(context, /\/api\/workspace/);
});

test("active operator contains no old fabricated KPI literals", () => {
  const operator = read("components/bluewolf/v12/operator.tsx");
  assert.doesNotMatch(operator, />96%</);
  assert.doesNotMatch(operator, />4\.2s</);
  assert.match(operator, /analysis\.provenance\.sampleCount/);
  assert.match(operator, /analysis\.groups\.si\.score/);
  assert.match(operator, /analysis\.groups\.so\.score/);
});

test("v1.7 defines simplified source-of-truth, no TTAG and current-Core replay", () => {
  const current = read("docs/BLUE_WOLF_SRS_CURRENT.md");
  const decisions = read("docs/BLUE_WOLF_ARCHITECTURE_DECISIONS_2026-09-06_V1_7.md");
  const architecture = read("docs/BLUE_WOLF_ARCHITECTURE_V1_7_SIMPLIFIED_CANONICAL.md");
  assert.match(current, /V1_7/);
  assert.match(decisions, /Canonical current Core is Python/);
  assert.match(decisions, /No TTAG/);
  assert.match(decisions, /InfluxDB is the historical source of truth/);
  assert.match(architecture, /Joined NAV may be kept in memory\/temporary cache only/);
  assert.match(architecture, /current canonical Core is used for future historical analysis/);
  assert.match(architecture, /daily backup/);
});
