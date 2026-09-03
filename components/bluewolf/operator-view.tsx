"use client";

import { useEffect, useRef, useState } from "react";
import {
  BellRing,
  CalendarClock,
  Check,
  ChevronLeft,
  Clock3,
  Crosshair,
  Database,
  Expand,
  Eye,
  Focus,
  History,
  Layers3,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Route,
  Satellite,
  ScanLine,
  Settings2,
  Sparkles,
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getServerScenario, type DataMode, type DemoGroup, type VehicleType } from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";
import { LiveMap, ScoreRing, TemplatePreview, TimelineChart, VehicleIconGlyph, groupLineColor, type GroupKey, type ScoreLayer } from "./visuals";

const scoreTone = (score: number) => score >= 80 ? "good" : score < 50 ? "low" : "medium";
const scoreLabel = (score: number) => score >= 80 ? "טוב" : score < 50 ? "נמוך" : "בינוני";

function TypeGlyph({ type }: { type?: VehicleType }) {
  return <svg className="member-type-icon" viewBox="-15 -15 30 30" aria-hidden="true"><VehicleIconGlyph icon={type?.icon ?? "rover"} color={type?.color ?? "#7f97a5"} /></svg>;
}

function GroupCard({
  group,
  selected,
  vehicleTypes,
  templateName,
  onSelect,
  onSelectVehicle,
  onTemplate,
}: {
  group: DemoGroup;
  selected: boolean;
  vehicleTypes: VehicleType[];
  templateName: string;
  onSelect: () => void;
  onSelectVehicle: (id: number) => void;
  onTemplate: () => void;
}) {
  return (
    <article className={`group-card glass-panel ${selected ? "active" : ""} tone-${scoreTone(group.total)}`}>
      <button type="button" className="group-card-select" onClick={onSelect}>
        <div className="group-card-head">
          <div><span className={`status-dot ${group.key}`} /><strong>{group.name}</strong><p>{group.subtitle}</p></div>
          <ScoreRing value={group.total} color={group.color} />
        </div>
        <div className="score-trio"><span>סנכרון<b>{group.sync}</b></span><span>נתיב<b>{group.route}</b></span><span>אמינות<b>{group.confidence}%</b></span></div>
      </button>
      <div className={`reason-line ${scoreTone(group.total)}`}><span>{scoreLabel(group.total)}</span><div><strong>גורם מוביל</strong>{group.reason}</div></div>
      <div className="active-template-row"><div><Sparkles /><span>תבנית פעילה</span><b>{templateName}</b></div><Button variant="outline" size="sm" onClick={onTemplate}><Settings2 />החלפה</Button></div>
      <div className="member-score-list">
        {group.members.map((member) => {
          const type = vehicleTypes.find((item) => item.id === member.typeId);
          return <button type="button" key={member.id} onClick={() => onSelectVehicle(member.id)}><TypeGlyph type={type} /><span><strong>רכב {member.id}</strong><small>{type?.name ?? "לא מוגדר"}</small></span><b className={`score-number ${scoreTone(member.score)}`}>{member.score}</b><ChevronLeft /></button>;
        })}
      </div>
    </article>
  );
}

function VehicleDetail({ group, id, vehicleTypes, onClose }: { group: DemoGroup; id: number; vehicleTypes: VehicleType[]; onClose: () => void }) {
  const vehicle = group.members.find((item) => item.id === id) ?? group.members[0];
  const type = vehicleTypes.find((item) => item.id === vehicle.typeId);
  return (
    <section className="vehicle-detail glass-panel">
      <header><div className="vehicle-detail-identity"><TypeGlyph type={type} /><div><strong>רכב {id}</strong><p>{type?.name} · פעיל · מידע תקף</p></div></div><Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="סגירת פירוט רכב"><X /></Button></header>
      <div className="vehicle-score-row"><ScoreRing value={vehicle.score} color={type?.color ?? group.color} size="large" /><div><span>הסיבה העיקרית</span><strong>{group.key === "so" && vehicle.score < group.total ? "כניסה מאוחרת לפנייה" : group.key === "si" ? "הפרש זווית יציב" : "פאזה ורבע תקינים"}</strong><p>{group.key === "so" && vehicle.score < group.total ? "14 שניות מעבר לתזמון הרצוי" : "בתוך תחום הציון התקין"}</p></div></div>
      <dl><div><dt>סנכרון</dt><dd>{vehicle.sync}</dd></div><div><dt>נתיב</dt><dd>{vehicle.route}</dd></div><div><dt>מהירות</dt><dd>{type?.workSpeedKmh ?? 45} קמ״ש</dd></div><div><dt>מחזור</dt><dd>04:18 דק׳</dd></div><div><dt>פאזה</dt><dd>{Math.round(vehicle.phase * 100)}%</dd></div><div><dt>אמינות</dt><dd>{vehicle.confidence}%</dd></div></dl>
    </section>
  );
}

