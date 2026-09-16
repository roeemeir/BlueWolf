import { applyMapSourceToken, buildWmtsCapabilitiesUrl } from "@/lib/map-source-config";
import { localMapSource, localMapSourceSecret, localMapSourcesEnabled } from "@/lib/local-map-source-server";
import { compatibleMatrixSets, defaultWmtsLayerSelections, parseWmtsCapabilities } from "@/lib/wmts-capabilities";

const MAX_CAPABILITIES_BYTES = 8 * 1024 * 1024;

export async function GET(request: Request) {
  if (!localMapSourcesEnabled()) {
    return Response.json({ error: "WMTS discovery is available only in local SQLite deployment" }, { status: 409 });
  }
  try {
    const sourceId = new URL(request.url).searchParams.get("sourceId")?.trim() ?? "";
    if (!sourceId) return Response.json({ error: "sourceId is required" }, { status: 400 });
    const source = await localMapSource(sourceId);
    if (source.kind !== "wmts") return Response.json({ error: "source is not WMTS" }, { status: 400 });
    const token = await localMapSourceSecret(source);
    const secured = applyMapSourceToken(buildWmtsCapabilitiesUrl(source), source, token);
    const response = await fetch(secured.url, {
      method: "GET",
      headers: secured.headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 300 && response.status < 400) throw new Error("WMTS GetCapabilities redirect rejected to prevent credential forwarding");
    if (!response.ok) throw new Error(`WMTS GetCapabilities returned HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CAPABILITIES_BYTES) throw new Error("WMTS GetCapabilities response is too large");
    const xml = await response.text();
    if (new TextEncoder().encode(xml).byteLength > MAX_CAPABILITIES_BYTES) throw new Error("WMTS GetCapabilities response is too large");
    const catalog = parseWmtsCapabilities(xml);
    const supportedLayers = catalog.layers.map((layer) => ({
      identifier: layer.identifier,
      compatibleMatrixSets: compatibleMatrixSets(catalog, layer).map((matrixSet) => ({ identifier: matrixSet.identifier, supportedCrs: matrixSet.supportedCrs })),
    }));
    const unsupportedLayers = supportedLayers.filter((layer) => layer.compatibleMatrixSets.length === 0).map((layer) => layer.identifier);
    const defaults = defaultWmtsLayerSelections(catalog);
    if (!defaults.length) throw new Error("WMTS server exposes no layers compatible with WGS84/WebMercator display");
    return Response.json({
      ok: true,
      sourceId: source.id,
      catalog,
      defaults,
      supportedLayers,
      unsupportedLayers,
      testedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "WMTS GetCapabilities failed" }, { status: 502 });
  }
}
