import { ensureTelAvivDemoMapState } from "./default-map-profile";
import { normalizeMapSources, type OperationalMapSource } from "./map-source-config";
import {
  hasLocalMapSourceToken,
  readLocalMapSourceToken,
  readLocalWorkspace,
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
  if (!migrated || typeof migrated !== "object" || Array.isArray(migrated)) throw new Error("local workspace is not configured");
  const row = migrated as Record<string, unknown>;
  const source = normalizeMapSources(row.mapServers ?? []).find((item) => item.id === sourceId && item.enabled);
  if (!source) throw new Error("map source is not configured or disabled");
  return source;
}

export async function localMapSourceSecret(source: OperationalMapSource) {
  if (source.tokenMode === "none") return null;
  return readLocalMapSourceToken(LOCAL_WORKSPACE_ID, source.id);
}

export async function localMapSourceTokenStatus(sourceId: string) {
  const source = await localMapSource(sourceId);
  return {
    sourceId: source.id,
    tokenMode: source.tokenMode,
    configured: source.tokenMode === "none" ? true : await hasLocalMapSourceToken(LOCAL_WORKSPACE_ID, source.id),
  };
}
