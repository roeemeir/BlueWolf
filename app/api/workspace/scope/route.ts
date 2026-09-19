import {
  readLocalWorkspaceScope,
  writeLocalWorkspaceScope,
  type WorkspaceScopeType,
} from "@/lib/sqlite-workspace";
import { normalizeScopedWorkspaceSettings } from "@/lib/scoped-workspace-settings";

const localStorage = () => process.env.BLUEWOLF_STORAGE === "sqlite";
const workspacePattern = /^[a-zA-Z0-9_-]{8,80}$/;
const scopeIdPattern = /^[A-Za-z0-9_.:@-]{1,160}$/;

function getWorkspaceId(request: Request) {
  if (localStorage()) return "installation";
  const value = request.headers.get("x-bluewolf-workspace") ?? "";
  return workspacePattern.test(value) ? value : null;
}

function scopeType(value: string | null): WorkspaceScopeType | null {
  return value === "server" || value === "group" ? value : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected scoped-settings error";
}

export async function GET(request: Request) {
  if (!localStorage()) return Response.json({ error: "scoped settings are available only in the offline SQLite runtime" }, { status: 501 });
  const workspaceId = getWorkspaceId(request);
  if (!workspaceId) return Response.json({ error: "workspace id is required" }, { status: 400 });
  const url = new URL(request.url);
  const type = scopeType(url.searchParams.get("type"));
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!type || !scopeIdPattern.test(id)) return Response.json({ error: "valid scope type and id are required" }, { status: 400 });
  try {
    return Response.json(await readLocalWorkspaceScope(workspaceId, type, id));
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  if (!localStorage()) return Response.json({ error: "scoped settings are available only in the offline SQLite runtime" }, { status: 501 });
  const workspaceId = getWorkspaceId(request);
  if (!workspaceId) return Response.json({ error: "workspace id is required" }, { status: 400 });
  try {
    const body = await request.json() as {
      scopeType?: string;
      scopeId?: string;
      state?: unknown;
      expectedRevision?: number;
      category?: string;
      action?: string;
      detail?: string;
    };
    const type = scopeType(body.scopeType ?? null);
    const id = (body.scopeId ?? "").trim();
    if (!type || !scopeIdPattern.test(id)) return Response.json({ error: "valid scope type and id are required" }, { status: 400 });
    if (body.expectedRevision !== undefined && (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0)) {
      return Response.json({ error: "expectedRevision must be a non-negative integer" }, { status: 400 });
    }
    const normalized = normalizeScopedWorkspaceSettings(type, body.state ?? {});
    const serialized = JSON.stringify(normalized);
    if (serialized.length > 50_000) return Response.json({ error: "scope state is too large" }, { status: 413 });
    const result = await writeLocalWorkspaceScope(
      workspaceId,
      type,
      id,
      serialized,
      (body.category ?? "scoped-settings").slice(0, 40),
      (body.action ?? "save-scope").slice(0, 80),
      (body.detail ?? "").slice(0, 500),
      body.expectedRevision,
    );
    return Response.json(result, { status: result.conflict ? 409 : 200 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}
