"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, Check, Clock3, Expand, Focus, History, Layers3, Pause, Play, Radio, Settings2, TriangleAlert, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getServerScenario, type DataMode, type DemoGroup, type SyncTemplate, type VehicleType } from "@/lib/bluewolf";
import { type DisplaySmoothingSeconds, smoothRuntimeHistoryForDisplay } from "@/lib/display-score-smoothing";
import { normalizeEventRecompute, normalizeInvestigationEvents, type EventRecomputeResult } from "@/lib/investigation-contract";
import { getRuntimeGroups } from "@/lib/live-runtime";
import { getLiveRuntimeHistory } from "@/lib/live-runtime-history";
import { groupFromEventRecompute, historyWithEventRecompute, sameRecomputeVersion } from "@/lib/operator-retroactive-result";
import { simulationActiveEventId } from "@/lib/simulation-investigation";
import { workspaceScopeId, type GroupScopedSettings, type ServerScopedSettings } from "@/lib/scoped-workspace-settings";
import { formatKnotsFromKmh, formatKnotsFromMps } from "@/lib/speed-units";
import { readWorkspaceScope, writeWorkspaceScope } from "@/lib/workspace-scope-client";
import { useWorkspace } from "./app-context";
import { OperationalLiveMap } from "./operational-live-map";
import { OperationalTimeline } from "./operational-timeline";
import { GovernedLiveMap, GovernedTemplatePreview } from "./so-governed-visuals";
import { SimulationTimeline } from "./simulation-timeline";
import { ScoreRing, VehicleIconGlyph, type GroupKey, type ScoreLayer } from "./visuals";

const scoreTone = (score: number) => score >= 80 ? "good" : score < 50 ? "low" : "medium";
const scoreLabel = (score: number) => score >= 80 ? "טוב" : score < 50 ? "נמוך" : "בינוני";
type MuteUntil = number | "restart" | null;
type EventEvidenceState = "loading" | "available" | "unavailable";
type VersionedTemplateApplication = {
  templateId: string;
  mode: "now" | "event-start";
  appliedAt: string;
  eventId?: string;
  recomputeRunId?: string;
  codeVersion?: string;
  configVersion?: string;
  templateVersion?: string;
};
type VersionedInvestigationEdit = {
  note: string;
  templateId: string;
  arena?: string;
  recomputeRunId?: string;
  requiredCodeVersion?: string;
  requiredConfigVersion?: string;
  requiredTemplateVersion?: string;
};
type LoadedScope<T> = { id: string; settings: T; revision: number; available: boolean };
type RuntimeGroupMetadata = {
  observedAt?: string;
  event?: { id?: string; active?: boolean };
};
type RuntimeVehicleMetadata = { speedMps?: unknown; reasons?: unknown };

function TypeGlyph({ type, color }: { type?: VehicleType; color: string }) {
  return <svg className="member-type-icon" viewBox="-15 -15 30 30" aria-hidden="true"><VehicleIconGlyph icon={type?.icon ?? "rover"} color={color} /></svg>;
}

function GroupCard({ group, selected, vehicleTypes, templateName, onSelect, onSelectVehicle, onTemplate }: { group: DemoGroup; selected: boolean; vehicleTypes: VehicleType[]; templateName: string; onSelect: () => void; onSelectVehicle: (id: number) => void; onTemplate: () => void }) {
  const groupColor = group.color;
  return <article className={`group-card v04-group-card glass-panel ${selected ? "active" : ""} tone-${scoreTone(group.total)}`}>
    <button type="button" className="group-card-select" onClick={onSelect}><div className="group-card-head"><div><span className="v04-group-dot" style={{ background: groupColor }} /><strong>{group.name}</strong><p>{group.subtitle}</p></div><ScoreRing value={group.total} color={groupColor} /></div><div className="score-trio"><span>סנכרון<b>{Math.round(group.sync)}</b></span><span>נתיב<b>{Math.round(group.route)}</b></span><span>אמינות<b>{group.confidence}%</b></span></div></button>
    <div className={`reason-line ${scoreTone(group.total)}`}><span>{scoreLabel(group.total)}</span><div><strong>גורם מוביל</strong>{group.reason}</div></div>
    <div className="active-template-row"><div><Layers3 /><span>תבנית</span><b>{templateName}</b></div><Button variant="outline" size="sm" onClick={onTemplate}><Settings2 />החלפה</Button></div>
    <div className="member-score-list">{group.members.map((member) => { const type = vehicleTypes.find((item) => item.id === member.typeId); return <button type="button" key={member.id} onClick={() => onSelectVehicle(member.id)} aria-label={`פתח פרטי רכב ${member.id}`}><TypeGlyph type={type} color={groupColor} /><span><strong>רכב {member.id}</strong><small>{type?.name ?? "לא מוגדר"}</small></span><b className={`score-number ${scoreTone(member.score)}`}>{member.score}</b></button>; })}</div>
  </article>;
}

