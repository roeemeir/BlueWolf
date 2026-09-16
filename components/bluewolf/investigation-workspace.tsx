"use client";

import { useMemo, useState } from "react";
import { CalendarRange, ChevronDown, Download, FileChartColumn, MapPinned, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EventRecomputeResult } from "@/lib/investigation-contract";
import { buildInvestigationReleasePdf } from "@/lib/investigation-pdf-release";
import { normalizeInvestigationReportData, type InvestigationReportDataEnvelope } from "@/lib/investigation-report-data";
import { useWorkspace } from "./app-context";

type InvestigationEdit = {
  note: string;
  templateId: string;
  arena?: string;
  recomputeRunId?: string;
  requiredCodeVersion?: string;
  requiredConfigVersion?: string;
  requiredTemplateVersion?: string;
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; detail: string }
  | { kind: "ready"; envelope: InvestigationReportDataEnvelope; fromLocal: string; toLocal: string };

type PdfState = "idle" | "running" | "done";

type GeoPoint = { latitude: number; longitude: number };

function inputTimeToIso(value: string, name: string) {
  if (!value) throw new Error(`יש לבחור ${name}`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} אינו זמן תקין`);
  return date.toISOString();
}

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatScore(value: number | null) {
  return value === null ? "—" : value.toFixed(1);
}

function eventColor(index: number) {
  return `hsl(${(192 + index * 67) % 360} 72% 48%)`;
}

function downloadPdf(bytes: Uint8Array, generatedAt: string) {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  const blob = new Blob([body.buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bluewolf-investigation-${generatedAt.slice(0, 10).replaceAll("-", "")}.pdf`;
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

function collectGeo(result: EventRecomputeResult): GeoPoint[] {
  const navigation = result.points.flatMap((point) => point.navigation)
    .filter((point) => point.latitude !== null && point.longitude !== null)
    .map((point) => ({ latitude: point.latitude as number, longitude: point.longitude as number }));
  const routes = result.routes.flatMap((route) => route.centerline);
  return [...navigation, ...routes];
}

function createProjector(results: EventRecomputeResult[], width: number, height: number) {
  const points = results.flatMap(collectGeo);
  if (!points.length) return null;
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const rawMinLat = Math.min(...latitudes);
  const rawMaxLat = Math.max(...latitudes);
  const rawMinLon = Math.min(...longitudes);
  const rawMaxLon = Math.max(...longitudes);
  const latSpan = Math.max(rawMaxLat - rawMinLat, 0.0002);
  const lonSpan = Math.max(rawMaxLon - rawMinLon, 0.0002);
  const minLat = rawMinLat - latSpan * 0.08;
  const maxLat = rawMaxLat + latSpan * 0.08;
  const minLon = rawMinLon - lonSpan * 0.08;
  const maxLon = rawMaxLon + lonSpan * 0.08;
  return {
    project(point: GeoPoint) {
      return {
        x: (point.longitude - minLon) / (maxLon - minLon) * width,
        y: height - (point.latitude - minLat) / (maxLat - minLat) * height,
      };
    },
    bounds: { minLat, maxLat, minLon, maxLon },
  };
}

function pathFromPoints(points: GeoPoint[], project: (point: GeoPoint) => { x: number; y: number }) {
  return points.map((point, index) => {
    const p = project(point);
    return `${index === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  }).join(" ");
}

function memberTrails(result: EventRecomputeResult) {
  const ids = Array.from(new Set(result.points.flatMap((point) => point.navigation.map((nav) => nav.memberId))));
  return ids.flatMap((memberId) => {
    const segments: GeoPoint[][] = [];
    let current: GeoPoint[] = [];
    result.points.forEach((frame) => {
      const nav = frame.navigation.find((item) => item.memberId === memberId);
      if (!nav || nav.latitude === null || nav.longitude === null) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      current.push({ latitude: nav.latitude, longitude: nav.longitude });
    });
    if (current.length) segments.push(current);
    return segments;
  });
}

function ReportOverviewMap({ events }: { events: InvestigationReportDataEnvelope["report"]["events"] }) {
  const width = 980;
  const height = 430;
  const projector = createProjector(events.map((event) => event.result), width, height);
  if (!projector) return <div className="investigation-empty"><MapPinned /><strong>אין WGS84 להצגת מפה מסכמת</strong><span>הדוח נשאר תקף; לא ממציאים מיקום כאשר event evidence חסר.</span></div>;
  return <section className="investigation-report-card report-map-card">
    <div className="report-card-title"><div><p className="eyebrow">Event overview</p><h3>עקבות ונתיבים לפי אירועים</h3></div><Badge variant="outline">{events.length} אירועים</Badge></div>
    <div className="event-map-legend">{events.map((event, index) => <span key={event.result.eventId}><i style={{ background: eventColor(index) }} />{event.result.groupId} · {formatTime(event.result.startAt)}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} className="investigation-overview-map" role="img" aria-label="עקבות ונתיבים צבועים לפי אירוע">
      <defs><pattern id="investigation-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" opacity=".08" strokeWidth="1" /></pattern></defs>
      <rect width={width} height={height} fill="url(#investigation-grid)" />
      {events.map((event, index) => {
        const color = eventColor(index);
        const routePaths = event.result.routes.map((route) => route.centerline).filter((points) => points.length > 1);
        const trails = memberTrails(event.result).filter((points) => points.length > 1);
        return <g key={event.result.eventId} data-event-id={event.result.eventId}>
          {trails.map((points, trailIndex) => <path key={`trail-${trailIndex}`} d={pathFromPoints(points, projector.project)} fill="none" stroke={color} strokeWidth="2.3" opacity=".45" vectorEffect="non-scaling-stroke" />)}
          {routePaths.map((points, routeIndex) => <path key={`route-${routeIndex}`} d={pathFromPoints(points, projector.project)} fill="none" stroke={color} strokeWidth="5" opacity=".9" vectorEffect="non-scaling-stroke" />)}
        </g>;
      })}
      <text x="14" y="25" fill="currentColor" opacity=".55" fontSize="15">N ↑ · engineering view · WGS84 evidence</text>
    </svg>
  </section>;
}

function EventMiniMap({ result, color }: { result: EventRecomputeResult; color: string }) {
  const width = 720;
  const height = 270;
  const projector = createProjector([result], width, height);
  if (!projector) return <div className="event-mini-map-empty">אין navigation/route WGS84 לאירוע זה.</div>;
  const trails = memberTrails(result).filter((points) => points.length > 1);
  const routes = result.routes.map((route) => route.centerline).filter((points) => points.length > 1);
  return <svg viewBox={`0 0 ${width} ${height}`} className="event-mini-map" role="img" aria-label={`מפת אירוע ${result.eventId}`}>
    <rect width={width} height={height} fill="none" />
    {trails.map((points, index) => <path key={`trail-${index}`} d={pathFromPoints(points, projector.project)} fill="none" stroke={color} strokeWidth="2" opacity=".38" vectorEffect="non-scaling-stroke" />)}
    {routes.map((points, index) => <path key={`route-${index}`} d={pathFromPoints(points, projector.project)} fill="none" stroke={color} strokeWidth="4.5" opacity=".92" vectorEffect="non-scaling-stroke" />)}
  </svg>;
}

function vehicleSummary(result: EventRecomputeResult) {
  const rows = new Map<string, { sync: number[]; route: number[]; total: number[]; reasons: Map<string, number> }>();
  result.points.forEach((point) => point.members.forEach((member) => {
    const row = rows.get(member.memberId) ?? { sync: [], route: [], total: [], reasons: new Map<string, number>() };
    if (member.sync !== null) row.sync.push(member.sync);
    if (member.route !== null) row.route.push(member.route);
    if (member.total !== null) row.total.push(member.total);
    if (member.primaryReason) row.reasons.set(member.primaryReason, (row.reasons.get(member.primaryReason) ?? 0) + 1);
    rows.set(member.memberId, row);
  }));
  const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return [...rows.entries()].map(([id, row]) => ({
    id,
    sync: avg(row.sync),
    route: avg(row.route),
    total: avg(row.total),
    rootCause: [...row.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—",
  }));
}

function EventChapter({ result, arena, note, index }: { result: EventRecomputeResult; arena: string | null; note: string | null; index: number }) {
  const color = eventColor(index);
  const vehicles = vehicleSummary(result);
  return <article className="investigation-event-chapter" data-event-id={result.eventId}>
    <header className="event-chapter-head" style={{ borderInlineStartColor: color }}>
      <div><p className="eyebrow">אירוע {index + 1}</p><h3>קבוצה {result.groupId}</h3><p>{formatTime(result.startAt)} — {formatTime(result.endAt)}</p></div>
      <div className="event-chapter-badges"><Badge variant="outline">{result.lifecycle.status}</Badge><Badge variant="outline">{result.templateId}</Badge><Badge variant="outline">{result.scoredFrameCount}/{result.frameCount} frames</Badge></div>
    </header>
    <div className="event-score-grid"><div><span>כולל</span><strong>{formatScore(result.summary.total)}</strong></div><div><span>סנכרון</span><strong>{formatScore(result.summary.sync)}</strong></div><div><span>נתיב</span><strong>{formatScore(result.summary.route)}</strong></div><div><span>חסר</span><strong>{result.missingFrameCount}</strong></div></div>
    <div className="event-chapter-grid">
      <section><h4>מפה · עקבה + נתיב</h4><EventMiniMap result={result} color={color} /></section>
      <section><h4>Root causes</h4><div className="root-cause-list">{result.rootCauses.length ? result.rootCauses.map((cause) => <div key={cause.reason}><span>{cause.reason}</span><b>{cause.occurrences}</b></div>) : <span>אין root cause מסכם.</span>}</div><h4>מטא־דאטה תחקור</h4><dl className="event-meta"><div><dt>Arena</dt><dd>{arena || "לא שויך"}</dd></div><div><dt>הערה</dt><dd>{note || "אין הערה"}</dd></div><div><dt>Run</dt><dd>{result.runId}</dd></div></dl></section>
    </div>
    <section className="event-vehicle-section"><h4>ציונים לפי רכב</h4><div className="event-vehicle-table"><div className="event-vehicle-row header"><span>רכב</span><span>כולל</span><span>סנכרון</span><span>נתיב</span><span>Root cause</span></div>{vehicles.map((vehicle) => <div className="event-vehicle-row" key={vehicle.id}><strong>{vehicle.id}</strong><span>{formatScore(vehicle.total)}</span><span>{formatScore(vehicle.sync)}</span><span>{formatScore(vehicle.route)}</span><span>{vehicle.rootCause}</span></div>)}</div></section>
    <details className="event-provenance"><summary><ChevronDown />פרטי evidence וגרסאות</summary><div><span>code {result.codeVersion}</span><span>config {result.configVersion}</span><span>template {result.templateVersion}</span><span>{result.routes.length} routes</span><span>{result.lifecycle.changes.length} lifecycle changes</span></div></details>
  </article>;
}

function groupSummary(events: InvestigationReportDataEnvelope["report"]["events"]) {
  const groups = new Map<string, { eventCount: number; frames: number; sync: number; syncWeight: number; route: number; routeWeight: number; total: number; totalWeight: number }>();
  events.forEach(({ result }) => {
    const row = groups.get(result.groupId) ?? { eventCount: 0, frames: 0, sync: 0, syncWeight: 0, route: 0, routeWeight: 0, total: 0, totalWeight: 0 };
    const weight = Math.max(1, result.scoredFrameCount);
    row.eventCount += 1;
    row.frames += result.frameCount;
    if (result.summary.sync !== null) { row.sync += result.summary.sync * weight; row.syncWeight += weight; }
    if (result.summary.route !== null) { row.route += result.summary.route * weight; row.routeWeight += weight; }
    if (result.summary.total !== null) { row.total += result.summary.total * weight; row.totalWeight += weight; }
    groups.set(result.groupId, row);
  });
  return [...groups.entries()].map(([groupId, row]) => ({ groupId, eventCount: row.eventCount, frames: row.frames, sync: row.syncWeight ? row.sync / row.syncWeight : null, route: row.routeWeight ? row.route / row.routeWeight : null, total: row.totalWeight ? row.total / row.totalWeight : null }));
}

export function InvestigationWorkspace({ server, onServerChange }: { server: string; onServerChange: (value: string) => void }) {
  const { state } = useWorkspace();
  const edits = state.investigationEdits as Record<string, InvestigationEdit>;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loadState, setLoadState] = useState<LoadState>({ kind: "idle" });
  const [pdfState, setPdfState] = useState<PdfState>("idle");

  const loadReport = async () => {
    let fromIso: string;
    let toIso: string;
    try {
      fromIso = inputTimeToIso(from, "זמן התחלה");
      toIso = inputTimeToIso(to, "זמן סוף");
      if (fromIso >= toIso) throw new Error("זמן ההתחלה חייב להיות מוקדם מזמן הסיום");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "טווח הזמן אינו תקין");
      return;
    }
    setLoadState({ kind: "loading" });
    setPdfState("idle");
    try {
      const response = await fetch("/api/investigation/report", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          serverId: Number(server), from: fromIso, to: toIso, format: "data",
          overrides: Object.entries(edits).map(([eventId, edit]) => ({
            eventId,
            templateId: edit.templateId || null,
            arena: edit.arena || null,
            note: edit.note || null,
            recomputeRunId: edit.recomputeRunId || null,
            requiredCodeVersion: edit.requiredCodeVersion || null,
            requiredConfigVersion: edit.requiredConfigVersion || null,
            requiredTemplateVersion: edit.requiredTemplateVersion || null,
          })),
        }),
      });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const row = payload && typeof payload === "object" ? payload as { error?: unknown; missingTemplateEvents?: unknown } : {};
        const missing = Array.isArray(row.missingTemplateEvents) ? ` · חסרה תבנית מקורית ל-${row.missingTemplateEvents.length} אירועים` : "";
        throw new Error(`${row.error ? String(row.error) : `report data returned ${response.status}`}${missing}`);
      }
      if (response.headers.get("x-bluewolf-report-source") !== "core-event-archive") throw new Error("מקור הדוח לא אומת כ-Core event archive");
      const envelope = normalizeInvestigationReportData(payload);
      setLoadState({ kind: "ready", envelope, fromLocal: from, toLocal: to });
    } catch (error) {
      setLoadState({ kind: "error", detail: error instanceof Error ? error.message : "טעינת דוח התחקור נכשלה" });
    }
  };

  const generatePdf = async () => {
    if (loadState.kind !== "ready") return;
    setPdfState("running");
    try {
      const pdf = await buildInvestigationReleasePdf(loadState.envelope.report);
      if (pdf.byteLength < 64) throw new Error("PDF report is unexpectedly empty");
      downloadPdf(pdf, loadState.envelope.report.generatedAt);
      setPdfState("done");
      toast.success("PDF הופק מאותו dataset שמוצג בדוח ה-Web");
    } catch (error) {
      setPdfState("idle");
      toast.error(error instanceof Error ? error.message : "הפקת PDF נכשלה");
    }
  };

  const groups = useMemo(() => loadState.kind === "ready" ? groupSummary(loadState.envelope.report.events) : [], [loadState]);

  if (loadState.kind !== "ready") return <div className="investigation-workspace" dir="rtl" data-requirements="BW-REP-001 BW-REP-003 BW-REP-004 BW-REP-008 BW-UI-014">
    <section className="investigation-range-card glass-panel">
      <div className="investigation-range-head"><div><p className="eyebrow">Investigation</p><h2>תחקור לפי טווח זמן</h2><p>בוחרים טווח פעם אחת. לאחר אישור נטען דוח Web מלא; PDF מופק מאותו dataset בדיוק.</p></div><CalendarRange /></div>
      <div className="investigation-range-grid">
        <label><span>מתאריך ושעה</span><input aria-label="זמן התחלה לתחקור" type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>עד תאריך ושעה</span><input aria-label="זמן סוף לתחקור" type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label><span>שרת</span><Select value={server} onValueChange={(value) => { onServerChange(value); setLoadState({ kind: "idle" }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
        <Button className="investigation-confirm" onClick={loadReport} disabled={loadState.kind === "loading"}><FileChartColumn />{loadState.kind === "loading" ? "טוען דוח…" : "אישור והצג דוח"}</Button>
      </div>
      {loadState.kind === "loading" && <div className="investigation-status"><ShieldCheck /><span>טוען אירועים ומחשב את הדוח מה־Core Event Archive. אין progress מומצא.</span></div>}
      {loadState.kind === "error" && <div className="investigation-status error"><TriangleAlert /><span>{loadState.detail}</span></div>}
    </section>
    <style jsx>{investigationStyles}</style>
  </div>;

  const { envelope } = loadState;
  return <div className="investigation-workspace report-ready" dir="rtl" data-requirements="BW-REP-001 BW-REP-003 BW-REP-004 BW-REP-008 BW-UI-014">
    <section className="investigation-report-hero glass-panel">
      <div><p className="eyebrow">Web Investigation Report</p><h2>דוח תחקור · שרת {server}</h2><p>{formatTime(envelope.report.from ?? envelope.report.events[0].result.startAt)} — {formatTime(envelope.report.to ?? envelope.report.events.at(-1)!.result.endAt)}</p><div className="report-provenance"><Badge variant="outline">Core Archive</Badge><Badge variant="outline">code {envelope.codeVersion.slice(0, 10)}</Badge><Badge variant="outline">config {envelope.configVersion.slice(0, 10)}</Badge></div></div>
      <div className="report-actions"><Button variant="outline" onClick={() => { setLoadState({ kind: "idle" }); setPdfState("idle"); }}><RefreshCw />שנה טווח</Button><Button onClick={generatePdf} disabled={pdfState === "running"}><Download />{pdfState === "running" ? "מפיק PDF…" : "הפק דוח PDF"}</Button></div>
    </section>

    <section className="report-summary-grid">
      <div className="investigation-report-card metric"><span>אירועים</span><strong>{envelope.report.events.length}</strong></div>
      <div className="investigation-report-card metric"><span>קבוצות</span><strong>{groups.length}</strong></div>
      <div className="investigation-report-card metric"><span>Scored frames</span><strong>{envelope.report.events.reduce((sum, event) => sum + event.result.scoredFrameCount, 0)}</strong></div>
      <div className="investigation-report-card metric"><span>Missing frames</span><strong>{envelope.report.events.reduce((sum, event) => sum + event.result.missingFrameCount, 0)}</strong></div>
    </section>

    <section className="investigation-report-card group-summary-card"><div className="report-card-title"><div><p className="eyebrow">Overall groups</p><h3>ציונים כוללים לפי קבוצה</h3></div><span>ממוצע משוקלל לפי frames עם ציון</span></div><div className="group-summary-table"><div className="group-summary-row header"><span>קבוצה</span><span>אירועים</span><span>כולל</span><span>סנכרון</span><span>נתיב</span></div>{groups.map((group) => <div className="group-summary-row" key={group.groupId}><strong>{group.groupId}</strong><span>{group.eventCount}</span><span>{formatScore(group.total)}</span><span>{formatScore(group.sync)}</span><span>{formatScore(group.route)}</span></div>)}</div></section>

    <ReportOverviewMap events={envelope.report.events} />

    <section className="event-chapters"><div className="event-chapters-title"><div><p className="eyebrow">Event chapters</p><h2>פרקי תחקור</h2></div><Badge variant="outline">{envelope.report.events.length}</Badge></div>{envelope.report.events.map((event, index) => <EventChapter key={event.result.eventId} result={event.result} arena={event.arena} note={event.note} index={index} />)}</section>

    {pdfState === "done" && <div className="investigation-status success"><ShieldCheck /><span>ה־PDF האחרון הופק מאותו dataset שמוצג כעת ב־Web.</span></div>}
    <style jsx>{investigationStyles}</style>
  </div>;
}

const investigationStyles = `
  .investigation-workspace{padding:18px 24px 36px;display:grid;gap:16px;max-width:1600px;margin:0 auto}
  .investigation-range-card,.investigation-report-hero{border-radius:22px;padding:22px}
  .investigation-range-head,.investigation-report-hero,.report-card-title,.event-chapters-title{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
  .investigation-range-head h2,.investigation-report-hero h2,.event-chapters-title h2,.report-card-title h3{margin:0}
  .investigation-range-head p,.investigation-report-hero p{margin:6px 0 0;color:var(--text-soft)}
  .investigation-range-head>svg{width:32px;height:32px;color:var(--brand)}
  .investigation-range-grid{display:grid;grid-template-columns:minmax(180px,1fr) minmax(180px,1fr) minmax(150px,.75fr) auto;gap:12px;align-items:end;margin-top:20px}
  .investigation-range-grid label{display:grid;gap:6px;min-width:0}.investigation-range-grid label>span{font-size:12px;color:var(--text-soft);font-weight:700}
  .investigation-range-grid input{width:100%;min-width:0;height:38px;border:1px solid var(--input);border-radius:10px;padding:0 10px;color:var(--foreground);background:var(--surface-soft)}
  .investigation-confirm{white-space:nowrap}
  .investigation-status{display:flex;align-items:center;gap:8px;margin-top:14px;padding:10px 12px;border-radius:12px;background:var(--surface-soft);color:var(--text-soft)}
  .investigation-status.error{color:var(--low)}.investigation-status.success{color:var(--good)}
  .investigation-report-hero{align-items:center}.report-actions,.report-provenance{display:flex;gap:8px;flex-wrap:wrap}.report-provenance{margin-top:10px}
  .report-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .investigation-report-card{border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,var(--surface-strong),var(--surface));box-shadow:var(--shadow),inset 0 1px 0 var(--glass-edge);padding:16px;min-width:0}
  .investigation-report-card.metric{display:grid;gap:4px}.investigation-report-card.metric span{color:var(--text-soft);font-size:12px}.investigation-report-card.metric strong{font-size:28px;font-variant-numeric:tabular-nums}
  .report-card-title{align-items:center;margin-bottom:12px}.report-card-title span{color:var(--text-faint);font-size:11px}
  .group-summary-table,.event-vehicle-table{display:grid;gap:2px;overflow:hidden;border:1px solid var(--line);border-radius:12px}
  .group-summary-row{display:grid;grid-template-columns:1.4fr repeat(4,1fr);gap:8px;padding:10px 12px;background:var(--surface-soft);font-variant-numeric:tabular-nums}.group-summary-row.header{font-size:11px;font-weight:800;color:var(--text-soft);background:var(--surface-strong)}
  .event-map-legend{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 10px;color:var(--text-soft);font-size:11px}.event-map-legend span{display:flex;align-items:center;gap:5px}.event-map-legend i{width:9px;height:9px;border-radius:50%}
  .investigation-overview-map,.event-mini-map{display:block;width:100%;min-height:220px;border:1px solid var(--line);border-radius:14px;background:var(--map-bg)}
  .event-chapters{display:grid;gap:14px}.event-chapters-title{align-items:center;padding:4px 2px}.investigation-event-chapter{border:1px solid var(--line);border-radius:20px;background:linear-gradient(145deg,var(--surface-strong),var(--surface));box-shadow:var(--shadow),inset 0 1px 0 var(--glass-edge);padding:17px;overflow:hidden}
  .event-chapter-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;border-inline-start:5px solid;padding-inline-start:12px}.event-chapter-head h3{margin:0}.event-chapter-head p{margin:4px 0 0;color:var(--text-soft);font-size:12px}.event-chapter-badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
  .event-score-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:14px}.event-score-grid>div{padding:10px 12px;border-radius:12px;background:var(--surface-soft);display:grid;gap:3px}.event-score-grid span{font-size:11px;color:var(--text-soft)}.event-score-grid strong{font-size:20px}
  .event-chapter-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(240px,.55fr);gap:14px;margin-top:14px}.event-chapter-grid section{min-width:0}.event-chapter-grid h4,.event-vehicle-section h4{margin:0 0 8px;font-size:13px}
  .root-cause-list{display:grid;gap:5px}.root-cause-list>div{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;background:var(--surface-soft)}.event-meta{display:grid;gap:5px;margin:8px 0 0}.event-meta>div{display:grid;grid-template-columns:70px 1fr;gap:8px}.event-meta dt{color:var(--text-soft);font-size:11px}.event-meta dd{margin:0;overflow-wrap:anywhere}
  .event-vehicle-section{margin-top:14px}.event-vehicle-row{display:grid;grid-template-columns:1fr .7fr .7fr .7fr 1.8fr;gap:8px;padding:9px 11px;background:var(--surface-soft)}.event-vehicle-row.header{font-size:11px;font-weight:800;color:var(--text-soft);background:var(--surface-strong)}
  .event-provenance{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}.event-provenance summary{display:flex;align-items:center;gap:5px;cursor:pointer;color:var(--text-soft);font-size:12px}.event-provenance summary svg{width:15px}.event-provenance>div{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;color:var(--text-faint);font-size:10px}.event-mini-map-empty,.investigation-empty{min-height:150px;display:grid;place-items:center;align-content:center;gap:6px;text-align:center;color:var(--text-soft)}
  @media(max-width:760px){
    .investigation-workspace{padding:10px 10px 28px;gap:10px}.investigation-range-card,.investigation-report-hero,.investigation-event-chapter{border-radius:16px;padding:14px}
    .investigation-range-head,.investigation-report-hero,.report-card-title,.event-chapter-head{display:grid;grid-template-columns:1fr}.investigation-range-head>svg{display:none}
    .investigation-range-grid{grid-template-columns:1fr}.investigation-range-grid [data-slot="select-trigger"],.investigation-confirm,.report-actions button{width:100%}
    .investigation-report-hero{align-items:stretch}.report-actions{display:grid;grid-template-columns:1fr}.report-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.investigation-report-card.metric strong{font-size:23px}
    .group-summary-card,.report-map-card{padding:12px}.group-summary-table,.event-vehicle-table{overflow-x:auto}.group-summary-row{min-width:540px}.event-vehicle-row{min-width:650px}
    .investigation-overview-map{min-height:180px}.event-chapter-badges{justify-content:flex-start}.event-score-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.event-chapter-grid{grid-template-columns:1fr}.event-mini-map{min-height:180px}
    .event-chapters-title{padding:6px}.event-map-legend{max-height:76px;overflow:auto}.event-meta>div{grid-template-columns:62px 1fr}
  }
`;
