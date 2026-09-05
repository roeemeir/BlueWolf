"use client";

import { useMemo, useState } from "react";
import { Download, FileDown, Save, Search } from "lucide-react";
import { toast } from "sonner";

import { getServerScenario, relationFromCode, type SavedRoute, type SyncTemplate } from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";
import { TimelineChartV09, doubleHippodromeGeometry, groupLineColor, hippodromeLoop, type GroupKey, type ScoreLayer } from "./visuals-v09";

type Point = { x: number; y: number };
type Cause = { label: string; share: number; impact: number };
type Member = { id: number; total: number; sync: number; route: number; reason: string };
type RetroEvent = {
  id: string; family: GroupKey; group: string; templateId: string; start: string; end: string; duration: number;
  total: number; sync: number; route: number; members: Member[]; causes: Cause[];
  joined?: number; left?: number; startReason: string; endReason: string; routeNames: string[];
};
type EventEdit = { note: string; templateId: string; arena?: string };
type EffectiveEvent = RetroEvent & { effectiveTotal: number; effectiveSync: number; effectiveRoute: number; templateName: string; note: string };

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const path = (points: Point[]) => points.length ? `M${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")} Z` : "";
const openPath = (points: Point[]) => points.length ? `M${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")}` : "";

function routeNames(family: GroupKey, routes: SavedRoute[]) {
  const names = routes.filter((route) => route.family === family.toUpperCase()).map((route) => route.name);
  return names.length ? names : [family === "si" ? "SI detected route" : "SO detected route"];
}

function buildEvents(serverId: string, routes: SavedRoute[]): RetroEvent[] {
  const scenario = getServerScenario(serverId);
  const si = scenario.groups.si;
  const so = scenario.groups.so;
  const buildMembers = (key: GroupKey, total: number, sync: number, route: number): Member[] => scenario.groups[key].members.map((member, index) => ({
    id: member.id,
    total: clamp(total + [4, -6, 2, -9][index % 4]),
    sync: clamp(sync + [3, -8, 1, -11][index % 4]),
    route: clamp(route + [2, -2, 5, -4][index % 4]),
    reason: key === "si" ? (index === 1 ? "סטיית זווית יחסית" : "פאזה ומשיק יציבים") : (index === 3 ? "איחור בפנייה" : "פאזה לאורך השרשרת"),
  }));
  const siIds = si.members.map((member) => member.id);
  const soIds = so.members.map((member) => member.id);
  return [
    {
      id: `${serverId}-event-01`, family: "si", group: si.id, templateId: si.templateId, start: "17:08", end: "17:42", duration: 34,
      total: clamp(si.total - 4), sync: clamp(si.sync - 5), route: clamp(si.route - 2), members: buildMembers("si", clamp(si.total - 4), clamp(si.sync - 5), clamp(si.route - 2)),
      causes: [{ label: "סטיית זווית בין רכבים", share: 18, impact: 7.4 }, { label: "סטייה מהמשיק", share: 9, impact: 3.2 }],
      joined: siIds[0], left: siIds.at(-1), startReason: `רכב ${siIds[0]} הצטרף והשלים חברות יציבה`, endReason: `רכב ${siIds.at(-1)} עזב ונשאר מחוץ לקבוצה מעבר ל-hold`, routeNames: routeNames("si", routes),
    },
    {
      id: `${serverId}-event-02`, family: "so", group: so.id, templateId: so.templateId, start: "17:48", end: "18:39", duration: 51,
      total: so.total, sync: so.sync, route: so.route, members: buildMembers("so", so.total, so.sync, so.route),
      causes: [{ label: "איחור בתזמון פנייה", share: 31, impact: 17.6 }, { label: "פער פאזה באזור פנייה", share: 22, impact: 10.4 }, { label: "סטיית מרחק", share: 8, impact: 4.1 }],
      joined: soIds[0], left: soIds.at(-1), startReason: `רכב ${soIds[0]} הצטרף ושרשרת SO אושרה`, endReason: `רכב ${soIds.at(-1)} יצא; שינוי החברות אושר`, routeNames: routeNames("so", routes),
    },
    {
      id: `${serverId}-event-03`, family: "si", group: si.id, templateId: si.templateId, start: "18:44", end: "19:26", duration: 42,
      total: clamp(si.total + 5), sync: clamp(si.sync + 4), route: clamp(si.route + 6), members: buildMembers("si", clamp(si.total + 5), clamp(si.sync + 4), clamp(si.route + 6)),
      causes: [{ label: "סטיית משיק קלה", share: 6, impact: 2.1 }, { label: "פער מחזור קצר", share: 4, impact: 1.7 }],
      joined: siIds.at(-1), startReason: `רכב ${siIds.at(-1)} חזר וקבוצת SI התקבעה מחדש`, endReason: "סיום טווח התחקור", routeNames: routeNames("si", routes),
    },
  ];
}