function VehicleDetail({ group, id, vehicleTypes, onClose }: { group: DemoGroup; id: number; vehicleTypes: VehicleType[]; onClose: () => void }) {
  const vehicle = group.members.find((item) => item.id === id) ?? group.members[0];
  const type = vehicleTypes.find((item) => item.id === vehicle.typeId);
  const color = group.color;
  const metadata = vehicle as typeof vehicle & RuntimeVehicleMetadata;
  const speedMps = typeof metadata.speedMps === "number" && Number.isFinite(metadata.speedMps) && metadata.speedMps >= 0 ? metadata.speedMps : undefined;
  const reasons = Array.isArray(metadata.reasons) ? metadata.reasons.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const rootCause = reasons[0] ?? group.reason ?? "אין גורם שורש פעיל";
  const speedLabel = speedMps !== undefined ? "מהירות נצפית" : "מהירות עבודה";
  const speedValue = speedMps !== undefined ? formatKnotsFromMps(speedMps) : type ? formatKnotsFromKmh(type.workSpeedKmh) : "אין נתון";
  return <section className="vehicle-detail v04-vehicle-detail glass-panel" aria-label={`פרטי רכב ${id}`}>
    <header><div className="vehicle-detail-identity"><TypeGlyph type={type} color={color} /><div><strong>רכב {id}</strong><p>{type?.name ?? "סוג לא מוגדר"} · קבוצה {group.id}</p></div></div><Button variant="ghost" size="icon-sm" onClick={onClose}><X /></Button></header>
    <div className="vehicle-score-row"><ScoreRing value={vehicle.score} color={color} size="large" /><div><span>Root cause</span><strong>{rootCause}</strong>{reasons.length > 1 && <p>{reasons.slice(1).join(" · ")}</p>}<p>הגורם מוצג מתוך תוצאת ה־Core של הרכב, לא מהשערת UI.</p></div></div>
    <dl><div><dt>מספר רכב</dt><dd>{vehicle.id}</dd></div><div><dt>ציון כולל</dt><dd>{vehicle.score}</dd></div><div><dt>סנכרון</dt><dd>{vehicle.sync}</dd></div><div><dt>נתיב</dt><dd>{vehicle.route}</dd></div><div><dt>{speedLabel}</dt><dd>{speedValue}</dd></div><div><dt>פאזה</dt><dd>{Math.round(vehicle.phase * 100)}%</dd></div><div><dt>אמינות</dt><dd>{vehicle.confidence}%</dd></div></dl>
  </section>;
}

function TemplateOverrideDialog({ open, onOpenChange, group, activeId, templates, vehicleTypes, eventEvidenceState, eventEvidenceMessage, onChoose }: { open: boolean; onOpenChange: (open: boolean) => void; group: DemoGroup; activeId: string; templates: SyncTemplate[]; vehicleTypes: VehicleType[]; eventEvidenceState: EventEvidenceState; eventEvidenceMessage: string; onChoose: (id: string, mode: "now" | "event-start") => void }) {
  const candidates = templates.filter((template) => template.family === group.family);
  const [previewId, setPreviewId] = useState(activeId);
  const [mode, setMode] = useState<"now" | "event-start">("now");
  const preview = candidates.find((item) => item.id === previewId) ?? candidates[0];
  const eventStartEnabled = eventEvidenceState === "available";
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="glass-dialog v04-template-dialog" dir="rtl"><DialogHeader><DialogTitle>החלפת תבנית · {group.name}</DialogTitle><DialogDescription>ה־preview מצייר את החוק עצמו: ב־SI את הטבעות והמיקומים; ב־SO את שרשרת ההיפודרומים עם רווח פיזי, 30° בין שכנים והיחס הנגזר ביניהם.</DialogDescription></DialogHeader><div className="v04-template-dialog-grid"><div className="template-choice-list">{candidates.map((template) => <button type="button" key={template.id} className={preview?.id === template.id ? "active" : ""} onClick={() => setPreviewId(template.id)}><span><strong>{template.name}</strong><small>{template.constellation}</small></span>{template.id === activeId && <Badge>פעילה</Badge>}</button>)}</div><div className="v04-template-large-preview"><GovernedTemplatePreview family={group.family} values={preview?.values ?? []} siPositions={preview?.siPositions} vehicleTypes={vehicleTypes} soKinds={preview?.soSpec?.chain} /><div className="v04-template-facts"><span>חוק<b>{preview?.law}</b></span><span>רכבים בקבוצה<b>{group.members.length}</b></span><span>ציון נוכחי<b>{Math.round(group.sync)}</b></span></div></div></div><div className="v04-apply-mode"><strong>מאיזה זמן להחיל?</strong><div className="segmented-control"><button type="button" className={mode === "now" ? "active" : ""} onClick={() => setMode("now")}>החל מעכשיו</button><button type="button" className={mode === "event-start" ? "active" : ""} disabled={!eventStartEnabled} aria-disabled={!eventStartEnabled} onClick={() => eventStartEnabled && setMode("event-start")}>מתחילת האירוע</button></div><p>{mode === "now" ? "האירוע נשאר רציף ונשמרת נקודת שינוי תבנית." : "האירוע הנוכחי מחושב מחדש מתחילת הקבוצתיות עם התבנית שנבחרה."}</p>{!eventStartEnabled && <p className="muted">{eventEvidenceMessage}</p>}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button><Button disabled={!preview || (preview.id === activeId && mode === "now") || (mode === "event-start" && !eventStartEnabled)} onClick={() => preview && onChoose(preview.id, mode)}><Check />החל תבנית</Button></DialogFooter></DialogContent></Dialog>;
}

