"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Expand, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";

import { relationFromCode, type DataMode, type SoRelation, type SyncTemplate } from "@/lib/bluewolf";
import { useWorkspace } from "../app-context";
import { doubleHippodromeLoop, hippodromeLoop, pointOnClosed, svgClosedPath } from "./geometry";
import { V09LiveMap, fixedVehicleTypes, GROUP_COLORS, type OverlayKey, type V09GroupKey } from "./map";
import { getV09Scenario } from "./simulator";
import { siTemplateScores, soTemplateScores, type ScoreTriple } from "./scoring";
import { V09Timeline, type TimelineLayer } from "./timeline";

const overlayLabels: Record<OverlayKey, string> = { trace: "עקבה · 5s", routes: "נתיבים", hulls: "קבוצות", relations: "תבנית", scoreTrace: "עקבה לפי ציון" };
const layerLabels: Record<TimelineLayer, string> = { total: "כולל", sync: "סנכרון", route: "נתיב" };
const tone = (score: number) => score >= 80 ? "good" : score >= 50 ? "medium" : "low";

function relations(template: SyncTemplate | undefined): SoRelation[] {
  return template?.soSpec?.relations?.length ? template.soSpec.relations : (template?.values ?? []).map(relationFromCode);
}

function scoreFor(groupKey: V09GroupKey, template: SyncTemplate | undefined, serverId: string, tick: number, state: ReturnType<typeof useWorkspace>["state"]): ScoreTriple {
  const scenario = getV09Scenario(serverId, tick);
  const group = scenario.groups[groupKey];
  if (groupKey === "si") return siTemplateScores(group.observedAngles ?? [120, 120], template?.values ?? [120, 120], state.thresholds, state.weights, group.routeScore, group.periodErrorPct, group.motionErrorPct);
  return soTemplateScores(group.observedRelations ?? ["opposite", "same"], relations(template), state.thresholds, state.weights, group.routeScore, group.periodErrorPct, group.motionErrorPct);
}

function templateMini(template: SyncTemplate, vehicleColors: string[]) {
  if (template.family === "SI") {
    const angles = template.values.length ? template.values : [120, 120];
    const cumulative = [0]; angles.forEach((angle) => cumulative.push((cumulative.at(-1) ?? 0) + angle));
    const points = cumulative.map((angle, index) => { const a = (angle - 90) * Math.PI / 180; const r = index % 2 ? 60 : 86; return { x: 180 + Math.cos(a) * r, y: 120 + Math.sin(a) * r }; });
    return <svg viewBox="0 0 360 240" className="v09-dialog-preview"><rect width="360" height="240" rx="18" /><circle cx="180" cy="120" r="86" className="v09-ring" /><circle cx="180" cy="120" r="60" className="v09-ring" />{points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="9" fill={vehicleColors[index % vehicleColors.length]} />)}{angles.map((angle, index) => { const a = points[index]; const b = points[index + 1]; return <g key={index}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="v09-dialog-link" /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5} textAnchor="middle">{angle}°</text></g>; })}</svg>;
  }
  const rel = relations(template);
  const left = hippodromeLoop({ x: 82, y: 155 }, 22, 78, -32);
  const double = doubleHippodromeLoop({ x: 190, y: 120 }, 20, 53, 57, 28, -10);
  const right = hippodromeLoop({ x: 292, y: 83 }, 20, 72, -42);
  return <svg viewBox="0 0 360 240" className="v09-dialog-preview"><rect width="360" height="240" rx="18" /><path d={svgClosedPath(left)} stroke={vehicleColors[0]} /><path d={svgClosedPath(double)} stroke={vehicleColors[1]} /><path d={svgClosedPath(right)} stroke={vehicleColors[2]} />{[left, double, right].map((route, index) => { const phase = index === 0 ? .1 : index === 1 ? (rel[0] === "opposite" ? .6 : rel[0] === "mixed" ? .35 : .1) : (rel[1] === "opposite" ? .65 : rel[1] === "mixed" ? .38 : .1); const p = pointOnClosed(route, phase); return <g key={index} transform={`translate(${p.x} ${p.y}) rotate(${p.heading})`}><path d="M0-10 6 7 0 4-6 7Z" fill={vehicleColors[index]} /></g>; })}<text x="128" y="42" textAnchor="middle">{rel[0] === "same" ? "זהה" : rel[0] === "opposite" ? "הפוך" : "מעורב"}</text><text x="260" y="188" textAnchor="middle">{rel[1] === "same" ? "זהה" : rel[1] === "opposite" ? "הפוך" : "מעורב"}</text></svg>;
}

