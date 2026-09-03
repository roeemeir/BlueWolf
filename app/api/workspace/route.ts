import { desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditEntries, workspaces } from "@/db/schema";

const workspacePattern = /^[a-zA-Z0-9_-]{8,80}$/;

function getWorkspaceId(request: Request) {
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

export async function GET(request: Request) {
  const workspaceId = getWorkspaceId(request);
  if (!workspaceId) return Response.json({ error: "workspace id is required" }, { status: 400 });

  try {
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
    const body = await request.json() as { state?: unknown; category?: string; action?: string; detail?: string };
    const state = JSON.stringify(body.state ?? {});
    if (state.length > 750_000) return Response.json({ error: "workspace state is too large" }, { status: 413 });

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
    return Response.json({ ok: true, revision: nextRevision });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
