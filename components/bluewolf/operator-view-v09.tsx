"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Check, Expand, Layers3, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";

import type { DataMode, DemoGroup, SyncTemplate, VehicleType } from "@/lib/bluewolf";
import { getServerScenario, relationFromCode } from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";
import {
  LiveMapV09,
  ScoreRing,
  TemplatePreviewV09,
  TimelineChartV09,
  VehicleIconGlyph,
  groupLineColor,
  type GroupKey,
  type ScoreLayer,
} from "./visuals-v09";

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const tone = (score: number) => score >= 80 ? "good" : score < 50 ? "low" : "medium";

function TypeGlyph({ type }: { type?: VehicleType }) {
  const color = type?.color ?? "#7f8c98";
  return <svg className="v09-member-icon" viewBox="-15 -15 30 30" aria-hidden="true"><VehicleIconGlyph icon={type?.icon ?? "rover"} color={color} /></svg>;
}

function errorScore(error: number, full: number, zero: number) {
  if (error <= full) return 100;
  if (error >= zero) return 0;
  return 100 * (zero - error) / Math.max(0.0001, zero - full);
}

function estimateTemplateScores(group: DemoGroup, active: SyncTemplate | undefined, preview: SyncTemplate | undefined, thresholds: ReturnType<typeof useWorkspace>["state"]["thresholds"]) {
  if (!preview || preview.id === active?.id) return { total: group.total, sync: group.sync, route: group.route, delta: 0, position: 100 };
  const activeValues = active?.values ?? [];
  let position = 100;
  if (group.family === "SI") {
    const errors = preview.values.map((value, index) => Math.abs(value - (activeValues[index] ?? value)));
    position = errors.length ? errors.reduce((sum, value) => sum + errorScore(value, thresholds.siPositionFullDeg, thresholds.siPositionZeroDeg), 0) / errors.length : 100;
  } else {
    const activeRelations = activeValues.map(relationFromCode);
    const previewRelations = preview.values.map(relationFromCode);
    const pairScores = previewRelations.map((relation, index) => {
      const current = activeRelations[index] ?? relation;
      if (current === relation) return 100;
      if (current === "mixed" || relation === "mixed") return 35;
      return 0;
    });
    position = pairScores.length ? pairScores.reduce((a,b)=>a+b,0) / pairScores.length : 100;
  }
  // Mirror the approved Core weights: position 60%, period 20%, motion 20%.
  // Period/motion stay at the observed group quality during a template-only what-if.
  const periodProxy = clamp(group.sync + 8);
  const motionProxy = clamp(group.sync + 5);
  const sync = Math.round(clamp(position * .60 + periodProxy * .20 + motionProxy * .20));
  const route = group.route;
  const total = Math.round(clamp(sync * .75 + route * .25));
  return { total, sync, route, delta: total - group.total, position: Math.round(position) };
}

function GroupCard({ group, vehicleTypes, selected, templateName, onSelect, onVehicle, onTemplate }: { group: DemoGroup; vehicleTypes: VehicleType[]; selected: boolean; templateName: string; onSelect: () => void; onVehicle: (id: number) => void; onTemplate: () => void }) {
  const color = groupLineColor[group.key];
  return <article className={`v09-group-card glass-panel ${selected ? "active" : ""}`}>
    <button className="v09-group-select" onClick={onSelect} type="button">
      <div><span className="v09-group-dot" style={{ background: color }} /><strong>{group.name}</strong><small>{group.subtitle}</small></div><ScoreRing value={group.total} color={color} />
    </button>
    <div className="v09-score-trio"><span>כולל<b className={tone(group.total)}>{group.total}</b></span><span>Sync<b>{group.sync}</b></span><span>Route<b>{group.route}</b></span></div>
    <div className="v09-template-row"><Layers3/><span>{templateName}</span><button type="button" onClick={onTemplate}>החלפה</button></div>
    <div className="v09-member-list">{group.members.map((member) => { const type = vehicleTypes.find((item)=>item.id===member.typeId); return <button type="button" key={member.id} onClick={()=>onVehicle(member.id)}><TypeGlyph type={type}/><span><b>רכב {member.id}</b><small>{type?.name}</small></span><strong className={tone(member.score)}>{member.score}</strong></button>; })}</div>
  </article>;
}

