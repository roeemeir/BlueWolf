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

/** A transport exception on an idempotent scope GET is safe to retry once.
 * Never retry a scope PUT: the SQLite revision may already have been committed
 * when the response was lost, and blindly re-sending could conflict or duplicate
 * a decision. HTTP errors and malformed payloads are not transport retries. */
async function fetchScopeForRead(url: string) {
  try {
    return await fetch(url, { cache: "no-store" });
  } catch (firstError) {
    try {
      return await fetch(url, { cache: "no-store" });
    } catch (secondError) {
      const detail = secondError instanceof Error ? secondError.message : String(secondError);
      const firstDetail = firstError instanceof Error ? firstError.message : String(firstError);
      throw new Error(`scope read transport failed twice (${firstDetail}; ${detail})`);
    }
  }
}

export async function readWorkspaceScope<T extends ScopedWorkspaceSettings>(scopeType: WorkspaceScopeType, scopeId: string): Promise<WorkspaceScopeEnvelope<T>> {
  const response = await fetchScopeForRead(`/api/workspace/scope?type=${encodeURIComponent(scopeType)}&id=${encodeURIComponent(scopeId)}`);
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
  // Deliberately one request. On a lost response the caller must reload the
  // revision and reconcile instead of repeating a possibly committed write.
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
  // An HTTP-200 error envelope or a reverse-proxy substitute is not evidence of
  // a durable write. Do not mark a map-profile choice as persisted without the
  // backend's explicit ok=true and a strictly advanced SQLite revision.
  if (!payload || typeof payload !== "object" || (payload as { ok?: unknown }).ok !== true) {
    throw new Error("scope save was not acknowledged by storage");
  }
  const revision = Number((payload as { revision?: unknown }).revision);
  if (!Number.isInteger(revision) || revision <= expectedRevision) {
    throw new Error("scope save returned an invalid or non-advancing revision");
  }
  return { available: true, ok: true, conflict: false, revision };
}
