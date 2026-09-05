"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Download, FileDown, Filter, LoaderCircle, Save, Search, TrendingDown, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getServerScenario, type SavedRoute, type SyncTemplate, type VehicleType } from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";
import { LiveMap, ScoreRing, TimelineChart, groupLineColor, type GroupKey, type ScoreLayer } from "./visuals";

type RootCause = { label: string; sharePct: number; impactPoints: number; contribution: number };
type MemberScore = { id: number; total: number; sync: number; route: number; reason: string };
type InvestigationEvent = {
  id: string;
  start: string;
  end: string;
  durationMin: number;
  family: GroupKey;
  group: string;
  members: MemberScore[];
  templateId: string;
  score: number;
  sync: number;
  route: number;
  rootCauses: RootCause[];
  startReason: string;
  endReason: string;
  routeNames: string[];
};
type InvestigationEdit = { note: string; templateId: string };

type PdfEvent = InvestigationEvent & { effectiveScore: number; effectiveSync: number; effectiveRoute: number; templateName: string; note: string };

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const quality = (score: number) => score >= 80 ? "טוב" : score < 50 ? "נמוך" : "בינוני";
const memberOffsets = [4, -7, 2, -11, 1, -4];

function routeNamesFor(family: GroupKey, routes: SavedRoute[]) {
  const wanted = family.toUpperCase();
  const names = routes.filter((route) => route.family === wanted).map((route) => route.name);
  return names.length ? names : [family === "si" ? "SI detected route" : "SO detected route"];
}

function buildEvents(server: string, routes: SavedRoute[]): InvestigationEvent[] {
  const scenario = getServerScenario(server);
  const si = scenario.groups.si;
  const so = scenario.groups.so;
  const makeMembers = (family: GroupKey, score: number, sync: number, route: number) => scenario.groups[family].members.map((member, index) => ({
    id: member.id,
    total: clamp(score + memberOffsets[index % memberOffsets.length]),
    sync: clamp(sync + memberOffsets[(index + 1) % memberOffsets.length]),
    route: clamp(route + memberOffsets[(index + 2) % memberOffsets.length]),
    reason: family === "si" ? (index === 1 ? "סטיית זווית יחסית" : "פאזה ומשיק יציבים") : (index === 3 ? "איחור בפנייה" : "פאזה לאורך השרשרת"),
  }));
  const siRoutes = routeNamesFor("si", routes);
  const soRoutes = routeNamesFor("so", routes);
  return [
    {
      id: `${server}-group-event-01`, start: "17:08", end: "17:42", durationMin: 34, family: "si", group: si.id,
      members: makeMembers("si", Math.max(72, si.total - 4), Math.max(70, si.sync - 5), Math.max(70, si.route - 2)), templateId: si.templateId,
      score: Math.max(72, si.total - 4), sync: Math.max(70, si.sync - 5), route: Math.max(70, si.route - 2),
      rootCauses: [{ label: "סטיית זווית בין רכבים", sharePct: 18, impactPoints: 7.4, contribution: 1.3 }, { label: "סטייה קלה מהמשיק", sharePct: 9, impactPoints: 3.2, contribution: 0.3 }],
      startReason: "הקבוצה אושרה לאחר חלון היציבות", endReason: "שינוי חברות בקבוצה נשמר מעבר ל־hold", routeNames: siRoutes,
    },
    {
      id: `${server}-group-event-02`, start: "17:48", end: "18:39", durationMin: 51, family: "so", group: so.id,
      members: makeMembers("so", so.total, so.sync, so.route), templateId: so.templateId, score: so.total, sync: so.sync, route: so.route,
      rootCauses: [{ label: "איחור בתזמון פנייה", sharePct: 31, impactPoints: 17.6, contribution: 5.5 }, { label: "פער פאזה באזור פנייה", sharePct: 22, impactPoints: 10.4, contribution: 2.3 }, { label: "סטיית מרחק מהנתיב", sharePct: 8, impactPoints: 4.1, contribution: 0.3 }],
      startReason: "SO chain אושרה עם חברות יציבה", endReason: "שינוי גיאומטריה/חברות יצר גבול אירוע", routeNames: soRoutes,
    },
    {
      id: `${server}-group-event-03`, start: "18:44", end: "19:26", durationMin: 42, family: "si", group: si.id,
      members: makeMembers("si", Math.min(95, si.total + 5), Math.min(97, si.sync + 4), Math.min(94, si.route + 6)), templateId: si.templateId,
      score: Math.min(95, si.total + 5), sync: Math.min(97, si.sync + 4), route: Math.min(94, si.route + 6),
      rootCauses: [{ label: "סטיית משיק קלה", sharePct: 6, impactPoints: 2.1, contribution: 0.1 }, { label: "פער מחזור קצר", sharePct: 4, impactPoints: 1.7, contribution: 0.1 }],
      startReason: "קבוצת SI חזרה והתקבעה", endReason: "סיום טווח התחקור", routeNames: siRoutes,
    },
  ];
}

