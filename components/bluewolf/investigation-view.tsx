"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileChartColumn, History, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  normalizeEventRecompute,
  normalizeInvestigationEvents,
  type EventRecomputeResult,
  type InvestigationEventIndex,
  type InvestigationTemplate,
} from "@/lib/investigation-contract";
import { useWorkspace } from "./app-context";

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date(value));
  } catch {
    return value;
  }
}

function scoreLabel(value: number | null) {
  return value === null ? "missing" : value.toFixed(1);
}

async function requestEvents(server: string) {
  const response = await fetch(`/api/investigation/events?serverId=${encodeURIComponent(server)}`, { cache: "no-store" });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `Investigation archive returned ${response.status}`;
    throw new Error(detail);
  }
  return normalizeInvestigationEvents(payload);
}

function Timeline({ result }: { result: EventRecomputeResult }) {
  const width = 900;
  const height = 220;
  const denominator = Math.max(1, result.points.length - 1);
  const segments: string[] = [];
  const markers: { x: number; y: number; key: string }[] = [];
  let current = "";
  for (const [index, point] of result.points.entries()) {
    const value = point.group.total;
    if (value === null) {
      if (current) segments.push(current);
      current = "";
      continue;
    }
    const x = index / denominator * width;
    const y = height - value / 100 * height;
    current += `${current ? " L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    markers.push({ x, y, key: `${point.observedAt}-${index}` });
  }
  if (current) segments.push(current);
  if (!markers.length) return <div className="empty-state"><History /><strong>אין נקודות scoreable באירוע</strong><span>{result.missingFrameCount} frames נשמרו כ־missing ולא נמחקו מטווח האירוע.</span></div>;
  return <div style={{ marginTop: 14 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}><strong>ציון כולל לאורך האירוע</strong><span>{result.scoredFrameCount} scored · {result.missingFrameCount} missing · {result.frameCount} total</span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recomputed event score timeline with missing evidence gaps" style={{ width: "100%", minHeight: 180 }}>{[0, 25, 50, 75, 100].map((score) => { const y = height - score / 100 * height; return <g key={score}><line x1="0" x2={width} y1={y} y2={y} stroke="currentColor" opacity=".12" /><text x="4" y={Math.max(12, y - 4)} fontSize="18" fill="currentColor" opacity=".6">{score}</text></g>; })}{segments.map((path, index) => <path key={`${index}-${path}`} d={path} fill="none" stroke="currentColor" strokeWidth="5" vectorEffect="non-scaling-stroke" />)}{markers.map((marker) => <circle key={marker.key} cx={marker.x} cy={marker.y} r="4" fill="currentColor" />)}</svg>{result.missingFrameCount > 0 && <p className="card-hint">פער בגרף פירושו evidence חסר בזמן אמת. ציר הזמן אינו נדחס והנקודות משני צדי הפער אינן מחוברות.</p>}</div>;
}

type EventsState =
  | { kind: "loading"; server: string }
  | { kind: "unavailable"; server: string; detail: string }
  | { kind: "ready"; server: string; events: InvestigationEventIndex[]; templates: InvestigationTemplate[] };

type RecomputeState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; detail: string }
  | { kind: "complete"; result: EventRecomputeResult; persisted: boolean };

export function InvestigationView({ server, onServerChange }: { server: string; onServerChange: (value: string) => void }) {
  const { state, save } = useWorkspace();
  const [eventsState, setEventsState] = useState<EventsState>({ kind: "loading", server });
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [note, setNote] = useState("");
  const [recompute, setRecompute] = useState<RecomputeState>({ kind: "idle" });
  const visibleState: EventsState = eventsState.server === server ? eventsState : { kind: "loading", server };
  const events = visibleState.kind === "ready" ? visibleState.events : [];
  const coreTemplates = visibleState.kind === "ready" ? visibleState.templates : [];
  const selectedEvent = events.find((event) => event.eventId === selectedEventId) ?? null;

  const chooseEvent = (
    eventId: string | null,
    availableEvents: InvestigationEventIndex[] = events,
    availableTemplates: InvestigationTemplate[] = coreTemplates,
  ) => {
    const nextId = eventId && availableEvents.some((event) => event.eventId === eventId) ? eventId : (availableEvents[0]?.eventId ?? null);
    setSelectedEventId(nextId);
    const existing = nextId ? state.investigationEdits[nextId] : undefined;
    const existingIsActiveCoreTemplate = Boolean(existing?.templateId && availableTemplates.some((template) => template.id === existing.templateId));
    setTemplateId(existingIsActiveCoreTemplate ? existing!.templateId : (availableTemplates[0]?.id ?? ""));
    setNote(existing?.note ?? "");
    setRecompute({ kind: "idle" });
  };

  const loadEvents = async () => {
    setEventsState({ kind: "loading", server });
    try {
      const loaded = await requestEvents(server);
      setEventsState({ kind: "ready", server, events: loaded.events, templates: loaded.templates });
      chooseEvent(selectedEventId, loaded.events, loaded.templates);
    } catch (error) {
      setEventsState({ kind: "unavailable", server, detail: error instanceof Error ? error.message : "Investigation archive unavailable" });
      chooseEvent(null, [], []);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const loaded = await requestEvents(server);
        if (cancelled) return;
        setEventsState({ kind: "ready", server, events: loaded.events, templates: loaded.templates });
        const nextId = loaded.events[0]?.eventId ?? null;
        setSelectedEventId(nextId);
        const existing = nextId ? state.investigationEdits[nextId] : undefined;
        const existingIsActiveCoreTemplate = Boolean(existing?.templateId && loaded.templates.some((template) => template.id === existing.templateId));
        setTemplateId(existingIsActiveCoreTemplate ? existing!.templateId : (loaded.templates[0]?.id ?? ""));
        setNote(existing?.note ?? "");
        setRecompute({ kind: "idle" });
      } catch (error) {
        if (cancelled) return;
        setEventsState({ kind: "unavailable", server, detail: error instanceof Error ? error.message : "Investigation archive unavailable" });
        setSelectedEventId(null);
        setRecompute({ kind: "idle" });
      }
    };
    void bootstrap();
    return () => { cancelled = true; };
    // The server boundary controls archive retrieval. Workspace drafts are read after the async Core response arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  const applyTemplate = async () => {
    if (!selectedEvent || !templateId) return;
    setRecompute({ kind: "running" });
    try {
      const response = await fetch("/api/investigation/recompute", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({ eventId: selectedEvent.eventId, templateId, scenarioId: `investigation:${selectedEvent.eventId}` }),
      });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const detail = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `Recompute returned ${response.status}`;
        setRecompute({ kind: "error", detail });
        return;
      }
      const result = normalizeEventRecompute(payload);
      const next = { ...state, investigationEdits: { ...state.investigationEdits, [selectedEvent.eventId]: { note, templateId: result.templateId } } };
      const persisted = await save(next, "investigation", "recompute-template", `${result.eventId} · ${result.templateId} · ${result.runId}`);
      setRecompute({ kind: "complete", result, persisted });
      if (!persisted) toast.warning("החישוב הושלם ב-Core אך עריכת התחקור לא נשמרה ב-Workspace");
    } catch (error) {
      setRecompute({ kind: "error", detail: error instanceof Error ? error.message : "Core recomputation unavailable" });
    }
  };

  const saveNoteOnly = async () => {
    if (!selectedEvent) return;
    const existing = state.investigationEdits[selectedEvent.eventId];
    const next = { ...state, investigationEdits: { ...state.investigationEdits, [selectedEvent.eventId]: { note, templateId: existing?.templateId ?? "" } } };
    await save(next, "investigation", "save-note", selectedEvent.eventId);
  };

  return <div className="investigation-page" dir="rtl" data-requirements="BW-SYNC-009 BW-SYNC-010 BW-SYNC-011 BW-UI-006 BW-REP-001 BW-QA-005">
    <section className="glass-panel" style={{ padding: 18, marginBottom: 16 }}><header className="developer-section-header"><div><p className="eyebrow">Core Event Archive</p><h2>תחקור מבוסס נתוני מקור</h2><p>אירוע מוגדר כרצף שבו קבוצה שומרת על הקבוצתיות שלה. אירועים וציונים אינם נוצרים בדפדפן; שינוי תבנית מופעל רק דרך recomputation של Python Core על observations שנשמרו בזמן האירוע. נקודות שבהן evidence עדיין חסר נשמרות כ־missing ואינן נמחקות מהטווח.</p></div><div className="header-actions"><Select value={server} onValueChange={onServerChange}><SelectTrigger style={{ minWidth: 170 }}><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={loadEvents}><RefreshCw />רענן ארכיון</Button></div></header></section>

    {visibleState.kind === "loading" && <section className="glass-panel empty-state" style={{ padding: 32 }}><History /><strong>טוען event evidence…</strong><span>אין אחוז התקדמות ללא telemetry אמיתי.</span></section>}
    {visibleState.kind === "unavailable" && <section className="glass-panel empty-state" style={{ padding: 32 }}><AlertTriangle /><strong>ארכיון התחקור לא זמין</strong><span>{visibleState.detail}</span></section>}
    {visibleState.kind === "ready" && events.length === 0 && <section className="glass-panel empty-state" style={{ padding: 32 }}><ShieldCheck /><strong>אין אירועי SO שמורים</strong><span>לא מוצגים אירועי demo. לאחר שה-Core ישמור evidence, האירועים יופיעו כאן.</span></section>}
    {visibleState.kind === "ready" && events.length > 0 && coreTemplates.length === 0 && <section className="glass-panel empty-state" style={{ padding: 24, marginBottom: 16 }}><AlertTriangle /><strong>בנק תבניות Core לא זמין לשרת</strong><span>ניתן לראות אירועים, אך recomputation מושבת עד שה־runtime יחזיר template bank פעיל.</span></section>}

    {visibleState.kind === "ready" && events.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) minmax(0, 1fr)", gap: 16 }}><aside className="glass-panel" style={{ padding: 14 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><strong>אירועים</strong><Badge variant="outline">{events.length}</Badge></div><div style={{ display: "grid", gap: 8 }}>{events.map((event) => <button key={event.eventId} type="button" onClick={() => chooseEvent(event.eventId)} className={`event-list-item ${event.eventId === selectedEventId ? "active" : ""}`} style={{ textAlign: "right", width: "100%" }}><strong>{event.groupId}</strong><span>{formatTime(event.startAt)}</span><small>{event.frameCount} Core frames</small></button>)}</div></aside><section className="glass-panel" style={{ padding: 18 }}>{selectedEvent ? <><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><p className="eyebrow">{selectedEvent.eventId}</p><h3>קבוצה {selectedEvent.groupId}</h3><p>{formatTime(selectedEvent.startAt)} — {formatTime(selectedEvent.endAt)} · {selectedEvent.frameCount} frames</p></div><Badge variant="outline"><FileChartColumn />SO evidence</Badge></div><div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(260px, 1fr)", gap: 14, marginTop: 16 }}><label style={{ display: "grid", gap: 6 }}><span>תבנית לחישוב מחדש</span><Select value={templateId} onValueChange={(value) => { setTemplateId(value); setRecompute({ kind: "idle" }); }} disabled={coreTemplates.length === 0}><SelectTrigger><SelectValue placeholder="בחר תבנית SO מה-Core" /></SelectTrigger><SelectContent>{coreTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select><small>הרשימה מגיעה מבנק התבניות הפעיל של Python Core; הבחירה היא draft עד recomputation תקף.</small></label><label style={{ display: "grid", gap: 6 }}><span>הערת תחקור</span><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="הערה ידנית נשמרת בנפרד מהציון" /></label></div><div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}><Button onClick={applyTemplate} disabled={!templateId || coreTemplates.length === 0 || recompute.kind === "running"}><Play />{recompute.kind === "running" ? "מחשב מחדש…" : "החל תבנית וחשב מחדש"}</Button><Button variant="outline" onClick={saveNoteOnly}>שמור הערה בלבד</Button></div>{recompute.kind === "idle" && <div className="empty-state" style={{ marginTop: 18 }}><History /><strong>recompute not run</strong><span>הציון לא משתנה עד להרצת Core אמיתית.</span></div>}{recompute.kind === "running" && <div className="empty-state" style={{ marginTop: 18 }}><ShieldCheck /><strong>Core recomputation running</strong><span>אין progress מומצא; ממתין לתוצאה מלאה.</span></div>}{recompute.kind === "error" && <div className="empty-state" style={{ marginTop: 18 }}><AlertTriangle /><strong>החישוב מחדש נכשל</strong><span>{recompute.detail}</span></div>}{recompute.kind === "complete" && <RecomputeResultView state={recompute} />}</> : <div className="empty-state"><History /><strong>בחר אירוע</strong></div>}</section></div>}
  </div>;
}

function RecomputeResultView({ state }: { state: Extract<RecomputeState, { kind: "complete" }> }) {
  const result = state.result;
  const lastScored = [...result.points].reverse().find((point) => point.members.length > 0);
  return <div style={{ marginTop: 18 }}><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Badge variant={state.persisted ? "default" : "outline"}>{state.persisted ? <CheckCircle2 /> : <AlertTriangle />}{state.persisted ? "נשמר" : "לא נשמר ב-Workspace"}</Badge><Badge variant="outline">run {result.runId}</Badge><Badge variant="outline">template {result.templateId}</Badge><Badge variant="outline">tpl-ver {result.templateVersion.slice(0, 14)}</Badge><Badge variant="outline">code {result.codeVersion.slice(0, 10)}</Badge><Badge variant="outline">config {result.configVersion.slice(0, 10)}</Badge><Badge variant="outline">scored {result.scoredFrameCount}</Badge><Badge variant="outline">missing {result.missingFrameCount}</Badge></div><div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10, marginTop: 14 }}><div className="metric-card"><span>Sync ממוצע</span><strong>{scoreLabel(result.summary.sync)}</strong></div><div className="metric-card"><span>Route ממוצע</span><strong>{scoreLabel(result.summary.route)}</strong></div><div className="metric-card"><span>Total ממוצע</span><strong>{scoreLabel(result.summary.total)}</strong></div></div><Timeline result={result} /><div style={{ display: "grid", gridTemplateColumns: "minmax(220px, .8fr) minmax(0, 1.2fr)", gap: 14, marginTop: 16 }}><div><strong>Root causes</strong><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{result.rootCauses.length ? result.rootCauses.map((cause) => <div key={cause.reason} className="glass-panel" style={{ padding: 10, display: "flex", justifyContent: "space-between" }}><span>{cause.reason}</span><b>{cause.occurrences}</b></div>) : <span>אין primary reasons בריצה זו.</span>}</div></div><div><strong>מצב אחרון scoreable לפי רכב</strong><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{lastScored?.members.map((member) => <div key={member.memberId} className="glass-panel" style={{ padding: 10, display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 10 }}><span>{member.memberId} · {member.slotId}</span><b>S {scoreLabel(member.sync)}</b><b>R {scoreLabel(member.route)}</b><b>T {scoreLabel(member.total)}</b></div>) ?? <span>אין member frames scoreable.</span>}</div></div></div><div className="empty-state" style={{ marginTop: 16 }}><FileChartColumn /><strong>PDF truth-backed עדיין לא הופק</strong><span>הדוח לא יסומן מוכן עד ש־BW-REP/PDF יעבוד מאותם event frames ו־recompute results.</span></div></div>;
}
