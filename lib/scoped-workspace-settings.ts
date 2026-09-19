export type WorkspaceScopeType = "server" | "group";

export type ServerScopedSettings = {
  arena?: string;
  mapProfile?: string;
};

export type GroupTemplateApplication = {
  templateId: string;
  mode: "now" | "event-start";
  appliedAt: string;
  eventId?: string;
  recomputeRunId?: string;
  codeVersion?: string;
  configVersion?: string;
  templateVersion?: string;
};

export type GroupScopedSettings = {
  activeTemplateId?: string;
  templateApplication?: GroupTemplateApplication;
};

export type ScopedWorkspaceSettings = ServerScopedSettings | GroupScopedSettings;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function optionalText(value: unknown, label: string, max = 200) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be text`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long`);
  return normalized;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unsupported = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unsupported.length) throw new Error(`${label} contains unsupported keys: ${unsupported.join(", ")}`);
}

function normalizeApplication(value: unknown): GroupTemplateApplication | undefined {
  if (value === undefined || value === null) return undefined;
  const row = record(value, "templateApplication");
  assertOnlyKeys(row, ["templateId", "mode", "appliedAt", "eventId", "recomputeRunId", "codeVersion", "configVersion", "templateVersion"], "templateApplication");
  const templateId = optionalText(row.templateId, "templateApplication.templateId", 160);
  const appliedAt = optionalText(row.appliedAt, "templateApplication.appliedAt", 80);
  if (!templateId || !appliedAt) throw new Error("templateApplication templateId and appliedAt are required");
  if (row.mode !== "now" && row.mode !== "event-start") throw new Error("templateApplication.mode must be now or event-start");
  if (!Number.isFinite(Date.parse(appliedAt))) throw new Error("templateApplication.appliedAt must be a valid timestamp");
  const output: GroupTemplateApplication = { templateId, mode: row.mode, appliedAt };
  for (const key of ["eventId", "recomputeRunId", "codeVersion", "configVersion", "templateVersion"] as const) {
    const normalized = optionalText(row[key], `templateApplication.${key}`, 220);
    if (normalized) output[key] = normalized;
  }
  if (output.mode === "event-start") {
    for (const key of ["eventId", "recomputeRunId", "codeVersion", "configVersion", "templateVersion"] as const) {
      if (!output[key]) throw new Error(`event-start templateApplication requires ${key}`);
    }
  }
  return output;
}

export function normalizeScopedWorkspaceSettings(scopeType: WorkspaceScopeType, value: unknown): ScopedWorkspaceSettings {
  const row = record(value, `${scopeType} scope state`);
  if (scopeType === "server") {
    assertOnlyKeys(row, ["arena", "mapProfile"], "server scope state");
    const arena = optionalText(row.arena, "server scope arena", 160);
    const mapProfile = optionalText(row.mapProfile, "server scope mapProfile", 120);
    return { ...(arena ? { arena } : {}), ...(mapProfile ? { mapProfile } : {}) } satisfies ServerScopedSettings;
  }
  if (scopeType === "group") {
    assertOnlyKeys(row, ["activeTemplateId", "templateApplication"], "group scope state");
    const activeTemplateId = optionalText(row.activeTemplateId, "group scope activeTemplateId", 160);
    const templateApplication = normalizeApplication(row.templateApplication);
    if (templateApplication && activeTemplateId && templateApplication.templateId !== activeTemplateId) {
      throw new Error("group scope activeTemplateId must match templateApplication.templateId");
    }
    return {
      ...(activeTemplateId ? { activeTemplateId } : {}),
      ...(templateApplication ? { templateApplication } : {}),
    } satisfies GroupScopedSettings;
  }
  throw new Error("scope type must be server or group");
}

export function workspaceScopeId(scopeType: WorkspaceScopeType, serverId: string, groupId?: string) {
  const server = serverId.trim();
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(server)) throw new Error("server scope id is invalid");
  if (scopeType === "server") return server;
  const group = (groupId ?? "").trim();
  if (!/^[A-Za-z0-9_.:@-]{1,120}$/.test(group)) throw new Error("group scope id is invalid");
  return `${server}:${group}`;
}
