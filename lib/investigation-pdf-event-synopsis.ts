import { investigationEventSourceLabel, type InvestigationPdfEvent, type InvestigationPdfReport } from "@/lib/investigation-pdf";
import { investigationEventFacts } from "@/lib/investigation-event-evidence-he";

const WIDTH = 1190;
const HEIGHT = 1684;
const MARGIN = 72;
const FONT = 'Arial, "Noto Sans Hebrew", sans-serif';
const NAVY = "#102433";
const MUTED = "#52666f";
const ACCENT = "#126b87";
const PANEL = "#f3f7fa";
const BORDER = "#d3e0e7";

type Page = { jpeg: Uint8Array; width: number; height: number };
type EvidenceRow = { heading: string; description: string; operatorMeaning: string };

function canvasPage() {
  if (typeof document === "undefined") throw new Error("REP-03 Hebrew event synopsis requires browser rendering");
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("REP-03 Hebrew event synopsis could not create a 2D canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textBaseline = "alphabetic";
  return { canvas, ctx };
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size = 20, bold = false, color = NAVY) {
  ctx.save();
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.font = `${bold ? 700 : 400} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
  ctx.restore();
}

function wrap(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, size: number): string[] {
  ctx.save();
  ctx.font = `400 ${size}px ${FONT}`;
  const tokens = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  // An unbroken source ID may be arbitrarily long; split it rather than crop.
  const pushWord = (token: string) => {
    let remaining = token;
    while (remaining && ctx.measureText(remaining).width > maxWidth) {
      let cut = 1;
      while (cut < remaining.length && ctx.measureText(remaining.slice(0, cut + 1)).width <= maxWidth) cut += 1;
      lines.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut);
    }
    return remaining;
  };
  for (const token of tokens) {
    const candidate = line ? `${line} ${token}` : token;
    if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
    if (line) { lines.push(line); line = ""; }
    line = pushWord(token);
  }
  if (line) lines.push(line);
  ctx.restore();
  return lines.length ? lines : ["—"];
}

function panel(ctx: CanvasRenderingContext2D, y: number, height: number) {
  ctx.save();
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(MARGIN, y, WIDTH - MARGIN * 2, height, 14);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function encode(canvas: HTMLCanvasElement): Page {
  const encoded = canvas.toDataURL("image/jpeg", 0.94);
  const comma = encoded.indexOf(",");
  if (comma < 0) throw new Error("REP-03 synopsis could not encode JPEG page");
  const raw = atob(encoded.slice(comma + 1));
  const jpeg = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) jpeg[index] = raw.charCodeAt(index);
  return { jpeg, width: WIDTH, height: HEIGHT };
}

function score(value: number | null): string {
  return value === null ? "אין ציון מחושב" : value.toFixed(1);
}

/** Pages share the same EventRecomputeResult used by the operator and WMTS maps.
 * Source-reported codes are not converted into guessed causal explanations. */
export function buildInvestigationEventSynopsisPages(
  event: InvestigationPdfEvent,
  eventIndex: number,
  eventCount: number,
  reportSource?: InvestigationPdfReport["source"],
): Page[] {
  const facts = investigationEventFacts(event);
  const rows: EvidenceRow[] = [
    {
      heading: "מקור הניווט והחישוב",
      description: investigationEventSourceLabel(event.result, reportSource),
      operatorMeaning: "סימון TEST או SIMULATOR נשמר גם בתחקור ואינו הופך לראיה מבצעית רק מפני שהופק PDF.",
    },
    {
      heading: "סיבת תחילת האירוע — לפי רשומת המקור",
      description: `${facts.startAt} · ${facts.opening.label}`,
      operatorMeaning: facts.opening.operatorMeaning,
    },
    {
      heading: "סיבת סיום האירוע — לפי רשומת המקור",
      description: `${facts.endAt} · ${facts.ending.label}`,
      operatorMeaning: facts.ending.operatorMeaning,
    },
    ...facts.sourceReasons.map((cause, index) => ({
      heading: `סיבה מדווחת ${index + 1} · ${cause.occurrences} מופעים בארכיון`,
      description: `תיעוד מקור: ${cause.reason}`,
      operatorMeaning: "זהו קוד/טקסט שהוחזר על ידי מנוע התחקור. בהיעדר פירוש מתועד לקוד אין לקבוע גורם אנושי, גאומטרי או תפעולי נוסף.",
    })),
    ...facts.members.map((member) => ({
      heading: `רכב ${member.memberId} · מיקום בתבנית ${member.slotId}`,
      description: `מסגרת ציונים אחרונה לרכב: ${member.observedAt} · כולל ${score(member.total)} · סנכרון ${score(member.sync)} · נתיב ${score(member.route)} · סיבת מקור: ${member.reason ?? "לא נרשמה"}`,
      operatorMeaning: "הציונים המוצגים הם של המסגרת המחושבת האחרונה הזמינה עבור רכב זה, ולא ממוצע אירוע. יש להשוות לציר הזמן ולראיות הניווט לפני קביעת מסקנה.",
    })),
  ];
  if (!facts.sourceReasons.length) rows.push({ heading: "סיבות לירידת הציון", description: "לא נרשמו סיבות שורש במקור הנתונים", operatorMeaning: "אין לייחס ירידת ציון לרכב, לנתיב או להפרעה מסוימת ללא ראיה נוספת." });
  if (!facts.members.length) rows.push({ heading: "ציוני רכבים", description: "אין מסגרת מחושבת עם ציונים נפרדים לרכבים", operatorMeaning: "לא הושלמו או הומצאו ציונים חסרים." });

  const pages: Page[] = [];
  let cursor = 0;
  let pageNumber = 1;
  while (cursor < rows.length || pageNumber === 1) {
    const { canvas, ctx } = canvasPage();
    text(ctx, `תחקור מקצועי · אירוע ${eventIndex + 1} מתוך ${eventCount}`, WIDTH - MARGIN, 87, 34, true);
    text(ctx, `${facts.eventId} · קבוצה ${facts.groupId}`, WIDTH - MARGIN, 127, 19, false, MUTED);
    ctx.strokeStyle = BORDER;
    ctx.beginPath(); ctx.moveTo(MARGIN, 151); ctx.lineTo(WIDTH - MARGIN, 151); ctx.stroke();
    let y = 185;
    if (pageNumber === 1) {
      panel(ctx, y, 148);
      text(ctx, `ציון כולל: ${score(facts.scores.total)}`, WIDTH - MARGIN - 24, y + 51, 26, true, ACCENT);
      text(ctx, `ציון סנכרון: ${score(facts.scores.sync)}    ·    ציון נתיב: ${score(facts.scores.route)}`, WIDTH - MARGIN - 24, y + 101, 22);
      y += 174;
    }
    let consumed = false;
    while (cursor < rows.length) {
      const row = rows[cursor];
      const description = wrap(ctx, row.description, WIDTH - MARGIN * 2 - 55, 17);
      const meaning = wrap(ctx, `משמעות למפעיל: ${row.operatorMeaning}`, WIDTH - MARGIN * 2 - 55, 16);
      const height = 69 + description.length * 27 + meaning.length * 25;
      if (y + height > HEIGHT - 126 && consumed) break;
      // The vast majority of source rows fit a page; reject pathological
      // source text rather than painting it outside the printable area.
      if (y + height > HEIGHT - 126) throw new Error(`REP-03: event evidence row is too long for a PDF page (${facts.eventId})`);
      panel(ctx, y, height - 12);
      text(ctx, row.heading, WIDTH - MARGIN - 22, y + 33, 21, true, ACCENT);
      description.forEach((line, lineIndex) => text(ctx, line, WIDTH - MARGIN - 22, y + 66 + lineIndex * 27, 17));
      meaning.forEach((line, lineIndex) => text(ctx, line, WIDTH - MARGIN - 22, y + 66 + description.length * 27 + lineIndex * 25, 16, false, MUTED));
      y += height;
      cursor += 1;
      consumed = true;
    }
    ctx.beginPath(); ctx.moveTo(MARGIN, HEIGHT - 85); ctx.lineTo(WIDTH - MARGIN, HEIGHT - 85); ctx.stroke();
    text(ctx, `המשך מפה ועקבות: נתוני ניווט מקוריים · עמוד ${pageNumber}`, WIDTH - MARGIN, HEIGHT - 52, 15, false, MUTED);
    text(ctx, `Code ${facts.codeVersion} · Config ${facts.configVersion} · Run ${facts.runId}`, WIDTH - MARGIN, HEIGHT - 26, 12, false, MUTED);
    pages.push(encode(canvas));
    pageNumber += 1;
  }
  return pages;
}
