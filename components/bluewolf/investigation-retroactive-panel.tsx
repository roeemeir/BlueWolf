"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, History, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  normalizeEventRecompute,
  normalizeInvestigationEvents,
  type InvestigationEventIndex,
  type InvestigationTemplate,
} from "@/lib/investigation-contract";
import { applyRetroactiveTemplateBatch } from "@/lib/investigation-retroactive";
import { useWorkspace } from "./app-context";

type InvestigationEdit = { note: string; templateId: string; arena?: string };
type ArchiveState = { server: string; events: InvestigationEventIndex[]; templates: InvestigationTemplate[] };
type SelectionState = { server: string; ids: string[] };
type TemplateState = { server: string; id: string };
type RunState =
  | { kind: "idle" }
  | { kind: "running"; count: number }
  | { kind: "error"; detail: string }
  | { kind: "complete"; count: number; persisted: boolean };

function localTimeToIso(value: string, name: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${name} אינו זמן תקין`);
  return parsed.toISOString();
}

async function fetchArchive(server: string, from?: string, to?: string) {
  const query = new URLSearchParams({ serverId: server });
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const response = await fetch(`/api/investigation/events?${query.toString()}`, { cache: "no-store" });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : `Investigation archive returned ${response.status}`;
    throw new Error(detail);
  }
  return normalizeInvestigationEvents(payload);
}

export function InvestigationRetroactivePanel({ server }: { server: string }) {
  const { state, save } = useWorkspace();
  const [archive, setArchive] = useState<ArchiveState | null>(null);
  const [selection, setSelection] = useState<SelectionState>({ server, ids: [] });
  const [template, setTemplate] = useState<TemplateState>({ server, id: "" });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [run, setRun] = useState<RunState>({ kind: "idle" });

  const visibleArchive = archive?.server === server ? archive : null;
  const selectedIds = selection.server === server ? selection.ids : [];
  const templateId = template.server === server ? template.id : "";
  const events = visibleArchive?.events ?? [];
  const templates = visibleArchive?.templates ?? [];

  useEffect(() => {
    let cancelled = false;
    void fetchArchive(server).then((loaded) => {
      if (cancelled) return;
      setArchive({ server, events: loaded.events, templates: loaded.templates });
      setLoadError(null);
    }).catch((error) => {
      if (cancelled) return;
      setLoadError(error instanceof Error ? error.message : "Investigation archive unavailable");
    });
    return () => { cancelled = true; };
  }, [server]);

  const loadRange = async () => {
    try {
      if ((from && !to) || (!from && to)) throw new Error("כדי לסנן טווח יש להזין גם התחלה וגם סוף");
      const fromIso = localTimeToIso(from, "זמן התחלה");
      const toIso = localTimeToIso(to, "זמן סוף");
      if (fromIso && toIso && fromIso > toIso) throw new Error("זמן ההתחלה חייב להיות מוקדם מזמן הסיום");
      const loaded = await fetchArchive(server, fromIso, toIso);
      setArchive({ server, events: loaded.events, templates: loaded.templates });
      setSelection({ server, ids: [] });
      setRun({ kind: "idle" });
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Investigation archive unavailable");
    }
  };

  const toggleEvent = (eventId: string) => {
    const current = selection.server === server ? selection.ids : [];
    const ids = current.includes(eventId) ? current.filter((id) => id !== eventId) : [...current, eventId];
    setSelection({ server, ids });
    setRun({ kind: "idle" });
  };

  const applyRetroactively = async () => {
    const selectedEvents = events.filter((event) => selectedIds.includes(event.eventId));
    if (!selectedEvents.length || !templateId) return;
    setRun({ kind: "running", count: selectedEvents.length });
    const batchId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
    try {
      const outcome = await applyRetroactiveTemplateBatch({
        candidates: selectedEvents.map((event) => ({ eventId: event.eventId, serverId: event.serverId })),
        templateId,
        recompute: async (eventId, requestedTemplateId) => {
          const response = await fetch("/api/investigation/recompute", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            cache: "no-store",
            body: JSON.stringify({
              eventId,
              templateId: requestedTemplateId,
              scenarioId: `retroactive:${batchId}:${eventId}`,
            }),
          });
          const payload = await response.json() as unknown;
          if (!response.ok) {
            const detail = payload && typeof payload === "object" && "error" in payload
              ? String((payload as { error: unknown }).error)
              : `Core recomputation returned ${response.status}`;
            throw new Error(`${eventId}: ${detail}`);
          }
          return normalizeEventRecompute(payload);
        },
        persist: async (results) => {
          const currentEdits = state.investigationEdits as Record<string, InvestigationEdit>;
          const nextEdits: Record<string, InvestigationEdit> = { ...currentEdits };
          for (const result of results) {
            const existing = currentEdits[result.eventId];
            nextEdits[result.eventId] = {
              note: existing?.note ?? "",
              templateId: result.templateId,
              ...(existing?.arena ? { arena: existing.arena } : {}),
            };
          }
          const next = { ...state, investigationEdits: nextEdits };
          return save(next, "investigation", "retroactive-template", `${templateId} · ${results.length} events · ${batchId}`);
        },
      });
      setRun({ kind: "complete", count: outcome.results.length, persisted: outcome.persisted });
    } catch (error) {
      setRun({ kind: "error", detail: error instanceof Error ? error.message : "Retroactive recomputation failed" });
    }
  };

  return <section className="glass-panel" dir="rtl" style={{ padding: 18, marginBottom: 16 }} data-requirements="BW-REP-007">
    <header className="developer-section-header">
      <div>
        <p className="eyebrow">Retroactive correction</p>
        <h3>החלת תיקון תבנית על אירועים נבחרים</h3>
        <p>רק האירועים שסומנו נכללים. כל אירוע עובר recomputation אמיתי ב־Core; השינוי נשמר ב־Workspace רק אם כל האירועים עברו את בדיקת ה־provenance.</p>
      </div>
      <Badge variant="outline"><RotateCcw />BW-REP-007</Badge>
    </header>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(180px,1fr) auto", gap: 10, alignItems: "end", marginTop: 12 }}>
      <label style={{ display: "grid", gap: 5 }}><span>מתאריך ושעה</span><input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label style={{ display: "grid", gap: 5 }}><span>עד תאריך ושעה</span><input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <Button variant="outline" onClick={loadRange}><History />טען אירועים לבחירה</Button>
    </div>

    {loadError && <div className="empty-state" style={{ marginTop: 12 }}><AlertTriangle /><strong>לא ניתן לטעון את הארכיון</strong><span>{loadError}</span></div>}
    {!visibleArchive && !loadError && <div className="empty-state" style={{ marginTop: 12 }}><History /><strong>טוען אירועים אמיתיים…</strong><span>אין אירועי demo.</span></div>}

    {visibleArchive && <>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,1fr) auto auto", gap: 10, alignItems: "end", marginTop: 14 }}>
        <label style={{ display: "grid", gap: 5 }}><span>תבנית מתוקנת</span><Select value={templateId || undefined} onValueChange={(id) => { setTemplate({ server, id }); setRun({ kind: "idle" }); }}><SelectTrigger><SelectValue placeholder="בחר תבנית מה-Core" /></SelectTrigger><SelectContent>{templates.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
        <Button variant="ghost" onClick={() => { setSelection({ server, ids: events.map((event) => event.eventId) }); setRun({ kind: "idle" }); }} disabled={!events.length}>בחר את כל הטווח</Button>
        <Button variant="ghost" onClick={() => { setSelection({ server, ids: [] }); setRun({ kind: "idle" }); }} disabled={!selectedIds.length}>נקה בחירה</Button>
      </div>

      <div style={{ display: "grid", gap: 7, marginTop: 12 }}>
        {events.length ? events.map((event) => <label key={event.eventId} className="glass-panel" style={{ padding: 10, display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 10 }}>
          <input type="checkbox" checked={selectedIds.includes(event.eventId)} onChange={() => toggleEvent(event.eventId)} />
          <span><strong>{event.groupId}</strong><br /><small>{event.startAt} — {event.endAt}</small></span>
          <small>{event.activeTemplateId ? `מקור: ${event.activeTemplateId}` : "מקור תבנית חסר"}</small>
        </label>) : <div className="empty-state"><History /><strong>אין אירועים בטווח</strong><span>לא נוצרים אירועים מלאכותיים לצורך תיקון.</span></div>}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
        <Button onClick={applyRetroactively} disabled={!selectedIds.length || !templateId || run.kind === "running"}><RotateCcw />{run.kind === "running" ? "מאמת ב-Core…" : `החל על ${selectedIds.length} אירועים נבחרים`}</Button>
        <span className="card-hint">אין שמירה חלקית: batch edit נשמר רק לאחר שכל האירועים עברו recomputation תקף.</span>
      </div>

      {run.kind === "error" && <div className="empty-state" style={{ marginTop: 12 }}><AlertTriangle /><strong>התיקון הרטרואקטיבי לא הוחל</strong><span>{run.detail}</span><small>ריצות Core שכבר בוצעו נשארות כהיסטוריית אימות, אך לא נשמר batch edit ב־Workspace.</small></div>}
      {run.kind === "complete" && <div className="empty-state" style={{ marginTop: 12 }}>{run.persisted ? <CheckCircle2 /> : <AlertTriangle />}<strong>{run.persisted ? `התיקון נשמר ל־${run.count} אירועים` : "ה־Core אימת את כל האירועים, אך השמירה לא הושלמה"}</strong><span>{run.persisted ? "כל האירועים שנבחרו משתמשים כעת בתבנית המתוקנת בתחקור ובדוחות עתידיים." : "העריכה לא הופעלה ב־Workspace."}</span></div>}
    </>}
  </section>;
}
