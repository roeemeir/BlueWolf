export const QA_RUN_SCHEMA_VERSION = "bluewolf.qa-run.v1" as const;

export type QaCategoryResult = {
  id: string;
  title: string;
  scenarios: number;
  passed: number;
  failed: number;
  p50Ms?: number;
  p95Ms?: number;
};

export type QaRunResult = {
  schemaVersion: typeof QA_RUN_SCHEMA_VERSION;
  runId: string;
  scenarioId: string;
  codeSha: string;
  configVersion: string;
  startedAt: string;
  durationMs: number;
  passed: boolean;
  categories: QaCategoryResult[];
};

function integer(value: unknown, name: string) {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${name} must be a non-negative integer`);
  return Number(value);
}

function finite(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
  return value;
}

export function normalizeQaRun(value: unknown): QaRunResult {
  if (!value || typeof value !== "object") throw new Error("QA payload must be an object");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== QA_RUN_SCHEMA_VERSION) throw new Error("unsupported QA schema");
  for (const key of ["runId", "scenarioId", "codeSha", "configVersion", "startedAt"] as const) {
    if (typeof row[key] !== "string" || !row[key]) throw new Error(`QA ${key} is missing`);
  }
  if (!Number.isFinite(Date.parse(String(row.startedAt)))) throw new Error("QA startedAt is invalid");
  if (typeof row.passed !== "boolean") throw new Error("QA passed must be boolean");
  if (!Array.isArray(row.categories)) throw new Error("QA categories must be an array");
  const categories = row.categories.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`QA category ${index + 1} must be an object`);
    const category = item as Record<string, unknown>;
    if (typeof category.id !== "string" || !category.id || typeof category.title !== "string" || !category.title) throw new Error(`QA category ${index + 1} identity is missing`);
    const scenarios = integer(category.scenarios, "QA scenarios");
    const passed = integer(category.passed, "QA passed count");
    const failed = integer(category.failed, "QA failed count");
    if (passed + failed !== scenarios) throw new Error("QA category counts do not add up");
    return {
      id: category.id,
      title: category.title,
      scenarios,
      passed,
      failed,
      p50Ms: category.p50Ms === undefined ? undefined : finite(category.p50Ms, "QA p50"),
      p95Ms: category.p95Ms === undefined ? undefined : finite(category.p95Ms, "QA p95"),
    };
  });
  return {
    schemaVersion: QA_RUN_SCHEMA_VERSION,
    runId: String(row.runId),
    scenarioId: String(row.scenarioId),
    codeSha: String(row.codeSha),
    configVersion: String(row.configVersion),
    startedAt: String(row.startedAt),
    durationMs: finite(row.durationMs, "QA duration"),
    passed: row.passed,
    categories,
  };
}
