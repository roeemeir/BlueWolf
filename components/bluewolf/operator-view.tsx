"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Check, Clock3, Expand, Focus, History, Layers3, Pause, Play, Radio, Settings2, TriangleAlert, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getServerScenario, type DataMode, type DemoGroup, type SyncTemplate, type VehicleType } from "@/lib/bluewolf";
import { getLiveRuntimeHistory } from "@/lib/live-runtime-history";
import { getRuntimeGroups } from "@/lib/live-runtime";
import { useWorkspace } from "./app-context";
import { OperationalLiveMap } from "./operational-live-map";
import { OperationalTimeline } from "./operational-timeline";
import { LiveMap, ScoreRing, TemplatePreview, TimelineChart, VehicleIconGlyph, type GroupKey, type ScoreLayer } from "./visuals";

const scoreTone = (score: number) => score >= 80 ? "good" : score < 50 ? "low" : "medium";
const scoreLabel = (score: number) => score >= 80 ? "טוב" : score < 50 ? "נמוך" : "בינוני";

function TypeGlyph({ type, color }: { type?: VehicleType; color: string }) {
  return <svg className="member-type-icon" viewBox="-15 -15 30 30" aria-hidden="true"><VehicleIconGlyph icon={type?.icon ?? "rover"} color={color} /></svg>;
}

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
  const vehicle = group.members.find((item) => item.id === id) ?? group.members[0];
  const type = vehicleTypes.find((item) => item.id === vehicle.typeId);
  const color = group.color;
  return <section className="vehicle-detail v04-vehicle-detail glass-panel"><header><div className="vehicle-detail-identity"><TypeGlyph type={type} color={color} /><div><strong>רכב {id}</strong><p>{type?.name} · צבע קבוצה {group.id}</p></div></div><Button variant="ghost" size="icon-sm" onClick={onClose}><X /></Button></header><div className="vehicle-score-row"><ScoreRing value={vehicle.score} color={color} size="large" /><div><span>הסיבה העיקרית</span><strong>{group.key === "so" && vehicle.score < group.total ? "תזמון פנייה" : group.key === "si" ? "יחס זוויתי" : "ביצוע תקין"}</strong><p>צבע marker = קבוצה. סוג הרכב מוצג באמצעות האייקון.</p></div></div><dl><div><dt>סנכרון</dt><dd>{vehicle.sync}</dd></div><div><dt>נתיב</dt><dd>{vehicle.route}</dd></div><div><dt>מהירות עבודה</dt><dd>{type?.workSpeedKmh ?? 45} קמ״ש</dd></div><div><dt>פאזה</dt><dd>{Math.round(vehicle.phase * 100)}%</dd></div><div><dt>אמינות</dt><dd>{vehicle.confidence}%</dd></div></dl></section>;
}

function TemplateOverrideDialog({ open, onOpenChange, group, activeId, templates, vehicleTypes, onChoose }: { open: boolean; onOpenChange: (open: boolean) => void; group: DemoGroup; activeId: string; templates: SyncTemplate[]; vehicleTypes: VehicleType[]; onChoose: (id: string, mode: "now" | "event-start") => void }) {
  const candidates = templates.filter((template) => template.family === group.family);
  const [previewId, setPreviewId] = useState(activeId);
  const [mode, setMode] = useState<"now" | "event-start">("now");
  const preview = candidates.find((item) => item.id === previewId) ?? candidates[0];
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="glass-dialog v04-template-dialog" dir="rtl"><DialogHeader><DialogTitle>החלפת תבנית · {group.name}</DialogTitle><DialogDescription>ה־preview מציג את החוק הפעיל. Override נשמר בנפרד מה־global config.</DialogDescription></DialogHeader><div className="v04-template-dialog-grid"><div className="template-choice-list">{candidates.map((template) => <button type="button" key={template.id} className={preview?.id === template.id ? "active" : ""} onClick={() => setPreviewId(template.id)}><span><strong>{template.name}</strong><small>{template.constellation}</small></span>{template.id === activeId && <Badge>פעילה</Badge>}</button>)}</div><div className="v04-template-large-preview"><TemplatePreview family={group.family} values={preview?.values ?? []} vehicleTypes={vehicleTypes} soKinds={preview?.soSpec?.chain} /><div className="v04-template-facts"><span>חוק<b>{preview?.law}</b></span><span>רכבים בקבוצה<b>{group.members.length}</b></span><span>Sync נוכחי<b>{group.sync}</b></span></div></div></div><div className="v04-apply-mode"><strong>מאיזה זמן להחיל?</strong><div className="segmented-control"><button type="button" className={mode === "now" ? "active" : ""} onClick={() => setMode("now")}>החל מעכשיו</button><button type="button" className={mode === "event-start" ? "active" : ""} onClick={() => setMode("event-start")}>מתחילת האירוע</button></div><p>{mode === "now" ? "האירוע נשאר רציף ונשמרת נקודת שינוי תבנית." : "האירוע מחושב מחדש מתחילת הקבוצתיות עם התבנית שנבחרה."}</p></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button><Button disabled={!preview || (preview.id === activeId && mode === "now")} onClick={() => preview && onChoose(preview.id, mode)}><Check />החל תבנית</Button></DialogFooter></DialogContent></Dialog>;
}

