import type { InvestigationPdfEvent, InvestigationPdfReport } from "@/lib/investigation-pdf";

const PAGE_WIDTH_PT = 595;
const PAGE_HEIGHT_PT = 842;
const PAGE_WIDTH_PX = 1190;
const PAGE_HEIGHT_PX = 1684;
const MARGIN = 72;
const FONT_STACK = 'Arial, "Noto Sans Hebrew", sans-serif';
const TEXT = "#102433";
const MUTED = "#52666f";
const LINE = "#cfd9dc";
const PANEL = "#f5f8f9";
const ACCENT = "#1b6f8a";
const GOOD = "#277a4c";
const MEDIUM = "#a66a00";
const LOW = "#b23a3a";
const SERIES = ["#126b87", "#6d4fc2", "#ad5f16", "#2e7c56", "#a63e74", "#4f6670", "#7b5b23"];

type BrowserPdfPage = { jpeg: Uint8Array; width: number; height: number };
type TextOptions = { size?: number; weight?: 400 | 600 | 700; color?: string; dir?: "rtl" | "ltr"; align?: CanvasTextAlign };
type GeoPoint = { latitude: number; longitude: number };
type FramePredicate = (observedAt: string) => boolean;

function makeCanvas() {
  if (typeof document === "undefined") throw new Error("REP-01 browser PDF renderer requires a browser document");
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH_PX;
  canvas.height = PAGE_HEIGHT_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("REP-01 browser PDF renderer could not create a 2D canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "alphabetic";
  return { canvas, ctx };
}

function applyText(ctx: CanvasRenderingContext2D, options: TextOptions = {}) {
  const size = options.size ?? 24;
  const weight = options.weight ?? 400;
  ctx.font = `${weight} ${size}px ${FONT_STACK}`;
  ctx.fillStyle = options.color ?? TEXT;
  ctx.direction = options.dir ?? "rtl";
  ctx.textAlign = options.align ?? (ctx.direction === "rtl" ? "right" : "left");
}

function drawText(ctx: CanvasRenderingContext2D, value: unknown, x: number, y: number, options: TextOptions = {}) {
  ctx.save();
  applyText(ctx, options);
  ctx.fillText(String(value ?? ""), x, y);
  ctx.restore();
}

function wrapLines(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, options: TextOptions = {}) {
  ctx.save();
  applyText(ctx, options);
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) { ctx.restore(); return [""]; }
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
    else { lines.push(line); line = word; }
  }
  lines.push(line);
  ctx.restore();
  return lines;
}

function drawWrappedText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number, lineHeight: number, options: TextOptions = {}) {
  const lines = wrapLines(ctx, value, maxWidth, options);
  lines.forEach((line, index) => drawText(ctx, line, x, y + index * lineHeight, options));
  return y + lines.length * lineHeight;
}

function rule(ctx: CanvasRenderingContext2D, y: number) {
  ctx.save();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(PAGE_WIDTH_PX - MARGIN, y);
  ctx.stroke();
  ctx.restore();
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.save();
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 18);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function scoreLabel(value: number | null) {
  return value === null ? "חסר" : value.toFixed(1);
}

function scoreColor(value: number | null) {
  if (value === null) return MUTED;
  if (value >= 80) return GOOD;
  if (value >= 50) return MEDIUM;
  return LOW;
}

