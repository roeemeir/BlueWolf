"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  Check,
  Clock3,
  Expand,
  Focus,
  History,
  Layers3,
  Pause,
  Play,
  Radio,
  Settings2,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getServerScenario,
  type DataMode,
  type DemoGroup,
  type SyncTemplate,
  type VehicleType,
} from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";
import {
  LiveMap,
  ScoreRing,
  TemplatePreview,
  TimelineChart,
  VehicleIconGlyph,
  groupLineColor,
  type GroupKey,
  type ScoreLayer,
} from "./visuals";

const scoreTone = (score: number) => score >= 80 ? "good" : score < 50 ? "low" : "medium";
const scoreLabel = (score: number) => score >= 80 ? "טוב" : score < 50 ? "נמוך" : "בינוני";
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function TypeGlyph({ type, color }: { type?: VehicleType; color: string }) {
  return <svg className="member-type-icon" viewBox="-15 -15 30 30" aria-hidden="true"><VehicleIconGlyph icon={type?.icon ?? "rover"} color={color} /></svg>;
}

function routeNameForGroup(group: DemoGroup, routes: ReturnType<typeof useWorkspace>["state"]["routes"]) {
  const matching = routes.find((route) => route.family === group.family);
  return matching ? `${group.name} · ${matching.name}` : group.name;
}

function GroupCard({ group, displayName, selected, vehicleTypes, templateName, onSelect, onSelectVehicle, onTemplate }: { group: DemoGroup; displayName: string; selected: boolean; vehicleTypes: VehicleType[]; templateName: string; onSelect: () => void; onSelectVehicle: (id: number) => void; onTemplate: () => void }) {
  const groupColor = groupLineColor[group.key];
  return <article className={`group-card v04-group-card glass-panel ${selected ? "active" : ""} tone-${scoreTone(group.total)}`}>
    <button type="button" className="group-card-select" onClick={onSelect}>
      <div className="group-card-head"><div><span className="v04-group-dot" style={{ background: groupColor }} /><strong>{displayName}</strong><p>{group.subtitle}</p></div><ScoreRing value={group.total} color={groupColor} /></div>
      <div className="score-trio"><span>סנכרון<b>{group.sync}</b></span><span>נתיב<b>{group.route}</b></span><span>אמינות<b>{group.confidence}%</b></span></div>
    </button>
    <div className={`reason-line ${scoreTone(group.total)}`}><span>{scoreLabel(group.total)}</span><div><strong>גורם מוביל</strong>{group.reason}</div></div>
    <div className="active-template-row"><div><Layers3 /><span>תבנית</span><b>{templateName.replaceAll("חיוך", "שרשרת")}</b></div><Button variant="outline" size="sm" onClick={onTemplate}><Settings2 />החלפה</Button></div>
    <div className="member-score-list">{group.members.map((member) => { const type = vehicleTypes.find((item) => item.id === member.typeId); return <button type="button" key={member.id} onClick={() => onSelectVehicle(member.id)}><TypeGlyph type={type} color={groupColor} /><span><strong>רכב {member.id}</strong><small>{type?.name ?? "לא מוגדר"}</small></span><b className={`score-number ${scoreTone(member.score)}`}>{member.score}</b></button>; })}</div>
  </article>;
}

