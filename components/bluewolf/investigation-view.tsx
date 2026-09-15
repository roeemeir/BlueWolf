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

function inputTimeToIso(value: string, name: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} אינו זמן תקין`);
  return date.toISOString();
}

async function requestEvents(server: string, from?: string, to?: string) {
  const query = new URLSearchParams({ serverId: server });
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const response = await fetch(`/api/investigation/events?${query.toString()}`, { cache: "no-store" });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `Investigation archive returned ${response.status}`;
    throw new Error(detail);
  }
  return normalizeInvestigationEvents(payload);
}

type ScoreSeries = {
  id: string;
  label: string;
  values: (number | null)[];
  strokeWidth: number;
  dash?: string;
};

function pathSegments(values: (number | null)[], width: number, height: number) {
  const denominator = Math.max(1, values.length - 1);
  const segments: string[] = [];
  let current = "";
  values.forEach((value, index) => {
    if (value === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    const x = index / denominator * width;
    const y = height - value / 100 * height;
    current += `${current ? " L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  });
  if (current) segments.push(current);
  return segments;
}

function ScoreTimeline({ result, cursor, onCursor }: { result: EventRecomputeResult; cursor: number; onCursor: (value: number) => void }) {
  const width = 900;
  const height = 240;
  const memberIds = Array.from(new Set(result.points.flatMap((point) => point.members.map((member) => member.memberId))));
  const dashPatterns = ["10 5", "4 4", "14 4 3 4", "2 5", "18 6"];
  const series: ScoreSeries[] = [
    { id: "group", label: "קבוצה · Total", values: result.points.map((point) => point.group.total), strokeWidth: 5 },
    ...memberIds.map((memberId, index) => ({
      id: memberId,
      label: `רכב ${memberId} · Total`,
      values: result.points.map((point) => point.members.find((member) => member.memberId === memberId)?.total ?? null),
      strokeWidth: 2.5,
      dash: dashPatterns[index % dashPatterns.length],
    })),
  ];
  const denominator = Math.max(1, result.points.length - 1);
  const cursorX = cursor / denominator * width;
  const cursorPoint = result.points[cursor];
  return <div style={{ marginTop: 14 }} data-requirements="BW-REP-004"><div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6, flexWrap: "wrap" }}><strong>Group + vehicle scores לאורך האירוע</strong><span>{result.scoredFrameCount} scored · {result.missingFrameCount} missing · {result.frameCount} total</span></div><div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>{series.map((item) => <span key={item.id} style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><svg width="34" height="8" aria-hidden="true"><line x1="0" x2="34" y1="4" y2="4" stroke="currentColor" strokeWidth={item.strokeWidth} strokeDasharray={item.dash} /></svg>{item.label}</span>)}</div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recomputed group and vehicle score timelines with one synchronized cursor" style={{ width: "100%", minHeight: 190 }}>{[0, 25, 50, 75, 100].map((score) => { const y = height - score / 100 * height; return <g key={score}><line x1="0" x2={width} y1={y} y2={y} stroke="currentColor" opacity=".12" /><text x="4" y={Math.max(12, y - 4)} fontSize="18" fill="currentColor" opacity=".6">{score}</text></g>; })}{series.map((item) => pathSegments(item.values, width, height).map((path, index) => <path key={`${item.id}-${index}`} d={path} fill="none" stroke="currentColor" strokeWidth={item.strokeWidth} strokeDasharray={item.dash} opacity={item.id === "group" ? 1 : .65} vectorEffect="non-scaling-stroke" />))}<line x1={cursorX} x2={cursorX} y1="0" y2={height} stroke="currentColor" strokeWidth="2" opacity=".45" /></svg><input aria-label="סליידר זמן אחיד לתחקור" type="range" min={0} max={Math.max(0, result.points.length - 1)} step={1} value={cursor} onChange={(event) => onCursor(Number(event.target.value))} style={{ width: "100%" }} /><div className="glass-panel" style={{ marginTop: 8, padding: 12 }}><strong>{cursorPoint ? formatTime(cursorPoint.observedAt) : "ללא frame"}</strong>{cursorPoint?.pendingReason ? <p>missing · {cursorPoint.pendingReason}</p> : cursorPoint ? <><p>Group: S {scoreLabel(cursorPoint.group.sync)} · R {scoreLabel(cursorPoint.group.route)} · T {scoreLabel(cursorPoint.group.total)}</p><div style={{ display: "grid", gap: 5 }}>{cursorPoint.members.map((member) => <span key={member.memberId}>{member.memberId} · {member.slotId} · S {scoreLabel(member.sync)} · R {scoreLabel(member.route)} · T {scoreLabel(member.total)}</span>)}</div></> : null}</div>{result.missingFrameCount > 0 && <p className="card-hint">פער בגרף פירושו evidence חסר בזמן אמת. ציר הזמן אינו נדחס והנקודות משני צדי הפער אינן מחוברות.</p>}</div>;
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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
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
    if ((from && !to) || (!from && to)) {
      toast.error("כדי לסנן טווח יש להזין גם התחלה וגם סוף");
      return;
    }
    let fromIso: string | undefined;
    let toIso: string | undefined;
    try {
      fromIso = inputTimeToIso(from, "זמן התחלה");
      toIso = inputTimeToIso(to, "זמן סוף");
      if (fromIso && toIso && fromIso > toIso) throw new Error("זמן ההתחלה חייב להיות מוקדם מזמן הסיום");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "טווח הזמן אינו תקין");
      return;
    }
    setEventsState({ kind: "loading", server });
    try {
      const loaded = await requestEvents(server, fromIso, toIso);
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

  return <div className="investigation-page" dir="rtl" data-requirements="BW-SYNC-009 BW-SYNC-010 BW-SYNC-011 BW-UI-006 BW-REP-001 BW-REP-003 BW-REP-004 BW-QA-005">
    <section className="glass-panel" style={{ padding: 18, marginBottom: 16 }}><header className="developer-section-header"><div><p className="eyebrow">Core Event Archive</p><h2>תחקור מבוסס נתוני מקור</h2><p>אירוע מוגדר כרצף שבו קבוצה שומרת על הקבוצתיות שלה. אירועים וציונים אינם נוצרים בדפדפן; שינוי תבנית מופעל רק דרך recomputation של Python Core על observations שנשמרו בזמן האירוע. נקודות שבהן evidence עדיין חסר נשמרות כ־missing ואינן נמחקות מהטווח.</p></div><div className="header-actions"><Select value={server} onValueChange={onServerChange}><SelectTrigger style={{ minWidth: 170 }}><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div></header><div style={{ display: "grid", gridTemplateColumns: "minmax(190px,1fr) minmax(190px,1fr) auto auto", gap: 10, alignItems: "end", marginTop: 14 }}><label style={{ display: "grid", gap: 5 }}><span>מתאריך ושעה</span><input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label style={{ display: "grid", gap: 5 }}><span>עד תאריך ושעה</span><input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label><Button variant="outline" onClick={loadEvents}><RefreshCw />טען טווח מהארכיון</Button><Button variant="ghost" onClick={() => { setFrom(""); setTo(""); void requestEvents(server).then((loaded) => { setEventsState({ kind: "ready", server, events: loaded.events, templates: loaded.templates }); chooseEvent(null, loaded.events, loaded.templates); }).catch((error) => setEventsState({ kind: "unavailable", server, detail: error instanceof Error ? error.message : "Investigation archive unavailable" })); }}>כל הארכיון</Button></div><p className="card-hint">הסינון נעשה ב־SQLite לפי אירועים שחופפים לטווח. אירוע שנבחר נשאר באורך המלא שלו ואינו נחתך מלאכותית בגבול הטווח.</p></section>

    {visibleState.kind === "loading" && <section className="glass-panel empty-state" style={{ padding: 32 }}><History /><strong>טוען event evidence…</strong><span>אין אחוז התקדמות ללא telemetry אמיתי.</span></section>}
    {visibleState.kind === "unavailable" && <section className="glass-panel empty-state" style={{ padding: 32 }}><AlertTriangle /><strong>ארכיון התחקור לא זמין</strong><span>{visibleState.detail}</span></section>}
    {visibleState.kind === "ready" && events.length === 0 && <section className="glass-panel empty-state" style={{ padding: 32 }}><ShieldCheck /><strong>אין אירועי SO שמורים בטווח</strong><span>לא מוצגים אירועי demo. שנה את הטווח או המתן ל־Core evidence אמיתי.</span></section>}
    {visibleState.kind === "ready" && events.length > 0 && coreTemplates.length === 0 && <section className="glass-panel empty-state" style={{ padding: 24, marginBottom: 16 }}><AlertTriangle /><strong>בנק תבניות Core לא זמין לשרת</strong><span>ניתן לראות אירועים, אך recomputation מושבת עד שה־runtime יחזיר template bank פעיל.</span></section>}

    {visibleState.kind === "ready" && events.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) minmax(0, 1fr)", gap: 16 }}><aside className="glass-panel" style={{ padding: 14 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><strong>אירועים</strong><Badge variant="outline">{events.length}</Badge></div><div style={{ display: "grid", gap: 8 }}>{events.map((event) => <button key={event.eventId} type="button" onClick={() => chooseEvent(event.eventId)} className={`event-list-item ${event.eventId === selectedEventId ? "active" : ""}`} style={{ textAlign: "right", width: "100%" }}><strong>{event.groupId}</strong><span>{formatTime(event.startAt)}</span><small>{event.frameCount} Core frames</small></button>)}</div></aside><section className="glass-panel" style={{ padding: 18 }}>{selectedEvent ? <><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><p className="eyebrow">{selectedEvent.eventId}</p><h3>קבוצה {selectedEvent.groupId}</h3><p>{formatTime(selectedEvent.startAt)} — {formatTime(selectedEvent.endAt)} · {selectedEvent.frameCount} frames</p></div><Badge variant="outline"><FileChartColumn />SO evidence</Badge></div><div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(260px, 1fr)", gap: 14, marginTop: 16 }}><label style={{ display: "grid", gap: 6 }}><span>תבנית לחישוב מחדש</span><Select value={templateId} onValueChange={(value) => { setTemplateId(value); setRecompute({ kind: "idle" }); }} disabled={coreTemplates.length === 0}><SelectTrigger><SelectValue placeholder="בחר תבנית SO מה-Core" /></SelectTrigger><SelectContent>{coreTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select><small>הרשימה מגיעה מבנק התבניות הפעיל של Python Core; הבחירה היא draft עד recomputation תקף.</small></label><label style={{ display: "grid", gap: 6 }}><span>הערת תחקור</span><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="הערה ידנית נשמרת בנפרד מהציון" /></label></div><div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}><Button onClick={applyTemplate} disabled={!templateId || coreTemplates.length === 0 || recompute.kind === "running"}><Play />{recompute.kind === "running" ? "מחשב מחדש…" : "החל תבנית וחשב מחדש"}</Button><Button variant="outline" onClick={saveNoteOnly}>שמור הערה בלבד</Button></div>{recompute.kind === "idle" && <div className="empty-state" style={{ marginTop: 18 }}><History /><strong>recompute not run</strong><span>הציון לא משתנה עד להרצת Core אמיתית.</span></div>}{recompute.kind === "running" && <div className="empty-state" style={{ marginTop: 18 }}><ShieldCheck /><strong>Core recomputation running</strong><span>אין progress מומצא; ממתין לתוצאה מלאה.</span></div>}{recompute.kind === "error" && <div className="empty-state" style={{ marginTop: 18 }}><AlertTriangle /><strong>החישוב מחדש נכשל</strong><span>{recompute.detail}</span></div>}{recompute.kind === "complete" && <RecomputeResultView key={recompute.result.runId} state={recompute} />}</> : <div className="empty-state"><History /><strong>בחר אירוע</strong></div>}</section></div>}
  </div>;
}

