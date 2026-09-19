export const RUNTIME_PROVENANCE_SCHEMA_VERSION = "bluewolf.runtime-provenance.v1" as const;

export type RuntimeProvenance = {
  schemaVersion: typeof RUNTIME_PROVENANCE_SCHEMA_VERSION;
  codeSha: string;
  configVersion: string;
};

export type CapturedRuntimeProvenance = RuntimeProvenance & {
  source: "python-core" | "web-workspace";
  capturedAt: string;
};

function requiredText(value: unknown, name: string, max = 200) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is missing`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${name} is too long`);
  return result;
}

export function normalizeRuntimeProvenance(value: unknown): RuntimeProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("runtime provenance must be an object");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== RUNTIME_PROVENANCE_SCHEMA_VERSION) throw new Error("unsupported runtime provenance schema");
  const codeSha = requiredText(row.codeSha, "runtime codeSha", 64);
  if (!/^[0-9a-f]{7,64}$/i.test(codeSha)) throw new Error("runtime codeSha must be a git SHA");
  return {
    schemaVersion: RUNTIME_PROVENANCE_SCHEMA_VERSION,
    codeSha: codeSha.toLowerCase(),
    configVersion: requiredText(row.configVersion, "runtime configVersion", 200),
  };
}

export function normalizeCapturedRuntimeProvenance(value: unknown): CapturedRuntimeProvenance {
  const normalized = normalizeRuntimeProvenance(value);
  const row = value as Record<string, unknown>;
  if (row.source !== "python-core" && row.source !== "web-workspace") throw new Error("runtime provenance source is invalid");
  const capturedAt = requiredText(row.capturedAt, "runtime provenance capturedAt", 80);
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("runtime provenance capturedAt must be ISO-8601");
  return { ...normalized, source: row.source, capturedAt };
}
