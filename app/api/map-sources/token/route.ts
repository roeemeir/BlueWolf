import {
  LOCAL_WORKSPACE_ID,
  localMapSource,
  localMapSourceTokenStatus,
  localMapSourcesEnabled,
} from "@/lib/local-map-source-server";
import {
  deleteLocalMapSourceToken,
  writeLocalMapSourceToken,
} from "@/lib/sqlite-workspace";

function unavailable() {
  return Response.json({ error: "private map source tokens are available only in local SQLite deployment" }, { status: 409 });
}

function sourceIdFromUrl(request: Request) {
  return new URL(request.url).searchParams.get("sourceId")?.trim() ?? "";
}

export async function GET(request: Request) {
  if (!localMapSourcesEnabled()) return unavailable();
  try {
    const sourceId = sourceIdFromUrl(request);
    if (!sourceId) return Response.json({ error: "sourceId is required" }, { status: 400 });
    return Response.json(await localMapSourceTokenStatus(sourceId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "map source token status failed" }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  if (!localMapSourcesEnabled()) return unavailable();
  try {
    const body = await request.json() as { sourceId?: unknown; token?: unknown };
    const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
    const token = typeof body.token === "string" ? body.token : "";
    if (!sourceId) return Response.json({ error: "sourceId is required" }, { status: 400 });
    const source = await localMapSource(sourceId);
    if (source.tokenMode === "none") return Response.json({ error: "this map source does not require a token" }, { status: 409 });
    const result = await writeLocalMapSourceToken(LOCAL_WORKSPACE_ID, source.id, token);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "map source token update failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!localMapSourcesEnabled()) return unavailable();
  try {
    const sourceId = sourceIdFromUrl(request);
    if (!sourceId) return Response.json({ error: "sourceId is required" }, { status: 400 });
    const source = await localMapSource(sourceId);
    return Response.json(await deleteLocalMapSourceToken(LOCAL_WORKSPACE_ID, source.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "map source token delete failed" }, { status: 400 });
  }
}
