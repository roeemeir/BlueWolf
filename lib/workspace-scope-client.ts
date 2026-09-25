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

// A scoped GET has no side effects, so one retry is safe after either a thrown
// network failure or a transient gateway response. Never apply this retry to a
// scoped PUT: the transaction could already be committed when its reply is lost.
const RETRYABLE_READ_STATUSES = new Set([502, 503, 504]);
async function fetchScopeForRead(url: string) {
  try {
    const first = await fetch(url, { cache: "no-store" });
    if (!RETRYABLE_READ_STATUSES.has(first.status)) return first;
  } catch (firstError) {
    try {
      return await fetch(url, { cache: "no-store" });
    } catch (secondError) {
      const detail = secondError instanceof Error ? secondError.message : String(secondError);
      const firstDetail = firstError instanceof Error ? firstError.message : String(firstError);
      throw new Error(`scope read transport failed twice (${firstDetail}; ${detail})`);
    }
  }
  return fetch(url, { cache: "no-store" });
}

export async function readWorkspaceScope<T extends ScopedWorkspaceSettings>(scopeType: WorkspaceScopeType, scopeId: string): Promise<WorkspaceScopeEnvelope<T>> {
  const response = await fetchScopeForRead(`/api/workspace/scope?type=${encodeURIComponent(scopeType)}&id=${encodeURIComponent(scopeId)}`);
  if (response.status === 501) return { available: false, state: null, revision: 0, updatedAt: null };
  // HTML from a reverse proxy is not a scoped-storage envelope. Preserve an
  // intelligible HTTP error even if a transient gateway did not send JSON.
  if (!response.ok) {
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* gateway sent non-JSON */ }
    throw new Error(errorFromPayload(payload, `scope read failed (${response.status})`));
  }
  const payload = await response.json() as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("scope read payload is invalid");
  const row = payload as { state?: unknown; revision?: unknown; updatedAt?: unknown };
  if (!Object.prototype.hasOwnProperty.call(row, "state")) throw new Error("scope read state is missing");
  if (typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 0) {
    throw new Error("scope read revision is invalid");
  }
  if (row.updatedAt !== null && row.updatedAt !== undefined && typeof row.updatedAt !== "string") {
    throw new Error("scope read updatedAt is invalid");
  }
  const state = row.state === null ? null : normalizeScopedWorkspaceSettings(scopeType, row.state) as T;
  return {
    available: true,
    state,
    revision: row.revision,
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
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("scope save expectedRevision is invalid");
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
    const revision = payload && typeof payload === "object" && "revision" in payload ? (payload as { revision: unknown }).revision : expectedRevision;
    return { available: true, ok: false, conflict: true, revision: typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0 ? revision : expectedRevision };
  }
  if (!response.ok) throw new Error(errorFromPayload(payload, `scope save failed (${response.status})`));
  // An HTTP-200 error envelope or reverse-proxy substitute is not proof of a
  // durable write. Require the backend's explicit acknowledgment and revision.
  if (!payload || typeof payload !== "object" || (payload as { ok?: unknown }).ok !== true) {
    throw new Error("scope save was not acknowledged by storage");
  }
  const revision = (payload as { revision?: unknown }).revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= expectedRevision) {
    throw new Error("scope save returned an invalid or non-advancing revision");
  }
  return { available: true, ok: true, conflict: false, revision };
}
