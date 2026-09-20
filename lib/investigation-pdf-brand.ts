import type { InvestigationPdfReport } from "@/lib/investigation-pdf";
import { OFFLINE_FAVICON_SVG } from "@/lib/investigation-pdf-logo-offline";

const WIDTH = 1190;
const HEIGHT = 1684;
const FONT = 'Arial, "Noto Sans Hebrew", sans-serif';
const NAVY = "#102433";
const MUTED = "#52666f";
const BLUE = "#0878d7";

export type BrandedPdfPage = { jpeg: Uint8Array; width: number; height: number };

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = NAVY, weight = 400) {
  ctx.save();
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function shortDate(value: string | null | undefined): string {
  if (!value) return "לא הוגדר";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short", hour12: false }).format(parsed);
}

/** Never let a stalled icon request hold the investigation PDF indefinitely. */
async function loadImageSource(src: string, maxWaitMs: number): Promise<HTMLImageElement | null> {
  return await new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const complete = (value: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };
    const timer = setTimeout(() => complete(null), maxWaitMs);
    image.onload = () => complete(image);
    image.onerror = () => complete(null);
    try { image.src = src; } catch { complete(null); }
  });
}

/** Prefer the live app favicon; fall back to an exact bundled copy offline. */
async function loadAppLogo(): Promise<HTMLImageElement | null> {
  if (typeof Image === "undefined") {
    console.warn("Blue Wolf PDF: browser Image unavailable; rendering a text-only cover");
    return null;
  }
  const primary = await loadImageSource("/favicon.svg", 2500);
  if (primary) return primary;
  console.warn("Blue Wolf PDF: /favicon.svg unavailable; trying the bundled offline copy");
  const inline = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(OFFLINE_FAVICON_SVG)}`;
  const fallback = await loadImageSource(inline, 2500);
  if (!fallback) console.warn("Blue Wolf PDF: embedded favicon failed; rendering a text-only cover");
  return fallback;
}

function roundedPanel(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string, stroke?: string) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 23);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.restore();
}

function stat(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, name: string, value: string) {
  roundedPanel(ctx, x, y, width, 153, "#ffffff", "#d9e4eb");
  label(ctx, name, x + width - 25, y + 45, 19, MUTED, 600);
  label(ctx, value, x + width - 25, y + 112, 46, NAVY, 700);
}

function toJpeg(canvas: HTMLCanvasElement): BrandedPdfPage {
  const encoded = canvas.toDataURL("image/jpeg", 0.94);
  const comma = encoded.indexOf(",");
  if (comma < 0) throw new Error("Blue Wolf PDF cover JPEG encoding failed");
  const binary = atob(encoded.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { jpeg: bytes, width: WIDTH, height: HEIGHT };
}

/** A browser-rendered, RTL cover with no inferred event or score evidence. */
export async function buildInvestigationBrandedCover(report: InvestigationPdfReport): Promise<BrandedPdfPage> {
  if (typeof document === "undefined") throw new Error("Blue Wolf PDF cover requires browser rendering");
  if ("fonts" in document) await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Blue Wolf PDF cover requires a 2D canvas");
  ctx.fillStyle = "#f3f7fb";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const header = ctx.createLinearGradient(0, 0, WIDTH, 470);
  header.addColorStop(0, "#0b2440");
  header.addColorStop(1, "#09518f");
  roundedPanel(ctx, 62, 75, WIDTH - 124, 415, "#0b2440");
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(62, 75, WIDTH - 124, 415, 23);
  ctx.fillStyle = header;
  ctx.fill();
  ctx.restore();
  const logo = await loadAppLogo();
  if (logo) {
    try { ctx.drawImage(logo, WIDTH - 245, 132, 142, 142); }
    catch (error) { console.warn("Blue Wolf PDF: logo could not be drawn; text branding remains", error); }
  }
  label(ctx, "זאב כחול", WIDTH - 280, 198, 52, "#ffffff", 700);
  label(ctx, "דוח תחקור אירועים", WIDTH - 105, 342, 48, "#ffffff", 700);
  label(ctx, "ניתוח הנדסי · נתוני האירועים בטווח שנבחר", WIDTH - 105, 397, 25, "#cceaff", 400);
  label(ctx, `שרת ${report.serverId}`, WIDTH - 105, 451, 20, "#b7dcf7", 600);

  label(ctx, "פרטי התחקור", WIDTH - 89, 581, 30, NAVY, 700);
  roundedPanel(ctx, 62, 615, WIDTH - 124, 258, "#ffffff", "#d9e4eb");
  label(ctx, "תחילת טווח", WIDTH - 97, 678, 19, MUTED, 600);
  label(ctx, shortDate(report.from), WIDTH - 97, 718, 28, NAVY, 700);
  label(ctx, "סוף טווח", WIDTH - 97, 778, 19, MUTED, 600);
  label(ctx, shortDate(report.to), WIDTH - 97, 818, 28, NAVY, 700);

  const events = report.events;
  const uniqueGroups = new Set(events.map((event) => event.result.groupId));
  const scored = events.reduce((sum, event) => sum + event.result.scoredFrameCount, 0);
  const missing = events.reduce((sum, event) => sum + event.result.missingFrameCount, 0);
  label(ctx, "היקף הנתונים בדוח", WIDTH - 89, 960, 30, NAVY, 700);
  const cardWidth = 248;
  const cardGap = 24;
  for (const [index, row] of [
    ["אירועים", String(events.length)],
    ["קבוצות", String(uniqueGroups.size)],
    ["מסגרות עם ציון", String(scored)],
    ["מסגרות חסרות", String(missing)],
  ].entries()) {
    stat(ctx, 62 + index * (cardWidth + cardGap), 996, cardWidth, row[0], row[1]);
  }

  roundedPanel(ctx, 62, 1210, WIDTH - 124, 237, "#e4f1fb", "#c7e1f3");
  label(ctx, "מבנה הדוח", WIDTH - 98, 1272, 27, BLUE, 700);
  label(ctx, "מפת אירועים מסכמת, פרקי תחקור, מפות וציונים", WIDTH - 98, 1327, 25, NAVY, 600);
  label(ctx, "פרטי גרסאות ומקור הנתונים מוצגים בפרקי התחקור", WIDTH - 98, 1382, 21, MUTED);
  ctx.save();
  ctx.strokeStyle = "#d1dfe9";
  ctx.beginPath(); ctx.moveTo(62, 1551); ctx.lineTo(WIDTH - 62, 1551); ctx.stroke();
  ctx.restore();
  label(ctx, `הופק: ${shortDate(report.generatedAt)}`, WIDTH - 77, 1601, 19, MUTED);
  label(ctx, "מסמך תחקור · זאב כחול", WIDTH - 77, 1638, 17, MUTED);
  return toJpeg(canvas);
}
