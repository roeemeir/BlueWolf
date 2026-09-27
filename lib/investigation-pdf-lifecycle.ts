import { investigationEventSourceLabel, type InvestigationPdfReport } from "@/lib/investigation-pdf";
import { buildInvestigationPdfBrowser, jpegPagesToPdf } from "@/lib/investigation-pdf-browser";

const WIDTH = 1190;
const HEIGHT = 1684;
const MARGIN = 72;
const FONT = 'Arial, "Noto Sans Hebrew", sans-serif';
const TEXT = "#102433";
const MUTED = "#52666f";
const LINE = "#cfd9dc";
const PANEL = "#f5f8f9";

type JpegPage = { jpeg: Uint8Array; width: number; height: number };
type LifecycleChange = InvestigationPdfReport["events"][number]["result"]["lifecycle"]["changes"][number];

function makeCanvas() {
  if (typeof document === "undefined") throw new Error("REP-03/04 lifecycle PDF requires a browser document");
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("REP-03/04 lifecycle PDF could not create a 2D canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textBaseline = "alphabetic";
  return { canvas, ctx };
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size = 20, weight = 400, color = TEXT) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.fillText(value, x, y);
  ctx.restore();
}

function wrap(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, size = 18, weight = 400) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(candidate).width <= maxWidth) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  ctx.restore();
  return lines.length ? lines : [""];
}

