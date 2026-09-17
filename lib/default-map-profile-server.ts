import { DEFAULT_PUBLIC_WMTS_SOURCE_ID, ensureTelAvivDemoMapState } from "./default-map-profile";
import { normalizeMapSources } from "./map-source-config";
import { defaultWmtsLayerSelections, parseWmtsCapabilities } from "./wmts-capabilities";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Best-effort live discovery for the public QA WMTS profile. Failure is
 * deliberately non-fatal: an isolated/offline installation must still start,
 * calculate and render the engineering grid without Internet access.
 */
export async function prepareTelAvivDemoWorkspace(value: unknown): Promise<unknown> {
  const migrated = ensureTelAvivDemoMapState(value);
  if (!isObject(migrated) || !Array.isArray(migrated.mapServers)) return migrated;

  const sources = normalizeMapSources(migrated.mapServers);
  const source = sources.find((item) => item.id === DEFAULT_PUBLIC_WMTS_SOURCE_ID);
  if (!source || source.kind !== "wmts" || source.wmtsCatalog) return migrated;

  try {
    const response = await fetch(source.baseUrl, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.1" },
    });
    if (response.status >= 300 && response.status < 400) throw new Error("public WMTS discovery redirect rejected");
    if (!response.ok) throw new Error(`public WMTS discovery returned HTTP ${response.status}`);
    const xml = await response.text();
    if (new TextEncoder().encode(xml).byteLength > 8 * 1024 * 1024) throw new Error("public WMTS capabilities response is too large");
    const catalog = parseWmtsCapabilities(xml);
    const defaults = defaultWmtsLayerSelections(catalog);
    if (!defaults.length) throw new Error("public WMTS exposes no Blue-Wolf-compatible layers");

    const state = structuredClone(migrated) as JsonObject;
    state.mapServers = (state.mapServers as unknown[]).map((raw) => {
      if (!isObject(raw) || raw.id !== DEFAULT_PUBLIC_WMTS_SOURCE_ID) return raw;
      return {
        ...raw,
        wmtsCatalog: catalog,
        wmtsLayers: defaults,
        layer: undefined,
        tileMatrixSet: undefined,
      };
    });
    return state;
  } catch {
    return migrated;
  }
}
