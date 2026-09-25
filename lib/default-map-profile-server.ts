import { DEFAULT_PUBLIC_WMTS_SOURCE_ID, ensureTelAvivDemoMapState } from "./default-map-profile";
import {
  applyMapSourceToken,
  normalizeMapSources,
  sanitizeWmtsCatalogToken,
} from "./map-source-config";
import { defaultWmtsLayerSelections, parseWmtsCapabilities } from "./wmts-capabilities";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Omniscale publishes `demo` as its test API key. Keep even this public key on
 * the server side so the out-of-box profile exercises the same secret-injection
 * path as a private operational WMTS deployment.
 */
export function defaultPublicWmtsDemoToken(sourceId: string) {
  if (sourceId !== DEFAULT_PUBLIC_WMTS_SOURCE_ID) return null;
  return process.env.BLUEWOLF_PUBLIC_WMTS_DEMO_TOKEN?.trim() || "demo";
}

type PublicWmtsDiscovery = {
  catalog: ReturnType<typeof parseWmtsCapabilities>;
  defaults: ReturnType<typeof defaultWmtsLayerSelections>;
};

let publicWmtsDiscoveryCache: PublicWmtsDiscovery | null = null;
let publicWmtsDiscoveryRetryAfter = 0;
const PUBLIC_WMTS_DISCOVERY_RETRY_MS = 30_000;

async function discoverDefaultPublicWmts(source: ReturnType<typeof normalizeMapSources>[number]): Promise<PublicWmtsDiscovery | null> {
  if (publicWmtsDiscoveryCache) return publicWmtsDiscoveryCache;
  if (Date.now() < publicWmtsDiscoveryRetryAfter) return null;

  const token = defaultPublicWmtsDemoToken(source.id);
  try {
    const secured = applyMapSourceToken(new URL(source.baseUrl), source, token);
    const response = await fetch(secured.url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      headers: new Headers({
        ...Object.fromEntries(secured.headers.entries()),
        accept: "application/xml,text/xml;q=0.9,*/*;q=0.1",
      }),
    });
    if (response.status >= 300 && response.status < 400) throw new Error("public WMTS discovery redirect rejected");
    if (!response.ok) throw new Error(`public WMTS discovery returned HTTP ${response.status}`);
    const xml = await response.text();
    if (new TextEncoder().encode(xml).byteLength > 8 * 1024 * 1024) throw new Error("public WMTS capabilities response is too large");
    const discovered = parseWmtsCapabilities(xml);
    const catalog = sanitizeWmtsCatalogToken(discovered, source, token);
    const defaults = defaultWmtsLayerSelections(catalog);
    if (!defaults.length) throw new Error("public WMTS exposes no Blue-Wolf-compatible layers");
    publicWmtsDiscoveryCache = { catalog, defaults };
    publicWmtsDiscoveryRetryAfter = 0;
    return publicWmtsDiscoveryCache;
  } catch {
    publicWmtsDiscoveryRetryAfter = Date.now() + PUBLIC_WMTS_DISCOVERY_RETRY_MS;
    return null;
  }
}

/**
 * Best-effort live discovery for the public QA WMTS profile. Failure is
 * deliberately non-fatal: an isolated/offline installation must still start,
 * calculate and render the engineering grid without Internet access. Successful
 * discovery is cached in-process so the tile proxy and Workspace GET share the
 * exact same sanitized catalog without creating a user revision.
 */
export async function prepareTelAvivDemoWorkspace(value: unknown): Promise<unknown> {
  const migrated = ensureTelAvivDemoMapState(value);
  if (!isObject(migrated) || !Array.isArray(migrated.mapServers)) return migrated;

  const sources = normalizeMapSources(migrated.mapServers);
  const source = sources.find((item) => item.id === DEFAULT_PUBLIC_WMTS_SOURCE_ID);
  if (!source || source.kind !== "wmts" || source.wmtsCatalog) return migrated;

  const discovery = await discoverDefaultPublicWmts(source);
  if (!discovery) return migrated;

  const state = structuredClone(migrated) as JsonObject;
  state.mapServers = (state.mapServers as unknown[]).map((raw) => {
    if (!isObject(raw) || raw.id !== DEFAULT_PUBLIC_WMTS_SOURCE_ID) return raw;
    return {
      ...raw,
      wmtsCatalog: discovery.catalog,
      wmtsLayers: discovery.defaults,
      layer: undefined,
      tileMatrixSet: undefined,
    };
  });
  return state;
}
