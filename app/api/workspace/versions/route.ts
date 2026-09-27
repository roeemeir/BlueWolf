import { listLocalWorkspaceVersions, readLocalWorkspaceVersion, writeLocalWorkspace } from "@/lib/sqlite-workspace";
import { normalizeAndValidateWorkspaceState } from "@/lib/workspace-validation";

const localStorage = () => process.env.BLUEWOLF_STORAGE === "sqlite";

export async function GET() {
  if (!localStorage()) return Response.json({ status: "unavailable", error: "Workspace version history is available only in the offline SQLite deployment" }, { status: 503 });
  try {
    const versions = await listLocalWorkspaceVersions("installation", 50);
    return Response.json({ schemaVersion: "bluewolf.workspace-versions.v1", versions, storage: "sqlite" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "version history failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!localStorage()) return Response.json({ status: "unavailable", error: "Workspace recovery is available only in the offline SQLite deployment" }, { status: 503 });
  try {
    const body = await request.json() as { revision?: unknown; expectedRevision?: unknown };
    const sourceRevision = Number(body.revision);
    const expectedRevision = body.expectedRevision === undefined ? undefined : Number(body.expectedRevision);
    if (!Number.isInteger(sourceRevision) || sourceRevision < 1) return Response.json({ error: "revision must be a positive integer" }, { status: 400 });
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) return Response.json({ error: "expectedRevision must be a non-negative integer" }, { status: 400 });

    const source = await readLocalWorkspaceVersion("installation", sourceRevision);
    if (!source) return Response.json({ error: "workspace revision was not found" }, { status: 404 });
    const normalized = normalizeAndValidateWorkspaceState(source.state);
    const result = await writeLocalWorkspace(
      "installation",
      JSON.stringify(normalized),
      "recovery",
      "restore-version",
      `restored from revision ${sourceRevision}`,
      expectedRevision,
    );
    if (result.conflict) return Response.json(result, { status: 409 });
    return Response.json({ ...result, restoredFrom: sourceRevision });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "workspace recovery failed" }, { status: 400 });
  }
}
