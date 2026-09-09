import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { auditEntries, eventConfigOverrides } from "@/db/schema";

const workspacePattern = /^[a-zA-Z0-9_-]{8,80}$/;

function workspaceId(request: Request) {
  const value = request.headers.get("x-bluewolf-workspace") ?? "";
  return workspacePattern.test(value) ? value : null;
}

function dbError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return message.includes("no such table") || message.includes("D1 binding")
    ? "מסד נתוני ה־override עדיין אינו זמין בפריסה זו."
    : message;
}

export async function GET(request: Request) {
  const id = workspaceId(request);
  if (!id) return Response.json({ error: "workspace id is required" }, { status: 400 });
  const url = new URL(request.url);
  const eventKey = url.searchParams.get("eventKey");
  try {
    const db = getDb();
    const rows = eventKey
      ? await db.select().from(eventConfigOverrides).where(and(eq(eventConfigOverrides.workspaceId, id), eq(eventConfigOverrides.eventKey, eventKey))).orderBy(desc(eventConfigOverrides.createdAt)).limit(100)
      : await db.select().from(eventConfigOverrides).where(eq(eventConfigOverrides.workspaceId, id)).orderBy(desc(eventConfigOverrides.createdAt)).limit(100);
    return Response.json({ overrides: rows.map((row) => ({ ...row, config: JSON.parse(row.configJson) })) });
  } catch (error) {
    return Response.json({ error: dbError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const id = workspaceId(request);
  if (!id) return Response.json({ error: "workspace id is required" }, { status: 400 });
  try {
    const body = await request.json() as {
      id?: string;
      eventKey?: string;
      groupId?: string;
      config?: unknown;
      reason?: string;
      approver?: string;
      approvalStatus?: "draft" | "approved" | "rejected";
      applyMode?: "now" | "event-start";
      configVersion?: number;
      algorithmVersion?: string;
    };
    if (!body.eventKey?.trim() || !body.groupId?.trim() || !body.reason?.trim()) {
      return Response.json({ error: "eventKey, groupId and reason are required" }, { status: 400 });
    }
    const configJson = JSON.stringify(body.config ?? {});
    if (new TextEncoder().encode(configJson).byteLength > 250_000) return Response.json({ error: "override is too large" }, { status: 413 });
    const overrideId = body.id?.slice(0, 120) || `ovr-${crypto.randomUUID()}`;
    const db = getDb();
    await db.batch([
      db.insert(eventConfigOverrides).values({
        id: overrideId,
        workspaceId: id,
        eventKey: body.eventKey.slice(0, 160),
        groupId: body.groupId.slice(0, 120),
        configJson,
        reason: body.reason.slice(0, 2000),
        approver: body.approver?.slice(0, 160),
        approvalStatus: body.approvalStatus ?? "draft",
        applyMode: body.applyMode ?? "now",
        configVersion: Number.isInteger(body.configVersion) ? body.configVersion : undefined,
        algorithmVersion: body.algorithmVersion?.slice(0, 100),
      }),
      db.insert(auditEntries).values({
        workspaceId: id,
        category: "investigation",
        action: "event-override",
        detail: `${body.eventKey} · ${body.groupId} · ${body.applyMode ?? "now"}`,
        entityType: "event_override",
        entityId: overrideId,
        configVersion: body.configVersion,
        algorithmVersion: body.algorithmVersion?.slice(0, 100),
      }),
    ]);
    return Response.json({ ok: true, overrideId });
  } catch (error) {
    return Response.json({ error: dbError(error) }, { status: 500 });
  }
}