function recalc(event: RetroEvent, original: SyncTemplate | undefined, selected: SyncTemplate | undefined, thresholds: ReturnType<typeof useWorkspace>["state"]["thresholds"]) {
  if (!selected || selected.id === original?.id) return { total: event.total, sync: event.sync, route: event.route };
  const base = original?.values ?? [];
  let position = 100;
  if (event.family === "si") {
    const scores = selected.values.map((value, index) => {
      const error = Math.abs(value - (base[index] ?? value));
      if (error <= thresholds.siPositionFullDeg) return 100;
      if (error >= thresholds.siPositionZeroDeg) return 0;
      return 100 * (thresholds.siPositionZeroDeg - error) / Math.max(1, thresholds.siPositionZeroDeg - thresholds.siPositionFullDeg);
    });
    position = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 100;
  } else {
    const current = base.map(relationFromCode);
    const next = selected.values.map(relationFromCode);
    const scores: number[] = next.map((relation, index) => relation === (current[index] ?? relation) ? 100 : (relation === "mixed" || current[index] === "mixed") ? 35 : 0);
    position = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 100;
  }
  const sync = clamp(position * .6 + clamp(event.sync + 8) * .2 + clamp(event.sync + 5) * .2);
  const route = event.route;
  return { sync, route, total: clamp(sync * .75 + route * .25) };
}

function geometry() {
  return {
    left: hippodromeLoop({ x: 500, y: 350 }, 95, 29, -38),
    double: doubleHippodromeGeometry({ x: 735, y: 245 }, .64, -7),
    right: hippodromeLoop({ x: 915, y: 145 }, 75, 26, 52),
  };
}

function RetroMap({ events, selected }: { events: EffectiveEvent[]; selected?: string }) {
  const geo = geometry();
  return <svg className="v09-retro-map" viewBox="0 0 1000 470" role="img" aria-label="מפת אירועים בתחקור">
    <defs><pattern id="v091-retro-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" /></pattern></defs>
    <rect width="1000" height="470" /><rect width="1000" height="470" fill="url(#v091-retro-grid)" />
    <circle cx="220" cy="235" r="105" stroke="#ff9f43" fill="none" strokeWidth="5" /><circle cx="220" cy="235" r="72" stroke="#34b7eb" fill="none" strokeWidth="5" /><circle cx="220" cy="235" r="44" stroke="#9068ff" fill="none" strokeWidth="5" />
    <path d={path(geo.left)} stroke="#ff9f43" fill="none" strokeWidth="5" /><path d={path(geo.double.left)} stroke="#34b7eb" fill="none" strokeWidth="5" /><path d={path(geo.double.right)} stroke="#34b7eb" fill="none" strokeWidth="5" /><path d={openPath(geo.double.connector)} stroke="#34b7eb" fill="none" strokeWidth="5" /><path d={path(geo.right)} stroke="#9068ff" fill="none" strokeWidth="5" />
    {events.map((event, index) => <g key={event.id} transform={`translate(${event.family === "si" ? 220 : 690 + index * 48} ${event.family === "si" ? 235 : 255 - index * 35})`}><circle r={selected === event.id ? 20 : 15} fill={groupLineColor[event.family]} stroke={selected === event.id ? "white" : "none"} strokeWidth="3" /><text textAnchor="middle" y="5">E{index + 1}</text></g>)}
  </svg>;
}