async function resolveArchivedEventId(serverId: string, group: DemoGroup): Promise<string | null> {
  const metadata = group as DemoGroup & RuntimeGroupMetadata;
  if (metadata.event?.id && metadata.event.active !== false) return metadata.event.id;
  const observedMs = metadata.observedAt ? Date.parse(metadata.observedAt) : Number.NaN;
  const anchorMs = Number.isFinite(observedMs) ? observedMs : Date.now();
  const query = new URLSearchParams({
    serverId,
    from: new Date(anchorMs - 40 * 60_000).toISOString(),
    to: new Date(anchorMs + 60_000).toISOString(),
  });
  const response = await fetch(`/api/investigation/events?${query.toString()}`, { cache: "no-store", headers: { accept: "application/json" } });
  const payload: unknown = await response.json();
  if (!response.ok) return null;
  const listing = normalizeInvestigationEvents(payload);
  const matching = listing.events.filter((event) => event.groupId === group.id).sort((a, b) => Date.parse(b.endAt) - Date.parse(a.endAt));
  const live = matching.find((event) => event.lifecycle.status === "active" || event.lifecycle.status === "finalizing");
  if (live) return live.eventId;
  const recent = matching.find((event) => Date.parse(event.startAt) <= anchorMs + 5_000 && Date.parse(event.endAt) >= anchorMs - 60_000);
  return recent?.eventId ?? null;
}

