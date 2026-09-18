import { ensureTelAvivDemoMapState } from "./default-map-profile";
import { defaultPublicWmtsDemoToken, prepareTelAvivDemoWorkspace } from "./default-map-profile-server";
import { normalizeMapSources, type OperationalMapSource } from "./map-source-config";
import {
  hasLocalMapSourceToken,
  readLocalMapSourceToken,
  readLocalWorkspace,
  writeLocalMapSourceToken,
} from "./sqlite-workspace";

export const LOCAL_WORKSPACE_ID = "installation";

export function localMapSourcesEnabled() {
  return process.env.BLUEWOLF_STORAGE === "sqlite";
}

export async function localMapSource(sourceId: string): Promise<OperationalMapSource> {
  if (!localMapSourcesEnabled()) throw new Error("private map sources are available only in local SQLite deployment");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sourceId)) throw new Error("map source id is invalid");
  const workspace = await readLocalWorkspace(LOCAL_WORKSPACE_ID);
  const rawState = workspace.state && typeof workspace.state === "object" && !Array.isArray(workspace.state)
    ? workspace.state
    : { mapServers: [], settings: {} };
  const migrated = ensureTelAvivDemoMapState(rawState);
  const prepared = sourceId === "omniscale-demo"
    ? await prepareTelAvivDemoWorkspace(migrated)
    : migrated;
  if (!prepared || typeof prepared !== "object" || Array.isArray(prepared)) throw new Error("local workspace is not configured");
  const row = prepared as Record<string, unknown>;
  const source = normalizeMapSources(row.mapServers ?? []).find((item) => item.id === sourceId && item.enabled);
  if (!source) throw new Error("map source is not configured or disabled");
  return source;
}

export async function localMapSourceSecret(source: OperationalMapSource) {
  if (source.tokenMode === "none") return null;
  const stored = await readLocalMapSourceToken(LOCAL_WORKSPACE_ID, source.id);
  if (stored) return stored;

  // The public Omniscale demo key is deliberately seeded through the same
  // SQLite secret table as a private deployment key. This makes the default QA
  // source exercise real server-side credential injection without putting the
  // key in workspace JSON, client responses, reports or map cache keys.
  const demo = defaultPublicWmtsDemoToken(source.id);
  if (!demo) return null;
  await writeLocalMapSourceToken(LOCAL_WORKSPACE_ID, source.id, demo);
  return demo;
}

export async function localMapSourceTokenStatus(sourceId: string) {
  const source = await localMapSource(sourceId);
  const persisted = source.tokenMode === "none" ? true : await hasLocalMapSourceToken(LOCAL_WORKSPACE_ID, source.id);
  return {
    sourceId: source.id,
    tokenMode: source.tokenMode,
    configured: persisted || defaultPublicWmtsDemoToken(source.id) !== null,
  };
}
