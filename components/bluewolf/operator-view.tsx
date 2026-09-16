"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, Check, Clock3, Expand, Focus, History, Layers3, Pause, Play, Radio, Settings2, TriangleAlert, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getServerScenario, type DataMode, type DemoGroup, type SyncTemplate, type VehicleType } from "@/lib/bluewolf";
import { normalizeEventRecompute, type EventRecomputeResult } from "@/lib/investigation-contract";
import { getRuntimeGroups } from "@/lib/live-runtime";
import { groupFromEventRecompute, sameRecomputeVersion } from "@/lib/operator-retroactive-result";
import { formatKnotsFromKmh, formatKnotsFromMps } from "@/lib/speed-units";
import { useWorkspace } from "./app-context";
import { OperationalLiveMap } from "./operational-live-map";
import { OperationalTimeline } from "./operational-timeline";
import { GovernedLiveMap, GovernedTemplatePreview } from "./so-governed-visuals";
import { SimulationTimeline } from "./simulation-timeline";
import { ScoreRing, VehicleIconGlyph, type GroupKey, type ScoreLayer } from "./visuals";

const scoreTone = (score: number) => score >= 80 ? "good" : score < 50 ? "low" : "medium";
const scoreLabel = (score: number) => score >= 80 ? "טוב" : score < 50 ? "נמוך" : "בינוני";
type MuteUntil = number | "restart" | null;
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

function TypeGlyph({ type, color }: { type?: VehicleType; color: string }) { return <svg className="member-type-icon" viewBox="-15 -15 30 30" aria-hidden="true"><VehicleIconGlyph icon={type?.icon ?? "rover"} color={color} /></svg>; }

function GroupCard({ group, selected, vehicleTypes, templateName, onSelect, onSelectVehicle, onTemplate }: { group: DemoGroup; selected: boolean; vehicleTypes: VehicleType[]; templateName: string; onSelect: () => void; onSelectVehicle: (id: number) => void; onTemplate: () => void }) {
  const groupColor = group.color;
  return <article className={`group-card v04-group-card glass-panel ${selected ? "active" : ""} tone-${scoreTone(group.total)}`}>
    <button type="button" className="group-card-select" onClick={onSelect}><div className="group-card-head"><div><span className="v04-group-dot" style={{ background: groupColor }} /><strong>{group.name}</strong><p>{group.subtitle}</p></div><ScoreRing value={group.total} color={groupColor} /></div><div className="score-trio"><span>סנכרון<b>{group.sync}</b></span><span>נתיב<b>{group.route}</b></span><span>אמינות<b>{group.confidence}%</b></span></div></button>
    <div className={`reason-line ${scoreTone(group.total)}`}><span>{scoreLabel(group.total)}</span><div><strong>גורם מוביל</strong>{group.reason}</div></div>
    <div className="active-template-row"><div><Layers3 /><span>תבנית</span><b>{templateName}</b></div><Button variant="outline" size="sm" onClick={onTemplate}><Settings2 />החלפה</Button></div>
    <div className="member-score-list">{group.members.map((member) => { const type = vehicleTypes.find((item) => item.id === member.typeId); return <button type="button" key={member.id} onClick={() => onSelectVehicle(member.id)}><TypeGlyph type={type} color={groupColor} /><span><strong>רכב {member.id}</strong><small>{type?.name ?? "לא מוגדר"}</small></span><b className={`score-number ${scoreTone(member.score)}`}>{member.score}</b></button>; })}</div>
  </article>;
}

