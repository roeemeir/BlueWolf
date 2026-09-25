import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { DEFAULT_WORKSPACE } from "@/lib/bluewolf";
import {
  RUNTIME_PROVENANCE_SCHEMA_VERSION,
  normalizeRuntimeProvenance,
  type CapturedRuntimeProvenance,
} from "@/lib/runtime-provenance";
import { readLocalWorkspace } from "@/lib/sqlite-workspace";

const SENSITIVE_KEY = /(token|secret|password)/i;

function publicConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicConfig);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, publicConfig(item)]),
    );
  }
  return value;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(publicConfig(value))).digest("hex");
}

function codeShaFromEnvironment() {
  for (const value of [process.env.BLUEWOLF_CODE_SHA, process.env.GITHUB_SHA]) {
    const normalized = value?.trim() ?? "";
    if (/^[0-9a-f]{7,64}$/i.test(normalized)) return normalized.toLowerCase();
  }
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 }).trim();
    return /^[0-9a-f]{7,64}$/i.test(value) ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function coreProvenance(): Promise<CapturedRuntimeProvenance | null> {
  const baseUrl = process.env.BLUEWOLF_CORE_API_URL?.trim().replace(/\/$/, "");
  if (!baseUrl) return null;
  const headers = new Headers({ accept: "application/json" });
  const token = process.env.BLUEWOLF_CORE_API_TOKEN?.trim();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${baseUrl}/v1/provenance`, { headers, cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Python Core provenance returned ${response.status}`);
    const normalized = normalizeRuntimeProvenance(await response.json());
    return { ...normalized, source: "python-core", capturedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
  }
}

async function webWorkspaceProvenance(): Promise<CapturedRuntimeProvenance> {
  const codeSha = codeShaFromEnvironment();
  if (!codeSha) throw new Error("code SHA is unavailable; set BLUEWOLF_CODE_SHA for the offline release");
  const explicitConfigVersion = process.env.BLUEWOLF_CONFIG_VERSION?.trim();
  const workspace = await readLocalWorkspace("installation");
  const configVersion = explicitConfigVersion || fingerprint(workspace.state ?? DEFAULT_WORKSPACE);
  return {
    schemaVersion: RUNTIME_PROVENANCE_SCHEMA_VERSION,
    codeSha,
    configVersion,
    source: "web-workspace",
    capturedAt: new Date().toISOString(),
  };
}

/**
 * BW-QA-008: provenance is resolved at the server/deployment boundary, never
 * accepted from browser input. Operational deployments prefer the Python Core
 * provenance endpoint. Offline developer-only deployments fall back to the
 * installed code SHA plus a secret-free fingerprint of the persisted Web config.
 */
export async function resolveRuntimeProvenance(): Promise<CapturedRuntimeProvenance> {
  const core = await coreProvenance();
  if (core) return core;
  return webWorkspaceProvenance();
}