function TemplateOverrideDialog({ open, onOpenChange, group, activeId, templates, onChoose }: { open: boolean; onOpenChange: (open: boolean) => void; group: DemoGroup; activeId: string; templates: ReturnType<typeof useWorkspace>["state"]["templates"]; onChoose: (id: string) => void }) {
  const candidates = templates;
  const [previewId, setPreviewId] = useState(activeId);
  const preview = candidates.find((item) => item.id === previewId) ?? candidates.find((item) => item.id === activeId) ?? candidates[0];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-dialog template-override-dialog" dir="rtl">
        <DialogHeader><DialogTitle>החלפת תבנית ל־{group.name}</DialogTitle><DialogDescription>התצוגה מטילה כל חלופה על הקבוצה הנוכחית. ב־SI מוצגות הזוויות; ב־SO מוצגים הרבעים, ההטיות ותזמון הפניות.</DialogDescription></DialogHeader>
        <div className="template-compare-layout">
          <div className="template-choice-list">{candidates.map((template) => <button type="button" key={template.id} className={preview?.id === template.id ? "active" : ""} onClick={() => setPreviewId(template.id)}><span><strong>{template.name}</strong><small>{template.law}</small></span>{template.id === activeId && <Badge>פעילה</Badge>}</button>)}</div>
          <div className="template-projection"><div><p className="eyebrow">הטלה על הקבוצה</p><h3>{preview?.name}</h3></div><TemplatePreview family={group.family} values={preview?.values ?? []} /><div className="projection-facts"><span>התאמה חזויה<b>{preview?.id === activeId ? group.sync : Math.min(99, group.sync + (preview?.id.endsWith("wave") || preview?.id.endsWith("60") ? 12 : 4))}</b></span><span>רכבים<b>{group.members.length}</b></span><span>חוקיות<b>{group.family === "SI" ? "זוויות" : "רבעים + פניות"}</b></span></div></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button><Button disabled={!preview || preview.id === activeId} onClick={() => preview && onChoose(preview.id)}><Check />החל מעכשיו</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
  const [showRoutes, setShowRoutes] = useState(true);
  const [showRelations, setShowRelations] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [layers, setLayers] = useState<ScoreLayer[]>(["sync"]);
  const [cursor, setCursor] = useState(119);
  const [alertAcknowledged, setAlertAcknowledged] = useState(false);
  const [muteLabel, setMuteLabel] = useState<string | null>(null);
  const [mapProfile, setMapProfile] = useState(state.settings.defaultMap);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [timeDialog, setTimeDialog] = useState(false);
  const [rangeMinutes, setRangeMinutes] = useState(60);
  const [from, setFrom] = useState("2026-09-03T07:30");
  const [to, setTo] = useState("2026-09-03T08:30");
  const mapRef = useRef<HTMLDivElement>(null);
  const influxConfigured = Boolean(state.influx.url.trim() && state.influx.token.trim() && state.influx.mappings.every((item) => item.bucket && item.measurement && item.key));

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
  const activeTemplate = state.templates.find((item) => item.id === activeTemplateId) ?? state.templates.find((item) => item.family === selected.family);
  const templateFor = (key: GroupKey) => {
    const group = scenario.groups[key];
    const id = state.activeTemplateOverrides[`${serverId}:${group.id}`] ?? group.templateId;
    return state.templates.find((item) => item.id === id) ?? state.templates.find((item) => item.family === group.family);
  };
  const templateValues = { si: templateFor("si")?.values ?? [120, 120, 120], so: templateFor("so")?.values ?? [2, 0, 2] };
  const selectedMix = Object.entries(selected.members.reduce<Record<string, number>>((counts, member) => {
    const typeName = state.vehicleTypes.find((item) => item.id === member.typeId)?.name ?? member.typeId;
    counts[typeName] = (counts[typeName] ?? 0) + 1;
    return counts;
  }, {})).map(([name, count]) => `${name}×${count}`).join(" · ");
  const relevantTemplates = state.templates.filter((template) => template.family === selected.family && template.mix === selectedMix);
  const layerLabels: Record<ScoreLayer, string> = { total: "כולל", sync: "סנכרון", route: "נתיב" };
  const toggleLayer = (layer: ScoreLayer) => setLayers((current) => current.includes(layer) ? (current.length === 1 ? current : current.filter((item) => item !== layer)) : [...current, layer]);
  const activeAlert = Object.values(scenario.groups).find((group) => group.alert)?.alert;
  const activeAlertGroup = Object.values(scenario.groups).find((group) => group.alert);

  const chooseTemplate = async (id: string) => {
    const next = { ...state, activeTemplateOverrides: { ...state.activeTemplateOverrides, [overrideKey]: id } };
    await save(next, "operator", "template-override", `${selected.id} → ${id}`);
    setTemplateDialog(false);
    toast.success("התבנית הוחלפה מעכשיו; האירוע יתועד כבחירה ידנית");
  };
  const applyPreset = (minutes: number) => { setRangeMinutes(minutes); setCursor(119); toast.success(`הגרף מציג ${minutes < 60 ? minutes + " דקות" : minutes / 60 + " שעות"} אחורה`); };
  const enterFullscreen = async () => { try { await mapRef.current?.requestFullscreen(); } catch { toast.info("הדפדפן חסם מעבר למסך מלא"); } };

  return (
    <div className="operator-workspace">
      <section className="live-map-panel glass-panel" ref={mapRef}>
        <div className="section-toolbar">
          <div><p className="eyebrow">מפה חיה · {scenario.arena}</p><h2>{serverName}</h2><div className="live-context"><span className={`source-badge ${dataMode}`}><Radio />{dataMode === "simulation" ? "SIMULATION" : influxConfigured ? "INFLUXDB 2 · מוגדר" : "INFLUXDB 2 · חסרה תצורה"}</span><span><Clock3 />הטיק הבא בעוד {running && (dataMode === "simulation" || influxConfigured) ? countdown : "—"} שנ׳</span><span>{scenario.status}</span></div></div>
          <div className="toolbar-actions">
            <Select value={mapProfile} onValueChange={(value) => { setMapProfile(value); toast.success(`מפת הרקע הוחלפה ל${state.mapServers.find((item) => item.id === value)?.name}`); }}><SelectTrigger className="map-profile-select"><Satellite /><SelectValue /></SelectTrigger><SelectContent>{state.mapServers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
            <label className="switch-label"><Switch checked={showRoutes} onCheckedChange={setShowRoutes} /> נתיבים</label>
            <label className="switch-label"><Switch checked={showTrace} onCheckedChange={setShowTrace} /> עקבות</label>
            <Button variant="outline" size="sm" onClick={() => setRunning((value) => !value)}>{running ? <Pause /> : <Play />}{running ? "השהה אנימציה" : "המשך"}</Button>
            <Button variant="outline" size="icon-sm" onClick={enterFullscreen} aria-label="מסך מלא"><Expand /></Button>
          </div>
        </div>
        <div className="map-stage">
          <div className={dataMode === "influx" && !influxConfigured ? "map-source-stale" : ""}><LiveMap serverId={serverId} tick={tick} selectedGroup={selectedGroup} selectedVehicle={selectedVehicle} showTrace={showTrace} showRoutes={showRoutes} showRelations={showRelations} showGrid={showGrid} vehicleTypes={state.vehicleTypes} templateValues={templateValues} mapProfile={mapProfile} onSelectGroup={(group) => { setSelectedGroup(group); setSelectedVehicle(null); }} onSelectVehicle={(id, group) => { setSelectedGroup(group); setSelectedVehicle(id); }} /></div>
          <button type="button" className={`map-floating top-start mode-button ${dataMode}`} onClick={() => { const next = dataMode === "simulation" ? "influx" : "simulation"; onDataModeChange(next); if (next === "influx" && !influxConfigured) toast.warning("מצב Influx נבחר; נדרש להשלים URL, Token ומיפוי במצב מפתחים"); }}><ScanLine />{dataMode === "simulation" ? "סימולציה חיה" : influxConfigured ? "Influx מוגדר" : "Influx ממתין"}<span>5 שנ׳</span></button>
          {dataMode === "influx" && !influxConfigured && <div className="influx-empty-overlay"><Database /><strong>מצב Influx נבחר — החיבור עדיין לא הוגדר</strong><p>השלם URL, Token ופרטי Bucket / Measurement / Key במצב מפתחים. המפה שמתחת היא תמונת הסימולציה האחרונה ואינה מתקדמת.</p><Button variant="outline" size="sm" onClick={() => onDataModeChange("simulation")}>חזור לסימולציה</Button></div>}
          <div className="map-layer-dock glass-panel">
            <Button variant={showGrid ? "secondary" : "ghost"} size="icon-sm" onClick={() => setShowGrid((value) => !value)} aria-label="רשת קואורדינטות"><Layers3 /></Button>
            <Button variant={showRelations ? "secondary" : "ghost"} size="icon-sm" onClick={() => setShowRelations((value) => !value)} aria-label="יחסי סנכרון"><Route /></Button>
            <Button variant="ghost" size="icon-sm" onClick={() => toast.success(`המפה ממוקדת על ${selected.name}`)} aria-label="מיקוד בקבוצה"><Crosshair /></Button>
          </div>
          <div className="map-floating bottom-end"><Focus />מיקוד: {selected.name} · {activeTemplate?.name}</div>
        </div>
      </section>

      <aside className="live-summary">
        <div className="summary-heading"><div><p className="eyebrow">תמונת מצב</p><h2>2 קבוצות פעילות</h2></div><Button variant="outline" size="icon-sm" onClick={() => { setTick((value) => value + 1); setCountdown(5); toast.success("התקבל טיק חדש"); }} aria-label="רענון נתונים"><RefreshCw /></Button></div>
        {activeAlert && activeAlertGroup && !alertAcknowledged && <div className={`active-alert rich-alert glass-panel ${activeAlert.severity}`}><TriangleAlert /><div><div><Badge variant="outline">{activeAlertGroup.id}</Badge><span>נפתח לפני 01:42</span></div><strong>{activeAlert.title}</strong><p>{activeAlert.detail}</p><dl><span>סנכרון<b>{activeAlertGroup.sync}</b></span><span>סף חוקי<b>≥ 50</b></span><span>אמינות<b>{activeAlertGroup.confidence}%</b></span></dl></div><div className="alert-actions"><Button size="sm" variant="outline" onClick={() => { setSelectedGroup(activeAlertGroup.key); toast.success("הקבוצה הודגשה במפה"); }}><Focus />מיקוד</Button><Button size="sm" onClick={() => { setAlertAcknowledged(true); toast.success("ההתראה אושרה; החיווי יישאר עד התאוששות"); }}><Check />אושר</Button></div></div>}
        {activeAlert && alertAcknowledged && <button type="button" className="acknowledged-alert" onClick={() => setAlertAcknowledged(false)}><BellRing />התראה מאושרת · החיווי נשאר פעיל</button>}
        {(["so", "si"] as GroupKey[]).map((key) => <GroupCard key={key} group={scenario.groups[key]} selected={selectedGroup === key} vehicleTypes={state.vehicleTypes} templateName={templateFor(key)?.name ?? "ללא תבנית"} onSelect={() => { setSelectedGroup(key); setSelectedVehicle(null); }} onSelectVehicle={(id) => { setSelectedGroup(key); setSelectedVehicle(id); }} onTemplate={() => { setSelectedGroup(key); setTemplateDialog(true); }} />)}
        {selectedVehicle && <VehicleDetail id={selectedVehicle} group={selected} vehicleTypes={state.vehicleTypes} onClose={() => setSelectedVehicle(null)} />}
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="wide-button">{muteLabel ? <VolumeX /> : <Volume2 />}{muteLabel ? `מושתק · ${muteLabel}` : "השתקת התראות"}</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="glass-menu"><DropdownMenuLabel>השתקת כל הצלילים</DropdownMenuLabel><DropdownMenuSeparator />{["5 דקות", "15 דקות", "30 דקות", "עד הפעלה מחדש"].map((label) => <DropdownMenuItem key={label} onClick={() => { setMuteLabel(label); toast.success(`כל הצלילים הושתקו: ${label}`); }}>{label}</DropdownMenuItem>)}{muteLabel && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setMuteLabel(null)}><Volume2 />הפעל צלילים</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu>
      </aside>

      <section className="timeline-panel glass-panel">
        <div className="section-toolbar timeline-toolbar">
          <div><p className="eyebrow">ציר זמן · שתי הקבוצות</p><h2>{rangeMinutes < 60 ? rangeMinutes + " הדקות האחרונות" : rangeMinutes / 60 + " השעות האחרונות"}</h2><p className="timeline-copy">המפה נשארת חיה; סמן הזמן והטווח משפיעים רק על הגרף.</p></div>
          <div className="chart-controls">
            <div className="segmented-control">{(["total", "sync", "route"] as ScoreLayer[]).map((layer) => <button type="button" key={layer} className={layers.includes(layer) ? "active" : ""} onClick={() => toggleLayer(layer)}>{layerLabels[layer]}</button>)}</div>
            <Select value={String(rangeMinutes)} onValueChange={(value) => applyPreset(Number(value))}><SelectTrigger className="range-select"><CalendarClock /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">30 דקות</SelectItem><SelectItem value="60">שעה</SelectItem><SelectItem value="180">3 שעות</SelectItem><SelectItem value="360">6 שעות</SelectItem><SelectItem value="720">12 שעות</SelectItem></SelectContent></Select>
            <Dialog open={timeDialog} onOpenChange={setTimeDialog}><DialogTrigger asChild><Button variant="outline" size="sm"><Clock3 />טווח מותאם</Button></DialogTrigger><DialogContent className="glass-dialog" dir="rtl"><DialogHeader><DialogTitle>בחירת זמן אחורה</DialogTitle><DialogDescription>ניתן לבחור כל חלון היסטורי. המפה החיה אינה זזה.</DialogDescription></DialogHeader><div className="time-range-form"><label><span>התחלה</span><input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><span>סיום</span><input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label></div><DialogFooter><Button variant="outline" onClick={() => setTimeDialog(false)}>ביטול</Button><Button onClick={() => { if (new Date(from) >= new Date(to)) { toast.error("זמן ההתחלה חייב להיות מוקדם מהסיום"); return; } setRangeMinutes(Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000))); setCursor(119); setTimeDialog(false); }}>הצג טווח</Button></DialogFooter></DialogContent></Dialog>
            <Button variant="outline" size="sm" onClick={onInvestigate}><History />תחקור מלא</Button>
          </div>
        </div>
        <div className="timeline-legend" aria-label="מקרא הגרף"><span><i style={{ background: groupLineColor.si }} />{scenario.groups.si.id}</span><span><i style={{ background: groupLineColor.so }} />{scenario.groups.so.id}</span><span><i className="line-solid" />סנכרון</span><span><i className="line-dotted" />כולל</span><span><i className="line-dashed" />נתיב</span><span><i className="event-border" />גבול אירוע</span></div>
        <TimelineChart serverId={serverId} selected={selectedGroup} layers={layers} cursor={cursor} onCursor={setCursor} selectedVehicle={selectedVehicle} fromLabel={rangeMinutes === 60 ? "לפני שעה" : from.replace("T", " ")} toLabel={rangeMinutes === 60 ? "עכשיו" : to.replace("T", " ")} />
        <div className="timeline-footer"><span><i className="quality good" />טוב 80–100</span><span><i className="quality medium" />בינוני 50–79</span><span><i className="quality low" />נמוך 0–49</span><span><i className="quality transition" />מעבר / אין מידע</span><span className="timeline-hint"><Eye />שורות SI/SO מתחת לגרף הן תחומי האירועים</span></div>
      </section>

      <TemplateOverrideDialog open={templateDialog} onOpenChange={setTemplateDialog} group={selected} activeId={activeTemplateId} templates={relevantTemplates.length ? relevantTemplates : state.templates.filter((template) => template.family === selected.family)} onChoose={chooseTemplate} />
    </div>
  );
}