function VehicleDetail({ group, id, vehicleTypes, onClose }: { group: DemoGroup; id: number; vehicleTypes: VehicleType[]; onClose: () => void }) {
  const vehicle = group.members.find((item) => item.id === id) ?? group.members[0]; const type = vehicleTypes.find((item) => item.id === vehicle.typeId); const color = group.color;
  const observedSpeed = (vehicle as { speedMps?: unknown }).speedMps;
  const speedMps = typeof observedSpeed === "number" && Number.isFinite(observedSpeed) && observedSpeed >= 0 ? observedSpeed : undefined;
  const speedLabel = speedMps !== undefined ? "מהירות נצפית" : "מהירות עבודה";
  const speedValue = speedMps !== undefined ? formatKnotsFromMps(speedMps) : type ? formatKnotsFromKmh(type.workSpeedKmh) : "אין נתון";
  return <section className="vehicle-detail v04-vehicle-detail glass-panel"><header><div className="vehicle-detail-identity"><TypeGlyph type={type} color={color} /><div><strong>רכב {id}</strong><p>{type?.name} · צבע קבוצה {group.id}</p></div></div><Button variant="ghost" size="icon-sm" onClick={onClose}><X /></Button></header><div className="vehicle-score-row"><ScoreRing value={vehicle.score} color={color} size="large" /><div><span>הסיבה העיקרית</span><strong>{group.key === "so" && vehicle.score < group.total ? "תזמון פנייה" : group.key === "si" ? "יחס זוויתי" : "ביצוע תקין"}</strong><p>הצבע במצב חי מייצג קבוצה בלבד; סוג הרכב מוצג באמצעות האייקון.</p></div></div><dl><div><dt>סנכרון</dt><dd>{vehicle.sync}</dd></div><div><dt>נתיב</dt><dd>{vehicle.route}</dd></div><div><dt>{speedLabel}</dt><dd>{speedValue}</dd></div><div><dt>פאזה</dt><dd>{Math.round(vehicle.phase * 100)}%</dd></div><div><dt>אמינות</dt><dd>{vehicle.confidence}%</dd></div></dl></section>;
}

function TemplateOverrideDialog({ open, onOpenChange, group, activeId, templates, vehicleTypes, onChoose }: { open: boolean; onOpenChange: (open: boolean) => void; group: DemoGroup; activeId: string; templates: SyncTemplate[]; vehicleTypes: VehicleType[]; onChoose: (id: string, mode: "now" | "event-start") => void }) {
  const candidates = templates.filter((template) => template.family === group.family); const [previewId, setPreviewId] = useState(activeId); const [mode, setMode] = useState<"now" | "event-start">("now"); const preview = candidates.find((item) => item.id === previewId) ?? candidates[0];
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="glass-dialog v04-template-dialog" dir="rtl"><DialogHeader><DialogTitle>החלפת תבנית · {group.name}</DialogTitle><DialogDescription>ה־preview מצייר את החוק עצמו: ב־SI את הטבעות והמיקומים; ב־SO את שרשרת ההיפודרומים עם רווח פיזי, 30° בין שכנים והיחס הנגזר ביניהם.</DialogDescription></DialogHeader><div className="v04-template-dialog-grid"><div className="template-choice-list">{candidates.map((template) => <button type="button" key={template.id} className={preview?.id === template.id ? "active" : ""} onClick={() => setPreviewId(template.id)}><span><strong>{template.name}</strong><small>{template.constellation}</small></span>{template.id === activeId && <Badge>פעילה</Badge>}</button>)}</div><div className="v04-template-large-preview"><GovernedTemplatePreview family={group.family} values={preview?.values ?? []} siPositions={preview?.siPositions} vehicleTypes={vehicleTypes} soKinds={preview?.soSpec?.chain} /><div className="v04-template-facts"><span>חוק<b>{preview?.law}</b></span><span>רכבים בקבוצה<b>{group.members.length}</b></span><span>ציון נוכחי<b>{group.sync}</b></span></div></div></div><div className="v04-apply-mode"><strong>מאיזה זמן להחיל?</strong><div className="segmented-control"><button type="button" className={mode === "now" ? "active" : ""} onClick={() => setMode("now")}>החל מעכשיו</button><button type="button" className={mode === "event-start" ? "active" : ""} onClick={() => setMode("event-start")}>מתחילת האירוע</button></div><p>{mode === "now" ? "האירוע נשאר רציף ונשמרת נקודת שינוי תבנית." : "האירוע הנוכחי מחושב מחדש מתחילת הקבוצתיות עם התבנית שנבחרה."}</p></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button><Button disabled={!preview || (preview.id === activeId && mode === "now")} onClick={() => preview && onChoose(preview.id, mode)}><Check />החל תבנית</Button></DialogFooter></DialogContent></Dialog>;
}

