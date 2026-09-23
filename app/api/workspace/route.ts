import { desc, eq, sql } from "drizzle-orm";

import { auditEntries, workspaces } from "@/db/schema";
import { DEFAULT_WORKSPACE, type InfluxSettings, type SyncTemplate, type VehicleType, type WorkspaceState } from "@/lib/bluewolf";
import { prepareTelAvivDemoWorkspace } from "@/lib/default-map-profile-server";
import { migrateUntouchedBuiltInSiTemplates } from "@/lib/si-builtin-template-migration";
import { readLocalWorkspace, writeLocalWorkspace } from "@/lib/sqlite-workspace";
import { normalizeAndValidateWorkspaceState } from "@/lib/workspace-validation";

const localStorage = () => process.env.BLUEWOLF_STORAGE === "sqlite";
const workspacePattern = /^[a-zA-Z0-9_-]{8,80}$/;

function getWorkspaceId(request: Request) {
  if (localStorage()) return "installation";
  const value = request.headers.get("x-bluewolf-workspace") ?? "";
  return workspacePattern.test(value) ? value : null;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table") || message.includes("D1 binding")) {
    return "מסד הנתונים עדיין אינו זמין בפריסה זו.";
  }
  return message;
}

function influxFromState(value: unknown): InfluxSettings {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("influx" in value)) throw new Error("influx settings are missing from workspace");
  return (value as { influx: InfluxSettings }).influx;
}