function drawPath(ctx: CanvasRenderingContext2D, points: Point[], color: string, x: number, y: number, scale: number, close = true) {
  if (!points.length) return;
  ctx.beginPath(); ctx.moveTo(x + points[0].x * scale, y + points[0].y * scale);
  points.slice(1).forEach((point) => ctx.lineTo(x + point.x * scale, y + point.y * scale));
  if (close) ctx.closePath(); ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.stroke();
}
function canvasMap(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, event?: EffectiveEvent, index = 0) {
  ctx.fillStyle = "#e9f1f6"; ctx.fillRect(x, y, w, h); ctx.strokeStyle = "rgba(70,105,135,.12)"; ctx.lineWidth = 1;
  for (let gx = x; gx <= x + w; gx += 42) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke(); }
  for (let gy = y; gy <= y + h; gy += 42) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }
  const scale = Math.min(w / 1000, h / 470), ox = x + (w - 1000 * scale) / 2, oy = y;
  ctx.strokeStyle = "#ff9f43"; ctx.lineWidth = 5; [105, 72, 44].forEach((radius, ring) => { ctx.beginPath(); ctx.arc(ox + 220 * scale, oy + 235 * scale, radius * scale, 0, Math.PI * 2); ctx.strokeStyle = ["#ff9f43", "#34b7eb", "#9068ff"][ring]; ctx.stroke(); });
  const geo = geometry(); drawPath(ctx, geo.left, "#ff9f43", ox, oy, scale); drawPath(ctx, geo.double.left, "#34b7eb", ox, oy, scale); drawPath(ctx, geo.double.right, "#34b7eb", ox, oy, scale); drawPath(ctx, geo.double.connector, "#34b7eb", ox, oy, scale, false); drawPath(ctx, geo.right, "#9068ff", ox, oy, scale);
  if (event) { const px = event.family === "si" ? 220 : 735, py = event.family === "si" ? 235 : 245; ctx.fillStyle = groupLineColor[event.family]; ctx.beginPath(); ctx.arc(ox + px * scale, oy + py * scale, 18, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "700 16px Arial"; ctx.fillText(`E${index + 1}`, ox + px * scale, oy + py * scale + 5); }
}
function pdfText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 24, color = "#17313d", weight = 500) { ctx.fillStyle = color; ctx.textAlign = "right"; ctx.direction = "rtl"; ctx.font = `${weight} ${size}px Arial, sans-serif`; ctx.fillText(text, x, y); }
function makeCanvas() { const canvas = document.createElement("canvas"); canvas.width = 1240; canvas.height = 1754; const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas unavailable"); ctx.fillStyle = "#f7fafc"; ctx.fillRect(0, 0, canvas.width, canvas.height); return { canvas, ctx }; }
function summaryCanvas(server: string, from: string, to: string, events: EffectiveEvent[], weighted: number) { const { canvas, ctx } = makeCanvas(); ctx.fillStyle = "#0c7087"; ctx.fillRect(70, 70, 1100, 270); pdfText(ctx, "זאב כחול · דוח תחקור", 1110, 150, 50, "#fff", 800); pdfText(ctx, `שרת ${server} · ${from.replace("T", " ")} — ${to.replace("T", " ")}`, 1110, 205, 22, "#e5fbf7"); pdfText(ctx, `ציון משוקלל ${weighted} · ${events.length} אירועים`, 1110, 280, 30, "#fff", 700); pdfText(ctx, "מפת סיכום כל האירועים", 1110, 410, 28, "#17313d", 800); canvasMap(ctx, 70, 445, 1100, 510); events.forEach((event, index) => { pdfText(ctx, `E${index + 1} · ${event.group} · ${event.start}–${event.end} · ${event.effectiveTotal}`, 1110, 1035 + index * 100, 23, groupLineColor[event.family], 700); pdfText(ctx, event.endReason, 1110, 1068 + index * 100, 17, "#607781"); }); return canvas; }
function eventCanvas(event: EffectiveEvent, index: number) { const { canvas, ctx } = makeCanvas(); ctx.fillStyle = groupLineColor[event.family]; ctx.fillRect(70, 70, 1100, 190); pdfText(ctx, `E${index + 1} · ${event.group}`, 1110, 145, 43, "#fff", 800); pdfText(ctx, `${event.start}–${event.end} · ${event.duration} דק׳ · ${event.templateName}`, 1110, 202, 22, "#efffff"); pdfText(ctx, `כולל ${event.effectiveTotal} · Sync ${event.effectiveSync} · Route ${event.effectiveRoute}`, 1110, 330, 28, "#17313d", 800); pdfText(ctx, "מפת האירוע", 1110, 410, 27, "#17313d", 800); canvasMap(ctx, 70, 445, 1100, 470, event, index); pdfText(ctx, `התחלה: ${event.startReason}`, 1110, 990, 20, "#17313d", 700); pdfText(ctx, `סיום: ${event.endReason}`, 1110, 1040, 20, "#17313d", 700); pdfText(ctx, "רכבים", 1110, 1130, 26, "#17313d", 800); event.members.slice(0, 6).forEach((member, row) => pdfText(ctx, `${member.id}   כולל ${member.total}   Sync ${member.sync}   Route ${member.route}   ${member.reason}`, 1110, 1170 + row * 54, 18, "#536b77", 600)); pdfText(ctx, "גורמי שורש", 1110, 1540, 25, "#17313d", 800); event.causes.slice(0, 3).forEach((cause, row) => pdfText(ctx, `${cause.label} · ${cause.share}% זמן · השפעה −${cause.impact}`, 1110, 1580 + row * 42, 18, "#607781")); return canvas; }
function bytes(value: string) { return new TextEncoder().encode(value); }
function concat(parts: Uint8Array[]) { const total = parts.reduce((sum, part) => sum + part.length, 0), result = new Uint8Array(total); let offset = 0; parts.forEach((part) => { result.set(part, offset); offset += part.length; }); return result; }
function jpeg(canvas: HTMLCanvasElement) { const raw = atob(canvas.toDataURL("image/jpeg", .92).split(",")[1]); const output = new Uint8Array(raw.length); for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index); return output; }
function buildPdf(canvases: HTMLCanvasElement[]) {
  const images = canvases.map(jpeg), count = 2 + images.length * 3, bodies: Uint8Array[] = Array.from({ length: count + 1 }, () => new Uint8Array()), pageIds = images.map((_, index) => 3 + index * 3);
  bodies[1] = bytes("<< /Type /Catalog /Pages 2 0 R >>"); bodies[2] = bytes(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${images.length} >>`);
  images.forEach((image, index) => { const pageId = 3 + index * 3, contentId = pageId + 1, imageId = pageId + 2, content = bytes("q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ\n"); bodies[pageId] = bytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`); bodies[contentId] = concat([bytes(`<< /Length ${content.length} >>\nstream\n`), content, bytes("endstream")]); bodies[imageId] = concat([bytes(`<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, bytes("\nendstream")]); });
  const parts: Uint8Array[] = [bytes("%PDF-1.4\n")], offsets = Array(count + 1).fill(0); let length = parts[0].length;
  for (let id = 1; id <= count; id += 1) { offsets[id] = length; const object = concat([bytes(`${id} 0 obj\n`), bodies[id], bytes("\nendobj\n")]); parts.push(object); length += object.length; }
  const xref = length; let table = `xref\n0 ${count + 1}\n0000000000 65535 f \n`; for (let id = 1; id <= count; id += 1) table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`; table += `trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; parts.push(bytes(table)); return concat(parts);
}
function downloadPdf(server: string, from: string, to: string, events: EffectiveEvent[], weighted: number) { const data = buildPdf([summaryCanvas(server, from, to, events, weighted), ...events.map(eventCanvas)]), blob = new Blob([data], { type: "application/pdf" }), url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `blue-wolf-v09-${server}-${from.slice(0, 10)}.pdf`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1200); }

export function InvestigationViewV091({ server, onServerChange }: { server: string; onServerChange: (server: string) => void }) {
  const { state, save } = useWorkspace();
  const [from, setFrom] = useState("2026-09-02T17:00"), [to, setTo] = useState("2026-09-02T19:30"), [filter, setFilter] = useState<"all" | GroupKey>("all"), [selectedId, setSelectedId] = useState(`${server}-event-02`), [cursor, setCursor] = useState(119), [layers, setLayers] = useState<ScoreLayer[]>(["total", "sync", "route"]), [edits, setEdits] = useState<Record<string, EventEdit>>(() => structuredClone(state.investigationEdits));
  const baseEvents = useMemo(() => buildEvents(server, state.routes), [server, state.routes]);
  const effective = baseEvents.map((event): EffectiveEvent => { const edit = edits[event.id] ?? state.investigationEdits[event.id] ?? { note: "", templateId: event.templateId }; const original = state.templates.find((template) => template.id === event.templateId), selected = state.templates.find((template) => template.id === edit.templateId) ?? original, result = recalc(event, original, selected, state.thresholds); return { ...event, effectiveTotal: result.total, effectiveSync: result.sync, effectiveRoute: result.route, templateName: selected?.name ?? "ללא תבנית", note: edit.note }; });
  const shown = effective.filter((event) => filter === "all" || event.family === filter), selected = effective.find((event) => event.id === selectedId) ?? effective[0], edit = edits[selected.id] ?? state.investigationEdits[selected.id] ?? { note: "", templateId: selected.templateId };
  const totalMinutes = effective.reduce((sum, event) => sum + event.duration, 0), weighted = Math.round(effective.reduce((sum, event) => sum + event.effectiveTotal * event.duration, 0) / Math.max(1, totalMinutes)), best = [...effective].sort((a, b) => b.effectiveTotal - a.effectiveTotal)[0];
  const toggle = (layer: ScoreLayer) => setLayers((current) => current.includes(layer) ? (current.length === 1 ? current : current.filter((item) => item !== layer)) : [...current, layer]);
  const patchEdit = (patch: Partial<EventEdit>) => setEdits((current) => ({ ...current, [selected.id]: { ...edit, ...patch } }));
  const saveEdit = async () => { const next = { ...state.investigationEdits, [selected.id]: { ...edit, note: edit.note.trim() } }; await save({ ...state, investigationEdits: next }, "investigation", "event-edit-v09", selected.id); toast.success("השינוי נשמר"); };

  return <div className="v09-investigation">
    <section className="glass-panel v09-investigation-filter"><div><p className="eyebrow">AFTER ACTION</p><h2>תחקור לאחור</h2><p>Event = קבוצתיות יציבה; Start/Stop מציינים גם רכב מצטרף/עוזב.</p></div><div className="v09-form-grid"><label>שרת<select value={server} onChange={(event) => { onServerChange(event.target.value); setSelectedId(`${event.target.value}-event-02`); }}>{state.servers.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>מתאריך<input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>עד תאריך<input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="v09-btn primary" onClick={() => { if (new Date(from) >= new Date(to)) toast.error("טווח זמן לא חוקי"); else toast.success("הטווח נטען"); }}><Search/>טען</button></div></section>
    <div className="v09-report-kpis"><article className="glass-panel"><span>אירועים</span><b>{effective.length}</b><small>{totalMinutes} דקות</small></article><article className="glass-panel"><span>ציון משוקלל</span><b>{weighted}</b><small>לפי משך Event</small></article><article className="glass-panel"><span>Best Event</span><b>{best.effectiveTotal}</b><small>{best.start}–{best.end}</small></article><article className="glass-panel"><span>PDF maps</span><b>✓</b><small>Summary + Event</small></article></div>
    <section className="glass-panel v09-summary-map"><header><div><h3>מפת סיכום כל האירועים</h3><p>Route = צבע סוג רכב; Event = צבע קבוצה.</p></div><div><button className="v09-btn secondary" onClick={() => { const blob = new Blob([JSON.stringify({ server, from, to, weighted, events: effective }, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "bluewolf-v09.json"; link.click(); URL.revokeObjectURL(url); }}><Download/>JSON</button><button className="v09-btn primary" onClick={() => { try { downloadPdf(server, from, to, effective, weighted); toast.success("PDF נוצר עם מפות"); } catch (error) { toast.error(`PDF נכשל: ${error instanceof Error ? error.message : "unknown"}`); } }}><FileDown/>PDF עם מפות</button></div></header><RetroMap events={effective} selected={selected.id}/></section>
    <section className="glass-panel v09-report-timeline"><header><div><h3>ציונים לאורך הטווח</h3><p>שתי הקבוצות יחד; אפשר להסתיר שכבות.</p></div><div className="v09-layer-legend">{(["total", "sync", "route"] as ScoreLayer[]).map((layer) => <button key={layer} className={layers.includes(layer) ? "active" : ""} onClick={() => toggle(layer)}>{layer}</button>)}</div></header><TimelineChartV09 serverId={server} windowMinutes={120} layers={layers} cursor={cursor} onCursor={setCursor}/></section>
    <div className="v09-report-layout"><aside className="glass-panel v09-event-list"><div className="v09-family-filter"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>הכל</button><button className={filter === "si" ? "active" : ""} onClick={() => setFilter("si")}>SI</button><button className={filter === "so" ? "active" : ""} onClick={() => setFilter("so")}>SO</button></div>{shown.map((event) => <button key={event.id} className={selected.id === event.id ? "active" : ""} onClick={() => setSelectedId(event.id)}><span style={{ background: groupLineColor[event.family] }}>E{effective.indexOf(event) + 1}</span><div><b>{event.group}</b><small>{event.start}–{event.end}</small><em>{event.startReason}</em></div><strong>{event.effectiveTotal}</strong></button>)}</aside>
      <main className="glass-panel v09-event-detail"><header><div><p className="eyebrow">{selected.family.toUpperCase()} · {selected.id}</p><h2>{selected.group}</h2><p>{selected.start}–{selected.end} · {selected.duration} דק׳</p></div><b className="v09-big-score">{selected.effectiveTotal}</b></header><div className="v09-event-reasons"><article><span>התחלה</span><b>{selected.startReason}</b>{selected.joined && <small>רכב מצטרף: {selected.joined}</small>}</article><article><span>סיום</span><b>{selected.endReason}</b>{selected.left && <small>רכב עוזב: {selected.left}</small>}</article></div><div className="v09-member-table"><div className="head"><span>רכב</span><span>כולל</span><span>Sync</span><span>Route</span><span>גורם</span></div>{selected.members.map((member) => <div key={member.id}><b>{member.id}</b><span>{member.total}</span><span>{member.sync}</span><span>{member.route}</span><small>{member.reason}</small></div>)}</div><div className="v09-root-causes"><h3>גורמי שורש</h3>{selected.causes.map((cause) => <div key={cause.label}><span>{cause.label}</span><div><i style={{ width: `${cause.share}%` }} /></div><b>{cause.share}% · −{cause.impact}</b></div>)}</div><div className="v09-event-edit"><label>Template override<select value={edit.templateId} onChange={(event) => patchEdit({ templateId: event.target.value })}>{state.templates.filter((template) => template.family.toLowerCase() === selected.family).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><div className="v09-recalc-note">מחושב לפני שמירה: <b>{selected.effectiveTotal}</b> · Sync {selected.effectiveSync} · Route {selected.effectiveRoute}</div><label>הערת תחקור<textarea value={edit.note} onChange={(event) => patchEdit({ note: event.target.value })} /></label><button className="v09-btn primary" onClick={saveEdit}><Save/>שמור שינוי</button></div></main>
    </div>
  </div>;
}
