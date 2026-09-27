"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, History, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  normalizeInvestigationEvents,
  type EventLifecycle,
  type EventLifecycleChange,
  type InvestigationEventIndex,
} from "@/lib/investigation-contract";

function formatTime(value: string | null) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusLabel(status: EventLifecycle["status"]) {
  if (status === "active") return "פעיל";
  if (status === "finalizing") return "ממתין ל-finalization";
  if (status === "closed") return "סגור";
  return "Lifecycle לא קיים בארכיון";
}

function reasonLabel(reason: string | null) {
  if (reason === "group_became_active") return "הקבוצה הפכה לפעילה";
  if (reason === "context_changed") return "הקשר האירוע השתנה";
  if (reason === "structural_group_ended") return "הקבוצה המבנית הסתיימה";
  if (reason === "group_inactive") return "הקבוצה אינה פעילה";
  return reason || "—";
}

function changeLabel(change: EventLifecycleChange) {
  const details = change.details;
  const kind = change.kind;
  if (kind === "event_opened") return `פתיחת אירוע · ${reasonLabel(typeof details.reason === "string" ? details.reason : null)}`;
  if (kind === "event_ending") return `סיום תפעולי · ${reasonLabel(typeof details.reason === "string" ? details.reason : null)}`;
  if (kind === "event_closed") return `אירוע נסגר סופית · ${reasonLabel(typeof details.reason === "string" ? details.reason : null)}`;
  if (kind === "alert_opened") return `התראת ${String(details.alert_type ?? "alert")} נפתחה · score ${String(details.score ?? "—")}`;
  if (kind === "alert_closed") return `התראת ${String(details.alert_type ?? "alert")} נסגרה · ${String(details.reason ?? details.score ?? "")}`;
  if (kind === "template_suggested") return `הומלצה תבנית ${String(details.suggested_template_id ?? "—")} · יתרון ${String(details.advantage ?? "—")}`;
  if (kind === "template_suggestion_closed") return `המלצת תבנית נסגרה · ${String(details.suggested_template_id ?? "—")}`;
  if (kind === "template_suggestion_rejected") return `המלצת תבנית נדחתה על ידי המפעיל · ${String(details.suggested_template_id ?? "—")}`;
  return kind;
}

type LifecycleState =
  | { kind: "loading"; server: string }
  | { kind: "error"; server: string; detail: string }
  | { kind: "ready"; server: string; events: InvestigationEventIndex[] };

async function loadLifecycleEvents(server: string) {
  const response = await fetch(`/api/investigation/events?serverId=${encodeURIComponent(server)}`, { cache: "no-store" });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `Investigation archive returned ${response.status}`;
    throw new Error(detail);
  }
  return normalizeInvestigationEvents(payload).events;
}

function LifecycleEvent({ event }: { event: InvestigationEventIndex }) {
  const lifecycle = event.lifecycle;
  const alertAndRecommendationChanges = lifecycle.changes.filter((change) =>
    change.kind.startsWith("alert_") || change.kind.startsWith("template_"),
  );
  return <article className="glass-panel" style={{ padding: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <div><strong>{event.groupId}</strong><div className="card-hint">{event.eventId}</div></div>
      <Badge variant="outline">{statusLabel(lifecycle.status)}</Badge>
    </div>
    {lifecycle.status === "unknown" ? <p className="card-hint" style={{ marginTop: 8 }}>זהו אירוע legacy ללא lifecycle evidence. המערכת אינה מסיקה שהוא פעיל ואינה ממציאה סיבת פתיחה או סיום.</p> : <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 10 }}>
        <div><small>פתיחה</small><div>{formatTime(lifecycle.openedAt)}</div><div className="card-hint">{reasonLabel(lifecycle.openingReason)}</div></div>
        <div><small>סיום תפעולי</small><div>{formatTime(lifecycle.endedAt)}</div><div className="card-hint">{reasonLabel(lifecycle.endingReason)}</div></div>
        <div><small>Finalize at</small><div>{formatTime(lifecycle.finalizeAt)}</div></div>
        <div><small>Closed</small><div>{formatTime(lifecycle.closedAt)}</div></div>
      </div>
      <div style={{ display: "grid", gap: 5, marginTop: 10 }}>
        {alertAndRecommendationChanges.length ? alertAndRecommendationChanges.map((change, index) => <div key={`${change.occurredAt}-${change.kind}-${index}`} style={{ display: "grid", gridTemplateColumns: "170px minmax(0,1fr)", gap: 8 }}><span className="card-hint">{formatTime(change.occurredAt)}</span><span>{changeLabel(change)}</span></div>) : <span className="card-hint">לא נשמרו התראות או המלצות template באירוע.</span>}
      </div>
    </>}
  </article>;
}

export function InvestigationLifecyclePanel({ server }: { server: string }) {
  const [state, setState] = useState<LifecycleState>({ kind: "loading", server });

  const refresh = async () => {
    setState({ kind: "loading", server });
    try {
      setState({ kind: "ready", server, events: await loadLifecycleEvents(server) });
    } catch (error) {
      setState({ kind: "error", server, detail: error instanceof Error ? error.message : "Lifecycle archive unavailable" });
    }
  };

  useEffect(() => {
    let cancelled = false;
    loadLifecycleEvents(server).then(
      (events) => { if (!cancelled) setState({ kind: "ready", server, events }); },
      (error: unknown) => {
        if (!cancelled) setState({ kind: "error", server, detail: error instanceof Error ? error.message : "Lifecycle archive unavailable" });
      },
    );
    return () => { cancelled = true; };
  }, [server]);

  const displayState: LifecycleState = state.server === server ? state : { kind: "loading", server };

  return <section className="glass-panel" dir="rtl" data-requirements="REP-03 REP-04" style={{ padding: 16, marginBottom: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
      <div><p className="eyebrow">Event Lifecycle Evidence</p><h3>פתיחה, סיום, התראות והמלצות</h3><p className="card-hint">המידע מגיע מ־EventAlertEngine ונשמר ב־SQLite לצד event evidence. `finalizing` פירושו שהאירוע הסתיים תפעולית אך חלון ה־late-data טרם נסגר.</p></div>
      <Button variant="outline" onClick={refresh} disabled={displayState.kind === "loading"}><RefreshCw />רענן</Button>
    </div>
    {displayState.kind === "loading" && <div className="empty-state" style={{ padding: 20 }}><History /><strong>טוען lifecycle evidence…</strong><span>אין progress מומצא.</span></div>}
    {displayState.kind === "error" && <div className="empty-state" style={{ padding: 20 }}><AlertTriangle /><strong>Lifecycle archive לא זמין</strong><span>{displayState.detail}</span></div>}
    {displayState.kind === "ready" && displayState.events.length === 0 && <div className="empty-state" style={{ padding: 20 }}><Activity /><strong>אין אירועים שמורים</strong><span>לא מוצג lifecycle demo.</span></div>}
    {displayState.kind === "ready" && displayState.events.length > 0 && <div style={{ display: "grid", gap: 10, marginTop: 12 }}>{displayState.events.map((event) => <LifecycleEvent key={event.eventId} event={event} />)}</div>}
  </section>;
}
