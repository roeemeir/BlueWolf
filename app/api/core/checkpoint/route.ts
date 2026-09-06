import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { coreCheckpoints } from "@/db/schema";

const workspacePattern = /^[a-zA-Z0-9_-]{8,80}$/;
const serverPattern = /^[a-zA-Z0-9_-]{1,80}$/;

function workspaceId(request: Request) {
  const value = request.headers.get("x-bluewolf-workspace") ?? "";
  return workspacePattern.test(value) ? value : null;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table") || message.includes("D1 binding") || message.includes("database")) {
    return "מסד הנתונים של ה־checkpoint אינו זמין בפריסה זו.";
  }
  return message;
}

export async function GET(request: Request) {
  const workspace = workspaceId(request);
  const serverId = new URL(request.url).searchParams.get("serverId") ?? "";
  if (!workspace || !serverPattern.test(serverId)) return Response.json({ error: "workspace/server id is required" }, { status: 400 });

  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(coreCheckpoints)
      .where(and(eq(coreCheckpoints.workspaceId, workspace), eq(coreCheckpoints.serverId, serverId)))
      .orderBy(desc(coreCheckpoints.id))
      .limit(1);
    return Response.json({ available: true, checkpoint: row ?? null });
  } catch (error) {
    return Response.json({ available: false, checkpoint: null, error: errorMessage(error) });
  }
}

export async function POST(request: Request) {
  const workspace = workspaceId(request);
  if (!workspace) return Response.json({ error: "workspace id is required" }, { status: 400 });

  try {
    const body = await request.json() as {
      serverId?: string;
      coreApiVersion?: string;
      algorithmVersion?: string;
      processedUntilUtc?: string | null;
      checkpointBase64?: string;
    };
    const serverId = (body.serverId ?? "").trim();
    const checkpointBase64 = body.checkpointBase64 ?? "";
    if (!serverPattern.test(serverId)) return Response.json({ error: "valid serverId is required" }, { status: 400 });
    if (!body.coreApiVersion || !body.algorithmVersion) return Response.json({ error: "Core versions are required" }, { status: 400 });
    if (!checkpointBase64 || checkpointBase64.length > 2_000_000) return Response.json({ error: "invalid checkpoint payload" }, { status: 413 });
    if (body.processedUntilUtc != null && !Number.isFinite(new Date(body.processedUntilUtc).getTime())) return Response.json({ error: "invalid processedUntilUtc" }, { status: 400 });

    const db = getDb();
    const [inserted] = await db.insert(coreCheckpoints).values({
      workspaceId: workspace,
      serverId,
      coreApiVersion: body.coreApiVersion.slice(0, 40),
      algorithmVersion: body.algorithmVersion.slice(0, 80),
      processedUntilUtc: body.processedUntilUtc ?? null,
      checkpointBase64,
    }).returning({ id: coreCheckpoints.id, createdAt: coreCheckpoints.createdAt });

    return Response.json({ ok: true, available: true, id: inserted?.id ?? null, createdAt: inserted?.createdAt ?? null });
  } catch (error) {
    return Response.json({ ok: false, available: false, error: errorMessage(error) });
  }
}
