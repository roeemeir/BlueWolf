import { resolveRuntimeProvenance } from "@/lib/runtime-provenance-server";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.BLUEWOLF_STORAGE !== "sqlite") {
    return Response.json({ error: "runtime provenance is exposed by the local/offline deployment" }, { status: 409 });
  }
  try {
    return Response.json(await resolveRuntimeProvenance(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ status: "unavailable", error: error instanceof Error ? error.message : "runtime provenance is unavailable" }, { status: 503 });
  }
}
