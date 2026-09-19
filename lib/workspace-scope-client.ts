"use client";

import {
  normalizeScopedWorkspaceSettings,
  type ScopedWorkspaceSettings,
  type WorkspaceScopeType,
} from "@/lib/scoped-workspace-settings";

export type WorkspaceScopeEnvelope<T extends ScopedWorkspaceSettings = ScopedWorkspaceSettings> = {
  available: boolean;
  state: T | null;
  revision: number;
  updatedAt: string | null;
};

export type WorkspaceScopeWriteResult = {
  available: boolean;
  ok: boolean;
  conflict: boolean;
  revision: number;
};

function errorFromPayload(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) return String((payload as { error: unknown }).error);
  return fallback;
}

export async function readWorkspaceScope<T extends ScopedWorkspaceSettings>(scopeType: WorkspaceScopeType, scopeId: string): Promise<WorkspaceScopeEnvelope<T>> {
  const response = await fetch(`/api/workspace/scope?type=${encodeURIComponent(scopeType)}&id=${encodeURIComponent(scopeId)}`, { cache: "no-store" });
  if (response.status === 501) return { available: false, state: null, revision: 0, updatedAt: null };
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(errorFromPayload(payload, `scope read failed (${response.status})`));
  if (!payload || typeof payload !== "object") throw new Error("scope read payload is invalid");
  const row = payload as { state?: unknown; revision?: unknown; updatedAt?: unknown };
  const revision = Number(row.revision ?? 0);
  if (!Number.isInteger(revision) || revision < 0) throw new Error("scope read revision is invalid");
  const state = row.state === null || row.state === undefined ? null : normalizeScopedWorkspaceSettings(scopeType, row.state) as T;
  return {
    available: true,
    state,
    revision,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
  };
}

export async function writeWorkspaceScope<T extends ScopedWorkspaceSettings>(
  scopeType: WorkspaceScopeType,
  scopeId: string,
  state: T,
  expectedRevision: number,
  action: string,
  detail: string,
): Promise<WorkspaceScopeWriteResult> {
  const normalized = normalizeScopedWorkspaceSettings(scopeType, state);
  const response = await fetch("/api/workspace/scope", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scopeType, scopeId, state: normalized, expectedRevision, category: "operator", action, detail }),
  });
  if (response.status === 501) return { available: false, ok: false, conflict: false, revision: expectedRevision };
  const payload = await response.json() as unknown;
  if (response.status === 409) {
    const revision = payload && typeof payload === "object" && "revision" in payload ? Number((payload as { revision: unknown }).revision) : expectedRevision;
    return { available: true, ok: false, conflict: true, revision: Number.isInteger(revision) ? revision : expectedRevision };
  }
  if (!response.ok) throw new Error(errorFromPayload(payload, `scope save failed (${response.status})`));
  const revision = payload && typeof payload === "object" && "revision" in payload ? Number((payload as { revision: unknown }).revision) : expectedRevision + 1;
  return { available: true, ok: true, conflict: false, revision: Number.isInteger(revision) ? revision : expectedRevision + 1 };
}