function TemplateSheet({ open, group, activeId, templates, vehicleTypes, thresholds, onClose, onApply }: { open: boolean; group: DemoGroup; activeId: string; templates: SyncTemplate[]; vehicleTypes: VehicleType[]; thresholds: ReturnType<typeof useWorkspace>["state"]["thresholds"]; onClose: () => void; onApply: (templateId: string, mode: "now"|"event-start") => void }) {
  const candidates = templates.filter((item)=>item.family===group.family);
  const [previewId,setPreviewId]=useState(activeId);
  const [mode,setMode]=useState<"now"|"event-start">("now");
  useEffect(()=>{ if(open) setPreviewId(activeId); },[open,activeId]);
  if(!open) return null;
  const active=candidates.find((item)=>item.id===activeId);
  const preview=candidates.find((item)=>item.id===previewId) ?? candidates[0];
  const expected=estimateTemplateScores(group,active,preview,thresholds);
  const entities=preview?.soSpec?.entities?.map((entity,index)=>({ id:`sheet-${index}`, kind:entity.kind, vehicleTypeId:entity.vehicleTypes[0] ?? vehicleTypes[index%vehicleTypes.length]?.id ?? "storm", vehicleCount:Math.max(1,entity.vehicleTypes.length) })) ?? [];
  return <div className="v09-template-sheet-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="v09-template-sheet" role="dialog" aria-modal="true" aria-label="החלפת תבנית">
      <header><div><p className="eyebrow">Template what-if</p><h2>החלפת תבנית · {group.name}</h2><p>הציון הצפוי מחושב באותו חוק ספים ומשקולות של הליבה; שינוי זווית משמעותי מוריד את רכיב המיקום באופן חד.</p></div><button type="button" className="v09-icon-btn" onClick={onClose}><X/></button></header>
      <div className="v09-template-sheet-body">
        <div className="v09-template-candidates">{candidates.map((template)=><button type="button" key={template.id} className={preview?.id===template.id?"active":""} onClick={()=>setPreviewId(template.id)}><strong>{template.name}</strong><small>{template.constellation}</small>{template.id===activeId&&<em>פעילה</em>}</button>)}</div>
        <div className="v09-template-preview-large"><TemplatePreviewV09 family={group.family} values={preview?.values??[]} vehicleTypes={vehicleTypes} entities={entities}/><div className="v09-expected-grid"><span>כולל צפוי<b>{expected.total}</b></span><span>Sync צפוי<b>{expected.sync}</b></span><span>Position<b>{expected.position}</b></span><span>Δ<b>{expected.delta>=0?"+":""}{expected.delta}</b></span></div></div>
        <div className="v09-apply-mode"><b>מאיזה זמן להחיל?</b><div><button className={mode==="now"?"active":""} onClick={()=>setMode("now")}>מעכשיו</button><button className={mode==="event-start"?"active":""} onClick={()=>setMode("event-start")}>מתחילת האירוע</button></div><p>{mode==="event-start"?"כל האירוע הנוכחי יחושב מחדש לפי התבנית.":"נשמרת נקודת שינוי תבנית בתוך האירוע."}</p></div>
      </div>
      <footer><button type="button" className="v09-btn secondary" onClick={onClose}>ביטול</button><button type="button" className="v09-btn primary" disabled={!preview} onClick={()=>preview&&onApply(preview.id,mode)}><Check/>החל תבנית</button></footer>
    </section>
  </div>;
}

