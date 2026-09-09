import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { appSettings, auditEntries, configVersions } from "@/db/schema";

const workspacePattern = /^[a-zA-Z0-9_-]{8,80}$/;
const MAX_CONFIG_BYTES = 750_000;

function workspaceId(request: Request) {
  const value = request.headers.get("x-bluewolf-workspace") ?? "";
  return workspacePattern.test(value) ? value : null;
}

function dbError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return message.includes("no such table") || message.includes("D1 binding")
    ? "מסד הנתונים של התצורה עדיין אינו זמין בפריסה זו."
    : message;
}

export async function GET(request: Request) {
  const id = workspaceId(request);
  if (!id) return Response.json({ error: "workspace id is required" }, { status: 400 });
  try {
    const db = getDb();
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.workspaceId, id)).limit(1);
    const versions = await db.select().from(configVersions).where(eq(configVersions.workspaceId, id)).orderBy(desc(configVersions.version)).limit(50);
    return Response.json({
      activeVersion: settings?.activeConfigVersion ?? null,
      draftVersion: settings?.draftConfigVersion ?? null,
      versions: versions.map((row) => ({ ...row, value: JSON.parse(row.value) })),
    });
  } catch (error) {
    return Response.json({ error: dbError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const id = workspaceId(request);
  if (!id) return Response.json({ error: "workspace id is required" }, { status: 400 });
  try {
    const body = await request.json() as {
      action?: "draft" | "publish";
      value?: unknown;
      version?: number;
      algorithmVersion?: string;
      actor?: string;
    };
    const action = body.action;
    if (action !== "draft" && action !== "publish") return Response.json({ error: "action must be draft or publish" }, { status: 400 });
    const db = getDb();

    if (action === "draft") {
      const serialized = JSON.stringify(body.value ?? {});
      if (new TextEncoder().encode(serialized).byteLength > MAX_CONFIG_BYTES) return Response.json({ error: "configuration is too large" }, { status: 413 });
      const latest = await db.select({ version: configVersions.version }).from(configVersions).where(eq(configVersions.workspaceId, id)).orderBy(desc(configVersions.version)).limit(1);
      const nextVersion = (latest[0]?.version ?? 0) + 1;
      await db.batch([
        db.insert(configVersions).values({ workspaceId: id, version: nextVersion, status: "draft", value: serialized, algorithmVersion: body.algorithmVersion?.slice(0, 100), createdBy: body.actor?.slice(0, 120) }),
        db.insert(appSettings).values({ workspaceId: id, draftConfigVersion: nextVersion }).onConflictDoUpdate({ target: appSettings.workspaceId, set: { draftConfigVersion: nextVersion, updatedAt: sql`CURRENT_TIMESTAMP` } }),
        db.insert(auditEntries).values({ workspaceId: id, category: "configuration", action: "draft", detail: `config v${nextVersion}`, entityType: "config_version", entityId: String(nextVersion), configVersion: nextVersion, algorithmVersion: body.algorithmVersion?.slice(0, 100) }),
      ]);
      return Response.json({ ok: true, version: nextVersion, status: "draft" });
    }

    if (!Number.isInteger(body.version) || (body.version ?? 0) < 1) return Response.json({ error: "version is required for publish" }, { status: 400 });
    const targetVersion = body.version!;
    const [target] = await db.select().from(configVersions).where(and(eq(configVersions.workspaceId, id), eq(configVersions.version, targetVersion))).limit(1);
    if (!target) return Response.json({ error: "configuration version was not found" }, { status: 404 });

    const published = await db.select({ id: configVersions.id }).from(configVersions).where(and(eq(configVersions.workspaceId, id), eq(configVersions.status, "published")));
    const statements = published.map((row) => db.update(configVersions).set({ status: "superseded" }).where(eq(configVersions.id, row.id)));
    statements.push(
      db.update(configVersions).set({ status: "published", publishedAt: sql`CURRENT_TIMESTAMP` }).where(eq(configVersions.id, target.id)),
      db.insert(appSettings).values({ workspaceId: id, activeConfigVersion: targetVersion, draftConfigVersion: targetVersion }).onConflictDoUpdate({ target: appSettings.workspaceId, set: { activeConfigVersion: targetVersion, draftConfigVersion: targetVersion, updatedAt: sql`CURRENT_TIMESTAMP` } }),
      db.insert(auditEntries).values({ workspaceId: id, category: "configuration", action: "publish", detail: `config v${targetVersion}`, entityType: "config_version", entityId: String(targetVersion), configVersion: targetVersion, algorithmVersion: target.algorithmVersion }),
    );
    await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
    return Response.json({ ok: true, version: targetVersion, status: "published" });
  } catch (error) {
    return Response.json({ error: dbError(error) }, { status: 500 });
  }
}