export function OperatorView({ serverId, serverName, dataMode, onDataModeChange, onInvestigate }: { serverId: string; serverName: string; dataMode: DataMode; onDataModeChange: (mode: DataMode) => void; onInvestigate: () => void }) {
  const { state, save } = useWorkspace();
  const scenario = getServerScenario(serverId);
  const runtimeGroups = getRuntimeGroups(serverId);
  const preferredBaseGroup = runtimeGroups.find((group) => group.key === "so") ?? runtimeGroups[0] ?? scenario.groups.so;
  const [arena, setArena] = useState(state.arenas[0] ?? "זירה א׳");
  const [selectedGroupId, setSelectedGroupId] = useState(preferredBaseGroup.id);
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [running, setRunning] = useState(true);
  const [tick, setTick] = useState(0);
  const [countdown, setCountdown] = useState(5);
  const [showTrace, setShowTrace] = useState(false);
  const [showRelations, setShowRelations] = useState(true);
  const [layers, setLayers] = useState<ScoreLayer[]>(["sync"]);
  const [cursor, setCursor] = useState(92);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [mutedUntil, setMutedUntil] = useState<MuteUntil>(null);
  const [mapProfile, setMapProfile] = useState(state.settings.defaultMap);
  const [recomputeOverride, setRecomputeOverride] = useState<EventRecomputeResult | null>(null);
  const restoredVersionKey = useRef<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const influxConfigured = Boolean(state.influx.url.trim() && state.influx.token.trim());

  useEffect(() => { if (!running || (dataMode === "influx" && !influxConfigured)) return; const timer = window.setInterval(() => setCountdown((value) => { if (value <= 1) { setTick((current) => current + 1); return 5; } return value - 1; }), 1000); return () => window.clearInterval(timer); }, [running, dataMode, influxConfigured]);
  useEffect(() => { if (typeof mutedUntil !== "number") return; const timer = window.setTimeout(() => setMutedUntil(null), Math.max(0, mutedUntil - Date.now())); return () => window.clearTimeout(timer); }, [mutedUntil]);

  const selectedBase = runtimeGroups.find((group) => group.id === selectedGroupId) ?? preferredBaseGroup;
  const overrideKey = `${serverId}:${selectedBase.id}`;
  const application = state.templateApplications[overrideKey] as VersionedTemplateApplication | undefined;
  const currentEventId = "event" in selectedBase ? selectedBase.event?.id : undefined;

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
      body: JSON.stringify({ eventId: expected.eventId, templateId: expected.templateId, scenarioId: `operator-refresh:${expected.eventId}:${expected.templateVersion}` }),
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
  }, [application, currentEventId, recomputeOverride]);

  const expectedOverrideVersion = application?.mode === "event-start" && application.eventId && application.codeVersion && application.configVersion && application.templateVersion && currentEventId === application.eventId
    ? { eventId: application.eventId, templateId: application.templateId, codeVersion: application.codeVersion, configVersion: application.configVersion, templateVersion: application.templateVersion }
    : null;
  const activeRecomputeOverride = recomputeOverride && expectedOverrideVersion && sameRecomputeVersion(recomputeOverride, expectedOverrideVersion) ? recomputeOverride : null;
  const displayGroups = runtimeGroups.map((group) => activeRecomputeOverride?.groupId === group.id && activeRecomputeOverride.eventId === group.event?.id ? groupFromEventRecompute(group, activeRecomputeOverride) : group);
  const preferredGroup = displayGroups.find((group) => group.key === "so") ?? displayGroups[0] ?? scenario.groups.so;
  const selected = displayGroups.find((group) => group.id === selectedGroupId) ?? preferredGroup;
  const activeTemplateId = state.activeTemplateOverrides[overrideKey] ?? selected.templateId;
  const templateFor = (group: DemoGroup) => { const id = state.activeTemplateOverrides[`${serverId}:${group.id}`] ?? group.templateId; return state.templates.find((item) => item.id === id) ?? state.templates.find((item) => item.family === group.family); };
  const groupForFamily = (key: GroupKey) => displayGroups.find((group) => group.key === key) ?? scenario.groups[key];
  const templateValues = { si: templateFor(groupForFamily("si"))?.values ?? [120, 120, 120], so: templateFor(groupForFamily("so"))?.values ?? [2, 0] };
  const activeAlertGroup = displayGroups.find((group) => group.alert); const activeAlert = activeAlertGroup?.alert; const muted = mutedUntil === "restart" || typeof mutedUntil === "number";

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

  const chooseTemplate = async (id: string, mode: "now" | "event-start") => {
    let recomputedResult: EventRecomputeResult | null = null;
    const eventId = "event" in selectedBase ? selectedBase.event?.id : undefined;
    if (mode === "event-start") {
      if (!eventId) { toast.error("אין event evidence פעיל לקבוצה; התבנית לא נשמרה מתחילת האירוע"); return; }
      try {
        const response = await fetch("/api/investigation/recompute", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, cache: "no-store", body: JSON.stringify({ eventId, templateId: id, scenarioId: `operator:${eventId}:${Date.now()}` }) });
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
    const next = {
      ...state,
      activeTemplateOverrides: { ...state.activeTemplateOverrides, [overrideKey]: id },
      templateApplications: { ...state.templateApplications, [overrideKey]: versionedApplication },
      investigationEdits,
    };
    await save(next, "operator", "template-override", `${selected.id} → ${id} · ${mode}${recomputedResult ? ` · run ${recomputedResult.runId} · code ${recomputedResult.codeVersion} · config ${recomputedResult.configVersion}` : ""}`);
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
    <section className="live-map-panel glass-panel" ref={mapRef}><div className="section-toolbar"><div><p className="eyebrow">מפה חיה · {arena}</p><h2>{serverName}</h2><div className="live-context"><span className={`source-badge ${dataMode}`}><Radio />{dataMode === "simulation" ? "SIMULATION" : influxConfigured ? "INFLUXDB 2" : "INFLUX חסר"}</span><span><Clock3 />טיק בעוד {running ? countdown : "—"} שנ׳</span><span>{scenario.status}</span></div></div><div className="toolbar-actions"><Select value={arena} onValueChange={setArena}><SelectTrigger className="v04-arena-select"><SelectValue /></SelectTrigger><SelectContent>{state.arenas.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={mapProfile} onValueChange={setMapProfile}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.mapServers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" onClick={() => setRunning((value) => !value)}>{running ? <Pause /> : <Play />}</Button><Button variant="outline" size="icon" onClick={enterFullscreen}><Expand /></Button></div></div><div className="v04-map-toolbar">{dataMode === "simulation" ? <div><Button size="sm" variant={showRelations ? "default" : "outline"} onClick={() => setShowRelations((v) => !v)}><Focus />יחסים</Button></div> : <span>CORE: מוצגים רק מיקומי WGS84 תקפים · auto-fit לכל הקבוצות</span>}<Button size="sm" variant={showTrace ? "default" : "outline"} onClick={() => setShowTrace(v => !v)}>עקבה לפי סנכרון</Button><span>עקבה: ירוק ≥80 · צהוב 50–79 · אדום &lt;50 · אפור ללא ציון</span></div><div className="map-stage">{dataMode === "influx" ? <OperationalLiveMap serverId={serverId} selectedGroupId={selected.id} selectedVehicle={selectedVehicle} vehicleTypes={state.vehicleTypes} showGrid showTrace={showTrace} recomputeOverride={activeRecomputeOverride} onSelectGroup={(groupId) => { setSelectedGroupId(groupId); setSelectedVehicle(null); }} onSelectVehicle={(id, groupId) => { setSelectedGroupId(groupId); setSelectedVehicle(id); }} /> : <GovernedLiveMap serverId={serverId} tick={tick} selectedGroup={selected.key} selectedVehicle={selectedVehicle} showTrace={showTrace} showRoutes showRelations={showRelations} showGrid vehicleTypes={state.vehicleTypes} templateValues={templateValues} mapProfile={mapProfile} onSelectGroup={(key) => { const group = chooseFamilyGroup(key); setSelectedGroupId(group.id); setSelectedVehicle(null); }} onSelectVehicle={(id, key) => { const group = chooseVehicleGroup(id, key); setSelectedGroupId(group.id); setSelectedVehicle(id); }} />}</div></section>
    <aside className="live-summary"><div className="summary-heading"><div><p className="eyebrow">קבוצות פעילות</p><h2>מצב נוכחי</h2></div><Badge variant="outline">{displayGroups.length} קבוצות</Badge></div>{displayGroups.map((group) => <GroupCard key={group.id} group={group} selected={selected.id === group.id} vehicleTypes={state.vehicleTypes} templateName={templateFor(group)?.name ?? "ללא תבנית"} onSelect={() => { setSelectedGroupId(group.id); setSelectedVehicle(null); }} onSelectVehicle={(id) => { setSelectedGroupId(group.id); setSelectedVehicle(id); }} onTemplate={() => { setSelectedGroupId(group.id); setTemplateDialog(true); }} />)}{selectedVehicle && <VehicleDetail group={selected} id={selectedVehicle} vehicleTypes={state.vehicleTypes} onClose={() => setSelectedVehicle(null)} />}</aside>
    <section className="timeline-panel glass-panel"><div className="section-toolbar"><div><p className="eyebrow">ציונים רציפים</p><h2>קבוצות לאורך זמן</h2></div><div className="toolbar-actions"><div className="segmented-control">{(["sync", "route", "total"] as ScoreLayer[]).map((layer) => <button type="button" key={layer} className={layers.includes(layer) ? "active" : ""} onClick={() => toggleLayer(layer)}>{layer === "sync" ? "סנכרון" : layer === "route" ? "נתיב" : "כולל"}</button>)}</div><Button variant="outline" size="sm" onClick={onInvestigate}><History />תחקור</Button></div></div>{dataMode === "influx" ? <OperationalTimeline serverId={serverId} selectedGroupId={selected.id} layers={layers} cursor={cursor} onCursor={setCursor} selectedVehicle={selectedVehicle} recomputeOverride={activeRecomputeOverride} /> : <SimulationTimeline serverId={serverId} selected={selected.key} layers={layers} cursor={cursor} onCursor={setCursor} selectedVehicle={selectedVehicle} />}<div className="timeline-footer"><span>אירוע = קבוצתיות רציפה. קווי האירועים אינם התראות.</span><span>{dataMode === "influx" ? "הגרף מבוסס snapshots אמיתיים מה־Core" : "לחיצה על הגרף מזיזה את הסמן"}</span></div></section>
    {activeAlert && <section className={`active-alert v04-live-alert glass-panel ${activeAlert.severity}`}><TriangleAlert /><div><span>התראה חיה · {activeAlertGroup?.id}</span><strong>{activeAlert.title}</strong><p>{activeAlert.detail}</p></div><div className="alert-actions">{muted ? <Button variant="outline" size="sm" onClick={() => setMutedUntil(null)}><VolumeX />בטל השתקה</Button> : <><Button variant="outline" size="sm" onClick={() => muteFor(5)}>5 דק׳</Button><Button variant="outline" size="sm" onClick={() => muteFor(15)}>15 דק׳</Button><Button variant="outline" size="sm" onClick={() => muteFor(30)}>30 דק׳</Button><Button variant="outline" size="sm" onClick={() => muteFor("restart")}><Volume2 />עד restart</Button></>}<Button size="sm" onClick={() => toast.success("ההתראה סומנה כטופלה; היא לא הופכת לאירוע תחקור")}><BellRing />טופל</Button></div></section>}
    <TemplateOverrideDialog open={templateDialog} onOpenChange={setTemplateDialog} group={selected} activeId={activeTemplateId} templates={state.templates} vehicleTypes={state.vehicleTypes} onChoose={chooseTemplate} />
    <div className="v04-source-switch"><span>מקור נתונים</span><button type="button" className={dataMode === "simulation" ? "active" : ""} onClick={() => onDataModeChange("simulation")}>SIM</button><button type="button" className={dataMode === "influx" ? "active" : ""} onClick={() => onDataModeChange("influx")}>INFLUX</button></div>
  </div>;
}