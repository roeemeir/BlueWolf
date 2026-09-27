import { investigationEventSourceLabel, investigationReportSourceLabel, type InvestigationPdfEvent, type InvestigationPdfReport } from "@/lib/investigation-pdf";
import { investigationEventColor } from "@/lib/investigation-pdf-browser";
import { investigationEventNavigationEvidence } from "@/lib/investigation-pdf-navigation-evidence";
import { normalizeMapSources, type OperationalMapSource } from "@/lib/map-source-config";
import { createOperationalProjection, type OperationalProjection } from "@/lib/operational-map-projection";
import { wmtsProjectionKind, wmtsScreenTiles, type WmtsLayerSelection, type WmtsTileMatrixSet } from "@/lib/wmts-capabilities";

const WIDTH = 1190;
const HEIGHT = 1684;
const MARGIN = 72;
const FONT = 'Arial, "Noto Sans Hebrew", sans-serif';
const TEXT = "#102433";
const MUTED = "#52666f";
const LINE = "#cfd9dc";
const ROUTE = "#17242b";

export type InvestigationWmtsJpegPage = { jpeg: Uint8Array; width: number; height: number };
type GeoPoint = { latitude: number; longitude: number };
type WorkspacePayload = { state?: { mapServers?: unknown; settings?: { defaultMap?: unknown } } | null };
type WmtsRenderProfile = {
  source: OperationalMapSource;
  layers: WmtsLayerSelection[];
  projectionMode: "local-wgs84" | "webmercator";
  projectionKind: "geographic" | "webmercator";
};

function makeCanvas() {
  if (typeof document === "undefined") throw new Error("BW-OFF-010 PDF WMTS renderer requires a browser document");
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("BW-OFF-010 PDF WMTS renderer could not create a canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textBaseline = "alphabetic";
  return { canvas, ctx };
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size = 20, weight = 400, color = TEXT, align: CanvasTextAlign = "right") {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.direction = align === "left" ? "ltr" : "rtl";
  ctx.textAlign = align;
  ctx.fillText(value, x, y);
  ctx.restore();
}

function jpeg(canvas: HTMLCanvasElement): InvestigationWmtsJpegPage {
  const encoded = canvas.toDataURL("image/jpeg", 0.94);
  const comma = encoded.indexOf(",");
  if (comma < 0) throw new Error("BW-OFF-010 PDF WMTS page JPEG encoding failed");
  const binary = atob(encoded.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { jpeg: bytes, width: WIDTH, height: HEIGHT };
}

function drawGrid(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.save();
  ctx.fillStyle = "#eef3f4";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#d4dde0";
  ctx.lineWidth = 1;
  for (let px = x; px <= x + width; px += 80) { ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + height); ctx.stroke(); }
  for (let py = y; py <= y + height; py += 80) { ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x + width, py); ctx.stroke(); }
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

function eventPoints(event: InvestigationPdfEvent, fromMs = Number.NEGATIVE_INFINITY, toMs = Number.POSITIVE_INFINITY): GeoPoint[] {
  const navigation = investigationEventNavigationEvidence(event, fromMs, toMs)
    .flatMap((member) => member.segments.flat());
  return [...navigation, ...event.result.routes.flatMap((route) => route.centerline)];
}

function matrixSetFor(source: OperationalMapSource, layer: WmtsLayerSelection): WmtsTileMatrixSet | null {
  return source.wmtsCatalog?.tileMatrixSets.find((item) => item.identifier === layer.tileMatrixSet) ?? null;
}

function renderProfile(source: OperationalMapSource): WmtsRenderProfile | null {
  if (source.kind !== "wmts" || !source.enabled || !source.wmtsCatalog || !source.wmtsLayers) return null;
  const enabled = [...source.wmtsLayers].filter((layer) => layer.enabled).sort((a, b) => a.order - b.order);
  if (!enabled.length) return null;
  const firstSet = matrixSetFor(source, enabled[0]);
  const projectionKind = firstSet ? wmtsProjectionKind(firstSet.supportedCrs) : null;
  if (!projectionKind) return null;
  const compatible = enabled.filter((layer) => {
    const set = matrixSetFor(source, layer);
    return set && wmtsProjectionKind(set.supportedCrs) === projectionKind;
  });
  if (!compatible.length) return null;
  return { source, layers: compatible, projectionKind, projectionMode: projectionKind === "webmercator" ? "webmercator" : "local-wgs84" };
}

async function loadDefaultProfile(): Promise<WmtsRenderProfile | null> {
  if (typeof window === "undefined") return null;
  let payload: WorkspacePayload | null = null;
  let workspaceId = "";
  try { workspaceId = window.localStorage.getItem("bluewolf-workspace-id") ?? ""; } catch { /* restricted browser storage */ }
  try {
    const headers = new Headers();
    if (workspaceId) headers.set("x-bluewolf-workspace", workspaceId);
    const response = await fetch("/api/workspace", { headers, cache: "no-store" });
    if (response.ok) payload = await response.json() as WorkspacePayload;
  } catch { /* isolated/offline renderer falls back to browser cache or engineering grid */ }
  if (!payload?.state) {
    try {
      const cached = window.localStorage.getItem("bluewolf-workspace-state");
      if (cached) payload = { state: JSON.parse(cached) as WorkspacePayload["state"] };
    } catch { payload = null; }
  }
  if (!payload?.state?.mapServers) return null;
  let sources: OperationalMapSource[];
  try { sources = normalizeMapSources(payload.state.mapServers); } catch { return null; }
  const requested = typeof payload.state.settings?.defaultMap === "string" ? payload.state.settings.defaultMap : "";
  const source = sources.find((item) => item.enabled && item.id === requested)
    ?? sources.find((item) => item.enabled && item.isDefault)
    ?? sources.find((item) => item.enabled && item.kind === "wmts" && item.wmtsCatalog);
  return source ? renderProfile(source) : null;
}

async function fetchTile(sourceId: string, layer: string, tileMatrix: string, tileRow: number, tileCol: number): Promise<CanvasImageSource | null> {
  const query = new URLSearchParams({ sourceId, layer, tileMatrix, tileRow: String(tileRow), tileCol: String(tileCol) });
  try {
    const response = await fetch(`/api/map-sources/proxy?${query.toString()}`, { cache: "no-store" });
    if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) return null;
    const blob = await response.blob();
    if (typeof createImageBitmap === "function") return await createImageBitmap(blob);
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      image.src = url;
    });
  } catch { return null; }
}