export function investigationEventColor(index: number) {
  if (!Number.isInteger(index) || index < 0) throw new Error("event color index must be a non-negative integer");
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 68% 42%)`;
}

function drawHeader(ctx: CanvasRenderingContext2D, title: string, subtitle?: string) {
  drawText(ctx, title, PAGE_WIDTH_PX - MARGIN, 92, { size: 38, weight: 700 });
  if (subtitle) drawText(ctx, subtitle, PAGE_WIDTH_PX - MARGIN, 132, { size: 20, color: MUTED });
  rule(ctx, 158);
}

function drawFooter(ctx: CanvasRenderingContext2D, pageLabel: string) {
  rule(ctx, PAGE_HEIGHT_PX - 82);
  drawText(ctx, pageLabel, PAGE_WIDTH_PX - MARGIN, PAGE_HEIGHT_PX - 45, { size: 16, color: MUTED });
  drawText(ctx, "Blue Wolf · מקור אמת: Core event archive", MARGIN, PAGE_HEIGHT_PX - 45, { size: 16, color: MUTED, dir: "ltr", align: "left" });
}

function drawKeyValue(ctx: CanvasRenderingContext2D, label: string, value: string, x: number, y: number, width: number) {
  drawText(ctx, label, x + width, y, { size: 17, color: MUTED });
  drawWrappedText(ctx, value, x + width, y + 28, width, 24, { size: 20, weight: 600 });
}

function drawTimeline(ctx: CanvasRenderingContext2D, event: InvestigationPdfEvent, x: number, y: number, width: number, height: number) {
  const result = event.result;
  panel(ctx, x, y, width, height);
  const pad = 42;
  const left = x + pad;
  const right = x + width - 18;
  const top = y + 42;
  const bottom = y + height - 34;
  ctx.save();
  ctx.strokeStyle = "#d9e1e4";
  ctx.lineWidth = 1;
  ctx.font = `14px ${FONT_STACK}`;
  ctx.fillStyle = MUTED;
  ctx.textAlign = "left";
  ctx.direction = "ltr";
  for (const tick of [0, 25, 50, 75, 100]) {
    const yy = bottom - (tick / 100) * (bottom - top);
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
    ctx.fillText(String(tick), x + 8, yy + 5);
  }
  const denominator = Math.max(1, result.points.length - 1);
  const drawSeries = (values: (number | null)[], color: string, lineWidth: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    let drawing = false;
    ctx.beginPath();
    values.forEach((value, index) => {
      if (value === null) { if (drawing) { ctx.stroke(); ctx.beginPath(); drawing = false; } return; }
      const xx = left + (index / denominator) * (right - left);
      const yy = bottom - (value / 100) * (bottom - top);
      if (!drawing) { ctx.moveTo(xx, yy); drawing = true; }
      else ctx.lineTo(xx, yy);
    });
    if (drawing) ctx.stroke();
  };
  drawSeries(result.points.map((point) => point.group.total), SERIES[0], 5);
  const memberIds = Array.from(new Set(result.points.flatMap((point) => point.members.map((member) => member.memberId))));
  memberIds.forEach((memberId, index) => drawSeries(
    result.points.map((point) => point.members.find((member) => member.memberId === memberId)?.total ?? null),
    SERIES[(index + 1) % SERIES.length],
    2,
  ));
  ctx.restore();
  drawText(ctx, "ציון קבוצה ורכבים לאורך האירוע", x + width - 18, y + 28, { size: 17, weight: 700 });
  drawText(ctx, `מסגרות: ${result.scoredFrameCount} מחושבות · ${result.missingFrameCount} חסרות`, x + width - 18, y + height - 10, { size: 14, color: MUTED });
}

function geoBounds(points: GeoPoint[]) {
  if (!points.length) return null;
  const lats = points.map((item) => item.latitude);
  const lons = points.map((item) => item.longitude);
  const minLat0 = Math.min(...lats); const maxLat0 = Math.max(...lats);
  const minLon0 = Math.min(...lons); const maxLon0 = Math.max(...lons);
  const latSpan = Math.max(maxLat0 - minLat0, 0.0002);
  const lonSpan = Math.max(maxLon0 - minLon0, 0.0002);
  return {
    minLat: minLat0 - latSpan * 0.08,
    maxLat: maxLat0 + latSpan * 0.08,
    minLon: minLon0 - lonSpan * 0.08,
    maxLon: maxLon0 + lonSpan * 0.08,
  };
}

function projector(bounds: NonNullable<ReturnType<typeof geoBounds>>, left: number, right: number, top: number, bottom: number) {
  return (lat: number, lon: number) => ({
    x: left + ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * (right - left),
    y: bottom - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * (bottom - top),
  });
}

function reportFramePredicate(report: InvestigationPdfReport): FramePredicate {
  const fromMs = report.from ? Date.parse(report.from) : Number.NEGATIVE_INFINITY;
  const toMs = report.to ? Date.parse(report.to) : Number.POSITIVE_INFINITY;
  return (observedAt: string) => {
    const observedMs = Date.parse(observedAt);
    return Number.isFinite(observedMs) && observedMs >= fromMs && observedMs <= toMs;
  };
}

export function investigationSummaryFrameTimes(event: InvestigationPdfEvent, report: InvestigationPdfReport) {
  const includeFrame = reportFramePredicate(report);
  return event.result.points.filter((point) => includeFrame(point.observedAt)).map((point) => point.observedAt);
}

function eventGeoPoints(event: InvestigationPdfEvent, includeFrame: FramePredicate = () => true) {
  const navigation = event.result.points
    .filter((point) => includeFrame(point.observedAt))
    .flatMap((point) => point.navigation)
    .filter((item) => item.latitude !== null && item.longitude !== null)
    .map((item) => ({ latitude: item.latitude as number, longitude: item.longitude as number }));
  const routes = event.result.routes.flatMap((route) => route.centerline);
  return [...navigation, ...routes];
}

function drawRouteEvidence(
  ctx: CanvasRenderingContext2D,
  event: InvestigationPdfEvent,
  project: ReturnType<typeof projector>,
  color: string,
  lineWidth = 2,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  for (const route of event.result.routes) {
    if (route.centerline.length < 2) continue;
    ctx.beginPath();
    route.centerline.forEach((row, index) => {
      const point = project(row.latitude, row.longitude);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    const first = route.centerline[0];
    const last = route.centerline[route.centerline.length - 1];
    if (first.latitude !== last.latitude || first.longitude !== last.longitude) {
      const point = project(first.latitude, first.longitude);
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawNavigationEvidence(
  ctx: CanvasRenderingContext2D,
  event: InvestigationPdfEvent,
  project: ReturnType<typeof projector>,
  colorForMember: (index: number) => string,
  lineWidth = 4,
  includeFrame: FramePredicate = () => true,
) {
  const nav = event.result.points
    .filter((point) => includeFrame(point.observedAt))
    .flatMap((point) => point.navigation)
    .filter((item) => item.latitude !== null && item.longitude !== null);
  const memberIds = Array.from(new Set(nav.map((item) => item.memberId)));
  ctx.save();
  memberIds.forEach((memberId, memberIndex) => {
    ctx.strokeStyle = colorForMember(memberIndex);
    ctx.lineWidth = lineWidth;
    let drawing = false;
    ctx.beginPath();
    for (const frame of event.result.points) {
      if (!includeFrame(frame.observedAt)) {
        if (drawing) { ctx.stroke(); ctx.beginPath(); drawing = false; }
        continue;
      }
      const row = frame.navigation.find((item) => item.memberId === memberId);
      if (!row || row.latitude === null || row.longitude === null) {
        if (drawing) { ctx.stroke(); ctx.beginPath(); drawing = false; }
        continue;
      }
      const point = project(row.latitude, row.longitude);
      if (!drawing) { ctx.moveTo(point.x, point.y); drawing = true; }
      else ctx.lineTo(point.x, point.y);
    }
    if (drawing) ctx.stroke();
  });
  ctx.restore();
}

function drawMap(ctx: CanvasRenderingContext2D, event: InvestigationPdfEvent, x: number, y: number, width: number, height: number) {
  const result = event.result;
  panel(ctx, x, y, width, height);
  drawText(ctx, "מפת WGS84 של האירוע", x + width - 18, y + 28, { size: 17, weight: 700 });
  const evidence = eventGeoPoints(event);
  const bounds = geoBounds(evidence);
  if (!bounds) {
    drawText(ctx, "אין עדות ניווט או נתיב מזוהה בארכיון", x + width / 2, y + height / 2, { size: 19, color: MUTED, align: "center" });
    return;
  }
  const left = x + 24; const right = x + width - 24; const top = y + 48; const bottom = y + height - 50;
  const project = projector(bounds, left, right, top, bottom);
  drawRouteEvidence(ctx, event, project, "#263238", 2);
  drawNavigationEvidence(ctx, event, project, (memberIndex) => SERIES[memberIndex % SERIES.length], 4);
  if (!result.routes.length) drawText(ctx, "אין route geometry evidence בארכיון הישן", x + width - 18, y + height - 24, { size: 13, color: MUTED });
  else drawText(ctx, `נתיבים מזוהים: ${result.routes.map((route) => `${route.routeInstanceId}/${route.subtype}`).join(" · ")}`, x + width - 18, y + height - 24, { size: 13, color: MUTED });
  drawText(ctx, `${bounds.minLat.toFixed(5)}…${bounds.maxLat.toFixed(5)} / ${bounds.minLon.toFixed(5)}…${bounds.maxLon.toFixed(5)}`, x + 16, y + height - 8, { size: 13, color: MUTED, dir: "ltr", align: "left" });
}

function coverPage(report: InvestigationPdfReport) {
  const { canvas, ctx } = makeCanvas();
  drawHeader(ctx, "זאב כחול — דוח תחקור הנדסי", "Blue Wolf Investigation Report");
  panel(ctx, MARGIN, 205, PAGE_WIDTH_PX - MARGIN * 2, 245);
  drawKeyValue(ctx, "שרת", String(report.serverId), 100, 250, 440);
  drawKeyValue(ctx, "טווח", `${report.from ?? "תחילת הארכיון"} ← ${report.to ?? "סוף הארכיון"}`, 610, 250, 480);
  drawKeyValue(ctx, "הופק", report.generatedAt, 100, 345, 440);
  drawKeyValue(ctx, "מספר אירועים", String(report.events.length), 610, 345, 480);
  const codeVersions = Array.from(new Set(report.events.map((item) => item.result.codeVersion)));
  const configVersions = Array.from(new Set(report.events.map((item) => item.result.configVersion)));
  drawText(ctx, `Code: ${codeVersions.join(", ")}`, PAGE_WIDTH_PX - MARGIN, 500, { size: 17, color: MUTED, dir: "ltr", align: "right" });
  drawText(ctx, `Config: ${configVersions.join(", ")}`, PAGE_WIDTH_PX - MARGIN, 530, { size: 17, color: MUTED, dir: "ltr", align: "right" });
  drawText(ctx, "סיכום אירועים", PAGE_WIDTH_PX - MARGIN, 602, { size: 28, weight: 700 });
  let y = 648;
  for (const [index, item] of report.events.slice(0, 18).entries()) {
    const result = item.result;
    drawText(ctx, `${index + 1}. ${result.eventId} · קבוצה ${result.groupId} · תבנית ${result.templateId} · ציון ${scoreLabel(result.summary.total)}`, PAGE_WIDTH_PX - MARGIN, y, { size: 18, color: investigationEventColor(index) });
    y += 43;
  }
  if (report.events.length > 18) drawText(ctx, `ועוד ${report.events.length - 18} אירועים — לכל אירוע מוקדש פרק נפרד`, PAGE_WIDTH_PX - MARGIN, y + 12, { size: 18, color: MUTED });
  drawFooter(ctx, "שער");
  return canvas;
}

function summaryMapPage(report: InvestigationPdfReport) {
  const { canvas, ctx } = makeCanvas();
  drawHeader(ctx, "מפה מסכמת לכל טווח התחקור", `${report.from ?? "תחילת הארכיון"} ← ${report.to ?? "סוף הארכיון"}`);
  const mapX = MARGIN;
  const mapY = 205;
  const mapWidth = PAGE_WIDTH_PX - MARGIN * 2;
  const mapHeight = 1040;
  panel(ctx, mapX, mapY, mapWidth, mapHeight);
  const includeFrame = reportFramePredicate(report);
  const allPoints = report.events.flatMap((event) => eventGeoPoints(event, includeFrame));
  const bounds = geoBounds(allPoints);
  if (!bounds) {
    drawText(ctx, "אין עדות WGS84 או route geometry בטווח שנבחר", PAGE_WIDTH_PX / 2, 700, { size: 22, color: MUTED, align: "center" });
  } else {
    const left = mapX + 28; const right = mapX + mapWidth - 28; const top = mapY + 40; const bottom = mapY + mapHeight - 50;
    const project = projector(bounds, left, right, top, bottom);
    report.events.forEach((event, eventIndex) => {
      const color = investigationEventColor(eventIndex);
      drawRouteEvidence(ctx, event, project, color, 2);
      drawNavigationEvidence(ctx, event, project, () => color, 4, includeFrame);
      const anchor = event.result.routes[0]?.centerline[0]
        ?? event.result.points
          .filter((point) => includeFrame(point.observedAt))
          .flatMap((point) => point.navigation)
          .find((row) => row.latitude !== null && row.longitude !== null);
      if (anchor && anchor.latitude !== null && anchor.longitude !== null) {
        const point = project(anchor.latitude, anchor.longitude);
        drawText(ctx, `${eventIndex + 1} · ${event.result.groupId}`, point.x + 8, point.y - 8, { size: 16, weight: 700, color, dir: "ltr", align: "left" });
      }
    });
    drawText(ctx, `${bounds.minLat.toFixed(5)}…${bounds.maxLat.toFixed(5)} / ${bounds.minLon.toFixed(5)}…${bounds.maxLon.toFixed(5)}`, mapX + 18, mapY + mapHeight - 14, { size: 13, color: MUTED, dir: "ltr", align: "left" });
  }

  drawText(ctx, "מקרא אירועים", PAGE_WIDTH_PX - MARGIN, 1305, { size: 24, weight: 700 });
  let legendY = 1345;
  for (const [index, event] of report.events.slice(0, 8).entries()) {
    drawText(ctx, `${index + 1}. ${event.result.eventId} · קבוצה ${event.result.groupId} · ${event.result.routes.length ? `נתיב ${event.result.routes.map((route) => route.subtype).join("/")}` : "ללא route evidence"}`, PAGE_WIDTH_PX - MARGIN, legendY, { size: 17, color: investigationEventColor(index) });
    legendY += 34;
  }
  if (report.events.length > 8) drawText(ctx, `המקרא המלא לכל ${report.events.length} האירועים ממשיך בעמודי המקרא הבאים`, PAGE_WIDTH_PX - MARGIN, legendY, { size: 16, color: MUTED });
  drawText(ctx, "העקבות נחתכות לטווח שנבחר ונשברות בחורי ניווט ובין אירועים; אין קו מלאכותי המחבר evidence חסר.", PAGE_WIDTH_PX - MARGIN, 1590, { size: 16, color: MUTED });
  drawFooter(ctx, "מפה מסכמת · REP-02");
  return canvas;
}

function summaryLegendPages(report: InvestigationPdfReport) {
  if (report.events.length <= 8) return [] as HTMLCanvasElement[];
  const rowsPerPage = 28;
  const pages: HTMLCanvasElement[] = [];
  for (let offset = 0; offset < report.events.length; offset += rowsPerPage) {
    const { canvas, ctx } = makeCanvas();
    const pageNumber = Math.floor(offset / rowsPerPage) + 1;
    drawHeader(ctx, "מקרא מלא — אירועים וקבוצות", `REP-02 · עמוד ${pageNumber}`);
    let y = 220;
    report.events.slice(offset, offset + rowsPerPage).forEach((event, localIndex) => {
      const eventIndex = offset + localIndex;
      const color = investigationEventColor(eventIndex);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(MARGIN + 8, y - 6);
      ctx.lineTo(MARGIN + 82, y - 6);
      ctx.stroke();
      ctx.restore();
      const routeLabel = event.result.routes.length
        ? event.result.routes.map((route) => `${route.routeInstanceId}/${route.subtype}`).join(" · ")
        : "ללא route evidence";
      drawText(ctx, `${eventIndex + 1}. ${event.result.eventId} · קבוצה ${event.result.groupId} · ${routeLabel}`, PAGE_WIDTH_PX - MARGIN, y, { size: 18, color });
      y += 48;
    });
    drawText(ctx, "כל צבע בעמודי המפה והאירוע מתייחס לאותו מספר אירוע ולשייכות הקבוצה המופיעה כאן.", PAGE_WIDTH_PX - MARGIN, 1575, { size: 16, color: MUTED });
    drawFooter(ctx, `מקרא REP-02 · ${pageNumber}`);
    pages.push(canvas);
  }
  return pages;
}

function eventMainPage(event: InvestigationPdfEvent, index: number, total: number) {
  const { canvas, ctx } = makeCanvas();
  const result = event.result;
  drawHeader(ctx, `אירוע ${index + 1} מתוך ${total}`, `${result.eventId} · קבוצה ${result.groupId}`);
  panel(ctx, MARGIN, 205, PAGE_WIDTH_PX - MARGIN * 2, 250);
  drawKeyValue(ctx, "טווח זמן", `${result.startAt} ← ${result.endAt}`, 100, 247, 475);
  drawKeyValue(ctx, "תבנית", `${result.templateId} · ${result.templateVersion}`, 620, 247, 470);
  drawKeyValue(ctx, "זירה", event.arena || "לא שויכה", 100, 340, 475);
  drawKeyValue(ctx, "מסגרות", `${result.frameCount} סה״כ · ${result.scoredFrameCount} מחושבות · ${result.missingFrameCount} חסרות`, 620, 340, 470);
  drawText(ctx, `סנכרון ${scoreLabel(result.summary.sync)}`, 1050, 424, { size: 24, weight: 700, color: scoreColor(result.summary.sync) });
  drawText(ctx, `נתיב ${scoreLabel(result.summary.route)}`, 780, 424, { size: 24, weight: 700, color: scoreColor(result.summary.route) });
  drawText(ctx, `כולל ${scoreLabel(result.summary.total)}`, 520, 424, { size: 24, weight: 700, color: scoreColor(result.summary.total) });
  drawMap(ctx, event, MARGIN, 500, 500, 470);
  drawTimeline(ctx, event, 618, 500, 500, 470);
  let noteY = 1032;
  if (event.note) {
    drawText(ctx, "הערת תחקור", PAGE_WIDTH_PX - MARGIN, noteY, { size: 22, weight: 700 });
    noteY = drawWrappedText(ctx, event.note, PAGE_WIDTH_PX - MARGIN, noteY + 34, PAGE_WIDTH_PX - MARGIN * 2, 30, { size: 19, color: MUTED });
  }
  drawText(ctx, "גרסאות חישוב", PAGE_WIDTH_PX - MARGIN, Math.max(noteY + 22, 1125), { size: 22, weight: 700 });
  drawText(ctx, `code ${result.codeVersion}`, PAGE_WIDTH_PX - MARGIN, Math.max(noteY + 56, 1160), { size: 16, color: MUTED, dir: "ltr", align: "right" });
  drawText(ctx, `config ${result.configVersion}`, PAGE_WIDTH_PX - MARGIN, Math.max(noteY + 84, 1188), { size: 16, color: MUTED, dir: "ltr", align: "right" });
  drawText(ctx, `run ${result.runId}`, PAGE_WIDTH_PX - MARGIN, Math.max(noteY + 112, 1216), { size: 16, color: MUTED, dir: "ltr", align: "right" });
  drawFooter(ctx, `אירוע ${index + 1} · עמוד ראשי`);
  return canvas;
}

function detailRows(event: InvestigationPdfEvent) {
  const result = event.result;
  const rows: { label: string; value: string; tone?: string }[] = [];
  rows.push({ label: "תבנית", value: `${result.templateId} · ${result.templateVersion}` });
  rows.push({ label: "גרסת חישוב", value: `code ${result.codeVersion} · config ${result.configVersion}` });
  rows.push({ label: "נתיבים מזוהים", value: result.routes.length ? result.routes.map((route) => `${route.routeInstanceId}: ${route.subtype} · ${route.routeId} · ${route.direction} · quality ${route.detectionQuality.toFixed(3)}`).join(" · ") : "אין route geometry evidence בארכיון" });
  rows.push({ label: "סיבות שורש", value: result.rootCauses.length ? result.rootCauses.map((cause) => `${cause.reason}: ${cause.occurrences}`).join(" · ") : "ללא סיבה מדווחת" });
  const lastScored = [...result.points].reverse().find((point) => point.members.length > 0);
  if (!lastScored) rows.push({ label: "ציוני רכבים", value: "אין מסגרת מחושבת עם ציוני רכבים" });
  for (const member of lastScored?.members ?? []) {
    rows.push({
      label: `רכב ${member.memberId}`,
      value: `מיקום ${member.slotId} · סנכרון ${scoreLabel(member.sync)} · נתיב ${scoreLabel(member.route)} · כולל ${scoreLabel(member.total)} · סיבה ${member.primaryReason ?? "ללא"}`,
      tone: scoreColor(member.total),
    });
  }
  const navMembers = Array.from(new Map(result.points.flatMap((point) => point.navigation).map((nav) => [nav.memberId, nav] as const)).values());
  for (const nav of navMembers) {
    rows.push({ label: `ניווט ${nav.memberId}`, value: `vehicle ${nav.vehicleIdentifier} · reliability ${nav.reliability.toFixed(3)} · active ${String(nav.active)}` });
  }
  const missingReasons = result.points.filter((point) => point.pendingReason).reduce((acc, point) => {
    const reason = point.pendingReason as string;
    acc.set(reason, (acc.get(reason) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());
  for (const [reason, count] of missingReasons) rows.push({ label: "מסגרות חסרות", value: `${reason}: ${count}` });
  return rows;
}

function eventDetailPages(event: InvestigationPdfEvent, index: number, total: number) {
  const rows = detailRows(event);
  const pages: HTMLCanvasElement[] = [];
  let rowIndex = 0;
  let pageNumber = 1;
  while (rowIndex < rows.length || (rows.length === 0 && pageNumber === 1)) {
    const { canvas, ctx } = makeCanvas();
    drawHeader(ctx, `אירוע ${index + 1} — פרטים`, `${event.result.eventId} · עמוד ${pageNumber}`);
    let y = 220;
    let consumed = false;
    while (rowIndex < rows.length) {
      const row = rows[rowIndex];
      const valueLines = wrapLines(ctx, row.value, PAGE_WIDTH_PX - MARGIN * 2 - 250, { size: 18 });
      const rowHeight = Math.max(72, 42 + valueLines.length * 28);
      if (y + rowHeight > PAGE_HEIGHT_PX - 125 && consumed) break;
      panel(ctx, MARGIN, y, PAGE_WIDTH_PX - MARGIN * 2, rowHeight - 10);
      drawText(ctx, row.label, PAGE_WIDTH_PX - MARGIN - 22, y + 34, { size: 20, weight: 700, color: row.tone ?? ACCENT });
      valueLines.forEach((line, lineIndex) => drawText(ctx, line, PAGE_WIDTH_PX - MARGIN - 250, y + 34 + lineIndex * 28, { size: 18, color: MUTED }));
      y += rowHeight;
      rowIndex += 1;
      consumed = true;
    }
    if (!rows.length) drawText(ctx, "אין שורות פירוט נוספות לאירוע", PAGE_WIDTH_PX - MARGIN, 270, { size: 20, color: MUTED });
    drawFooter(ctx, `אירוע ${index + 1}/${total} · פרטים ${pageNumber}`);
    pages.push(canvas);
    pageNumber += 1;
    if (!rows.length) break;
  }
  return pages;
}

function canvasJpeg(canvas: HTMLCanvasElement) {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("REP-01 renderer failed to encode JPEG page");
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { jpeg: bytes, width: canvas.width, height: canvas.height } satisfies BrowserPdfPage;
}

function asciiChunk(value: string) {
  return new TextEncoder().encode(value);
}

function concatChunks(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export function jpegPagesToPdf(pages: BrowserPdfPage[]) {
  if (!pages.length) throw new Error("REP-01 PDF requires at least one page");
  const maxObjectId = 2 + pages.length * 3;
  const offsets = new Array<number>(maxObjectId + 1).fill(0);
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const push = (chunk: Uint8Array) => { chunks.push(chunk); byteLength += chunk.length; };
  const pushText = (value: string) => push(asciiChunk(value));
  const objectText = (id: number, body: string) => {
    offsets[id] = byteLength;
    pushText(`${id} 0 obj\n${body}\nendobj\n`);
  };

  push(asciiChunk("%PDF-1.4\n%"));
  push(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x0a]));
  objectText(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const pageIds = pages.map((_, index) => 3 + index * 3);
  objectText(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);

  pages.forEach((page, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const imageName = `Im${index + 1}`;
    objectText(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH_PT} ${PAGE_HEIGHT_PT}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    offsets[imageId] = byteLength;
    pushText(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
    push(page.jpeg);
    pushText("\nendstream\nendobj\n");
    const content = `q ${PAGE_WIDTH_PT} 0 0 ${PAGE_HEIGHT_PT} 0 0 cm /${imageName} Do Q`;
    offsets[contentId] = byteLength;
    pushText(`${contentId} 0 obj\n<< /Length ${asciiChunk(content).length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });

  const xrefOffset = byteLength;
  pushText(`xref\n0 ${maxObjectId + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= maxObjectId; id += 1) pushText(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  pushText(`trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return concatChunks(chunks);
}

export async function buildInvestigationPdfBrowser(report: InvestigationPdfReport) {
  if (!report.events.length) throw new Error("REP-01 PDF cannot be generated without report events");
  if (typeof document !== "undefined" && "fonts" in document) await document.fonts.ready;
  const pages: BrowserPdfPage[] = [canvasJpeg(coverPage(report)), canvasJpeg(summaryMapPage(report))];
  for (const canvas of summaryLegendPages(report)) pages.push(canvasJpeg(canvas));
  report.events.forEach((event, index) => {
    pages.push(canvasJpeg(eventMainPage(event, index, report.events.length)));
    for (const canvas of eventDetailPages(event, index, report.events.length)) pages.push(canvasJpeg(canvas));
  });
  return jpegPagesToPdf(pages);
}