function RecomputeResultView({ state }: { state: Extract<RecomputeState, { kind: "complete" }> }) {
  const result = state.result;
  const [cursor, setCursor] = useState(Math.max(0, result.points.length - 1));
  const lastScored = [...result.points].reverse().find((point) => point.members.length > 0);
  return <div style={{ marginTop: 18 }}><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Badge variant={state.persisted ? "default" : "outline"}>{state.persisted ? <CheckCircle2 /> : <AlertTriangle />}{state.persisted ? "נשמר" : "לא נשמר ב-Workspace"}</Badge><Badge variant="outline">run {result.runId}</Badge><Badge variant="outline">template {result.templateId}</Badge><Badge variant="outline">tpl-ver {result.templateVersion.slice(0, 14)}</Badge><Badge variant="outline">code {result.codeVersion.slice(0, 10)}</Badge><Badge variant="outline">config {result.configVersion.slice(0, 10)}</Badge><Badge variant="outline">scored {result.scoredFrameCount}</Badge><Badge variant="outline">missing {result.missingFrameCount}</Badge></div><div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10, marginTop: 14 }}><div className="metric-card"><span>Sync ממוצע</span><strong>{scoreLabel(result.summary.sync)}</strong></div><div className="metric-card"><span>Route ממוצע</span><strong>{scoreLabel(result.summary.route)}</strong></div><div className="metric-card"><span>Total ממוצע</span><strong>{scoreLabel(result.summary.total)}</strong></div></div><ScoreTimeline result={result} cursor={cursor} onCursor={setCursor} /><div style={{ display: "grid", gridTemplateColumns: "minmax(220px, .8fr) minmax(0, 1.2fr)", gap: 14, marginTop: 16 }}><div><strong>Root causes</strong><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{result.rootCauses.length ? result.rootCauses.map((cause) => <div key={cause.reason} className="glass-panel" style={{ padding: 10, display: "flex", justifyContent: "space-between" }}><span>{cause.reason}</span><b>{cause.occurrences}</b></div>) : <span>אין primary reasons בריצה זו.</span>}</div></div><div><strong>מצב אחרון scoreable לפי רכב</strong><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{lastScored?.members.map((member) => <div key={member.memberId} className="glass-panel" style={{ padding: 10, display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 10 }}><span>{member.memberId} · {member.slotId}</span><b>S {scoreLabel(member.sync)}</b><b>R {scoreLabel(member.route)}</b><b>T {scoreLabel(member.total)}</b></div>) ?? <span>אין member frames scoreable.</span>}</div></div></div><div className="empty-state" style={{ marginTop: 16 }}><FileChartColumn /><strong>PDF truth-backed עדיין לא הופק</strong><span>הדוח לא יסומן מוכן עד ש־BW-REP/PDF יעבוד מאותם event frames ו־recompute results.</span></div></div>;
}