async function drawWmtsLayers(
  ctx: CanvasRenderingContext2D,
  profile: WmtsRenderProfile,
  projection: OperationalProjection,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  let rendered = 0;
  for (const layer of profile.layers) {
    const matrixSet = matrixSetFor(profile.source, layer);
    if (!matrixSet || wmtsProjectionKind(matrixSet.supportedCrs) !== profile.projectionKind) continue;
    const tiles = wmtsScreenTiles(projection, matrixSet, width, height, 64);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
    ctx.globalAlpha = layer.opacity;
    const batchSize = 8;
    for (let offset = 0; offset < tiles.length; offset += batchSize) {
      const batch = tiles.slice(offset, offset + batchSize);
      const images = await Promise.all(batch.map((tile) => fetchTile(profile.source.id, layer.layer, tile.tileMatrix, tile.tileRow, tile.tileCol)));
      batch.forEach((tile, index) => {
        const image = images[index];
        if (!image) return;
        ctx.drawImage(image, x + tile.screenX, y + tile.screenY, Math.max(1, tile.width + 1), Math.max(1, tile.height + 1));
        rendered += 1;
        if ("close" in image && typeof (image as ImageBitmap).close === "function") (image as ImageBitmap).close();
      });
    }
    ctx.restore();
  }
  return rendered;
}

function drawPositionMarker(
  ctx: CanvasRenderingContext2D, projection: OperationalProjection, x: number, y: number,
  position: GeoPoint, color: string, caption: string, first: boolean,
) {
  const projected = projection.project(position.latitude, position.longitude);
  const px = x + projected.x;
  const py = y + projected.y;
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, 9, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.48;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  text(ctx, caption, px - 13, py + (first ? -13 : 26), 15, 700, color);
}