function templateRecalculation(event: InvestigationEvent, original: SyncTemplate | undefined, selected: SyncTemplate | undefined) {
  if (!selected || selected.id === original?.id) return { score: event.score, sync: event.sync, route: event.route, delta: 0 };
  const base = original?.values ?? [];
  const mismatch = selected.values.reduce((sum, value, index) => sum + Math.abs(value - (base[index] ?? value)), 0);
  const scale = event.family === "si" ? Math.max(1, selected.values.length * 120) : Math.max(1, selected.values.length * 2);
  const normalized = Math.min(1, mismatch / scale);
  const sync = clamp(event.sync + 8 - normalized * 24);
  const route = clamp(event.route + (event.family === "so" ? 2 : 0));
  const score = clamp(sync * 0.75 + route * 0.25);
  return { score, sync, route, delta: score - event.score };
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function pdfText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 28, weight = 500, color = "#17313d") {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.direction = "rtl";
  ctx.fillText(text, x, y);
}

function wrapPdfText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, size = 24, weight = 500, color = "#17313d") {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.direction = "rtl";
  const words = text.split(/\s+/);
  let line = "";
  let lineY = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, lineY);
      lineY += lineHeight;
      line = word;
    } else line = next;
  }
  if (line) ctx.fillText(line, x, lineY);
  return lineY;
}

