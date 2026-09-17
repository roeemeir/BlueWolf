import { desc, eq, sql } from "drizzle-orm";

import { auditEntries, workspaces } from "@/db/schema";
import type { InfluxSettings, SyncTemplate, VehicleType } from "@/lib/bluewolf";
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

export async function GET(request: Request) {
  const workspaceId = getWorkspaceId(request);
  if (!workspaceId) return Response.json({ error: "workspace id is required" }, { status: 400 });

  try {
    if (localStorage()) return Response.json(await readLocalWorkspace(workspaceId));
    const { getDb } = await import("@/db");
    const db = getDb();
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const logs = await db.select().from(auditEntries).where(eq(auditEntries.workspaceId, workspaceId)).orderBy(desc(auditEntries.id)).limit(20);
    return Response.json({ state: row ? JSON.parse(row.state) : null, revision: row?.revision ?? 0, updatedAt: row?.updatedAt ?? null, logs });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const workspaceId = getWorkspaceId(request);
  if (!workspaceId) return Response.json({ error: "workspace id is required" }, { status: 400 });

  try {
    const body = await request.json() as { state?: unknown; category?: string; action?: string; detail?: string; expectedRevision?: number };
    const normalizedState = normalizeAndValidateWorkspaceState(body.state ?? {});
    const state = JSON.stringify(normalizedState);
    if (state.length > 750_000) return Response.json({ error: "workspace state is too large" }, { status: 413 });

    if (localStorage()) {
      let runtimeSync = null;
      const category = body.category ?? "";
      if (category === "influx") {
        try {
          const { syncInfluxToOperationalConfig } = await import("@/lib/influx-runtime-sync");
          runtimeSync = await syncInfluxToOperationalConfig(influxFromState(normalizedState));
        } catch (error) {
          return Response.json({ error: `Influx runtime config sync failed: ${errorMessage(error)}` }, { status: 502 });
        }
      } else if (category === "templates" || category === "vehicle-ranges") {
        try {
          const { syncSiTemplatesToOperationalConfig } = await import("@/lib/si-runtime-sync");
          const siRuntime = siRuntimeFromState(normalizedState);
          runtimeSync = await syncSiTemplatesToOperationalConfig(siRuntime.templates, siRuntime.vehicleTypes);
        } catch (error) {
          return Response.json({ error: `SI runtime config sync failed: ${errorMessage(error)}` }, { status: 502 });
        }
      }
      const result = await writeLocalWorkspace(workspaceId, state, (body.category ?? "configuration").slice(0,40), (body.action ?? "save").slice(0,80), (body.detail ?? "").slice(0,500), body.expectedRevision);
      return Response.json({ ...result, runtimeSync }, { status: result.conflict ? 409 : 200 });
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
