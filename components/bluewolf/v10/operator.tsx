"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Expand, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";

import { relationFromCode, type DataMode, type SoRelation, type SyncTemplate } from "@/lib/bluewolf";
import { useWorkspace } from "../app-context";
import { doubleHippodromeLoop, hippodromeLoop, pointOnClosed, svgClosedPath } from "../v09/geometry";
import { fixedVehicleTypes } from "../v09/map";
import { getV09Scenario } from "../v09/simulator";
import { siTemplateScores, soTemplateScores, type ScoreTriple } from "../v09/scoring";
import { GROUP_COLORS, V10LiveMap, type OverlayKey, type V10GroupKey } from "./map";
import { V10Timeline, type TimelineLayer } from "./timeline";
import { averageWindPenalty, windForVehicle, type WindMode } from "./wind";

const overlayLabels: Record<OverlayKey, string> = { trace: "עקבה", routes: "נתיבים", hulls: "קבוצות", relations: "תבנית", scoreTrace: "עקבה לפי ציון" };
const layerLabels: Record<TimelineLayer, string> = { total: "כולל", sync: "סנכרון", route: "נתיב" };
const tone = (score: number) => score >= 80 ? "good" : score >= 50 ? "medium" : "low";
const clamp = (score: number) => Math.max(0, Math.min(100, Math.round(score)));

function relations(template: SyncTemplate | undefined): SoRelation[] {
  return template?.soSpec?.relations?.length ? template.soSpec.relations : (template?.values ?? []).map(relationFromCode);
}

function scoreFor(groupKey: V10GroupKey, template: SyncTemplate | undefined, serverId: string, tick: number, state: ReturnType<typeof useWorkspace>["state"], windMode: WindMode): ScoreTriple {
  const scenario = getV09Scenario(serverId, tick);
  const group = scenario.groups[groupKey];
  const base = groupKey === "si"
    ? siTemplateScores(group.observedAngles ?? [120, 120], template?.values ?? [120, 120], state.thresholds, state.weights, group.routeScore, group.periodErrorPct, group.motionErrorPct)
    : soTemplateScores(group.observedRelations ?? ["opposite", "same"], relations(template), state.thresholds, state.weights, group.routeScore, group.periodErrorPct, group.motionErrorPct);
  const penalty = averageWindPenalty(serverId, tick, group.members.map((member) => member.id), windMode);
  const sync = clamp(base.sync - penalty);
  const total = clamp(sync * state.weights.total.sync / 100 + base.route * state.weights.total.route / 100);
  return { ...base, sync, total };
}

function templateMini(template: SyncTemplate, color: string) {
  if (template.family === "SI") {
    const angles = template.values.length ? template.values : [120, 120];
    const cumulative = [0]; angles.forEach((angle) => cumulative.push((cumulative.at(-1) ?? 0) + angle));
    const points = cumulative.map((angle, index) => { const a = (angle - 90) * Math.PI / 180; const r = index % 2 ? 60 : 86; return { x: 180 + Math.cos(a) * r, y: 120 + Math.sin(a) * r }; });
    return <svg viewBox="0 0 360 240" className="v09-dialog-preview"><rect width="360" height="240" rx="18" /><circle cx="180" cy="120" r="86" className="v09-ring" /><circle cx="180" cy="120" r="60" className="v09-ring" />{points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="9" fill={color} />)}{angles.map((angle, index) => { const a = points[index]; const b = points[index + 1]; return <g key={index}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="v09-dialog-link" /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5} textAnchor="middle">{angle}°</text></g>; })}</svg>;
  }
  const rel = relations(template);
  const left = hippodromeLoop({ x: 80, y: 148 }, 22, 74, -20);
  const middle = doubleHippodromeLoop({ x: 180, y: 118 }, 20, 50, 54, 26, 0);
  const right = hippodromeLoop({ x: 286, y: 148 }, 22, 74, 20);
  return <svg viewBox="0 0 360 240" className="v09-dialog-preview"><rect width="360" height="240" rx="18" /><path d={svgClosedPath(left)} stroke={color} /><path d={svgClosedPath(middle)} stroke={color} /><path d={svgClosedPath(right)} stroke={color} />{[left, middle, right].map((route, index) => { const point = pointOnClosed(route, index === 1 ? .37 : .12); return <g key={index} transform={`translate(${point.x} ${point.y}) rotate(${point.heading})`}><path d="M0-10 6 7 0 4-6 7Z" fill={color} /></g>; })}<text x="126" y="46" textAnchor="middle">{rel[0] === "opposite" ? "הפוך" : rel[0] === "mixed" ? "מעורב" : "זהה"}</text><text x="250" y="46" textAnchor="middle">{rel[1] === "opposite" ? "הפוך" : rel[1] === "mixed" ? "מעורב" : "זהה"}</text></svg>;
}