export function OperatorViewV09({ serverId, serverName, dataMode, onInvestigate }: { serverId: string; serverName: string; dataMode: DataMode; onInvestigate: () => void }) {
  const { state, save } = useWorkspace();
  const vehicleTypes = useMemo(() => fixedVehicleTypes(state.vehicleTypes), [state.vehicleTypes]);
  const [selectedGroup, setSelectedGroup] = useState<V09GroupKey>("so");
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [tick, setTick] = useState(80);
  const [running, setRunning] = useState(true);
  const [windowMinutes, setWindowMinutes] = useState<30 | 60 | 90 | 120>(120);
  const [cursor, setCursor] = useState(120);
  const [layers, setLayers] = useState<TimelineLayer[]>(["total", "sync", "route"]);
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({ trace: true, routes: true, hulls: true, relations: true, scoreTrace: false });
  const [baseMap, setBaseMap] = useState(state.settings.defaultMap || state.mapServers.find((item) => item.isDefault)?.id || "engineering");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewId, setPreviewId] = useState("");
  const [applyMode, setApplyMode] = useState<"now" | "event-start">("now");
  const [mutedUntil, setMutedUntil] = useState(0);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!running) return; const timer = window.setInterval(() => setTick((value) => value + 1), 1000); return () => window.clearInterval(timer); }, [running]);
  const scenario = getV09Scenario(serverId, tick);
  const activeTemplate = (key: V09GroupKey) => {
    const group = scenario.groups[key];
    const override = state.activeTemplateOverrides[`${serverId}:${group.id}`];
    return state.templates.find((template) => template.id === (override ?? (key === "si" ? "tpl-si-120" : "tpl-so-chain"))) ?? state.templates.find((template) => template.family === group.family);
  };
  const siTemplate = activeTemplate("si"); const soTemplate = activeTemplate("so");
  const scores = { si: scoreFor("si", siTemplate, serverId, tick, state), so: scoreFor("so", soTemplate, serverId, tick, state) };
  const currentGroup = scenario.groups[selectedGroup];
  const currentScore = scores[selectedGroup];
  const currentTemplate = selectedGroup === "si" ? siTemplate : soTemplate;
  const candidateTemplates = state.templates.filter((template) => template.family === currentGroup.family);
  const preview = candidateTemplates.find((template) => template.id === previewId) ?? currentTemplate ?? candidateTemplates[0];
  const expected = preview ? scoreFor(selectedGroup, preview, serverId, tick, state) : currentScore;
  const visibleMembers = currentGroup.members;
  const mapProfiles = state.mapServers.length ? state.mapServers : [{ id: "engineering", name: "מפת הנדסה", enabled: true }, { id: "orthophoto", name: "אורתופוטו", enabled: true }] as never[];

  const toggleLayer = (layer: TimelineLayer) => setLayers((current) => current.includes(layer) ? (current.length === 1 ? current : current.filter((item) => item !== layer)) : [...current, layer]);
  const chooseMute = (minutes: number | "restart" | 0) => { if (minutes === 0) setMutedUntil(0); else if (minutes === "restart") setMutedUntil(Number.MAX_SAFE_INTEGER); else setMutedUntil(Date.now() + minutes * 60_000); };
  const applyTemplate = async () => {
    if (!preview) return;
    const key = `${serverId}:${currentGroup.id}`;
    await save({ ...state, vehicleTypes, activeTemplateOverrides: { ...state.activeTemplateOverrides, [key]: preview.id }, templateApplications: { ...state.templateApplications, [key]: { templateId: preview.id, mode: applyMode, appliedAt: new Date().toISOString() } } }, "operator", "template-v09", `${currentGroup.id}:${preview.id}:${applyMode}`);
    setDialogOpen(false);
    toast.success(`התבנית הוחלה · Sync ${expected.sync} · Total ${expected.total}`);
  };

  return <div className="v09-operator">
    <header className="v09-page-head"><div><p className="eyebrow">OPERATOR · {dataMode === "simulation" ? "SIM" : "INFLUX"}</p><h1>תמונה מבצעית</h1><p>{serverName} · {scenario.title} · הקבוצה נקבעת מגיאומטריה ומחזור, לא מהציון.</p></div><div className="v09-actions"><button onClick={onInvestigate}>לתחקור</button><button className="primary" onClick={() => { setPreviewId(currentTemplate?.id ?? ""); setDialogOpen(true); }}>החלפת תבנית</button></div></header>

    <div className="v09-kpis"><article><span>ציון כולל · SI</span><b className={tone(scores.si.total)}>{scores.si.total}</b><small>Sync {scores.si.sync} · Route {scores.si.route}</small></article><article><span>ציון כולל · SO</span><b className={tone(scores.so.total)}>{scores.so.total}</b><small>Sync {scores.so.sync} · Route {scores.so.route}</small></article><article><span>אמינות</span><b>96%</b><small>joined/interpolated</small></article><article><span>Latency</span><b>4.2s</b><small>יעד &lt;10s</small></article><article><span>תרחיש</span><b>{serverId}</b><small>{scenario.eventNote}</small></article></div>

    <div className="v09-operator-grid"><section className="v09-panel v09-map-panel"><div className="v09-panel-head"><div><h2>מפה חיה</h2><p>מפת הבסיס נבחרת בנפרד. שכבות הן רק איורים מעל המפה.</p></div><div className="v09-map-select"><label>מפת בסיס<select value={baseMap} onChange={(event) => setBaseMap(event.target.value)}>{mapProfiles.filter((item: { enabled?: boolean }) => item.enabled !== false).map((item: { id: string; name: string }) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button aria-label="מסך מלא" onClick={() => mapRef.current?.requestFullscreen?.()}><Expand /></button></div></div><div className="v09-overlay-bar">{(Object.keys(overlays) as OverlayKey[]).map((key) => <button key={key} className={overlays[key] ? "active" : ""} onClick={() => setOverlays((current) => ({ ...current, [key]: !current[key] }))}>{overlayLabels[key]}</button>)}</div><div ref={mapRef} className="v09-map-shell"><V09LiveMap serverId={serverId} tick={tick} baseMap={baseMap} overlays={overlays} vehicleTypes={vehicleTypes} selectedGroup={selectedGroup} selectedVehicle={selectedVehicle} siAngles={siTemplate?.values ?? [120,120]} soRelations={relations(soTemplate)} onSelectGroup={(group) => { setSelectedGroup(group); setSelectedVehicle(null); }} onSelectVehicle={(vehicle, group) => { setSelectedGroup(group); setSelectedVehicle(vehicle); }} /></div></section>
      <aside className="v09-side"><article className="v09-panel"><div className="v09-group-title"><div><i style={{ background: GROUP_COLORS[selectedGroup] }} /><span><b>{currentGroup.name}</b><small>{currentGroup.id} · {visibleMembers.length} רכבים</small></span></div><strong className={tone(currentScore.total)}>{currentScore.total}</strong></div><div className="v09-score-grid"><span>Sync<b>{currentScore.sync}</b></span><span>Route<b>{currentScore.route}</b></span><span>Position<b>{currentScore.position}</b></span></div><p className="v09-cause">גורם מוביל: {currentScore.position < 60 ? "אי־התאמת תבנית / מיקום יחסי" : currentGroup.reason}</p><div className="v09-members">{visibleMembers.map((member) => { const type = vehicleTypes.find((item) => item.id === member.typeId); return <button key={member.id} className={selectedVehicle === member.id ? "active" : ""} onClick={() => setSelectedVehicle(member.id)}><i style={{ background: type?.color ?? TYPE_COLORS[0] }} /><span>רכב {member.id}<small>{type?.name ?? member.typeId}</small></span><b>{member.confidence}%</b></button>; })}</div></article>
        <article className="v09-panel"><div className="v09-panel-head"><div><h3>התראות</h3><p>התראה אינה Event</p></div><button className="v09-icon-button" onClick={() => chooseMute(mutedUntil ? 0 : 15)}>{mutedUntil ? <VolumeX /> : <Volume2 />}</button></div><div className="v09-alert warning"><b>{currentGroup.name} · {currentGroup.reason}</b><span>עכשיו</span><p>{scenario.eventNote}</p></div><div className="v09-mute-choices"><button onClick={() => chooseMute(5)}>5 דק׳</button><button onClick={() => chooseMute(15)}>15 דק׳</button><button onClick={() => chooseMute(30)}>30 דק׳</button><button onClick={() => chooseMute("restart")}>עד restart</button></div></article>
      </aside>
    </div>

    <section className="v09-panel v09-chart-panel"><div className="v09-panel-head"><div><h2>ציר ציונים</h2><p>שתי הקבוצות בו־זמנית; צבע = קבוצה, סוג קו = ציון.</p></div><div className="v09-window-picker">{([30,60,90,120] as const).map((value) => <button key={value} className={windowMinutes === value ? "active" : ""} onClick={() => { setWindowMinutes(value); setCursor(value); }}>{value} דק׳</button>)}</div></div><div className="v09-chart-toggles">{(["total","sync","route"] as TimelineLayer[]).map((layer) => <button key={layer} className={layers.includes(layer) ? "active" : ""} onClick={() => toggleLayer(layer)}>{layerLabels[layer]}</button>)}</div><V09Timeline serverId={serverId} windowMinutes={windowMinutes} layers={layers} cursor={Math.min(cursor, windowMinutes)} onCursor={setCursor} /></section>

    <section className="v09-panel v09-global-time"><div><button className="v09-icon-button" onClick={() => setRunning((value) => !value)}>{running ? <Pause /> : <Play />}</button><b>זמן סימולציה</b><span>t={tick}s</span></div><input type="range" min="0" max="300" value={tick % 301} onChange={(event) => { setRunning(false); setTick(Number(event.target.value)); }} /></section>

    {dialogOpen && <div className="v09-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}><section className="v09-template-sheet" role="dialog" aria-modal="true" aria-label="החלפת תבנית"><header><div><p className="eyebrow">Template switch</p><h2>החלפת תבנית · {currentGroup.name}</h2><p>הציון מחושב באותה פונקציית 100→לינארי→0 של ה־Core, ולכן זווית שגויה מורידה משמעותית את Sync.</p></div><button className="v09-icon-button" onClick={() => setDialogOpen(false)}><X /></button></header><div className="v09-sheet-scroll"><div className="v09-template-choices">{candidateTemplates.map((template) => <button key={template.id} className={preview?.id === template.id ? "active" : ""} onClick={() => setPreviewId(template.id)}><b>{template.name}</b><span>{template.constellation}</span></button>)}</div>{preview && <div className="v09-template-preview-large">{templateMini(preview, vehicleTypes.map((type) => type.color))}<div className="v09-expected"><span>כולל צפוי<b className={tone(expected.total)}>{expected.total}</b></span><span>Sync צפוי<b className={tone(expected.sync)}>{expected.sync}</b></span><span>Route צפוי<b>{expected.route}</b></span><span>Position<b>{expected.position}</b></span></div></div>}<div className="v09-mode"><b>מאיזה זמן להחיל?</b><button className={applyMode === "now" ? "active" : ""} onClick={() => setApplyMode("now")}>מעכשיו</button><button className={applyMode === "event-start" ? "active" : ""} onClick={() => setApplyMode("event-start")}>מתחילת האירוע</button></div></div><footer><button onClick={() => setDialogOpen(false)}>ביטול</button><button className="primary" onClick={applyTemplate}><Check />החל תבנית</button></footer></section></div>}
  </div>;
}