function canvasPage() {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#f6fafb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

function summaryPdfPage(server: string, from: string, to: string, events: PdfEvent[], weightedScore: number, groupScores: Record<string, number>) {
  const { canvas, ctx } = canvasPage();
  const gradient = ctx.createLinearGradient(80, 80, 1160, 330);
  gradient.addColorStop(0, "#061d37"); gradient.addColorStop(0.58, "#0b7186"); gradient.addColorStop(1, "#20b8a6");
  ctx.fillStyle = gradient; ctx.fillRect(70, 70, 1100, 290);
  pdfText(ctx, "זאב כחול · דוח תחקור", 1110, 165, 52, 800, "#ffffff");
  pdfText(ctx, `שרת ${server} · ${from.replace("T", " ")} — ${to.replace("T", " ")}`, 1110, 225, 25, 500, "#dff6f4");
  pdfText(ctx, "אירוע = רצף קבוצתיות יציב. התראות חיות אינן פרקי תחקור.", 1110, 282, 22, 500, "#dff6f4");
  const kpis = [["אירועים", String(events.length)], ["ציון משוקלל", String(weightedScore)], ["זמן קבוצתי", `${events.reduce((s, e) => s + e.durationMin, 0)} דק׳`]];
  kpis.forEach(([label, value], index) => { const x = 70 + index * 365; ctx.fillStyle = "#ffffff"; ctx.fillRect(x, 405, 335, 150); pdfText(ctx, label, x + 290, 450, 22, 500, "#69808a"); pdfText(ctx, value, x + 290, 515, 42, 800, "#123742"); });
  pdfText(ctx, "ציון משוקלל לכל קבוצה", 1110, 650, 30, 800);
  Object.entries(groupScores).forEach(([group, score], index) => { const y = 710 + index * 88; ctx.fillStyle = index % 2 ? "#eef7f8" : "#ffffff"; ctx.fillRect(90, y - 48, 1060, 64); pdfText(ctx, group, 1090, y, 24, 700); pdfText(ctx, String(score), 260, y, 28, 800, score >= 80 ? "#16886f" : score < 50 ? "#bc414c" : "#a06a18"); });
  pdfText(ctx, "אירועים", 1110, 1010, 30, 800);
  events.forEach((event, index) => { const y = 1075 + index * 160; ctx.fillStyle = "#ffffff"; ctx.fillRect(90, y - 50, 1060, 130); pdfText(ctx, `E${index + 1} · ${event.group}`, 1090, y - 5, 26, 800); pdfText(ctx, `${event.start}–${event.end} · ${event.durationMin} דק׳`, 1090, y + 37, 21, 500, "#6e838b"); pdfText(ctx, `כולל ${event.effectiveScore} · Sync ${event.effectiveSync} · Route ${event.effectiveRoute}`, 620, y + 20, 22, 700, groupLineColor[event.family]); });
  return canvas;
}

function eventPdfPage(event: PdfEvent, index: number) {
  const { canvas, ctx } = canvasPage();
  ctx.fillStyle = groupLineColor[event.family]; ctx.fillRect(70, 70, 1100, 190);
  pdfText(ctx, `E${index + 1} · ${event.group}`, 1110, 145, 46, 800, "#ffffff");
  pdfText(ctx, `${event.start}–${event.end} · ${event.durationMin} דקות · ${event.templateName}`, 1110, 205, 24, 500, "#eefbff");
  const scores = [["כולל", event.effectiveScore], ["סנכרון", event.effectiveSync], ["נתיב", event.effectiveRoute]] as const;
  scores.forEach(([label, value], i) => { const x = 90 + i * 350; ctx.fillStyle = "#ffffff"; ctx.fillRect(x, 315, 315, 125); pdfText(ctx, label, x + 270, 355, 20, 500, "#71858d"); pdfText(ctx, String(value), x + 270, 410, 38, 800); });
  pdfText(ctx, "סיבת התחלה", 1110, 520, 25, 800); wrapPdfText(ctx, event.startReason, 1110, 560, 1000, 32, 22, 500, "#516a74");
  pdfText(ctx, "סיבת סיום", 1110, 650, 25, 800); wrapPdfText(ctx, event.endReason, 1110, 690, 1000, 32, 22, 500, "#516a74");
  pdfText(ctx, "רכבים", 1110, 790, 28, 800);
  const headers = ["רכב", "כולל", "Sync", "Route", "גורם מוביל"];
  const columns = [1090, 900, 760, 620, 500];
  ctx.fillStyle = "#eaf2f4"; ctx.fillRect(90, 820, 1060, 55);
  headers.forEach((header, i) => pdfText(ctx, header, columns[i], 858, 19, 700, "#5f7680"));
  event.members.forEach((member, row) => { const y = 920 + row * 68; ctx.fillStyle = row % 2 ? "#f0f6f7" : "#ffffff"; ctx.fillRect(90, y - 40, 1060, 58); pdfText(ctx, String(member.id), columns[0], y, 20, 700); pdfText(ctx, String(member.total), columns[1], y, 20, 700); pdfText(ctx, String(member.sync), columns[2], y, 20, 700); pdfText(ctx, String(member.route), columns[3], y, 20, 700); pdfText(ctx, member.reason, columns[4], y, 18, 500, "#536d77"); });
  const causesY = 940 + event.members.length * 68;
  pdfText(ctx, "גורמי שורש", 1110, causesY, 28, 800);
  event.rootCauses.slice(0, 4).forEach((cause, row) => { const y = causesY + 60 + row * 74; pdfText(ctx, `${row + 1}. ${cause.label}`, 1110, y, 21, 700); pdfText(ctx, `${cause.sharePct}% זמן · השפעה −${cause.impactPoints} · תרומה −${cause.contribution}`, 620, y, 18, 500, "#6b8088"); });
  if (event.note) { const noteY = causesY + 390; pdfText(ctx, "הערת תחקור", 1110, noteY, 25, 800); wrapPdfText(ctx, event.note, 1110, noteY + 42, 1000, 30, 20, 500, "#526b74"); }
  return canvas;
}

function jpegBytes(canvas: HTMLCanvasElement) {
  const base64 = canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function buildPdf(canvases: HTMLCanvasElement[]) {
  const encoder = new TextEncoder();
  const images = canvases.map(jpegBytes);
  const objectCount = 2 + images.length * 3;
  const bodies: Uint8Array[] = Array.from({ length: objectCount + 1 }, () => new Uint8Array());
  const pageIds = images.map((_, index) => 3 + index * 3);
  bodies[1] = encoder.encode("<< /Type /Catalog /Pages 2 0 R >>");
  bodies[2] = encoder.encode(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${images.length} >>`);
  images.forEach((image, index) => {
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const content = encoder.encode("q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ\n");
    bodies[pageId] = encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    bodies[contentId] = concatBytes([encoder.encode(`<< /Length ${content.length} >>\nstream\n`), content, encoder.encode("endstream")]);
    bodies[imageId] = concatBytes([encoder.encode(`<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, encoder.encode("\nendstream")]);
  });
  const parts: Uint8Array[] = [encoder.encode("%PDF-1.4\n")];
  const offsets = Array(objectCount + 1).fill(0);
  let length = parts[0].length;
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = length;
    const object = concatBytes([encoder.encode(`${id} 0 obj\n`), bodies[id], encoder.encode("\nendobj\n")]);
    parts.push(object); length += object.length;
  }
  const xrefOffset = length;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(encoder.encode(xref));
  return concatBytes(parts);
}