function panel(ctx: CanvasRenderingContext2D, y: number, height: number) {
  ctx.save();
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(MARGIN, y, WIDTH - 2 * MARGIN, height, 16);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function statusLabel(status: string) {
  if (status === "active") return "פעיל";
  if (status === "finalizing") return "ממתין ל-finalization";
  if (status === "closed") return "סגור";
  return "אין lifecycle evidence בארכיון";
}

function reasonLabel(reason: string | null) {
  if (reason === "group_became_active") return "הקבוצה הפכה לפעילה";
  if (reason === "context_changed") return "הקשר האירוע השתנה";
  if (reason === "structural_group_ended") return "הקבוצה המבנית הסתיימה";
  if (reason === "group_inactive") return "הקבוצה אינה פעילה";
  return reason || "—";
}

function detail(change: LifecycleChange) {
  const d = change.details;
  if (change.kind === "event_opened") return `פתיחת אירוע · ${reasonLabel(typeof d.reason === "string" ? d.reason : null)}`;
  if (change.kind === "event_ending") return `סיום תפעולי · ${reasonLabel(typeof d.reason === "string" ? d.reason : null)}`;
  if (change.kind === "event_closed") return `סגירה סופית · ${reasonLabel(typeof d.reason === "string" ? d.reason : null)}`;
  if (change.kind === "alert_opened") return `התראת ${String(d.alert_type ?? "alert")} נפתחה · score ${String(d.score ?? "—")} · threshold ${String(d.threshold ?? "—")}`;
  if (change.kind === "alert_closed") return `התראת ${String(d.alert_type ?? "alert")} נסגרה · ${String(d.reason ?? d.score ?? "")}`;
  if (change.kind === "template_suggested") return `המלצה: ${String(d.active_template_id ?? "—")} → ${String(d.suggested_template_id ?? "—")} · יתרון ${String(d.advantage ?? "—")}`;
  if (change.kind === "template_suggestion_closed") return `המלצת template נסגרה · ${String(d.suggested_template_id ?? "—")} · ${String(d.reason ?? "")}`;
  if (change.kind === "template_suggestion_rejected") return `המלצת template נדחתה על ידי המפעיל · ${String(d.suggested_template_id ?? "—")}`;
  return change.kind;
}

function formatTime(value: string | null) {
  return value || "—";
}

function lifecycleChangeTime(change: LifecycleChange) {
  if (change.kind === "event_closed" && typeof change.details.finalized_time_utc === "string" && change.details.finalized_time_utc) {
    return change.details.finalized_time_utc;
  }
  return change.occurredAt;
}

function jpeg(canvas: HTMLCanvasElement): JpegPage {
  const encoded = canvas.toDataURL("image/jpeg", 0.94);
  const comma = encoded.indexOf(",");
  if (comma < 0) throw new Error("REP-03/04 lifecycle page JPEG encoding failed");
  const binary = atob(encoded.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { jpeg: bytes, width: WIDTH, height: HEIGHT };
}

export function extractCanvasJpegPages(pdf: Uint8Array): JpegPage[] {
  const pages: JpegPage[] = [];
  let cursor = 0;
  while (cursor < pdf.length - 1) {
    let start = -1;
    for (let i = cursor; i < pdf.length - 1; i += 1) {
      if (pdf[i] === 0xff && pdf[i + 1] === 0xd8) { start = i; break; }
    }
    if (start < 0) break;
    let end = -1;
    for (let i = start + 2; i < pdf.length - 1; i += 1) {
      if (pdf[i] === 0xff && pdf[i + 1] === 0xd9) { end = i + 2; break; }
    }
    if (end < 0) throw new Error("REP-03/04 could not recover a complete JPEG page from the base PDF");
    pages.push({ jpeg: pdf.slice(start, end), width: WIDTH, height: HEIGHT });
    cursor = end;
  }
  if (!pages.length) throw new Error("REP-03/04 base engineering PDF did not contain Canvas JPEG pages");
  return pages;
}

function lifecyclePages(report: InvestigationPdfReport) {
  const pages: JpegPage[] = [];
  for (const [eventIndex, event] of report.events.entries()) {
    const lifecycle = event.result.lifecycle;
    const rows = lifecycle.changes.map((change) => ({ time: lifecycleChangeTime(change), value: detail(change) }));
    if (!rows.length) rows.push({ time: "—", value: "אין lifecycle evidence בארכיון עבור אירוע legacy זה; אין הסקה של active/closed ואין סיבת סיום מומצאת." });
    let rowIndex = 0;
    let pageNumber = 1;
    while (rowIndex < rows.length || pageNumber === 1) {
      const { canvas, ctx } = makeCanvas();
      text(ctx, `Lifecycle אירוע ${eventIndex + 1} מתוך ${report.events.length}`, WIDTH - MARGIN, 92, 36, 700);
      text(ctx, `${event.result.eventId} · קבוצה ${event.result.groupId}`, WIDTH - MARGIN, 132, 18, 400, MUTED);
      ctx.strokeStyle = LINE;
      ctx.beginPath(); ctx.moveTo(MARGIN, 158); ctx.lineTo(WIDTH - MARGIN, 158); ctx.stroke();

      panel(ctx, 205, 250);
      text(ctx, `סטטוס: ${statusLabel(lifecycle.status)}`, WIDTH - MARGIN - 20, 248, 23, 700);
      text(ctx, `פתיחה: ${formatTime(lifecycle.openedAt)} · ${reasonLabel(lifecycle.openingReason)}`, WIDTH - MARGIN - 20, 292, 18);
      text(ctx, `סיום תפעולי: ${formatTime(lifecycle.endedAt)} · ${reasonLabel(lifecycle.endingReason)}`, WIDTH - MARGIN - 20, 332, 18);
      text(ctx, `finalizeAt: ${formatTime(lifecycle.finalizeAt)} · closedAt: ${formatTime(lifecycle.closedAt)}`, WIDTH - MARGIN - 20, 372, 17, 400, MUTED);
      text(ctx, `Code ${event.result.codeVersion} · Config ${event.result.configVersion}`, WIDTH - MARGIN - 20, 414, 15, 400, MUTED);

      text(ctx, "ציר אירועים, התראות והמלצות", WIDTH - MARGIN, 510, 26, 700);
      let y = 560;
      let consumed = false;
      while (rowIndex < rows.length) {
        const row = rows[rowIndex];
        const lines = wrap(ctx, row.value, WIDTH - 2 * MARGIN - 280, 18);
        const height = Math.max(76, 44 + lines.length * 27);
        if (y + height > HEIGHT - 125 && consumed) break;
        panel(ctx, y, height - 8);
        text(ctx, row.time, WIDTH - MARGIN - 20, y + 31, 15, 400, MUTED);
        lines.forEach((line, index) => text(ctx, line, WIDTH - MARGIN - 260, y + 31 + index * 27, 18));
        y += height;
        rowIndex += 1;
        consumed = true;
      }
      ctx.strokeStyle = LINE;
      ctx.beginPath(); ctx.moveTo(MARGIN, HEIGHT - 82); ctx.lineTo(WIDTH - MARGIN, HEIGHT - 82); ctx.stroke();
      text(ctx, investigationEventSourceLabel(event.result, report.source), MARGIN, HEIGHT - 45, 13, 400, MUTED);
      text(ctx, `REP-03/REP-04 · lifecycle ${pageNumber}`, WIDTH - MARGIN, HEIGHT - 45, 15, 400, MUTED);
      pages.push(jpeg(canvas));
      pageNumber += 1;
      if (!rows.length) break;
    }
  }
  return pages;
}

export async function buildInvestigationPdfWithLifecycle(report: InvestigationPdfReport) {
  if (typeof document !== "undefined" && "fonts" in document) await document.fonts.ready;
  const base = await buildInvestigationPdfBrowser(report);
  const basePages = extractCanvasJpegPages(base);
  const lifecycle = lifecyclePages(report);
  return jpegPagesToPdf([...basePages, ...lifecycle]);
}
