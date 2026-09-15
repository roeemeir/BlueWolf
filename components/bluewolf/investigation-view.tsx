"use client";

import { useEffect, useMemo, useState } from "react";
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
} from "@/lib/investigation-contract";
import { useWorkspace } from "./app-context";

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat("he-IL", {
      dateStyle: "short",
      timeStyle: "medium",
      hour12: false,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function scoreLabel(value: number | null) {
  return value === null ? "missing" : value.toFixed(1);
}

function Timeline({ result }: { result: EventRecomputeResult }) {
  const values = result.points
    .map((point, index) => ({ index, value: point.group.total }))
    .filter((item): item is { index: number; value: number } => item.value !== null);
  if (values.length < 2) return <div className="empty-state"><History /><strong>אין מספיק נקודות לגרף</strong><span>ה־Core החזיר {result.points.length} frame(s).</span></div>;
  const width = 900;
  const height = 220;
  const path = values.map((item, order) => {
    const x = values.length === 1 ? width / 2 : (order / (values.length - 1)) * width;
    const y = height - (item.value / 100) * height;
    return `${order ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return <div style={{ marginTop: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}><strong>ציון כולל לאורך האירוע</strong><span>{result.points.length} frames מה־Core</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recomputed event score timeline" style={{ width: "100%", minHeight: 180 }}>
      {[0, 25, 50, 75, 100].map((score) => {
        const y = height - score / 100 * height;
        return <g key={score}><line x1="0" x2={width} y1={y} y2={y} stroke="currentColor" opacity=".12" /><text x="4" y={Math.max(12, y - 4)} fontSize="18" fill="currentColor" opacity=".6">{score}</text></g>;
      })}
      <path d={path} fill="none" stroke="currentColor" strokeWidth="5" vectorEffect="non-scaling-stroke" />
    </svg>
  </div>;
}

type EventsState =
  | { kind: "loading" }
  | { kind: "unavailable"; detail: string }
  | { kind: "ready"; events: InvestigationEventIndex[] };

type RecomputeState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; detail: string }
  | { kind: "complete"; result: EventRecomputeResult; persisted: boolean };

export function InvestigationView({ server, onServerChange }: { server: string; onServerChange: (value: string) => void }) {
  const { state, save } = useWorkspace();
  const [eventsState, setEventsState] = useState<EventsState>({ kind: "loading" });
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [note, setNote] = useState("");
  const [recompute, setRecompute] = useState<RecomputeState>({ kind: "idle" });
  const templates = useMemo(() => state.templates.filter((template) => template.family === "SO"), [state.templates]);
  const events = eventsState.kind === "ready" ? eventsState.events : [];
  const selectedEvent = events.find((event) => event.eventId === selectedEventId) ?? null;

  const loadEvents = async () => {
    setEventsState({ kind: "loading" });
    setRecompute({ kind: "idle" });
    try {
      const response = await fetch(`/api/investigation/events?serverId=${encodeURIComponent(server)}`, { cache: "no-store" });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const detail = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `Investigation archive returned ${response.status}`;
        setEventsState({ kind: "unavailable", detail });
        setSelectedEventId(null);
        return;
      }
      const normalized = normalizeInvestigationEvents(payload);
      setEventsState({ kind: "ready", events: normalized.events });
      setSelectedEventId((current) => current && normalized.events.some((event) => event.eventId === current) ? current : (normalized.events[0]?.eventId ?? null));
    } catch (error) {
      setEventsState({ kind: "unavailable", detail: error instanceof Error ? error.message : "Investigation archive unavailable" });
      setSelectedEventId(null);
    }
  };

  useEffect(() => {
    void loadEvents();
    // Server changes are the only automatic archive reload. Manual refresh uses loadEvents directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  useEffect(() => {
    if (!selectedEventId) {
      setTemplateId(templates[0]?.id ?? "");
      setNote("");
      setRecompute({ kind: "idle" });
      return;
    }
    const existing = state.investigationEdits[selectedEventId];
    setTemplateId(existing?.templateId || templates[0]?.id || "");
    setNote(existing?.note ?? "");
    setRecompute({ kind: "idle" });
  }, [selectedEventId, state.investigationEdits, templates]);

  const applyTemplate = async () => {
    if (!selectedEvent || !templateId) return;
    setRecompute({ kind: "running" });
    try {
      const response = await fetch("/api/investigation/recompute", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          eventId: selectedEvent.eventId,
          templateId,
          scenarioId: `investigation:${selectedEvent.eventId}`,
        }),
      });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const detail = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `Recompute returned ${response.status}`;
        setRecompute({ kind: "error", detail });
        return;
      }
      const result = normalizeEventRecompute(payload);
      const next = {
        ...state,
        investigationEdits: {
          ...state.investigationEdits,
          [selectedEvent.eventId]: { note, templateId: result.templateId },
        },
      };
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
    const next = {
      ...state,
      investigationEdits: {
        ...state.investigationEdits,
        [selectedEvent.eventId]: { note, templateId: existing?.templateId ?? "" },
      },
    };
    await save(next, "investigation", "save-note", selectedEvent.eventId);
  };

  return <div className="investigation-page" dir="rtl" data-requirements="BW-SYNC-009 BW-SYNC-010 BW-SYNC-011 BW-UI-006 BW-REP-001 BW-QA-005">
    <section className="glass-panel" style={{ padding: 18, marginBottom: 16 }}>
      <header className="developer-section-header">
        <div><p className="eyebrow">Core Event Archive</p><h2>תחקור מבוסס נתוני מקור</h2><p>אירועים וציונים אינם נוצרים בדפדפן. שינוי תבנית מופעל רק דרך recomputation של Python Core על observations שנשמרו בזמן האירוע.</p></div>
        <div className="header-actions">
          <Select value={server} onValueChange={onServerChange}><SelectTrigger style={{ minWidth: 170 }}><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
          <Button variant="outline" onClick={loadEvents}><RefreshCw />רענן ארכיון</Button>
        </div>
      </header>
    </section>

    {eventsState.kind === "loading" && <section className="glass-panel empty-state" style={{ padding: 32 }}><History /><strong>טוען event evidence…</strong><span>אין אחוז התקדמות ללא telemetry אמיתי.</span></section>}
    {eventsState.kind === "unavailable" && <section className="glass-panel empty-state" style={{ padding: 32 }}><AlertTriangle /><strong>ארכיון התחקור לא זמין</strong><span>{eventsState.detail}</span></section>}
    {eventsState.kind === "ready" && events.length === 0 && <section className="glass-panel empty-state" style={{ padding: 32 }}><ShieldCheck /><strong>אין אירועי SO שמורים</strong><span>לא מוצגים אירועי demo. לאחר שה-Core ישמור evidence, האירועים יופיעו כאן.</span></section>}

    {eventsState.kind === "ready" && events.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) minmax(0, 1fr)", gap: 16 }}>
      <aside className="glass-panel" style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><strong>אירועים</strong><Badge variant="outline">{events.length}</Badge></div>
        <div style={{ display: "grid", gap: 8 }}>{events.map((event) => <button key={event.eventId} type="button" onClick={() => setSelectedEventId(event.eventId)} className={`event-list-item ${event.eventId === selectedEventId ? "active" : ""}`} style={{ textAlign: "right", width: "100%" }}><strong>{event.groupId}</strong><span>{formatTime(event.startAt)}</span><small>{event.frameCount} Core frames</small></button>)}</div>
      </aside>

      <section className="glass-panel" style={{ padding: 18 }}>
        {selectedEvent ? <>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div><p className="eyebrow">{selectedEvent.eventId}</p><h3>קבוצה {selectedEvent.groupId}</h3><p>{formatTime(selectedEvent.startAt)} — {formatTime(selectedEvent.endAt)} · {selectedEvent.frameCount} frames</p></div>
            <Badge variant="outline"><FileChartColumn />SO evidence</Badge>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(260px, 1fr)", gap: 14, marginTop: 16 }}>
            <label style={{ display: "grid", gap: 6 }}><span>תבנית לחישוב מחדש</span><Select value={templateId} onValueChange={(value) => { setTemplateId(value); setRecompute({ kind: "idle" }); }}><SelectTrigger><SelectValue placeholder="בחר תבנית SO" /></SelectTrigger><SelectContent>{templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select><small>הבחירה היא draft בלבד עד שה-Core מחזיר recomputation תקף.</small></label>
            <label style={{ display: "grid", gap: 6 }}><span>הערת תחקור</span><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="הערה ידנית נשמרת בנפרד מהציון" /></label>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}><Button onClick={applyTemplate} disabled={!templateId || recompute.kind === "running"}><Play />{recompute.kind === "running" ? "מחשב מחדש…" : "החל תבנית וחשב מחדש"}</Button><Button variant="outline" onClick={saveNoteOnly}>שמור הערה בלבד</Button></div>

          {recompute.kind === "idle" && <div className="empty-state" style={{ marginTop: 18 }}><History /><strong>recompute not run</strong><span>הציון לא משתנה עד להרצת Core אמיתית.</span></div>}
          {recompute.kind === "running" && <div className="empty-state" style={{ marginTop: 18 }}><ShieldCheck /><strong>Core recomputation running</strong><span>אין progress מומצא; ממתין לתוצאה מלאה.</span></div>}
          {recompute.kind === "error" && <div className="empty-state" style={{ marginTop: 18 }}><AlertTriangle /><strong>החישוב מחדש נכשל</strong><span>{recompute.detail}</span></div>}
          {recompute.kind === "complete" && <RecomputeResultView state={recompute} />}
        </> : <div className="empty-state"><History /><strong>בחר אירוע</strong></div>}
      </section>
    </div>}
  </div>;
}

function RecomputeResultView({ state }: { state: Extract<RecomputeState, { kind: "complete" }> }) {
  const result = state.result;
  const last = result.points.at(-1);
  return <div style={{ marginTop: 18 }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Badge variant={state.persisted ? "default" : "outline"}>{state.persisted ? <CheckCircle2 /> : <AlertTriangle />}{state.persisted ? "נשמר" : "לא נשמר ב-Workspace"}</Badge>
      <Badge variant="outline">run {result.runId}</Badge><Badge variant="outline">template {result.templateId}</Badge><Badge variant="outline">tpl-ver {result.templateVersion.slice(0, 14)}</Badge><Badge variant="outline">code {result.codeVersion.slice(0, 10)}</Badge><Badge variant="outline">config {result.configVersion.slice(0, 10)}</Badge>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10, marginTop: 14 }}>
      <div className="metric-card"><span>Sync ממוצע</span><strong>{scoreLabel(result.summary.sync)}</strong></div>
      <div className="metric-card"><span>Route ממוצע</span><strong>{scoreLabel(result.summary.route)}</strong></div>
      <div className="metric-card"><span>Total ממוצע</span><strong>{scoreLabel(result.summary.total)}</strong></div>
    </div>
    <Timeline result={result} />
    <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, .8fr) minmax(0, 1.2fr)", gap: 14, marginTop: 16 }}>
      <div><strong>Root causes</strong><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{result.rootCauses.length ? result.rootCauses.map((cause) => <div key={cause.reason} className="glass-panel" style={{ padding: 10, display: "flex", justifyContent: "space-between" }}><span>{cause.reason}</span><b>{cause.occurrences}</b></div>) : <span>אין primary reasons בריצה זו.</span>}</div></div>
      <div><strong>מצב אחרון לפי רכב</strong><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{last?.members.map((member) => <div key={member.memberId} className="glass-panel" style={{ padding: 10, display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 10 }}><span>{member.memberId} · {member.slotId}</span><b>S {scoreLabel(member.sync)}</b><b>R {scoreLabel(member.route)}</b><b>T {scoreLabel(member.total)}</b></div>) ?? <span>אין member frames.</span>}</div></div>
    </div>
    <div className="empty-state" style={{ marginTop: 16 }}><FileChartColumn /><strong>PDF truth-backed עדיין לא הופק</strong><span>הדוח לא יסומן מוכן עד ש־BW-REP/PDF יעבוד מאותם event frames ו־recompute results.</span></div>
  </div>;
}