function downloadPdf(server: string, from: string, to: string, events: PdfEvent[], weightedScore: number, groupScores: Record<string, number>) {
  const canvases = [summaryPdfPage(server, from, to, events, weightedScore, groupScores), ...events.map(eventPdfPage)];
  const pdf = buildPdf(canvases);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `blue-wolf-${server}-${from.slice(0, 10)}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

function RetrospectiveMap({ routes, events, vehicleTypes }: { routes: SavedRoute[]; events: InvestigationEvent[]; vehicleTypes: VehicleType[] }) {
  const typeColor = (route: SavedRoute) => vehicleTypes.find((item) => item.name === route.vehicleType)?.color ?? "#8798a1";
  return <svg className="v08-retro-map" viewBox="0 0 900 390" role="img" aria-label="מפה מסכמת של הנתיבים והאירועים במיקום היחסי השמור">
    <defs><pattern id="retro-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" /></pattern></defs>
    <rect width="900" height="390" /><rect width="900" height="390" fill="url(#retro-grid)" />
    {routes.map((route) => { const x = (route.mapX ?? 50) / 100 * 900; const y = (route.mapY ?? 50) / 100 * 390; const color = typeColor(route); return <g key={route.id} transform={`translate(${x} ${y}) rotate(${route.rotationDeg ?? 0})`} className="v08-retro-route">{route.family === "SI" ? <circle r="38" stroke={color} /> : <path d="M-58-18H58A18 18 0 0 1 58 18H-58A18 18 0 0 1-58-18Z" stroke={color} />}<text y="62" textAnchor="middle">{route.name}</text></g>; })}
    {events.map((event, index) => { const matching = routes.find((route) => route.family.toLowerCase() === event.family); const x = ((matching?.mapX ?? (event.family === "si" ? 26 : 68)) / 100) * 900 + index * 16; const y = ((matching?.mapY ?? (event.family === "si" ? 42 : 55)) / 100) * 390 + index * 10; return <g key={event.id} className="v08-retro-event" transform={`translate(${x} ${y})`}><circle r="14" fill={groupLineColor[event.family]} /><text y="5" textAnchor="middle">E{index + 1}</text></g>; })}
  </svg>;
}

export function InvestigationView({ server, onServerChange }: { server: string; onServerChange: (server: string) => void }) {
  const { state, save } = useWorkspace();
  const [from, setFrom] = useState("2026-09-02T17:00");
  const [to, setTo] = useState("2026-09-02T19:30");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [familyFilter, setFamilyFilter] = useState<"all" | GroupKey>("all");
  const [cursor, setCursor] = useState(72);
  const [selectedId, setSelectedId] = useState(`${server}-group-event-02`);
  const [draftEdits, setDraftEdits] = useState<Record<string, InvestigationEdit>>(() => structuredClone(state.investigationEdits));
  const layers: ScoreLayer[] = ["total", "sync", "route"];
  const allEvents = useMemo(() => buildEvents(server, state.routes), [server, state.routes]);
  const selectedBase = allEvents.find((event) => event.id === selectedId) ?? allEvents[0];
  const events = allEvents.filter((event) => familyFilter === "all" || event.family === familyFilter);
  const draft = draftEdits[selectedBase.id] ?? state.investigationEdits[selectedBase.id] ?? { note: "", templateId: selectedBase.templateId };
  const originalTemplate = state.templates.find((item) => item.id === selectedBase.templateId);
  const selectedTemplate = state.templates.find((item) => item.id === draft.templateId) ?? originalTemplate;
  const recalculated = templateRecalculation(selectedBase, originalTemplate, selectedTemplate);
  const selected = { ...selectedBase, score: recalculated.score, sync: recalculated.sync, route: recalculated.route };
  const updateDraft = (patch: Partial<InvestigationEdit>) => setDraftEdits((current) => ({ ...current, [selectedBase.id]: { ...draft, ...patch } }));
  const effectiveEvents: PdfEvent[] = allEvents.map((event) => {
    const edit = draftEdits[event.id] ?? state.investigationEdits[event.id] ?? { note: "", templateId: event.templateId };
    const baseTemplate = state.templates.find((item) => item.id === event.templateId);
    const template = state.templates.find((item) => item.id === edit.templateId) ?? baseTemplate;
    const result = templateRecalculation(event, baseTemplate, template);
    return { ...event, effectiveScore: result.score, effectiveSync: result.sync, effectiveRoute: result.route, templateName: template?.name ?? "ללא תבנית", note: edit.note };
  });
  const totalMinutes = effectiveEvents.reduce((sum, event) => sum + event.durationMin, 0);
  const weightedScore = Math.round(effectiveEvents.reduce((sum, event) => sum + event.effectiveScore * event.durationMin, 0) / Math.max(1, totalMinutes));
  const best = [...effectiveEvents].sort((a, b) => b.effectiveScore - a.effectiveScore)[0];
  const groupScores = effectiveEvents.reduce<Record<string, { sum: number; minutes: number }>>((acc, event) => { const current = acc[event.group] ?? { sum: 0, minutes: 0 }; current.sum += event.effectiveScore * event.durationMin; current.minutes += event.durationMin; acc[event.group] = current; return acc; }, {});
  const groupWeighted = Object.fromEntries(Object.entries(groupScores).map(([group, value]) => [group, Math.round(value.sum / Math.max(1, value.minutes))]));

  const loadRange = () => {
    if (new Date(from) >= new Date(to)) { toast.error("זמן ההתחלה חייב להיות מוקדם מזמן הסיום"); return; }
    setLoading(true); setProgress(8);
    const timer = window.setInterval(() => setProgress((value) => { const next = Math.min(100, value + 18); if (next >= 100) { window.clearInterval(timer); window.setTimeout(() => { setLoading(false); toast.success("הטווח נטען וחולק לאירועי קבוצתיות"); }, 100); } return next; }), 90);
  };
  const saveEdit = async () => {
    const nextEdit = { note: draft.note.trim(), templateId: draft.templateId };
    setDraftEdits((current) => ({ ...current, [selectedBase.id]: nextEdit }));
    await save({ ...state, investigationEdits: { ...state.investigationEdits, [selectedBase.id]: nextEdit } }, "investigation", "event-edit", selectedBase.id);
    toast.success("התיקון נשמר והציון המוצג נשאר מחושב לפי התבנית החדשה");
  };

  return <div className="investigation-workspace v08-investigation">
    <section className="investigation-filter glass-panel"><div><p className="eyebrow">תחקור לאחור</p><h2>טווח ושרת</h2><p>אירוע = רצף קבוצתיות יציב. התראות אינן יוצרות אירועים.</p></div><div className="investigation-controls"><label><span>שרת</span><Select value={server} onValueChange={(value) => { onServerChange(value); setSelectedId(`${value}-group-event-02`); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label><label><span>מתאריך</span><input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><span>עד תאריך</span><input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label><Button onClick={loadRange} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Search />}{loading ? "טוען" : "טען"}</Button></div>{loading && <div className="range-progress"><Progress value={progress} /><span>{progress}% · {progress < 50 ? "מזהה קבוצתיות" : "מחשב ציונים וסיבות"}</span></div>}</section>

    <section className="v08-investigation-summary"><article className="glass-panel"><span>אירועים</span><strong>{effectiveEvents.length}</strong><small>{totalMinutes} דקות קבוצתיות</small></article><article className="glass-panel"><span>ציון משוקלל בזמן</span><strong>{weightedScore}</strong><small>לפי משך כל Event</small></article><article className="glass-panel"><span>האירוע המוביל</span><strong>{best.group}</strong><small>{best.start}–{best.end} · {best.effectiveScore} נק׳</small></article><article className="glass-panel"><span>קבוצות</span><strong>{Object.keys(groupWeighted).length}</strong><small>{Object.entries(groupWeighted).map(([group, score]) => `${group} ${score}`).join(" · ")}</small></article></section>

    <section className="v08-summary-map glass-panel"><div className="section-toolbar"><div><p className="eyebrow">מפה מסכמת</p><h2>כל האירועים במיקום היחסי של הנתיבים</h2></div><div className="toolbar-actions"><Button variant="outline" size="sm" onClick={() => downloadJson(`bluewolf-${server}.json`, { server, from, to, weightedScore, groupWeighted, events: effectiveEvents })}><Download />JSON</Button><Button size="sm" onClick={() => { try { downloadPdf(server, from, to, effectiveEvents, weightedScore, groupWeighted); toast.success("PDF נוצר והורד ישירות"); } catch (error) { toast.error(`יצירת PDF נכשלה: ${error instanceof Error ? error.message : "unknown"}`); } }}><FileDown />PDF</Button></div></div><RetrospectiveMap routes={state.routes} events={allEvents} vehicleTypes={state.vehicleTypes} /></section>

    <section className="investigation-timeline glass-panel"><div className="section-toolbar"><div><p className="eyebrow">ציר זמן</p><h2>כל הקבוצות · כולל / Sync / Route</h2></div><div className="segmented-control"><button type="button" className={familyFilter === "all" ? "active" : ""} onClick={() => setFamilyFilter("all")}>הכול</button><button type="button" className={familyFilter === "si" ? "active" : ""} onClick={() => setFamilyFilter("si")}>SI</button><button type="button" className={familyFilter === "so" ? "active" : ""} onClick={() => setFamilyFilter("so")}>SO</button></div></div><TimelineChart serverId={server} selected={selected.family} layers={layers} cursor={cursor} onCursor={setCursor} fromLabel={from.replace("T", " ")} toLabel={to.replace("T", " ")} /><div className="v08-time-slider"><span>{from.slice(11)}</span><input type="range" min="0" max="119" value={cursor} onChange={(event) => setCursor(Number(event.target.value))} /><span>{to.slice(11)}</span></div><div className="timeline-footer"><span><CalendarRange />גבולות E1/E2/E3 הם גבולות קבוצתיות</span><span>אין רשימת התראות בדוח</span></div></section>

    <div className="investigation-main v08-investigation-main"><section className="event-list glass-panel"><div className="list-title"><div><p className="eyebrow">אירועים</p><h2>{events.length} רצפים</h2></div><Filter /></div><div className="event-list-scroll">{events.map((event) => { const effective = effectiveEvents.find((item) => item.id === event.id) ?? { ...event, effectiveScore: event.score }; return <button type="button" className={`event-row ${selectedBase.id === event.id ? "active" : ""}`} key={event.id} onClick={() => setSelectedId(event.id)}><div className="v08-event-glyph" style={{ borderColor: groupLineColor[event.family] }}>{event.family.toUpperCase()}</div><div><span>E{allEvents.indexOf(event) + 1} · {event.start}–{event.end}</span><strong>{event.group} · {quality(effective.effectiveScore)}</strong><p>{event.durationMin} דק׳ · {event.members.length} רכבים · {event.rootCauses.length} גורמי שורש</p></div><ScoreRing value={effective.effectiveScore} color={groupLineColor[event.family]} size="small" /></button>; })}</div></section>

      <section className="event-detail glass-panel"><div className="section-toolbar"><div><p className="eyebrow">אירוע נבחר · {selected.start}–{selected.end}</p><h2>{selected.group} · {quality(selected.score)}</h2><p><UsersRound /> {selected.members.map((member) => member.id).join(" · ")}</p></div><div className="event-score-summary"><span>כולל <b>{selected.score}</b></span><span>Sync <b>{selected.sync}</b></span><span>Route <b>{selected.route}</b></span><ScoreRing value={selected.score} color={groupLineColor[selected.family]} /></div></div>
        <div className="v08-event-meta"><span><b>התחלה</b>{selected.startReason}</span><span><b>סיום</b>{selected.endReason}</span><span><b>נתיבים</b>{selected.routeNames.join(" · ")}</span></div>
        <div className="investigation-map-wrap"><LiveMap serverId={server} tick={cursor} selectedGroup={selected.family} selectedVehicle={null} showTrace showRoutes showRelations showGrid vehicleTypes={state.vehicleTypes} animate={false} onSelectGroup={() => undefined} onSelectVehicle={() => undefined} /></div>

        <div className="v08-member-table"><div className="table-head"><span>רכב</span><span>כולל</span><span>Sync</span><span>Route</span><span>גורם מוביל</span></div>{selected.members.map((member) => <div className="table-row" key={member.id}><strong>{member.id}</strong><b>{member.total}</b><span>{member.sync}</span><span>{member.route}</span><span>{member.reason}</span></div>)}</div>

        <div className="v04-root-causes"><div className="panel-title"><div><p className="eyebrow">Root causes</p><h3>הסיבות שהורידו את הציון</h3></div><Badge variant="outline">מדורג לפי תרומה</Badge></div>{[...selected.rootCauses].sort((a, b) => b.contribution - a.contribution).map((cause, index) => <article key={cause.label}><span className="v04-cause-rank">#{index + 1}</span><div><strong>{cause.label}</strong><small>{cause.sharePct}% מזמן האירוע</small></div><span><TrendingDown />השפעה בעת הופעה <b>−{cause.impactPoints}</b></span><span>תרומה כוללת <b>−{cause.contribution}</b></span></article>)}</div>

        <div className="event-editor v08-event-editor"><div><p className="eyebrow">תיקון תחקור</p><h3>Template replay מיידי</h3><p>שינוי תבנית מעדכן את הציון בתצוגה לפני שמירה.</p></div><label><span>תבנית לחישוב האירוע</span><Select value={draft.templateId} onValueChange={(value) => updateDraft({ templateId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.templates.filter((item) => item.family.toLowerCase() === selected.family).map((item) => <SelectItem key={item.id} value={item.id}>{item.name.replaceAll("חיוך", "שרשרת")}</SelectItem>)}</SelectContent></Select></label><div className="v08-recalc"><span>לפני <b>{selectedBase.score}</b></span><span>אחרי <b>{selected.score}</b></span><span>Δ <b>{recalculated.delta >= 0 ? "+" : ""}{recalculated.delta}</b></span></div><Textarea value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} placeholder="הערת תחקור קצרה" /><Button onClick={saveEdit}><Save />שמור תיקון</Button></div>
      </section></div>
  </div>;
}