export function OperatorView({ serverId, serverName, dataMode, onDataModeChange, onInvestigate }: { serverId: string; serverName: string; dataMode: DataMode; onDataModeChange: (mode: DataMode) => void; onInvestigate: () => void }) {
  const { state, setState, save } = useWorkspace();
  const scenario = getServerScenario(serverId);
  const runtimeGroups = getRuntimeGroups(serverId);
  const preferredBaseGroup = runtimeGroups.find((group) => group.key === "so") ?? runtimeGroups[0] ?? scenario.groups.so;
  const [selectedGroupId, setSelectedGroupId] = useState(preferredBaseGroup.id);
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [running, setRunning] = useState(true);
  const [tick, setTick] = useState(0);
  const [countdown, setCountdown] = useState(5);
  const [showTrace, setShowTrace] = useState(false);
  const [showRelations, setShowRelations] = useState(true);
  const [layers, setLayers] = useState<ScoreLayer[]>(["sync"]);
  const [cursor, setCursor] = useState(92);
  const [smoothingSeconds, setSmoothingSeconds] = useState<DisplaySmoothingSeconds>(10);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [mutedUntil, setMutedUntil] = useState<MuteUntil>(null);
  const [mapProfile, setMapProfile] = useState(state.settings.defaultMap);
  const [recomputeOverride, setRecomputeOverride] = useState<EventRecomputeResult | null>(null);
  const [serverScope, setServerScope] = useState<LoadedScope<ServerScopedSettings> | null>(null);
  const [groupScopes, setGroupScopes] = useState<Record<string, LoadedScope<GroupScopedSettings>>>({});
  const [archiveEventId, setArchiveEventId] = useState<string | null>(null);
  const [eventEvidenceState, setEventEvidenceState] = useState<EventEvidenceState>("loading");
  const [eventEvidenceMessage, setEventEvidenceMessage] = useState("בודק event evidence בארכיון…");
  const restoredVersionKey = useRef<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const influxConfigured = Boolean(state.influx.url.trim() && state.influx.token.trim());

  useEffect(() => { if (!running || (dataMode === "influx" && !influxConfigured)) return; const timer = window.setInterval(() => setCountdown((value) => { if (value <= 1) { setTick((current) => current + 1); return 5; } return value - 1; }), 1000); return () => window.clearInterval(timer); }, [running, dataMode, influxConfigured]);
  useEffect(() => { if (typeof mutedUntil !== "number") return; const timer = window.setTimeout(() => setMutedUntil(null), Math.max(0, mutedUntil - Date.now())); return () => window.clearTimeout(timer); }, [mutedUntil]);

  const baseGroups = runtimeGroups.length ? runtimeGroups : [scenario.groups.si, scenario.groups.so];
  const groupScopeKey = baseGroups.map((group) => workspaceScopeId("group", serverId, group.id)).sort().join("|");
  useEffect(() => {
    let cancelled = false;
    const id = workspaceScopeId("server", serverId);
    void readWorkspaceScope<ServerScopedSettings>("server", id).then((scope) => {
      if (cancelled) return;
      const settings = scope.state ?? {};
      setServerScope({ id, settings, revision: scope.revision, available: scope.available });
      if (settings.mapProfile && state.mapServers.some((item) => item.id === settings.mapProfile && item.enabled)) setMapProfile(settings.mapProfile);
    }).catch((error) => { if (!cancelled) toast.error(error instanceof Error ? `טעינת הגדרות שרת נכשלה: ${error.message}` : "טעינת הגדרות שרת נכשלה"); });
    return () => { cancelled = true; };
  }, [serverId]);

  useEffect(() => {
    let cancelled = false;
    const groups = runtimeGroups.length ? runtimeGroups : [scenario.groups.si, scenario.groups.so];
    void Promise.all(groups.map(async (group) => {
      const id = workspaceScopeId("group", serverId, group.id);
      const scope = await readWorkspaceScope<GroupScopedSettings>("group", id);
      return [id, { id, settings: scope.state ?? {}, revision: scope.revision, available: scope.available }] as const;
    })).then((rows) => {
      if (cancelled) return;
      setGroupScopes((current) => ({ ...current, ...Object.fromEntries(rows) }));
    }).catch((error) => { if (!cancelled) toast.error(error instanceof Error ? `טעינת הגדרות קבוצה נכשלה: ${error.message}` : "טעינת הגדרות קבוצה נכשלה"); });
    return () => { cancelled = true; };
  }, [serverId, groupScopeKey]);

  const selectedBase = runtimeGroups.find((group) => group.id === selectedGroupId) ?? preferredBaseGroup;
  const selectedMetadata = selectedBase as DemoGroup & RuntimeGroupMetadata;
  const snapshotEventId = selectedMetadata.event?.active === false ? undefined : selectedMetadata.event?.id;
  const selectedObservedAt = selectedMetadata.observedAt;
  const overrideKey = `${serverId}:${selectedBase.id}`;
  const selectedGroupScope = groupScopes[workspaceScopeId("group", serverId, selectedBase.id)];
  const application = (selectedGroupScope?.settings.templateApplication as VersionedTemplateApplication | undefined) ?? state.templateApplications[overrideKey] as VersionedTemplateApplication | undefined;

  useEffect(() => {
    let cancelled = false;
    if (snapshotEventId) {
      setArchiveEventId(snapshotEventId);
      setEventEvidenceState("available");
      setEventEvidenceMessage("Event evidence פעיל זמין לחישוב מחדש.");
      return () => { cancelled = true; };
    }
    if (dataMode === "simulation") {
      const simulationEventId = simulationActiveEventId(serverId, selectedBase.family);
      setArchiveEventId(simulationEventId);
      setEventEvidenceState("available");
      setEventEvidenceMessage("SIM event evidence זמין מתוך ארכיון הסימולציה הדטרמיניסטי.");
      return () => { cancelled = true; };
    }
    setArchiveEventId(null);
    setEventEvidenceState("loading");
    setEventEvidenceMessage("בודק event evidence בארכיון…");
    void resolveArchivedEventId(serverId, selectedBase).then((eventId) => {
      if (cancelled) return;
      setArchiveEventId(eventId);
      setEventEvidenceState(eventId ? "available" : "unavailable");
      setEventEvidenceMessage(eventId ? "Event evidence פעיל זמין לחישוב מחדש." : "לא נמצא event evidence פעיל לקבוצה בארכיון; הפעולה מושבתת כדי לא ליצור חישוב שווא.");
    }).catch(() => {
      if (cancelled) return;
      setArchiveEventId(null);
      setEventEvidenceState("unavailable");
      setEventEvidenceMessage("ארכיון ה־event evidence אינו זמין כרגע; החלה רטרואקטיבית מושבתת.");
    });
    return () => { cancelled = true; };
  }, [serverId, selectedBase.id, selectedObservedAt, snapshotEventId, dataMode, tick]);

  const currentEventId = snapshotEventId ?? archiveEventId ?? undefined;

  useEffect(() => {
    if (!application || application.mode !== "event-start" || !application.eventId || !application.codeVersion || !application.configVersion || !application.templateVersion || currentEventId !== application.eventId) {
      restoredVersionKey.current = null;
      return;
    }
    const expected = { eventId: application.eventId, templateId: application.templateId, codeVersion: application.codeVersion, configVersion: application.configVersion, templateVersion: application.templateVersion };
    if (recomputeOverride && sameRecomputeVersion(recomputeOverride, expected)) return;
    const key = `${expected.eventId}:${expected.templateId}:${expected.codeVersion}:${expected.configVersion}:${expected.templateVersion}`;
    if (restoredVersionKey.current === key) return;
    restoredVersionKey.current = key;
    let cancelled = false;
    void fetch("/api/investigation/recompute", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, cache: "no-store",
      body: JSON.stringify({ source: dataMode === "simulation" ? "simulation" : "core", serverId: Number(serverId), groupId: selectedBase.id, family: selectedBase.family, eventId: expected.eventId, templateId: expected.templateId, template: state.templates.find((item) => item.id === expected.templateId) ?? null, scenarioId: `operator-refresh:${expected.eventId}:${expected.templateVersion}` }),
    }).then(async (response) => {
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(`recompute restore failed (${response.status})`);
      return normalizeEventRecompute(payload);
    }).then((result) => {
      if (cancelled) return;
      if (!sameRecomputeVersion(result, expected)) throw new Error("saved event-start decision belongs to a different code/config/template version");
      setRecomputeOverride(result);
    }).catch((error) => {
      if (!cancelled) { setRecomputeOverride(null); toast.error(error instanceof Error ? `לא ניתן לשחזר חישוב רטרואקטיבי: ${error.message}` : "לא ניתן לשחזר חישוב רטרואקטיבי"); }
    });
    return () => { cancelled = true; };
  }, [application, currentEventId, recomputeOverride, dataMode, serverId, selectedBase.id, selectedBase.family, state.templates]);

  const expectedOverrideVersion = application?.mode === "event-start" && application.eventId && application.codeVersion && application.configVersion && application.templateVersion && currentEventId === application.eventId
    ? { eventId: application.eventId, templateId: application.templateId, codeVersion: application.codeVersion, configVersion: application.configVersion, templateVersion: application.templateVersion }
    : null;
  const activeRecomputeOverride = recomputeOverride && expectedOverrideVersion && sameRecomputeVersion(recomputeOverride, expectedOverrideVersion) ? recomputeOverride : null;
  const originalDisplayHistory = getLiveRuntimeHistory(serverId);
  const recomputeHistoryGroup = activeRecomputeOverride
    ? originalDisplayHistory.flatMap((point) => point.groups).find((group) => group.id === activeRecomputeOverride.groupId)
    : undefined;
  const recomputedDisplayHistory = activeRecomputeOverride && recomputeHistoryGroup
    ? historyWithEventRecompute(originalDisplayHistory, activeRecomputeOverride, recomputeHistoryGroup)
    : originalDisplayHistory;
  const latestDisplayPoint = smoothRuntimeHistoryForDisplay(recomputedDisplayHistory, smoothingSeconds).at(-1);
  const displayScoreByGroup = new Map((latestDisplayPoint?.groups ?? []).map((group) => [group.id, group] as const));
  const displayGroups = runtimeGroups.map((group) => {
    const recomputed = activeRecomputeOverride?.groupId === group.id && (group.event?.id === activeRecomputeOverride.eventId || (group.id === selectedBase.id && currentEventId === activeRecomputeOverride.eventId))
      ? groupFromEventRecompute(group, activeRecomputeOverride)
      : group;
    const displayScore = displayScoreByGroup.get(group.id);
    if (!displayScore?.scoreValid) return recomputed;
    return { ...recomputed, total: displayScore.total, sync: displayScore.sync, route: displayScore.route };
  });
  const preferredGroup = displayGroups.find((group) => group.key === "so") ?? displayGroups[0] ?? scenario.groups.so;
  const selected = displayGroups.find((group) => group.id === selectedGroupId) ?? preferredGroup;
  const activeTemplateId = selectedGroupScope?.settings.activeTemplateId ?? state.activeTemplateOverrides[overrideKey] ?? selected.templateId;
  const templateFor = (group: DemoGroup) => {
    const scopeId = workspaceScopeId("group", serverId, group.id);
    const id = groupScopes[scopeId]?.settings.activeTemplateId ?? state.activeTemplateOverrides[`${serverId}:${group.id}`] ?? group.templateId;
    return state.templates.find((item) => item.id === id) ?? state.templates.find((item) => item.family === group.family);
  };
  const groupForFamily = (key: GroupKey) => displayGroups.find((group) => group.key === key) ?? scenario.groups[key];
  const templateValues = { si: templateFor(groupForFamily("si"))?.values ?? [120, 120, 120], so: templateFor(groupForFamily("so"))?.values ?? [2, 0] };
  const activeAlertGroup = runtimeGroups.find((group) => group.alert); const activeAlert = activeAlertGroup?.alert; const muted = mutedUntil === "restart" || typeof mutedUntil === "number";

  useEffect(() => {
    if (!activeAlert || muted) return;
    const AudioContextConstructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor(); const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = "sine"; oscillator.frequency.value = activeAlert.severity === "critical" ? 1046.5 : 880; gain.gain.value = 0.045; oscillator.connect(gain); gain.connect(context.destination);
    void context.resume().catch(() => undefined); oscillator.start(); oscillator.stop(context.currentTime + 0.22);
    const closeTimer = window.setTimeout(() => { void context.close().catch(() => undefined); }, 320);
    return () => { window.clearTimeout(closeTimer); try { oscillator.stop(); } catch { /* already stopped */ } void context.close().catch(() => undefined); };
  }, [activeAlert?.id, activeAlert?.severity, muted]);

  const persistServerScope = async (patch: Partial<ServerScopedSettings>) => {
    const id = workspaceScopeId("server", serverId);
    try {
      let loaded: LoadedScope<ServerScopedSettings>;
      if (serverScope && serverScope.id === id) loaded = serverScope;
      else {
        const scope = await readWorkspaceScope<ServerScopedSettings>("server", id);
        loaded = { id, settings: scope.state ?? {}, revision: scope.revision, available: scope.available };
      }
      if (!loaded.available) return;
      const settings = { ...loaded.settings, ...patch };
      const result = await writeWorkspaceScope("server", id, settings, loaded.revision, "server-settings", Object.keys(patch).join(","));
      if (result.conflict) { toast.error("הגדרות השרת השתנו במקביל; השינוי המקומי לא נשמר"); return; }
      if (result.ok) setServerScope({ id, settings, revision: result.revision, available: true });
    } catch (error) { toast.error(error instanceof Error ? `שמירת הגדרות שרת נכשלה: ${error.message}` : "שמירת הגדרות שרת נכשלה"); }
  };

  const chooseTemplate = async (id: string, mode: "now" | "event-start") => {
    let recomputedResult: EventRecomputeResult | null = null;
    const eventId = currentEventId;
    if (mode === "event-start") {
      if (!eventId || eventEvidenceState !== "available") { toast.error(eventEvidenceMessage); return; }
      try {
        const response = await fetch("/api/investigation/recompute", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, cache: "no-store", body: JSON.stringify({ source: dataMode === "simulation" ? "simulation" : "core", serverId: Number(serverId), groupId: selectedBase.id, family: selectedBase.family, eventId, templateId: id, template: state.templates.find((item) => item.id === id) ?? null, scenarioId: `operator:${eventId}:${Date.now()}` }) });
        const payload: unknown = await response.json();
        if (!response.ok) { const detail = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `recompute failed (${response.status})`; throw new Error(detail); }
        recomputedResult = normalizeEventRecompute(payload);
        if (recomputedResult.eventId !== eventId || recomputedResult.templateId !== id) throw new Error("recompute provenance does not match selected event/template");
      } catch (error) { toast.error(error instanceof Error ? `חישוב האירוע נכשל: ${error.message}` : "חישוב האירוע נכשל"); return; }
    }

    const appliedAt = new Date().toISOString();
    const versionedApplication: VersionedTemplateApplication = recomputedResult ? {
      templateId: id, mode, appliedAt, eventId: recomputedResult.eventId, recomputeRunId: recomputedResult.runId,
      codeVersion: recomputedResult.codeVersion, configVersion: recomputedResult.configVersion, templateVersion: recomputedResult.templateVersion,
    } : { templateId: id, mode, appliedAt };
    const existingEdit = eventId ? (state.investigationEdits[eventId] as VersionedInvestigationEdit | undefined) : undefined;
    const investigationEdits = recomputedResult && eventId ? {
      ...state.investigationEdits,
      [eventId]: {
        note: existingEdit?.note ?? "",
        arena: existingEdit?.arena,
        templateId: id,
        recomputeRunId: recomputedResult.runId,
        requiredCodeVersion: recomputedResult.codeVersion,
        requiredConfigVersion: recomputedResult.configVersion,
        requiredTemplateVersion: recomputedResult.templateVersion,
      },
    } : state.investigationEdits;

    const scopeId = workspaceScopeId("group", serverId, selectedBase.id);
    let scopedSaved = false;
    try {
      const cached = groupScopes[scopeId];
      const loaded = cached ?? await readWorkspaceScope<GroupScopedSettings>("group", scopeId).then((scope) => ({ id: scopeId, settings: scope.state ?? {}, revision: scope.revision, available: scope.available }));
      if (loaded.available) {
        const settings: GroupScopedSettings = { activeTemplateId: id, templateApplication: versionedApplication };
        const result = await writeWorkspaceScope("group", scopeId, settings, loaded.revision, "template-override", `${selectedBase.id} → ${id} · ${mode}`);
        if (result.conflict) { toast.error("הגדרות הקבוצה השתנו במקביל; רענן לפני החלפת תבנית נוספת"); return; }
        if (result.ok) {
          setGroupScopes((current) => ({ ...current, [scopeId]: { id: scopeId, settings, revision: result.revision, available: true } }));
          scopedSaved = true;
        }
      }
    } catch (error) { toast.error(error instanceof Error ? `שמירת הגדרות קבוצה נכשלה: ${error.message}` : "שמירת הגדרות קבוצה נכשלה"); return; }

    if (scopedSaved) {
      setState((current) => ({ ...current, activeTemplateOverrides: { ...current.activeTemplateOverrides, [overrideKey]: id }, templateApplications: { ...current.templateApplications, [overrideKey]: versionedApplication } }));
      if (recomputedResult && eventId) {
        const persisted = await save({ ...state, investigationEdits }, "operator", "event-recompute-metadata", `${selected.id} → ${id} · ${mode} · run ${recomputedResult.runId}`);
        if (!persisted) toast.warning("התבנית נשמרה ב־group scope, אך metadata התחקור לא נשמר; יש לרענן לפני הפקת דוח");
      }
    } else {
      const next = { ...state, activeTemplateOverrides: { ...state.activeTemplateOverrides, [overrideKey]: id }, templateApplications: { ...state.templateApplications, [overrideKey]: versionedApplication }, investigationEdits };
      const persisted = await save(next, "operator", "template-override", `${selected.id} → ${id} · ${mode}${recomputedResult ? ` · run ${recomputedResult.runId} · code ${recomputedResult.codeVersion} · config ${recomputedResult.configVersion}` : ""}`);
      if (!persisted) return;
    }
    setRecomputeOverride(recomputedResult);
    setTemplateDialog(false);
    toast.success(mode === "event-start" ? "התבנית נשמרה לאחר חישוב מחדש אמיתי; הכרטיס, הגרף, העקבה והדוח נעולים לאותה גרסת תוצאה" : "התבנית הוחלה מעכשיו; העבר נשמר ללא חישוב חוזר");
  };

  const muteFor = (value: 5 | 15 | 30 | "restart") => { setMutedUntil(value === "restart" ? "restart" : Date.now() + value * 60_000); toast.success(value === "restart" ? "התראות קוליות הושתקו עד הפעלה מחדש" : `התראות קוליות הושתקו ל־${value} דקות`); };
  const enterFullscreen = async () => { try { await mapRef.current?.requestFullscreen(); } catch { toast.info("הדפדפן חסם מסך מלא"); } };
  const toggleLayer = (layer: ScoreLayer) => setLayers((current) => current.includes(layer) ? (current.length === 1 ? current : current.filter((item) => item !== layer)) : [...current, layer]);
  const chooseFamilyGroup = (key: GroupKey) => displayGroups.find((group) => group.key === key) ?? scenario.groups[key];
  const chooseVehicleGroup = (id: number, key: GroupKey) => displayGroups.find((group) => group.key === key && group.members.some((member) => member.id === id)) ?? chooseFamilyGroup(key);

  return <div className="operator-workspace v04-operator">
    <section className="live-map-panel glass-panel" ref={mapRef}>
      <div className="section-toolbar"><div><p className="eyebrow">מפה חיה</p><h2>{serverName}</h2><div className="live-context"><span className={`source-badge ${dataMode}`}><Radio />{dataMode === "simulation" ? "SIMULATION" : influxConfigured ? "INFLUXDB 2" : "INFLUX חסר"}</span><span><Clock3 />טיק בעוד {running ? countdown : "—"} שנ׳</span><span>{scenario.status}</span></div></div><div className="toolbar-actions"><Select value={mapProfile} onValueChange={(value) => { setMapProfile(value); void persistServerScope({ mapProfile: value }); }}><SelectTrigger aria-label="פרופיל מפה"><SelectValue /></SelectTrigger><SelectContent>{state.mapServers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" onClick={() => setRunning((value) => !value)}>{running ? <Pause /> : <Play />}</Button><Button variant="outline" size="icon" onClick={enterFullscreen}><Expand /></Button></div></div>
      <div className="v04-map-toolbar"><strong><Layers3 /> שכבות Blue Wolf</strong>{dataMode === "simulation" ? <Button size="sm" variant={showRelations ? "default" : "outline"} onClick={() => setShowRelations((value) => !value)}><Focus />יחסים</Button> : <span>CORE · WGS84 · auto-fit</span>}<Button size="sm" variant={showTrace ? "default" : "outline"} onClick={() => setShowTrace((value) => !value)}>עקבה צבועה לפי ציון</Button><span>נתיב · קבוצות · עקבה נצפית · 30/60/90 זמינים בבקרת השכבות בתוך המפה</span></div>
      <div className="map-stage">{dataMode === "influx" ? <OperationalLiveMap serverId={serverId} selectedGroupId={selected.id} selectedVehicle={selectedVehicle} vehicleTypes={state.vehicleTypes} showGrid showTrace={showTrace} recomputeOverride={activeRecomputeOverride} mapProfile={mapProfile} onSelectGroup={(groupId) => { setSelectedGroupId(groupId); setSelectedVehicle(null); }} onSelectVehicle={(id, groupId) => { setSelectedGroupId(groupId); setSelectedVehicle(id); }} /> : <GovernedLiveMap serverId={serverId} tick={tick} selectedGroup={selected.key} selectedVehicle={selectedVehicle} showTrace={showTrace} showRoutes showRelations={showRelations} showGrid vehicleTypes={state.vehicleTypes} templateValues={templateValues} mapProfile={mapProfile} onSelectGroup={(key) => { const group = chooseFamilyGroup(key); setSelectedGroupId(group.id); setSelectedVehicle(null); }} onSelectVehicle={(id, key) => { const group = chooseVehicleGroup(id, key); setSelectedGroupId(group.id); setSelectedVehicle(id); }} />}</div>
    </section>
    <aside className="live-summary"><div className="summary-heading"><div><p className="eyebrow">קבוצות פעילות</p><h2>מצב נוכחי</h2></div><Badge variant="outline">{displayGroups.length} קבוצות</Badge></div>{displayGroups.map((group) => <GroupCard key={group.id} group={group} selected={selected.id === group.id} vehicleTypes={state.vehicleTypes} templateName={templateFor(group)?.name ?? "ללא תבנית"} onSelect={() => { setSelectedGroupId(group.id); setSelectedVehicle(null); }} onSelectVehicle={(id) => { setSelectedGroupId(group.id); setSelectedVehicle(id); }} onTemplate={() => { setSelectedGroupId(group.id); setTemplateDialog(true); }} />)}{selectedVehicle && <VehicleDetail group={selected} id={selectedVehicle} vehicleTypes={state.vehicleTypes} onClose={() => setSelectedVehicle(null)} />}</aside>
    <section className="timeline-panel glass-panel"><div className="section-toolbar"><div><p className="eyebrow">ציונים רציפים</p><h2>קבוצות לאורך זמן</h2></div><div className="toolbar-actions"><div className="segmented-control">{(["sync", "route", "total"] as ScoreLayer[]).map((layer) => <button type="button" key={layer} className={layers.includes(layer) ? "active" : ""} onClick={() => toggleLayer(layer)}>{layer === "sync" ? "סנכרון" : layer === "route" ? "נתיב" : "כולל"}</button>)}</div><Button variant="outline" size="sm" onClick={onInvestigate}><History />תחקור</Button></div></div>{dataMode === "influx" ? <OperationalTimeline serverId={serverId} selectedGroupId={selected.id} layers={layers} cursor={cursor} onCursor={setCursor} smoothingSeconds={smoothingSeconds} onSmoothingSeconds={setSmoothingSeconds} selectedVehicle={selectedVehicle} recomputeOverride={activeRecomputeOverride} /> : <SimulationTimeline serverId={serverId} selected={selected.key} layers={layers} cursor={cursor} onCursor={setCursor} selectedVehicle={selectedVehicle} />}<div className="timeline-footer"><span>אירוע = קבוצתיות רציפה. קווי האירועים אינם התראות.</span><span>{dataMode === "influx" ? `הגרף והכרטיסים משתמשים באותה החלקת תצוגה בלבד (${smoothingSeconds === 0 ? "RAW" : `${smoothingSeconds} שנ׳`})` : "לחיצה על הגרף מזיזה את הסמן"}</span></div></section>
    {activeAlert && <section className={`active-alert v04-live-alert glass-panel ${activeAlert.severity}`}><TriangleAlert /><div><span>התראה חיה · {activeAlertGroup?.id}</span><strong>{activeAlert.title}</strong><p>{activeAlert.detail}</p></div><div className="alert-actions">{muted ? <Button variant="outline" size="sm" onClick={() => setMutedUntil(null)}><VolumeX />בטל השתקה</Button> : <><Button variant="outline" size="sm" onClick={() => muteFor(5)}>5 דק׳</Button><Button variant="outline" size="sm" onClick={() => muteFor(15)}>15 דק׳</Button><Button variant="outline" size="sm" onClick={() => muteFor(30)}>30 דק׳</Button><Button variant="outline" size="sm" onClick={() => muteFor("restart")}><Volume2 />עד restart</Button></>}<Button size="sm" onClick={() => toast.success("ההתראה סומנה כטופלה; היא לא הופכת לאירוע תחקור")}><BellRing />טופל</Button></div></section>}
    <TemplateOverrideDialog open={templateDialog} onOpenChange={setTemplateDialog} group={selected} activeId={activeTemplateId} templates={state.templates} vehicleTypes={state.vehicleTypes} eventEvidenceState={eventEvidenceState} eventEvidenceMessage={eventEvidenceMessage} onChoose={chooseTemplate} />
    <div className="v04-source-switch"><span>מקור נתונים</span><button type="button" className={dataMode === "simulation" ? "active" : ""} onClick={() => onDataModeChange("simulation")}>SIM</button><button type="button" className={dataMode === "influx" ? "active" : ""} onClick={() => onDataModeChange("influx")}>INFLUX</button></div>
  </div>;
}
