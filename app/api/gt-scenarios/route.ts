import { deleteLocalGtScenario, listLocalGtScenarios, readLocalGtScenario, writeLocalGtScenario } from "@/lib/sqlite-gt-scenarios";
import { resolveRuntimeProvenance } from "@/lib/runtime-provenance-server";

export const runtime = "nodejs";

function enabled() {
  return process.env.BLUEWOLF_STORAGE === "sqlite";
}

function integer(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`integer must be in [${min},${max}]`);
  return parsed;
}

function withServerProvenance(value: unknown, provenance: Awaited<ReturnType<typeof resolveRuntimeProvenance>>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return { ...(value as Record<string, unknown>), provenance };
}

export async function GET(request: Request) {
  if (!enabled()) return Response.json({ error: "GT scenario bank is available in local SQLite deployment" }, { status: 409 });
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("id")?.trim();
    if (id) {
      const scenario = await readLocalGtScenario(id);
      return scenario ? Response.json({ scenario, storage: "sqlite" }) : Response.json({ error: "GT scenario not found" }, { status: 404 });
    }
    const result = await listLocalGtScenarios({
      query: params.get("q") ?? "",
      serverId: params.get("serverId") ?? "",
      limit: integer(params.get("limit"), 100, 1, 500),
      offset: integer(params.get("offset"), 0, 0, 100_000),
    });
    return Response.json({ ...result, storage: "sqlite" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "GT scenario query failed" }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  if (!enabled()) return Response.json({ error: "GT scenario bank is available in local SQLite deployment" }, { status: 409 });
  try {
    const body = await request.json() as { scenario?: unknown; expectedRevision?: unknown };
    const expectedRevision = body.expectedRevision === undefined ? undefined : Number(body.expectedRevision);
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) throw new Error("expectedRevision is invalid");
    let provenance;
    try {
      provenance = await resolveRuntimeProvenance();
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "runtime provenance is unavailable" }, { status: 503 });
    }
    const result = await writeLocalGtScenario(withServerProvenance(body.scenario, provenance), expectedRevision);
    const conflict = "conflict" in result && result.conflict === true;
    return Response.json(result, { status: conflict ? 409 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "GT scenario save failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!enabled()) return Response.json({ error: "GT scenario bank is available in local SQLite deployment" }, { status: 409 });
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("id")?.trim() ?? "";
    if (!id) throw new Error("GT scenario id is required");
    const expectedRevision = params.has("revision") ? integer(params.get("revision"), 0, 0, 1_000_000_000) : undefined;
    const result = await deleteLocalGtScenario(id, expectedRevision);
    const notFound = "notFound" in result && result.notFound === true;
    const conflict = "conflict" in result && result.conflict === true;
    return Response.json(result, { status: notFound ? 404 : conflict ? 409 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "GT scenario delete failed" }, { status: 400 });
  }
}