function VehicleDetail({ group, id, vehicleTypes, onClose }: { group: DemoGroup; id: number; vehicleTypes: VehicleType[]; onClose: () => void }) {
  const vehicle = group.members.find((item) => item.id === id) ?? group.members[0];
  const type = vehicleTypes.find((item) => item.id === vehicle.typeId);
  const color = groupLineColor[group.key];
  return <section className="vehicle-detail v04-vehicle-detail glass-panel">
    <header><div className="vehicle-detail-identity"><TypeGlyph type={type} color={color} /><div><strong>רכב {id}</strong><p>{type?.name} · צבע = קבוצה</p></div></div><Button variant="ghost" size="icon-sm" onClick={onClose}><X /></Button></header>
    <div className="vehicle-score-row"><ScoreRing value={vehicle.score} color={color} size="large" /><div><span>הסיבה העיקרית</span><strong>{group.key === "so" && vehicle.score < group.total ? "תזמון פנייה / פאזה" : group.key === "si" ? "יחס זוויתי / משיק" : "ביצוע תקין"}</strong><p>הציון האישי אינו משפיע על חברות בקבוצה.</p></div></div>
    <dl><div><dt>כולל</dt><dd>{vehicle.score}</dd></div><div><dt>סנכרון</dt><dd>{vehicle.sync}</dd></div><div><dt>נתיב</dt><dd>{vehicle.route}</dd></div><div><dt>פאזה</dt><dd>{Math.round(vehicle.phase * 100)}%</dd></div><div><dt>אמינות</dt><dd>{vehicle.confidence}%</dd></div><div><dt>מהירות עבודה</dt><dd>{type?.workSpeedKmh ?? 45} קמ״ש</dd></div></dl>
  </section>;
}

function estimateTemplateScores(group: DemoGroup, active?: SyncTemplate, preview?: SyncTemplate) {
  if (!preview) return { total: group.total, sync: group.sync, route: group.route, delta: 0 };
  if (active?.id === preview.id) return { total: group.total, sync: group.sync, route: group.route, delta: 0 };
  const activeValues = active?.values ?? [];
  const previewValues = preview.values ?? [];
  const mismatch = previewValues.reduce((sum, value, index) => sum + Math.abs(value - (activeValues[index] ?? value)), 0);
  const normalized = group.family === "SI" ? mismatch / Math.max(1, previewValues.length * 120) : mismatch / Math.max(1, previewValues.length * 2);
  const sync = Math.round(clamp(group.sync + (0.16 - Math.min(0.35, normalized)) * 24));
  const route = group.route;
  const total = Math.round(clamp(sync * 0.75 + route * 0.25));
  return { total, sync, route, delta: total - group.total };
}