export function OperatorViewV10({ serverId, serverName, dataMode, onInvestigate }: { serverId: string; serverName: string; dataMode: DataMode; onInvestigate: () => void }) {
  const { state, save } = useWorkspace();
  const vehicleTypes = useMemo(() => fixedVehicleTypes(state.vehicleTypes), [state.vehicleTypes]);
  const settings = state.settings as typeof state.settings & { trailHistoryMinutes?: number };
  const trailMinutes = settings.trailHistoryMinutes ?? 30;
  const [selectedGroup, setSelectedGroup] = useState<V10GroupKey>("so");
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [tick, setTick] = useState(80);
  const [running, setRunning] = useState(true);
  const [windowMinutes, setWindowMinutes] = useState<30 | 60 | 90 | 120>(30);
  const [cursor, setCursor] = useState(30);
  const [layers, setLayers] = useState<TimelineLayer[]>(["total", "sync", "route"]);
  const [visibleGroups, setVisibleGroups] = useState<V10GroupKey[]>(["si", "so"]);
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({ trace: true, routes: true, hulls: true, relations: true, scoreTrace: false });
  const [baseMap, setBaseMap] = useState(state.settings.defaultMap || state.mapServers.find((item) => item.isDefault)?.id || "engineering");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewId, setPreviewId] = useState("");
  const [applyMode, setApplyMode] = useState<"now" | "event-start">("now");
  const [mutedUntil, setMutedUntil] = useState(0);
  const [windMode, setWindMode] = useState<WindMode>("gusty");
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!running) return; const timer = window.setInterval(() => setTick((value) => value + 1), 1000); return () => window.clearInterval(timer); }, [running]);
  const effectiveWindMode: WindMode = dataMode === "simulation" ? windMode : "off";

  const scenario = getV09Scenario(serverId, tick);
  const activeTemplate = (key: V10GroupKey) => {
    const group = scenario.groups[key];
    const override = state.activeTemplateOverrides[`${serverId}:${group.id}`];
    return state.templates.find((template) => template.id === (override ?? (key === "si" ? "tpl-si-120" : "tpl-so-chain"))) ?? state.templates.find((template) => template.family === group.family);
  };
  const siTemplate = activeTemplate("si"); const soTemplate = activeTemplate("so");
  const scores = { si: scoreFor("si", siTemplate, serverId, tick, state, effectiveWindMode), so: scoreFor("so", soTemplate, serverId, tick, state, effectiveWindMode) };
  const currentGroup = scenario.groups[selectedGroup];
  const currentScore = scores[selectedGroup];
  const currentTemplate = selectedGroup === "si" ? siTemplate : soTemplate;
  const candidateTemplates = state.templates.filter((template) => template.family === currentGroup.family);
  const preview = candidateTemplates.find((template) => template.id === previewId) ?? currentTemplate ?? candidateTemplates[0];
  const expected = preview ? scoreFor(selectedGroup, preview, serverId, tick, state, effectiveWindMode) : currentScore;
  const mapProfiles = state.mapServers.length ? state.mapServers : [{ id: "engineering", name: "מפת הנדסה", enabled: true }] as never[];

  const toggleLayer = (layer: TimelineLayer) => setLayers((current) => current.includes(layer) ? (current.length === 1 ? current : current.filter((item) => item !== layer)) : [...current, layer]);
  const toggleGroup = (group: V10GroupKey) => setVisibleGroups((current) => current.includes(group) ? (current.length === 1 ? current : current.filter((item) => item !== group)) : [...current, group]);
  const chooseMute = (minutes: number | "restart" | 0) => { if (minutes === 0) setMutedUntil(0); else if (minutes === "restart") setMutedUntil(Number.MAX_SAFE_INTEGER); else setMutedUntil(Date.now() + minutes * 60_000); };
  const applyTemplate = async () => {
    if (!preview) return;
    const key = `${serverId}:${currentGroup.id}`;
    await save({ ...state, activeTemplateOverrides: { ...state.activeTemplateOverrides, [key]: preview.id }, templateApplications: { ...state.templateApplications, [key]: { templateId: preview.id, mode: applyMode, appliedAt: new Date().toISOString() } } }, "operator", "template-v10", `${currentGroup.id}:${preview.id}:${applyMode}`);
    setDialogOpen(false);
    toast.success(`התבנית הוחלה · Sync ${expected.sync} · Total ${expected.total}`);
  };

  return <div className="v09-operator v10-operator">
    <header className="v09-page-head"><div><p className="eyebrow">OPERATOR · {dataMode === "simulation" ? "SIM" : "INFLUX"}</p><h1>תמונה מבצעית</h1><p>{serverName} · {scenario.title} · צבע מבצעי = קבוצה · עקבה ברירת מחדל {trailMinutes} דק׳.</p></div><div className="v09-actions">{dataMode === "simulation" && <label className="v10-wind-select">רוח<select value={windMode} onChange={(event) => setWindMode(event.target.value as WindMode)}><option value="off">ללא</option><option value="steady">קבועה</option><option value="gusty">משבים</option><option value="crosswind">רוח צד</option></select></label>}<button onClick={onInvestigate}>לתחקור</button><button className="primary" onClick={() => { setPreviewId(currentTemplate?.id ?? ""); setDialogOpen(true); }}>החלפת תבנית</button></div></header>

    <div className="v09-kpis"><article><span>ציון כולל · SI</span><b className={tone(scores.si.total)}>{scores.si.total}</b><small>Sync {scores.si.sync} · Route {scores.si.route}</small></article><article><span>ציון כולל · SO</span><b className={tone(scores.so.total)}>{scores.so.total}</b><small>Sync {scores.so.sync} · Route {scores.so.route}</small></article><article><span>אמינות</span><b>96%</b><small>joined/interpolated</small></article><article><span>Latency</span><b>4.2s</b><small>יעד &lt;10s</small></article><article><span>רוח בסימולציה</span><b>{effectiveWindMode === "off" ? "OFF" : "ON"}</b><small>{effectiveWindMode === "off" ? "ללא הפרעה" : "נמדדת פגיעה ב־Sync"}</small></article></div>

    <div className="v09-operator-grid"><section className="v09-panel v09-map-panel"><div className="v09-panel-head"><div><h2>מפה חיה</h2><p>כל רכיב מבצעי שומר את צבע הקבוצה; סוג רכב נשאר מידע טקסטואלי.</p></div><div className="v09-map-select"><label>מפת בסיס<select value={baseMap} onChange={(event) => setBaseMap(event.target.value)}>{mapProfiles.filter((item: { enabled?: boolean }) => item.enabled !== false).map((item: { id: string; name: string }) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button aria-label="מסך מלא" onClick={() => mapRef.current?.requestFullscreen?.()}><Expand /></button></div></div><div className="v09-overlay-bar">{(Object.keys(overlays) as OverlayKey[]).map((key) => <button key={key} className={overlays[key] ? "active" : ""} onClick={() => setOverlays((current) => ({ ...current, [key]: !current[key] }))}>{overlayLabels[key]}</button>)}</div><div ref={mapRef} className="v09-map-shell"><V10LiveMap serverId={serverId} tick={tick} baseMap={baseMap} overlays={overlays} vehicleTypes={vehicleTypes} selectedGroup={selectedGroup} selectedVehicle={selectedVehicle} siAngles={siTemplate?.values ?? [120, 120]} soRelations={relations(soTemplate)} trailMinutes={trailMinutes} onSelectGroup={(group) => { setSelectedGroup(group); setSelectedVehicle(null); }} onSelectVehicle={(vehicle, group) => { setSelectedGroup(group); setSelectedVehicle(vehicle); }} /></div></section>
      <aside className="v09-side v10-group-stack">{(["si", "so"] as V10GroupKey[]).map((key) => { const group = scenario.groups[key]; const score = scores[key]; const selected = selectedGroup === key; return <article key={key} className={`v09-panel v10-group-card ${selected ? "selected" : ""}`} onClick={() => { setSelectedGroup(key); setSelectedVehicle(null); }}><div className="v09-group-title"><div><i style={{ background: GROUP_COLORS[key] }} /><span><b>{group.name}</b><small>{group.id} · {group.members.length} רכבים</small></span></div><strong className={tone(score.total)}>{score.total}</strong></div><div className="v10-compact-scores"><span>Sync <b>{score.sync}</b></span><span>Route <b>{score.route}</b></span><span>Position <b>{score.position}</b></span></div>{selected && <><p className="v09-cause">גורם מוביל: {score.position < 60 ? "אי־התאמת תבנית / מיקום יחסי" : group.reason}</p><div className="v09-members">{group.members.map((member) => { const type = vehicleTypes.find((item) => item.id === member.typeId); const wind = windForVehicle(serverId, tick, member.id, effectiveWindMode); return <button key={member.id} className={selectedVehicle === member.id ? "active" : ""} onClick={(event) => { event.stopPropagation(); setSelectedVehicle(member.id); }}><i style={{ background: GROUP_COLORS[key] }} /><span>רכב {member.id}<small>{type?.name ?? member.typeId} · רוח משוערת {wind.estimatedKnots} kt @ {wind.estimatedBearingDeg}°</small></span><b>{wind.confidence}%</b></button>; })}</div>{effectiveWindMode !== "off" && <div className="v10-wind-impact"><b>השפעת רוח משוערת</b><span>−{averageWindPenalty(serverId, tick, group.members.map((member) => member.id), effectiveWindMode).toFixed(1)} נק׳ Sync</span><small>שערוך ניווט בהנחת מהירות נומינלית קבועה בקירוב</small></div>}</>}</article>; })}
        <article className="v09-panel"><div className="v09-panel-head"><div><h3>התראות</h3><p>התראה אינה Event</p></div><button className="v09-icon-button" onClick={() => chooseMute(mutedUntil ? 0 : 15)}>{mutedUntil ? <VolumeX /> : <Volume2 />}</button></div><div className="v09-alert warning"><b>{currentGroup.name} · {currentGroup.reason}</b><span>עכשיו</span><p>{scenario.eventNote}</p></div><div className="v09-mute-choices"><button onClick={() => chooseMute(5)}>5 דק׳</button><button onClick={() => chooseMute(15)}>15 דק׳</button><button onClick={() => chooseMute(30)}>30 דק׳</button><button onClick={() => chooseMute("restart")}>עד restart</button></div></article>
      </aside>
    </div>

    <section className="v09-panel v09-chart-panel"><div className="v09-panel-head"><div><h2>ציר ציונים</h2><p>כל הקבוצות על גרף אחד. אפשר לסנן קבוצות ומטריקות באופן עצמאי.</p></div><div className="v09-window-picker">{([30, 60, 90, 120] as const).map((value) => <button key={value} className={windowMinutes === value ? "active" : ""} onClick={() => { setWindowMinutes(value); setCursor(value); }}>{value} דק׳</button>)}</div></div><div className="v09-chart-toggles v10-chart-filters"><div><b>קבוצות</b>{(["si", "so"] as V10GroupKey[]).map((group) => <button key={group} style={{ borderColor: GROUP_COLORS[group] }} className={visibleGroups.includes(group) ? "active" : ""} onClick={() => toggleGroup(group)}>{group.toUpperCase()}</button>)}</div><div><b>מטריקות</b>{(["total", "sync", "route"] as TimelineLayer[]).map((layer) => <button key={layer} className={layers.includes(layer) ? "active" : ""} onClick={() => toggleLayer(layer)}>{layerLabels[layer]}</button>)}</div></div><V10Timeline serverId={serverId} windowMinutes={windowMinutes} layers={layers} groups={visibleGroups} cursor={Math.min(cursor, windowMinutes)} onCursor={setCursor} /></section>

    <section className="v09-panel v09-global-time"><div><button className="v09-icon-button" onClick={() => setRunning((value) => !value)}>{running ? <Pause /> : <Play />}</button><b>זמן סימולציה</b><span>t={tick}s</span></div><input type="range" min="0" max="300" value={tick % 301} onChange={(event) => { setRunning(false); setTick(Number(event.target.value)); }} /></section>

    {dialogOpen && <div className="v09-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}><section className="v09-template-sheet" role="dialog" aria-modal="true" aria-label="החלפת תבנית"><header><div><p className="eyebrow">Template switch · v1.2</p><h2>החלפת תבנית · {currentGroup.name}</h2><p>SO גנרי ואינו תלוי בסוג רכב. הציון הצפוי כולל את הפרעת הרוח בסימולציה.</p></div><button className="v09-icon-button" onClick={() => setDialogOpen(false)}><X /></button></header><div className="v09-sheet-scroll"><div className="v09-template-choices">{candidateTemplates.map((template) => <button key={template.id} className={preview?.id === template.id ? "active" : ""} onClick={() => setPreviewId(template.id)}><b>{template.name}</b><span>{template.constellation}</span></button>)}</div>{preview && <div className="v09-template-preview-large">{templateMini(preview, GROUP_COLORS[selectedGroup])}<div className="v09-expected"><span>כולל צפוי<b className={tone(expected.total)}>{expected.total}</b></span><span>Sync צפוי<b className={tone(expected.sync)}>{expected.sync}</b></span><span>Route צפוי<b>{expected.route}</b></span><span>Position<b>{expected.position}</b></span></div></div>}<div className="v09-mode"><b>מאיזה זמן להחיל?</b><button className={applyMode === "now" ? "active" : ""} onClick={() => setApplyMode("now")}>מעכשיו</button><button className={applyMode === "event-start" ? "active" : ""} onClick={() => setApplyMode("event-start")}>מתחילת האירוע</button></div></div><footer><button onClick={() => setDialogOpen(false)}>ביטול</button><button className="primary" onClick={applyTemplate}><Check />החל תבנית</button></footer></section></div>}
  </div>;
}