function drawEvidence(
  ctx: CanvasRenderingContext2D, events: readonly InvestigationPdfEvent[],
  projection: OperationalProjection, x: number, y: number,
  fromMs: number, toMs: number, firstEventIndex: number,
) {
  events.forEach((event, eventIndex) => {
    const color = investigationEventColor(firstEventIndex + eventIndex);
    const navigation = investigationEventNavigationEvidence(event, fromMs, toMs);
    ctx.save();
    ctx.strokeStyle = ROUTE;
    ctx.lineWidth = 2;
    for (const route of event.result.routes) {
      if (route.centerline.length < 2) continue;
      ctx.beginPath();
      route.centerline.forEach((row, index) => {
        const point = projection.project(row.latitude, row.longitude);
        if (index === 0) ctx.moveTo(x + point.x, y + point.y); else ctx.lineTo(x + point.x, y + point.y);
      });
      ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    for (const member of navigation) {
      for (const segment of member.segments) {
        if (segment.length < 2) continue;
        ctx.beginPath();
        segment.forEach((row, index) => {
          const point = projection.project(row.latitude, row.longitude);
          if (index === 0) ctx.moveTo(x + point.x, y + point.y);
          else ctx.lineTo(x + point.x, y + point.y);
        });
        ctx.stroke();
      }
      // Only observed positions are eligible: never infer an event-boundary
      // location from a route centerline, extrapolation, or another vehicle.
      const vehicle = `רכב ${member.vehicleIdentifier}`;
      drawPositionMarker(ctx, projection, x, y, member.first, color, `תחילה · ${vehicle}`, true);
      drawPositionMarker(ctx, projection, x, y, member.last, color, `סוף · ${vehicle}`, false);
    }
    ctx.restore();
  });
}

async function mapPage(
  title: string, subtitle: string, events: readonly InvestigationPdfEvent[],
  points: GeoPoint[], profile: WmtsRenderProfile | null,
  fromMs: number, toMs: number, firstEventIndex: number,
  provenanceLabel: string,
) {
  const { canvas, ctx } = makeCanvas();
  text(ctx, title, WIDTH - MARGIN, 88, 36, 700);
  text(ctx, subtitle, WIDTH - MARGIN, 126, 18, 400, MUTED);
  const mapX = MARGIN;
  const mapY = 175;
  const mapWidth = WIDTH - MARGIN * 2;
  const mapHeight = HEIGHT - 305;
  drawGrid(ctx, mapX, mapY, mapWidth, mapHeight);
  let rendered = 0;
  if (points.length) {
    const projection = createOperationalProjection(points, mapWidth, mapHeight, 20, 20, profile?.projectionMode ?? "local-wgs84");
    if (profile) rendered = await drawWmtsLayers(ctx, profile, projection, mapX, mapY, mapWidth, mapHeight);
    drawEvidence(ctx, events, projection, mapX, mapY, fromMs, toMs, firstEventIndex);
  } else {
    text(ctx, "אין עדות ניווט או נתיב בטווח הנבחר", mapX + mapWidth - 30, mapY + 95, 23, 600, MUTED);
  }
  const layerLabel = profile
    ? profile.layers.map((layer) => `${layer.layer} (${Math.round(layer.opacity * 100)}%)`).join(" · ")
    : "ללא WMTS זמין";
  text(ctx, "תחילה וסוף = מדידת הניווט הראשונה והאחרונה שנצפו בטווח; אין השלמת מיקום חסר", WIDTH - MARGIN, HEIGHT - 109, 14, 400, MUTED);
  text(ctx, `רקע: ${profile?.source.name ?? "Engineering grid"} · ${layerLabel}`, WIDTH - MARGIN, HEIGHT - 86, 15, 400, MUTED);
  text(ctx, provenanceLabel, MARGIN, HEIGHT - 86, 13, 600, MUTED, "left");
  text(ctx, rendered > 0 ? `WMTS tiles בדוח: ${rendered} · דרך proxy/cache מקומי` : "לא התקבל tile רקע; הדוח ממשיך עם engineering grid ללא תלות באינטרנט", WIDTH - MARGIN, HEIGHT - 54, 14, 400, MUTED);
  return jpeg(canvas);
}

export async function buildInvestigationWmtsMapPages(report: InvestigationPdfReport): Promise<InvestigationWmtsJpegPage[]> {
  const profile = await loadDefaultProfile();
  const fromMs = report.from ? Date.parse(report.from) : Number.NEGATIVE_INFINITY;
  const toMs = report.to ? Date.parse(report.to) : Number.POSITIVE_INFINITY;
  const pages: InvestigationWmtsJpegPage[] = [];
  const summaryPoints = report.events.flatMap((event) => eventPoints(event, fromMs, toMs));
  pages.push(await mapPage("מפת רקע מבצעית — טווח התחקור", `${report.from ?? "תחילת הארכיון"} ← ${report.to ?? "סוף הארכיון"}`, report.events, summaryPoints, profile, fromMs, toMs, 0, investigationReportSourceLabel(report)));
  for (const [index, event] of report.events.entries()) {
    const eventFrom = Date.parse(event.result.startAt);
    const eventTo = Date.parse(event.result.endAt);
    const eventFromMs = Math.max(fromMs, eventFrom);
    const eventToMs = Math.min(toMs, eventTo);
    pages.push(await mapPage(`מפת WMTS · אירוע ${index + 1}`, `${event.result.eventId} · קבוצה ${event.result.groupId}`, [event], eventPoints(event, eventFromMs, eventToMs), profile, eventFromMs, eventToMs, index, investigationEventSourceLabel(event.result, report.source)));
  }
  return pages;
}