function TemplateOverrideDialog({ open, onOpenChange, group, activeId, templates, vehicleTypes, onChoose }: { open: boolean; onOpenChange: (open: boolean) => void; group: DemoGroup; activeId: string; templates: SyncTemplate[]; vehicleTypes: VehicleType[]; onChoose: (id: string, mode: "now" | "event-start") => void }) {
  const candidates = templates.filter((template) => template.family === group.family);
  const [previewId, setPreviewId] = useState(activeId);
  const [mode, setMode] = useState<"now" | "event-start">("now");
  const active = candidates.find((item) => item.id === activeId);
  const preview = candidates.find((item) => item.id === previewId) ?? candidates[0];
  const expected = estimateTemplateScores(group, active, preview);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="glass-dialog v04-template-dialog" dir="rtl">
    <DialogHeader><DialogTitle>החלפת תבנית · {group.name}</DialogTitle><DialogDescription>התצוגה מציירת את החוק שנבחר. הציון הצפוי הוא אומדן דטרמיניסטי עד שהחישוב מחובר ישירות לליבת Replay.</DialogDescription></DialogHeader>
    <div className="v04-template-dialog-grid">
      <div className="template-choice-list">{candidates.map((template) => <button type="button" key={template.id} className={preview?.id === template.id ? "active" : ""} onClick={() => setPreviewId(template.id)}><span><strong>{template.name.replaceAll("חיוך", "שרשרת")}</strong><small>{template.constellation}</small></span>{template.id === activeId && <Badge>פעילה</Badge>}</button>)}</div>
      <div className="v04-template-large-preview"><TemplatePreview family={group.family} values={preview?.values ?? []} vehicleTypes={vehicleTypes} soKinds={preview?.soSpec?.chain} /><div className="v04-template-facts"><span>כולל צפוי<b>{expected.total}</b></span><span>סנכרון צפוי<b>{expected.sync}</b></span><span>נתיב צפוי<b>{expected.route}</b></span><span>שינוי<b>{expected.delta >= 0 ? "+" : ""}{expected.delta}</b></span></div></div>
    </div>
    <div className="v04-apply-mode"><strong>מאיזה זמן להחיל?</strong><div className="segmented-control"><button type="button" className={mode === "now" ? "active" : ""} onClick={() => setMode("now")}>החל מעכשיו</button><button type="button" className={mode === "event-start" ? "active" : ""} onClick={() => setMode("event-start")}>מתחילת האירוע</button></div><p>{mode === "now" ? "האירוע נשאר רציף ונשמרת נקודת שינוי תבנית." : "האירוע הנוכחי יחושב מחדש מתחילת הקבוצתיות עם התבנית שנבחרה."}</p></div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button><Button disabled={!preview || (preview.id === activeId && mode === "now")} onClick={() => preview && onChoose(preview.id, mode)}><Check />החל תבנית</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function OperatorView({ serverId, serverName, dataMode, onDataModeChange, onInvestigate }: { serverId: string; serverName: string; dataMode: DataMode; onDataModeChange: (mode: DataMode) => void; onInvestigate: () => void }) {
  const { state, save } = useWorkspace();
  const scenario = getServerScenario(serverId);
  const [selectedGroup, setSelectedGroup] = useState<GroupKey>("so");
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [running, setRunning] = useState(true);
  const [tick, setTick] = useState(0);
  const [countdown, setCountdown] = useState(5);
  const [showTrace, setShowTrace] = useState(true);
  const [showRelations, setShowRelations] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [layers, setLayers] = useState<ScoreLayer[]>(["total", "sync", "route"]);
  const [windowMinutes, setWindowMinutes] = useState<30 | 60 | 90 | 120>(120);
  const [cursor, setCursor] = useState(92);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [mutedUntil, setMutedUntil] = useState<number>(0);
  const [mapProfile, setMapProfile] = useState(state.settings.defaultMap);
  const mapRef = useRef<HTMLDivElement>(null);
  const influxConfigured = Boolean(state.influx.url.trim() && state.influx.token.trim());

  useEffect(() => {
    if (!running || (dataMode === "influx" && !influxConfigured)) return;
    const timer = window.setInterval(() => setCountdown((value) => {
      if (value <= 1) { setTick((current) => current + 1); return 5; }
      return value - 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [running, dataMode, influxConfigured]);

  const selected = scenario.groups[selectedGroup];
  const overrideKey = `${serverId}:${selected.id}`;
  const activeTemplateId = state.activeTemplateOverrides[overrideKey] ?? selected.templateId;
  const templateFor = (key: GroupKey) => {
    const group = scenario.groups[key];
    const id = state.activeTemplateOverrides[`${serverId}:${group.id}`] ?? group.templateId;
    return state.templates.find((item) => item.id === id) ?? state.templates.find((item) => item.family === group.family);
  };
  const activeTemplate = state.templates.find((item) => item.id === activeTemplateId) ?? state.templates.find((item) => item.family === selected.family);
  const templateValues = { si: templateFor("si")?.values ?? [120, 120], so: templateFor("so")?.values ?? [2, 0] };
  const activeAlertGroup = Object.values(scenario.groups).find((group) => group.alert);
  const activeAlert = activeAlertGroup?.alert;
  const muted = mutedUntil === Number.POSITIVE_INFINITY || mutedUntil > Date.now();

  const chooseTemplate = async (id: string, mode: "now" | "event-start") => {
    const next = {
      ...state,
      activeTemplateOverrides: { ...state.activeTemplateOverrides, [overrideKey]: id },
      templateApplications: { ...state.templateApplications, [overrideKey]: { templateId: id, mode, appliedAt: new Date().toISOString() } },
    };
    await save(next, "operator", "template-override", `${selected.id} → ${id} · ${mode}`);
    setTemplateDialog(false);
    toast.success(mode === "event-start" ? "התבנית הוחלה מתחילת האירוע; התחקור יסומן לחישוב מחדש" : "התבנית הוחלה מעכשיו");
  };

  const enterFullscreen = async () => { try { await mapRef.current?.requestFullscreen(); } catch { toast.info("הדפדפן חסם מסך מלא"); } };
  const toggleLayer = (layer: ScoreLayer) => setLayers((current) => current.includes(layer) ? (current.length === 1 ? current : current.filter((item) => item !== layer)) : [...current, layer]);
  const muteFor = (value: "restart" | "5" | "15" | "30" | "off") => {
    if (value === "off") setMutedUntil(0);
    else if (value === "restart") setMutedUntil(Number.POSITIVE_INFINITY);
    else setMutedUntil(Date.now() + Number(value) * 60_000);
    toast.success(value === "off" ? "הצליל הופעל" : `ההתראות הקוליות הושתקו ${value === "restart" ? "עד הפעלה מחדש" : `ל־${value} דקות`}`);
  };

  const startLabel = useMemo(() => {
    const startHour = 19 - Math.floor(windowMinutes / 60);
    const startMinute = 60 - (windowMinutes % 60 || 60);
    return `${String(startHour + (startMinute === 60 ? 1 : 0)).padStart(2, "0")}:${String(startMinute % 60).padStart(2, "0")}`;
  }, [windowMinutes]);

  return <div className="operator-workspace v04-operator">
    <section className="live-map-panel glass-panel" ref={mapRef}>
      <div className="section-toolbar"><div><p className="eyebrow">מפה חיה · ללא תלות בזירה</p><h2>{serverName}</h2><div className="live-context"><span className={`source-badge ${dataMode}`}><Radio />{dataMode === "simulation" ? "SIMULATION" : influxConfigured ? "INFLUXDB 2" : "INFLUX חסר"}</span><span><Clock3 />טיק בעוד {running ? countdown : "—"} שנ׳</span><span>{scenario.status}</span></div></div><div className="toolbar-actions"><Select value={mapProfile} onValueChange={setMapProfile}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.mapServers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" onClick={() => setRunning((value) => !value)}>{running ? <Pause /> : <Play />}</Button><Button variant="outline" size="icon" onClick={enterFullscreen}><Expand /></Button></div></div>
      <div className="v04-map-toolbar"><div><Button size="sm" variant={showTrace ? "default" : "outline"} onClick={() => setShowTrace((value) => !value)}>עקבה · 5s</Button><Button size="sm" variant={showRoutes ? "default" : "outline"} onClick={() => setShowRoutes((value) => !value)}>נתיבים</Button><Button size="sm" variant={showRelations ? "default" : "outline"} onClick={() => setShowRelations((value) => !value)}><Focus />תבנית</Button><Button size="sm" variant={showGrid ? "default" : "outline"} onClick={() => setShowGrid((value) => !value)}>מפת הנדסה</Button></div><span>Live: צבע = קבוצה · Route: צבע = סוג רכב · Heading פיזי אינו מתהפך ב־RTL</span></div>
      <div className="map-stage"><LiveMap serverId={serverId} tick={tick} selectedGroup={selectedGroup} selectedVehicle={selectedVehicle} showTrace={showTrace} showRoutes={showRoutes} showRelations={showRelations} showGrid={showGrid} vehicleTypes={state.vehicleTypes} templateValues={templateValues} mapProfile={mapProfile} onSelectGroup={(key) => { setSelectedGroup(key); setSelectedVehicle(null); }} onSelectVehicle={(id, group) => { setSelectedGroup(group); setSelectedVehicle(id); }} /></div>
    </section>

    <aside className="live-summary"><div className="summary-heading"><div><p className="eyebrow">קבוצות פעילות</p><h2>מצב נוכחי</h2></div><Badge variant="outline">{Object.keys(scenario.groups).length} קבוצות</Badge></div>{(["si", "so"] as GroupKey[]).map((key) => <GroupCard key={key} group={scenario.groups[key]} displayName={routeNameForGroup(scenario.groups[key], state.routes)} selected={selectedGroup === key} vehicleTypes={state.vehicleTypes} templateName={templateFor(key)?.name ?? "ללא תבנית"} onSelect={() => { setSelectedGroup(key); setSelectedVehicle(null); }} onSelectVehicle={(id) => { setSelectedGroup(key); setSelectedVehicle(id); }} onTemplate={() => { setSelectedGroup(key); setTemplateDialog(true); }} />)}{selectedVehicle && <VehicleDetail group={selected} id={selectedVehicle} vehicleTypes={state.vehicleTypes} onClose={() => setSelectedVehicle(null)} />}</aside>

    <section className="timeline-panel glass-panel">
      <div className="section-toolbar"><div><p className="eyebrow">ציונים רציפים · כל הקבוצות</p><h2>כולל / סנכרון / נתיב</h2></div><div className="toolbar-actions"><div className="segmented-control">{(["total", "sync", "route"] as ScoreLayer[]).map((layer) => <button type="button" key={layer} className={layers.includes(layer) ? "active" : ""} onClick={() => toggleLayer(layer)}>{layer === "total" ? "כולל" : layer === "sync" ? "סנכרון" : "נתיב"}</button>)}</div><div className="segmented-control">{([30, 60, 90, 120] as const).map((window) => <button type="button" key={window} className={windowMinutes === window ? "active" : ""} onClick={() => setWindowMinutes(window)}>{window}</button>)}</div><Button variant="outline" size="sm" onClick={onInvestigate}><History />תחקור</Button></div></div>
      <TimelineChart serverId={serverId} selected={selectedGroup} layers={layers} cursor={cursor} onCursor={setCursor} fromLabel={startLabel} toLabel="19:00" selectedVehicle={selectedVehicle} />
      <div className="v08-global-time"><label><span>ציר זמן משותף</span><b>{Math.round(cursor / 119 * windowMinutes)} / {windowMinutes} דק׳</b><input type="range" min="0" max="119" value={cursor} onChange={(event) => { setCursor(Number(event.target.value)); setTick(Math.round(Number(event.target.value) / 119 * 240)); }} /></label></div>
      <div className="timeline-footer"><span>כולל = רציף · סנכרון = מקווקו · נתיב = מנוקד</span><span>Event bands מייצגים קבוצתיות יציבה, לא התראות</span></div>
    </section>

    {activeAlert && <section className={`active-alert v04-live-alert glass-panel ${activeAlert.severity}`}><TriangleAlert /><div><span>התראה חיה · {activeAlertGroup?.id}</span><strong>{activeAlert.title}</strong><p>{activeAlert.detail}</p>{muted && <small>הצליל מושתק; ההתראה החזותית נשארת פעילה.</small>}</div><div className="alert-actions"><Select value={muted ? "muted" : "active"} onValueChange={(value) => { if (value !== "muted" && value !== "active") muteFor(value as "restart" | "5" | "15" | "30" | "off"); }}><SelectTrigger className="v08-mute-select">{muted ? <VolumeX /> : <Volume2 />}<SelectValue placeholder={muted ? "מושתק" : "צליל פעיל"} /></SelectTrigger><SelectContent><SelectItem value="restart">עד הפעלה מחדש</SelectItem><SelectItem value="5">5 דקות</SelectItem><SelectItem value="15">15 דקות</SelectItem><SelectItem value="30">30 דקות</SelectItem><SelectItem value="off">בטל השתקה</SelectItem></SelectContent></Select><Button size="sm" onClick={() => toast.success("ההתראה סומנה כטופלה; לא נוצר Event") }><BellRing />טופל</Button></div></section>}

    <TemplateOverrideDialog open={templateDialog} onOpenChange={setTemplateDialog} group={selected} activeId={activeTemplateId} templates={state.templates} vehicleTypes={state.vehicleTypes} onChoose={chooseTemplate} />
    <div className="v04-source-switch"><span>מקור נתונים</span><button type="button" className={dataMode === "simulation" ? "active" : ""} onClick={() => onDataModeChange("simulation")}>SIM</button><button type="button" className={dataMode === "influx" ? "active" : ""} onClick={() => onDataModeChange("influx")}>INFLUX</button></div>
  </div>;
}