export function OperatorViewV09({ serverId, serverName, dataMode, onDataModeChange, onInvestigate }: { serverId:string; serverName:string; dataMode:DataMode; onDataModeChange:(mode:DataMode)=>void; onInvestigate:()=>void }) {
  const { state, save } = useWorkspace();
  const scenario=getServerScenario(serverId);
  const [selectedGroup,setSelectedGroup]=useState<GroupKey>("so");
  const [selectedVehicle,setSelectedVehicle]=useState<number|null>(null);
  const [running,setRunning]=useState(true);
  const [tick,setTick]=useState(0);
  const [showTrace,setShowTrace]=useState(true);
  const [showScoreTrace,setShowScoreTrace]=useState(false);
  const [showRoutes,setShowRoutes]=useState(true);
  const [showGroups,setShowGroups]=useState(true);
  const [showRelations,setShowRelations]=useState(true);
  const [showGrid,setShowGrid]=useState(false);
  const [mapProfile,setMapProfile]=useState(state.settings.defaultMap || state.mapServers.find((item)=>item.enabled)?.id || "engineering");
  const [layers,setLayers]=useState<ScoreLayer[]>(["total","sync","route"]);
  const [windowMinutes,setWindowMinutes]=useState<30|60|90|120>(120);
  const [cursor,setCursor]=useState(119);
  const [templateSheet,setTemplateSheet]=useState(false);
  const [mutedUntil,setMutedUntil]=useState(0);
  const mapRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{if(!running)return;const timer=window.setInterval(()=>setTick((value)=>value+1),1000);return()=>window.clearInterval(timer);},[running]);
  useEffect(()=>{setCursor(119);},[windowMinutes,serverId]);

  const selected=scenario.groups[selectedGroup];
  const overrideKey=`${serverId}:${selected.id}`;
  const activeTemplateId=state.activeTemplateOverrides[overrideKey]??selected.templateId;
  const templateFor=(key:GroupKey)=>{const group=scenario.groups[key];const id=state.activeTemplateOverrides[`${serverId}:${group.id}`]??group.templateId;return state.templates.find((item)=>item.id===id)??state.templates.find((item)=>item.family===group.family);};
  const templateValues={si:templateFor("si")?.values??[120,120],so:templateFor("so")?.values??[2,0]};
  const activeTemplate=templateFor(selectedGroup);
  const muted=mutedUntil>Date.now()||mutedUntil===Number.MAX_SAFE_INTEGER;

  const toggleLayer=(layer:ScoreLayer)=>setLayers((current)=>current.includes(layer)?(current.length===1?current:current.filter((item)=>item!==layer)):[...current,layer]);
  const applyTemplate=async(id:string,mode:"now"|"event-start")=>{const next={...state,activeTemplateOverrides:{...state.activeTemplateOverrides,[overrideKey]:id},templateApplications:{...state.templateApplications,[overrideKey]:{templateId:id,mode,appliedAt:new Date().toISOString()}}};await save(next,"operator","template-override",`${selected.id}→${id}·${mode}`);setTemplateSheet(false);toast.success(mode==="event-start"?"התבנית הוחלה מתחילת האירוע וחישוב התחקור עודכן":"התבנית הוחלה מעכשיו");};
  const muteFor=(minutes:number|"restart")=>{setMutedUntil(minutes==="restart"?Number.MAX_SAFE_INTEGER:Date.now()+minutes*60_000);toast.success(minutes==="restart"?"מושתק עד הפעלה מחדש":`מושתק ל-${minutes} דקות`);};

  return <div className="v09-operator">
    <header className="v09-page-head"><div><p className="eyebrow">OPERATOR · LIVE</p><h2>{serverName}</h2><p>קיבוץ = גיאומטריה + מחזור בלבד. צבע אייקון/נתיב = סוג רכב; צבע מעטפת = קבוצה.</p></div><div className="v09-head-actions"><button className="v09-btn secondary" onClick={onInvestigate}>תחקור</button><button className="v09-btn primary" onClick={()=>setTemplateSheet(true)}>החלפת תבנית</button></div></header>

    <div className="v09-kpis">{[["כולל",selected.total],["Sync",selected.sync],["Route",selected.route],["אמינות",selected.confidence]].map(([label,value])=><article className="glass-panel" key={String(label)}><span>{label}</span><strong>{value}{label==="אמינות"?"%":""}</strong></article>)}<article className="glass-panel"><span>מקור</span><strong>{dataMode==="simulation"?"SIM":"INFLUX"}</strong><button onClick={()=>onDataModeChange(dataMode==="simulation"?"influx":"simulation")}>החלף</button></article></div>

    <div className="v09-operator-grid">
      <section className="glass-panel v09-map-panel" ref={mapRef}>
        <div className="v09-panel-head"><div><h3>מפה חיה</h3><p>עקבות מודגשות; “לפי ציון” צובע כל דגימה לפי איכותה.</p></div><div className="v09-map-source"><label>מפת בסיס<select value={mapProfile} onChange={(event)=>setMapProfile(event.target.value)}>{state.mapServers.filter((item)=>item.enabled).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="v09-icon-btn" onClick={()=>mapRef.current?.requestFullscreen?.()}><Expand/></button></div></div>
        <div className="v09-map-layers"><button className={showTrace?"active":""} onClick={()=>setShowTrace((v)=>!v)}>עקבה · 5s</button><button className={showRoutes?"active":""} onClick={()=>setShowRoutes((v)=>!v)}>נתיבים</button><button className={showGroups?"active":""} onClick={()=>setShowGroups((v)=>!v)}>קבוצות</button><button className={showRelations?"active":""} onClick={()=>setShowRelations((v)=>!v)}>תבנית</button><button className={showScoreTrace?"active":""} onClick={()=>setShowScoreTrace((v)=>!v)}>עקבה לפי ציון</button><button className={showGrid?"active":""} onClick={()=>setShowGrid((v)=>!v)}>Grid</button></div>
        <div className="v09-map-wrap"><LiveMapV09 serverId={serverId} tick={tick} selectedGroup={selectedGroup} selectedVehicle={selectedVehicle} showTrace={showTrace} showScoreTrace={showScoreTrace} showRoutes={showRoutes} showRelations={showRelations} showGroups={showGroups} showGrid={showGrid} vehicleTypes={state.vehicleTypes} templateValues={templateValues} mapProfile={mapProfile} onSelectGroup={(key)=>{setSelectedGroup(key);setSelectedVehicle(null);}} onSelectVehicle={(id,key)=>{setSelectedGroup(key);setSelectedVehicle(id);}}/></div>
      </section>
      <aside className="v09-live-side">
        {(["si","so"] as GroupKey[]).map((key)=><GroupCard key={key} group={scenario.groups[key]} vehicleTypes={state.vehicleTypes} selected={selectedGroup===key} templateName={templateFor(key)?.name??"ללא תבנית"} onSelect={()=>{setSelectedGroup(key);setSelectedVehicle(null);}} onVehicle={(id)=>{setSelectedGroup(key);setSelectedVehicle(id);}} onTemplate={()=>{setSelectedGroup(key);setTemplateSheet(true);}}/>)}
        <article className="glass-panel v09-alert-card"><header><BellRing/><div><b>התראות</b><small>Alert ≠ Event</small></div><button className="v09-icon-btn" onClick={()=>muted?setMutedUntil(0):muteFor(15)}>{muted?<VolumeX/>:<Volume2/>}</button></header><p>{scenario.groups.so.alert?.detail??"אין התראה חריגה כרגע"}</p><div className="v09-mute-row"><button onClick={()=>muteFor(5)}>5 דק׳</button><button onClick={()=>muteFor(15)}>15</button><button onClick={()=>muteFor(30)}>30</button><button onClick={()=>muteFor("restart")}>עד restart</button></div></article>
      </aside>
    </div>

    <section className="glass-panel v09-timeline-panel"><div className="v09-panel-head"><div><h3>ציר ציונים</h3><p>שתי הקבוצות מוצגות יחד; הגבולות נחתכים לפי חלון הזמן.</p></div><div className="v09-window-row">{([30,60,90,120] as const).map((value)=><button key={value} className={windowMinutes===value?"active":""} onClick={()=>setWindowMinutes(value)}>{value} דק׳</button>)}</div></div><div className="v09-layer-legend">{(["total","sync","route"] as ScoreLayer[]).map((layer)=><button key={layer} className={layers.includes(layer)?"active":""} onClick={()=>toggleLayer(layer)}><i className={`style-${layer}`}/>{layer==="total"?"כולל":layer==="sync"?"סנכרון":"נתיב"}</button>)}</div><TimelineChartV09 serverId={serverId} windowMinutes={windowMinutes} layers={layers} cursor={cursor} onCursor={setCursor} selectedVehicle={selectedVehicle}/><div className="v09-playbar"><button className="v09-icon-btn" onClick={()=>setRunning((value)=>!value)}>{running?<Pause/>:<Play/>}</button><input type="range" min={Math.max(0,120-windowMinutes)} max={119} value={clamp(cursor,Math.max(0,120-windowMinutes),119)} onChange={(event)=>{setRunning(false);setCursor(Number(event.target.value));}}/><span>{cursor-(120-windowMinutes)+1}/{windowMinutes} דק׳</span></div></section>

    <TemplateSheet open={templateSheet} group={selected} activeId={activeTemplateId} templates={state.templates} vehicleTypes={state.vehicleTypes} thresholds={state.thresholds} onClose={()=>setTemplateSheet(false)} onApply={applyTemplate}/>
  </div>;
}