type StructuralEventRow = { id: string; groupId: string; groupName: string; observedAt: string; active: boolean; cursor: number };

function structuralEvents(serverId: string): StructuralEventRow[] {
  const history = getLiveRuntimeHistory(serverId);
  if (history.length === 0) return [];
  const firstMs = Date.parse(history[0].observedAt);
  const lastMs = Date.parse(history.at(-1)!.observedAt);
  const span = Math.max(1, lastMs - firstMs);
  const byId = new Map<string, StructuralEventRow>();
  for (const point of history) {
    for (const group of point.groups) {
      if (!group.event) continue;
      const row: StructuralEventRow = {
        id: group.event.id,
        groupId: group.id,
        groupName: group.name,
        observedAt: point.observedAt,
        active: group.event.active,
        cursor: Math.round(((Date.parse(point.observedAt) - firstMs) / span) * 100),
      };
      const existing = byId.get(row.id);
      if (!existing || Date.parse(row.observedAt) < Date.parse(existing.observedAt)) byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)).slice(0, 8);
}

export function OperatorView({ serverId, serverName, dataMode, onDataModeChange, onInvestigate }: { serverId: string; serverName: string; dataMode: DataMode; onDataModeChange: (mode: DataMode) => void; onInvestigate: () => void }) {
  const { state, save } = useWorkspace();
  const scenario = getServerScenario(serverId);
  const groups = getRuntimeGroups(serverId);
  const preferredGroup = groups.find((group) => group.key === "so") ?? groups[0] ?? scenario.groups.so;
  const [arena, setArena] = useState(state.arenas[0] ?? "זירה א׳");
  const [selectedGroupId, setSelectedGroupId] = useState(preferredGroup.id);
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [running, setRunning] = useState(true);
  const [tick, setTick] = useState(0);
  const [countdown, setCountdown] = useState(5);
  const [showTrace, setShowTrace] = useState(true);
  const [showScoreTrace, setShowScoreTrace] = useState(true);
  const [trailMinutes, setTrailMinutes] = useState(30);
  const [showRelations, setShowRelations] = useState(true);
  const [layers, setLayers] = useState<ScoreLayer[]>(["sync"]);
  const [cursor, setCursor] = useState(92);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [muteUntil, setMuteUntil] = useState<number | "restart" | null>(null);
  const [mapProfile, setMapProfile] = useState(state.settings.defaultMap);
  const mapRef = useRef<HTMLDivElement>(null);
  const influxConfigured = Boolean(state.influx.url.trim() && state.influx.token.trim());

  useEffect(() => { if (!running || (dataMode === "influx" && !influxConfigured)) return; const timer = window.setInterval(() => setCountdown((value) => { if (value <= 1) { setTick((current) => current + 1); return 5; } return value - 1; }), 1000); return () => window.clearInterval(timer); }, [running, dataMode, influxConfigured]);

  const selected = groups.find((group) => group.id === selectedGroupId) ?? preferredGroup;
  const overrideKey = `${serverId}:${selected.id}`;
  const activeTemplateId = state.activeTemplateOverrides[overrideKey] ?? selected.templateId;
  const templateFor = (group: DemoGroup) => { const id = state.activeTemplateOverrides[`${serverId}:${group.id}`] ?? group.templateId; return state.templates.find((item) => item.id === id) ?? state.templates.find((item) => item.family === group.family); };
  const groupForFamily = (key: GroupKey) => groups.find((group) => group.key === key) ?? scenario.groups[key];
  const templateValues = { si: templateFor(groupForFamily("si"))?.values ?? [120, 120, 120], so: templateFor(groupForFamily("so"))?.values ?? [2, 0] };
  const activeAlertGroup = groups.find((group) => group.alert);
  const activeAlert = activeAlertGroup?.alert;
  const events = useMemo(() => dataMode === "influx" ? structuralEvents(serverId) : [], [dataMode, serverId, groups]);
  const muted = muteUntil === "restart" || (typeof muteUntil === "number" && muteUntil > Date.now());

  const chooseTemplate = async (id: string, mode: "now" | "event-start") => { const next = { ...state, activeTemplateOverrides: { ...state.activeTemplateOverrides, [overrideKey]: id }, templateApplications: { ...state.templateApplications, [overrideKey]: { templateId: id, mode, appliedAt: new Date().toISOString() } } }; await save(next, "operator", "template-override", `${selected.id} → ${id} · ${mode}`); setTemplateDialog(false); toast.success(mode === "event-start" ? "התבנית הוחלה מתחילת האירוע" : "התבנית הוחלה מעכשיו"); };
  const enterFullscreen = async () => { try { await mapRef.current?.requestFullscreen(); } catch { toast.info("הדפדפן חסם מסך מלא"); } };
  const toggleLayer = (layer: ScoreLayer) => setLayers((current) => current.includes(layer) ? (current.length === 1 ? current : current.filter((item) => item !== layer)) : [...current, layer]);
  const chooseFamilyGroup = (key: GroupKey) => groups.find((group) => group.key === key) ?? scenario.groups[key];
  const chooseVehicleGroup = (id: number, key: GroupKey) => groups.find((group) => group.key === key && group.members.some((member) => member.id === id)) ?? chooseFamilyGroup(key);
  const muteFor = (value: "restart" | "5" | "15" | "30") => { setMuteUntil(value === "restart" ? "restart" : Date.now() + Number(value) * 60_000); toast.success(value === "restart" ? "הקול הושתק עד Restart" : `הקול הושתק ל־${value} דקות`); };

  return <div className="operator-workspace v04-operator">
    <section className="live-map-panel glass-panel" ref={mapRef}>
      <div className="section-toolbar"><div><p className="eyebrow">מפה חיה · {arena}</p><h2>{serverName}</h2><div className="live-context"><span className={`source-badge ${dataMode}`}><Radio />{dataMode === "simulation" ? "SIMULATION" : influxConfigured ? "INFLUXDB 2" : "INFLUX חסר"}</span><span><Clock3 />טיק בעוד {running ? countdown : "—"} שנ׳</span><span>{scenario.status}</span></div></div><div className="toolbar-actions"><Select value={arena} onValueChange={setArena}><SelectTrigger className="v04-arena-select"><SelectValue /></SelectTrigger><SelectContent>{state.arenas.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={mapProfile} onValueChange={setMapProfile}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.mapServers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" onClick={() => setRunning((value) => !value)}>{running ? <Pause /> : <Play />}</Button><Button variant="outline" size="icon" onClick={enterFullscreen}><Expand /></Button></div></div>
      <div className="v04-map-toolbar"><div><Button size="sm" variant={showTrace ? "default" : "outline"} onClick={() => setShowTrace((value) => !value)}>עקבה</Button><Button size="sm" variant={showScoreTrace ? "default" : "outline"} onClick={() => setShowScoreTrace((value) => !value)}>Score Trace · Sync</Button>{dataMode === "simulation" && <Button size="sm" variant={showRelations ? "default" : "outline"} onClick={() => setShowRelations((value) => !value)}><Focus />יחסים</Button>}<Select value={String(trailMinutes)} onValueChange={(value) => setTrailMinutes(Number(value))}><SelectTrigger className="trail-window-select"><SelectValue /></SelectTrigger><SelectContent>{[15,30,60,90,120].map((value) => <SelectItem key={value} value={String(value)}>{value} דק׳</SelectItem>)}</SelectContent></Select></div><span>Marker/Hull = Group · Route = Vehicle Type · Score Trace = Sync</span></div>
      <div className="map-stage">{dataMode === "influx" ? <OperationalLiveMap serverId={serverId} selectedGroupId={selected.id} selectedVehicle={selectedVehicle} vehicleTypes={state.vehicleTypes} showGrid showTrace={showTrace} showScoreTrace={showScoreTrace} trailMinutes={trailMinutes} onSelectGroup={(groupId) => { setSelectedGroupId(groupId); setSelectedVehicle(null); }} onSelectVehicle={(id, groupId) => { setSelectedGroupId(groupId); setSelectedVehicle(id); }} /> : <LiveMap serverId={serverId} tick={tick} selectedGroup={selected.key} selectedVehicle={selectedVehicle} showTrace={showTrace} showRoutes showRelations={showRelations} showGrid vehicleTypes={state.vehicleTypes} templateValues={templateValues} mapProfile={mapProfile} onSelectGroup={(key) => { const group = chooseFamilyGroup(key); setSelectedGroupId(group.id); setSelectedVehicle(null); }} onSelectVehicle={(id, key) => { const group = chooseVehicleGroup(id, key); setSelectedGroupId(group.id); setSelectedVehicle(id); }} />}</div>
    </section>

    <aside className="live-summary">
      <div className="summary-heading"><div><p className="eyebrow">קבוצות פעילות</p><h2>מצב נוכחי</h2></div><Badge variant="outline">{groups.length} קבוצות</Badge></div>
      {groups.map((group) => <GroupCard key={group.id} group={group} selected={selected.id === group.id} vehicleTypes={state.vehicleTypes} templateName={templateFor(group)?.name ?? "ללא תבנית"} onSelect={() => { setSelectedGroupId(group.id); setSelectedVehicle(null); }} onSelectVehicle={(id) => { setSelectedGroupId(group.id); setSelectedVehicle(id); }} onTemplate={() => { setSelectedGroupId(group.id); setTemplateDialog(true); }} />)}
      {selectedVehicle && <VehicleDetail group={selected} id={selectedVehicle} vehicleTypes={state.vehicleTypes} onClose={() => setSelectedVehicle(null)} />}
      <section className="operator-events glass-panel"><div className="panel-title"><div><p className="eyebrow">Structural Events</p><h3>אירועים אחרונים</h3></div><Badge variant="outline">לא Alerts</Badge></div>{events.length === 0 ? <div className="operator-events-empty">אין כרגע Event history מבצעי זמין.</div> : <div className="operator-event-list">{events.map((event) => <button type="button" key={event.id} onClick={() => { setSelectedGroupId(event.groupId); setSelectedVehicle(null); setCursor(event.cursor); }}><span className="event-state-dot" data-active={event.active} /><div><strong>{event.groupName}</strong><small>{event.id}</small></div><time>{new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(event.observedAt))}</time></button>)}</div>}</section>
    </aside>

    <section className="timeline-panel glass-panel"><div className="section-toolbar"><div><p className="eyebrow">ציונים רציפים</p><h2>קבוצות לאורך זמן</h2></div><div className="toolbar-actions"><div className="segmented-control">{(["sync", "route", "total"] as ScoreLayer[]).map((layer) => <button type="button" key={layer} className={layers.includes(layer) ? "active" : ""} onClick={() => toggleLayer(layer)}>{layer === "sync" ? "סנכרון" : layer === "route" ? "נתיב" : "כולל"}</button>)}</div><Button variant="outline" size="sm" onClick={onInvestigate}><History />תחקור</Button></div></div>{dataMode === "influx" ? <OperationalTimeline serverId={serverId} selectedGroupId={selected.id} layers={layers} cursor={cursor} onCursor={setCursor} selectedVehicle={selectedVehicle} /> : <TimelineChart serverId={serverId} selected={selected.key} layers={layers} cursor={cursor} onCursor={setCursor} selectedVehicle={selectedVehicle} />}<div className="timeline-footer"><span>Event = קבוצתיות רציפה; Alert = מצב תפעולי נפרד.</span><span>{dataMode === "influx" ? "Snapshots אמיתיים מה־Core" : "Simulation"}</span></div></section>

    {activeAlert && <section className={`active-alert v04-live-alert glass-panel ${activeAlert.severity}`}><TriangleAlert /><div><span>התראה חיה · {activeAlertGroup?.id}</span><strong>{activeAlert.title}</strong><p>{activeAlert.detail}</p></div><div className="alert-actions"><Select value={muted ? "muted" : "choose"} onValueChange={(value) => value !== "choose" && value !== "muted" && muteFor(value as "restart" | "5" | "15" | "30")}><SelectTrigger className="mute-select">{muted ? <VolumeX /> : <Volume2 />}<SelectValue placeholder="השתק" /></SelectTrigger><SelectContent><SelectItem value="choose">בחר השתקה</SelectItem>{muted && <SelectItem value="muted">מושתק</SelectItem>}<SelectItem value="restart">עד Restart</SelectItem><SelectItem value="5">5 דקות</SelectItem><SelectItem value="15">15 דקות</SelectItem><SelectItem value="30">30 דקות</SelectItem></SelectContent></Select>{muted && <Button variant="outline" size="sm" onClick={() => setMuteUntil(null)}><Volume2 />בטל השתקה</Button>}<Button size="sm" onClick={() => toast.success("ההתראה סומנה כטופלה; היא לא הופכת לאירוע") }><BellRing />טופל</Button></div></section>}

    <TemplateOverrideDialog open={templateDialog} onOpenChange={setTemplateDialog} group={selected} activeId={activeTemplateId} templates={state.templates} vehicleTypes={state.vehicleTypes} onChoose={chooseTemplate} />
    <div className="v04-source-switch"><span>מקור נתונים</span><button type="button" className={dataMode === "simulation" ? "active" : ""} onClick={() => onDataModeChange("simulation")}>SIM</button><button type="button" className={dataMode === "influx" ? "active" : ""} onClick={() => onDataModeChange("influx")}>INFLUX</button></div>
  </div>;
}
