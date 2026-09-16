import {
  applyMapSourceToken,
  buildWmsUpstreamUrl,
  buildWmtsUpstreamUrl,
  buildXyzUpstreamUrl,
} from "@/lib/map-source-config";
import {
  localMapSource,
  localMapSourceSecret,
  localMapSourcesEnabled,
} from "@/lib/local-map-source-server";

function numeric(value: string | null, label: string) {
  if (value === null || value === "") throw new Error(`${label} is required`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be numeric`);
  return parsed;
}

function integer(value: string | null, label: string) {
  const parsed = numeric(value, label);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

function bbox(value: string | null): [number, number, number, number] {
  if (!value) throw new Error("bbox is required");
  const parts = value.split(",").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) throw new Error("bbox must contain four finite comma-separated numbers");
  return parts as [number, number, number, number];
}

export async function GET(request: Request) {
  if (!localMapSourcesEnabled()) {
    return Response.json({ error: "private map proxy is available only in local SQLite deployment" }, { status: 409 });
  }
  try {
    const params = new URL(request.url).searchParams;
    const sourceId = params.get("sourceId")?.trim() ?? "";
    if (!sourceId) return Response.json({ error: "sourceId is required" }, { status: 400 });
    const source = await localMapSource(sourceId);
    let upstream: URL;
    if (source.kind === "wms") {
      upstream = buildWmsUpstreamUrl(source, {
        bbox: bbox(params.get("bbox")),
        width: integer(params.get("width"), "width"),
        height: integer(params.get("height"), "height"),
      });
    } else if (source.kind === "wmts") {
      upstream = buildWmtsUpstreamUrl(source, {
        tileMatrix: params.get("tileMatrix")?.trim() ?? "",
        tileRow: integer(params.get("tileRow"), "tileRow"),
        tileCol: integer(params.get("tileCol"), "tileCol"),
      });
    } else {
      upstream = buildXyzUpstreamUrl(
        source,
        integer(params.get("z"), "z"),
        integer(params.get("x"), "x"),
        integer(params.get("y"), "y"),
      );
    }
    const token = await localMapSourceSecret(source);
    const secured = applyMapSourceToken(upstream, source, token);
    const response = await fetch(secured.url, {
      method: "GET",
      headers: secured.headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 300 && response.status < 400) throw new Error("map source redirect rejected to prevent credential forwarding");
    if (!response.ok) throw new Error(`map source returned HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) throw new Error("map source response is not an image");
    return new Response(response.body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "private, max-age=30",
        "x-bluewolf-map-source": source.id,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "map source proxy failed" }, { status: 502 });
  }
}
