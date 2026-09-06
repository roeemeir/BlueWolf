import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("active dashboard declares v0.13 / SRS v1.5 and versioned core", () => {
  const page = read("app/page.tsx");
  const dashboard = read("components/bluewolf/dashboard-app-v12.tsx");
  assert.match(page, /DashboardAppV12/);
  assert.match(dashboard, /v0\.13/);
  assert.match(dashboard, /SRS v1\.5/);
  assert.match(dashboard, /CORE_API_VERSION/);
});

test("application reaches algorithms through one adapter", () => {
  const adapter = read("lib/algorithm-core-adapter.ts");
  const analyzer = read("components/bluewolf/v12/navigation-analyzer.ts");
  const history = read("components/bluewolf/v12/navigation-history.ts");
  assert.match(adapter, /packages\/bluewolf-core\/src\/index/);
  assert.match(adapter, /analyzeNavigationDataset as runCore/);
  assert.doesNotMatch(adapter, /drizzle|localStorage|react/i);
  assert.match(analyzer, /algorithm-core-adapter/);
  assert.match(history, /algorithm-core-adapter/);
  assert.doesNotMatch(analyzer, /function pca|siScores|soPairCompatibility/);
  assert.doesNotMatch(history, /function boundaryReason|function routeSignature/);
});

test("SO grouping production law is owned by core", () => {
  const legacy = read("components/bluewolf/v10/grouping.ts");
  assert.match(legacy, /packages\/bluewolf-core/);
  assert.doesNotMatch(legacy, /function segments|averageAxisDeg/);
});

test("workspace persistence and audit DB contract remain unchanged", () => {
  const schema = read("db/schema.ts");
  const route = read("app/api/workspace/route.ts");
  const context = read("components/bluewolf/app-context.tsx");
  assert.match(schema, /sqliteTable\("workspaces"/);
  assert.match(schema, /state: text\("state"\)/);
  assert.match(schema, /revision: integer\("revision"\)/);
  assert.match(schema, /sqliteTable\("audit_entries"/);
  assert.match(route, /db\.insert\(workspaces\)/);
  assert.match(route, /db\.insert\(auditEntries\)/);
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

test("SRS v1.5 defines core replacement and single NAV truth", () => {
  const current = read("docs/BLUE_WOLF_SRS_CURRENT.md");
  const amendment = read("docs/BLUE_WOLF_SRS_CHANGESET_2026-09-06_V1_5.md");
  const architecture = read("docs/BLUE_WOLF_ARCHITECTURE_V1_5.md");
  assert.match(current, /V1_5/);
  assert.match(amendment, /Replaceable Algorithm Core/);
  assert.match(amendment, /Hard-coded operational demo numbers are prohibited/);
  assert.match(architecture, /WorkspaceState/);
  assert.match(architecture, /workspaces.*audit_entries/s);
  assert.match(architecture, /Core replacement does \*\*not\*\* require a DB migration/);
});