function siRuntimeFromState(value: unknown): { templates: SyncTemplate[]; vehicleTypes: VehicleType[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("workspace state is missing");
  const row = value as { templates?: unknown; vehicleTypes?: unknown };
  if (!Array.isArray(row.templates)) throw new Error("templates are missing from workspace");
  if (!Array.isArray(row.vehicleTypes)) throw new Error("vehicle types are missing from workspace");
  return { templates: row.templates as SyncTemplate[], vehicleTypes: row.vehicleTypes as VehicleType[] };
}

/** Normalize first; upgrade only complete, untouched historical SI presets.
 * A read never persists the migrated view, changes the user's revision or
 * overwrites user-authored templates. A subsequent explicit PUT owns that write.
 */
function prepareServerSiRead(state: WorkspaceState): WorkspaceState {
  return { ...state, templates: migrateUntouchedBuiltInSiTemplates(state.templates, state.vehicleTypes) };
}

async function preparedLocalWorkspace(workspaceId: string) {
  const current = await readLocalWorkspace(workspaceId);
  const source = current.state ?? DEFAULT_WORKSPACE;
  const prepared = await prepareTelAvivDemoWorkspace(source);
  const normalized = normalizeAndValidateWorkspaceState(prepared) as WorkspaceState;
  return { ...current, state: prepareServerSiRead(normalized), revision: Number(current.revision ?? 0) };
}

export async function GET(request: Request) {
  const workspaceId = getWorkspaceId(request);
  if (!workspaceId) return Response.json({ error: "workspace id is required" }, { status: 400 });
  try {
    if (localStorage()) return Response.json(await preparedLocalWorkspace(workspaceId));
    const { getDb } = await import("@/db");
    const db = getDb();
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const logs = await db.select().from(auditEntries).where(eq(auditEntries.workspaceId, workspaceId)).orderBy(desc(auditEntries.id)).limit(20);
    return Response.json({ state: row ? JSON.parse(row.state) : null, revision: row?.revision ?? 0, updatedAt: row?.updatedAt ?? null, logs });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

// Serialize SQLite workspace PUTs within the single-worker offline Web host.
// A losing optimistic write must never touch the external Core config. The
// queue also prevents an older successful save from syncing *after* a newer
// successful save has already synced in this process.
let localWriteQueue: Promise<void> = Promise.resolve();
function serializeLocalWrite(task: () => Promise<Response>): Promise<Response> {
  const current = localWriteQueue.then(task, task);
  localWriteQueue = current.then(() => undefined, () => undefined);
  return current;
}

async function persistAndSyncLocal(
  workspaceId: string,
  normalizedState: WorkspaceState,
  state: string,
  body: { category?: string; action?: string; detail?: string; expectedRevision?: number },
): Promise<Response> {
  const category = body.category ?? "";
  // Commit and resolve the optimistic version FIRST. The old flow modified
  // operational config before discovering a 409, letting a stale browser alter
  // the live Core configuration without owning the Workspace revision.
  const result = await writeLocalWorkspace(
    workspaceId, state, category.slice(0, 40) || "configuration",
    (body.action ?? "save").slice(0, 80), (body.detail ?? "").slice(0, 500), body.expectedRevision,
  );
  if (result.conflict) return Response.json({ ...result, runtimeSync: null }, { status: 409 });

  let runtimeSync: { synced: boolean; configPath: string | null; restartRequired: boolean; reason?: string } | null = null;
  try {
    if (category === "influx") {
      const { syncInfluxToOperationalConfig } = await import("@/lib/influx-runtime-sync");
      runtimeSync = await syncInfluxToOperationalConfig(influxFromState(normalizedState));
    } else if (category === "templates" || category === "vehicle-ranges") {
      const { syncSiTemplatesToOperationalConfig } = await import("@/lib/si-runtime-sync");
      const { templates, vehicleTypes } = siRuntimeFromState(normalizedState);
      runtimeSync = await syncSiTemplatesToOperationalConfig(templates, vehicleTypes);
      // This adapter currently syncs SI only. Never claim that saved SO
      // placements or a new binding are running in the operational Core.
      if (runtimeSync.synced && templates.some((template) => template.family === "SO")) {
        runtimeSync = {
          ...runtimeSync,
          synced: false,
          reason: "תבניות SI נכתבו לקונפיגורציה ומחייבות הפעלה מחדש; תבניות SO עדיין לא סונכרנו לליבה התפעולית. בדיקת E2E חסומה.",
        };
      }
    }
  } catch (error) {
    // A committed SQLite revision cannot be reported as a failed save or
    // silently rolled back. Return the durable success with an explicit Core
    // sync failure for the operator to resolve, never a misleading HTTP 502.
    runtimeSync = { synced: false, configPath: null, restartRequired: false, reason: `סנכרון הליבה נכשל לאחר שמירה ב־SQLite: ${errorMessage(error)}` };
  }
  if (runtimeSync && !runtimeSync.synced && !runtimeSync.reason) {
    runtimeSync = { ...runtimeSync, reason: "קונפיגורציית Core תפעולי אינה מוגדרת; בדיקת E2E חסומה." };
  }
  if (runtimeSync?.reason === "BLUEWOLF_OPERATIONAL_CONFIG is not configured") {
    runtimeSync = { ...runtimeSync, reason: "קונפיגורציית Core תפעולי אינה מוגדרת; בדיקת E2E חסומה." };
  }
  return Response.json({ ...result, runtimeSync }, { status: 200 });
}

export async function PUT(request: Request) {
  const workspaceId = getWorkspaceId(request);
  if (!workspaceId) return Response.json({ error: "workspace id is required" }, { status: 400 });
  try {
    const body = await request.json() as { state?: unknown; category?: string; action?: string; detail?: string; expectedRevision?: number };
    const normalizedState = normalizeAndValidateWorkspaceState(body.state ?? {}) as WorkspaceState;
    const state = JSON.stringify(normalizedState);
    if (state.length > 750_000) return Response.json({ error: "workspace state is too large" }, { status: 413 });

    if (localStorage()) {
      return await serializeLocalWrite(() => persistAndSyncLocal(workspaceId, normalizedState, state, body));
    }
    const { getDb } = await import("@/db");
    const db = getDb();
    const current = await db.select({ revision: workspaces.revision }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const nextRevision = (current[0]?.revision ?? 0) + 1;
    await db.batch([
      db.insert(workspaces).values({ id: workspaceId, state, revision: nextRevision }).onConflictDoUpdate({
        target: workspaces.id,
        set: { state, revision: nextRevision, updatedAt: sql`CURRENT_TIMESTAMP` },
      }),
      db.insert(auditEntries).values({
        workspaceId,
        category: (body.category ?? "configuration").slice(0, 40),
        action: (body.action ?? "save").slice(0, 80),
        detail: (body.detail ?? "").slice(0, 500),
      }),
    ]);
    return Response.json({ ok: true, revision: nextRevision, runtimeSync: null });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}
