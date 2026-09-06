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

test("canonical algorithm implementation is isolated Python with stateful live worker", () => {
  const init = read("core/src/bluewolf_core/__init__.py");
  const worker = read("core/src/bluewolf_core/worker.py");
  const session = read("core/src/bluewolf_core/session_v17.py");
  const live = read("core/src/bluewolf_core/live_analysis.py");
  const service = read("core/service/http_service.py");
  assert.match(init, /IMPLEMENTATION_LANGUAGE = "python"/);
  assert.match(init, /CORE_API_VERSION = "1\.0\.0"/);
  assert.match(worker, /create_analysis_session/);
  assert.match(worker, /process_analysis_batch/);
  assert.match(worker, /checkpoint_analysis_session/);
  assert.match(worker, /restore_analysis_session/);
  assert.match(session, /checkpoint_schema_version/);
  assert.match(session, /hydrate_recovery_history/);
  assert.match(live, /LiveAnalysisSession/);
  assert.match(live, /CoreSession/);
  assert.match(service, /CoreWorker/);
  assert.match(service, /\/rpc/);
  assert.doesNotMatch(worker, /sqlite3|requests|httpx|react|localStorage/i);
});

test("active Web adapter sends only live NAV deltas after Python warmup and has no TS fallback", () => {
  const adapter = read("lib/algorithm-core-adapter.ts");
  const proxy = read("app/api/core/rpc/route.ts");
  const analyzer = read("components/bluewolf/v12/navigation-analyzer.ts");
  const history = read("components/bluewolf/v12/navigation-history.ts");
  const operator = read("components/bluewolf/v12/operator.tsx");
  assert.match(adapter, /CORE_IMPLEMENTATION = "python"/);
  assert.match(adapter, /\/api\/core\/rpc/);
  assert.match(adapter, /command: "create_analysis_session"/);
  assert.match(adapter, /command: "process_analysis_batch"/);
  assert.match(adapter, /Date\.parse\(sample\.timestamp\) > afterMs/);
  assert.match(adapter, /livePending/);
  assert.doesNotMatch(adapter, /analyzeNavigationDataset as runCore|packages\/bluewolf-core\/src\/analyzer/);
  assert.match(proxy, /BLUEWOLF_PYTHON_CORE_URL/);
  assert.match(proxy, /\/health/);
  assert.match(proxy, /\/rpc/);
  assert.match(analyzer, /algorithm-core-adapter/);
  assert.match(history, /algorithm-core-adapter/);
  assert.match(operator, /לא מתבצע חישוב חלופי ב־TypeScript/);
});

test("Figure-8 is an SO hippodrome with crossed legs and single-hippodrome external grouping", () => {
  const contracts = read("packages/bluewolf-core/src/contracts.ts");
  const grouping = read("packages/bluewolf-core/src/grouping.ts");
  const analysis = read("core/src/bluewolf_core/application_analysis_v18.py");
  const topologyTest = read("core/tests/test_route_topology_v08.py");
  assert.match(contracts, /RouteKind = "circle" \| "single" \| "double" \| "figure8"/);
  assert.match(contracts, /crossedLegs\?: boolean/);
  assert.match(grouping, /geometry\.kind === "single" \|\| geometry\.kind === "figure8"/);
  assert.match(analysis, /return "figure8"/);
  assert.match(analysis, /geometry\["crossedLegs"\] = True/);
  assert.match(topologyTest, /hippodrome whose two straight legs cross/);
  assert.match(topologyTest, /RouteTopology\.SELF_CROSSING/);
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

test("Influx missing altitude remains missing instead of becoming a fabricated zero", () => {
  const route = read("app/api/influx/query/route.ts");
  const contracts = read("packages/bluewolf-core/src/contracts.ts");
  assert.match(route, /altitude: item\.altitude \?\? null/);
  assert.doesNotMatch(route, /altitude: item\.altitude \?\? 0/);
  assert.match(contracts, /altitude: number \| null/);
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
