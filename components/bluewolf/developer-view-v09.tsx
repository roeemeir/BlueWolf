"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Database, Link2, Minus, Pause, Play, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  DEFAULT_WORKSPACE,
  SI_ALLOWED_PAIR_ANGLES,
  SO_RELATION_LABELS,
  THRESHOLD_DESCRIPTIONS,
  canonicalTemplateKey,
  createId,
  getServerScenario,
  relationCode,
  type DeveloperSection,
  type Family,
  type GtSegment,
  type InfluxFieldMapping,
  type ScoreThresholds,
  type SoRelation,
  type SoRouteKind,
  type SyncTemplate,
  type VehicleIdRange,
  type VehicleType,
} from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";
import { GtPlaybackV09, TemplatePreviewV09, ThresholdDiagram, type SoPreviewEntity } from "./visuals-v09";
import { RouteBankEditorV09, type RouteV09 } from "./route-bank-editor-v09";

const sections: { id: DeveloperSection; label: string }[] = [
  { id: "score", label: "ציון וספים" },
  { id: "templates", label: "תבניות" },
  { id: "gt", label: "GT ו־Sweep" },
  { id: "influx", label: "InfluxDB 2" },
  { id: "routes", label: "בנק נתיבים" },
  { id: "tests", label: "בדיקות מערכת" },
  { id: "settings", label: "הגדרות" },
];

type RouteKind = "single" | "double" | "figure8";
type CountMatrix = Record<RouteKind, Record<string, number>>;
type SoLayout = { id: string; entities: SoPreviewEntity[]; stacked: boolean };

function SectionHeader({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return <header className="v09-dev-head glass-panel"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div><div className="v09-head-actions">{children}</div></header>;
}
function Btn({ children, onClick, primary=false, disabled=false }: { children:React.ReactNode; onClick?:()=>void; primary?:boolean; disabled?:boolean }) {
  return <button type="button" className={`v09-btn ${primary?"primary":"secondary"}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Counter({ value, onChange, max=8 }: { value:number; onChange:(value:number)=>void; max?:number }) {
  return <div className="v09-counter"><button type="button" aria-label="הפחת" onClick={()=>onChange(Math.max(0,value-1))}><Minus/></button><b>{value}</b><button type="button" aria-label="הוסף" onClick={()=>onChange(Math.min(max,value+1))}><Plus/></button></div>;
}
function errorPair(key:keyof ScoreThresholds): { partner:keyof ScoreThresholds|null; unit:string } {
  const map: Partial<Record<keyof ScoreThresholds,{partner:keyof ScoreThresholds;unit:string}>>={
    siPositionFullDeg:{partner:"siPositionZeroDeg",unit:"°"}, siPositionZeroDeg:{partner:"siPositionFullDeg",unit:"°"},
    soPositionFullPct:{partner:"soPositionZeroPct",unit:"%"}, soPositionZeroPct:{partner:"soPositionFullPct",unit:"%"},
    periodFullPct:{partner:"periodZeroPct",unit:"%"}, periodZeroPct:{partner:"periodFullPct",unit:"%"},
    motionFullPct:{partner:"motionZeroPct",unit:"%"}, motionZeroPct:{partner:"motionFullPct",unit:"%"},
    routeDistanceFullPct:{partner:"routeDistanceZeroPct",unit:"%b"}, routeDistanceZeroPct:{partner:"routeDistanceFullPct",unit:"%b"},
    tangentFullDeg:{partner:"tangentZeroDeg",unit:"°"}, tangentZeroDeg:{partner:"tangentFullDeg",unit:"°"},
    curvatureFullPct:{partner:"curvatureZeroPct",unit:"%"}, curvatureZeroPct:{partner:"curvatureFullPct",unit:"%"},
  };
  return map[key]??{partner:null,unit:""};
}

const thresholdOptions: Record<keyof ScoreThresholds, number[]> = {
  siPositionFullDeg:[5,10,15,20], siPositionZeroDeg:[20,30,45,60], soPositionFullPct:[2,5,10,15], soPositionZeroPct:[15,20,25,30],
  periodFullPct:[2,5,10,15], periodZeroPct:[15,20,25,30], motionFullPct:[5,10,15,20], motionZeroPct:[20,30,40,50],
  routeDistanceFullPct:[2,5,10,15], routeDistanceZeroPct:[20,30,40,50], tangentFullDeg:[5,10,15,20], tangentZeroDeg:[30,45,60,90],
  curvatureFullPct:[5,10,20,30], curvatureZeroPct:[50,75,100,125], lowSpeedPct:[10,20,30,40,50], smoothingSeconds:[3,5,10,15,20,30], greenScore:[70,75,80,85,90], redScore:[30,40,50,60],
};
const thresholdLabels: Record<keyof ScoreThresholds,string>={
  siPositionFullDeg:"SI · 100 עד",siPositionZeroDeg:"SI · 0 החל מ־",soPositionFullPct:"SO · 100 עד",soPositionZeroPct:"SO · 0 החל מ־",periodFullPct:"מחזור · 100 עד",periodZeroPct:"מחזור · 0 החל מ־",motionFullPct:"תנועה · 100 עד",motionZeroPct:"תנועה · 0 החל מ־",routeDistanceFullPct:"מרחק · 100 עד",routeDistanceZeroPct:"מרחק · 0 החל מ־",tangentFullDeg:"משיק · 100 עד",tangentZeroDeg:"משיק · 0 החל מ־",curvatureFullPct:"עקמומיות · 100 עד",curvatureZeroPct:"עקמומיות · 0 החל מ־",lowSpeedPct:"סף מהירות",smoothingSeconds:"החלקה",greenScore:"תחילת ירוק",redScore:"מתחת לאדום",
};

function ScoreSection(){
  const {state,save}=useWorkspace();const [thresholds,setThresholds]=useState<ScoreThresholds>(structuredClone(state.thresholds));
  const keys=Object.keys(thresholdOptions) as (keyof ScoreThresholds)[];
  return <><SectionHeader eyebrow="SRS · Scoring" title="ספים והסבר חזותי" description="הציורים הם חלק קבוע מהכיול. אין ערכים חופשיים; כל שינוי נבחר מתוך Grid מאושר."><Btn onClick={()=>setThresholds(structuredClone(DEFAULT_WORKSPACE.thresholds))}>ברירת מחדל</Btn><Btn primary onClick={()=>save({...state,thresholds},"scoring","save-v09") }><Save/>שמור</Btn></SectionHeader>
    <section className="glass-panel v09-threshold-grid">{keys.map((key)=>{const pair=errorPair(key),partner=pair.partner;let full=thresholds[key],zero=partner?thresholds[partner]:Math.max(thresholds[key]+1,100);if(String(key).includes("Zero")){full=partner?thresholds[partner]:thresholds[key]/2;zero=thresholds[key];}return <article key={key} className="v09-threshold-card"><header><div><b>{thresholdLabels[key]}</b><small>{THRESHOLD_DESCRIPTIONS[key]}</small></div><select value={thresholds[key]} onChange={(e)=>setThresholds({...thresholds,[key]:Number(e.target.value)})}>{thresholdOptions[key].map(v=><option key={v} value={v}>{v}{pair.unit}</option>)}</select></header>{partner?<ThresholdDiagram full={Math.min(full,zero-0.0001)} zero={Math.max(zero,full+0.0001)} unit={pair.unit}/>:<div className="v09-threshold-simple"><span>ערך פעיל</span><b>{thresholds[key]}</b><div className="bar"><i style={{width:`${Math.min(100,Number(thresholds[key]))}%`}}/></div></div>}</article>})}</section>
  </>;
}

function blankMatrix(vehicleTypes:VehicleType[]):CountMatrix { const row=()=>Object.fromEntries(vehicleTypes.map(t=>[t.id,0])); return {single:row(),double:row(),figure8:row()}; }
function entityCapacity(kind:RouteKind){return kind==="double"?4:2;}
function entitiesFromMatrix(matrix:CountMatrix,vehicleTypes:VehicleType[]):SoPreviewEntity[]{
  const entities:SoPreviewEntity[]=[];
  (["single","double","figure8"] as RouteKind[]).forEach(kind=>vehicleTypes.forEach(type=>{let remaining=matrix[kind][type.id]??0;while(remaining>0){const count=Math.min(entityCapacity(kind),remaining);entities.push({id:`${kind}-${type.id}-${entities.length}`,kind,vehicleTypeId:type.id,vehicleCount:count});remaining-=count;}}));
  return entities;
}
function canonicalOrder(entities:SoPreviewEntity[]){const encode=(items:SoPreviewEntity[])=>items.map(e=>`${e.kind}:${e.vehicleTypeId}:${e.vehicleCount}`).join("|");const a=encode(entities),b=encode([...entities].reverse());return a<b?a:b;}
function permutations(entities:SoPreviewEntity[],limit=24){const out:SoPreviewEntity[][]=[],seen=new Set<string>();function walk(prefix:SoPreviewEntity[],remaining:SoPreviewEntity[]){if(out.length>=limit)return;if(!remaining.length){const key=canonicalOrder(prefix);if(!seen.has(key)){seen.add(key);out.push(prefix.map((e,i)=>({...e,id:`p-${out.length}-${i}`})));}return;}remaining.forEach((entity,index)=>walk([...prefix,entity],[...remaining.slice(0,index),...remaining.slice(index+1)]));}walk([],entities);return out;}
function layoutsFor(matrix:CountMatrix,vehicleTypes:VehicleType[]):SoLayout[]{
  const base=entitiesFromMatrix(matrix,vehicleTypes);if(base.reduce((s,e)=>s+e.vehicleCount,0)<2)return[];
  const normal=permutations(base,18).map((entities,index)=>({id:`normal-${index}`,entities,stacked:false}));
  const stacked:SoLayout[]=[];
  for(const item of normal){for(let i=0;i<item.entities.length-1;i++){const a=item.entities[i],b=item.entities[i+1];if(a.vehicleTypeId!==b.vehicleTypeId&&a.kind==="single"&&b.kind==="single"){const group=`stack-${stacked.length}`;stacked.push({id:`stacked-${stacked.length}`,stacked:true,entities:item.entities.map((e,j)=>j===i||j===i+1?{...e,stackGroup:group}:e)});break;}}if(stacked.length>=6)break;}
  return [...normal,...stacked];
}

function TemplatesSection(){
  const {state,save}=useWorkspace();const [family,setFamily]=useState<Family>("SO");const [name,setName]=useState("");
  const [siCounts,setSiCounts]=useState<Record<string,number>>(()=>Object.fromEntries(state.vehicleTypes.map(t=>[t.id,1])));const [siAngles,setSiAngles]=useState<number[]>([120,120]);
  const [matrix,setMatrix]=useState<CountMatrix>(()=>{const m=blankMatrix(state.vehicleTypes);state.vehicleTypes.forEach((t)=>{m.single[t.id]=1;});return m;});
  const layouts=useMemo(()=>layoutsFor(matrix,state.vehicleTypes),[matrix,state.vehicleTypes]);const [layoutId,setLayoutId]=useState<string>("");const selected=layouts.find(l=>l.id===layoutId)??layouts[0];
  const [relations,setRelations]=useState<Record<string,SoRelation[]>>({});
  useEffect(()=>{if(layouts.length&&!layouts.some(l=>l.id===layoutId))setLayoutId(layouts[0].id);},[layouts,layoutId]);
  const selectedRelations=selected?(relations[selected.id]??Array(Math.max(0,selected.entities.length-1)).fill("same") as SoRelation[]):[];
  const siItems=state.vehicleTypes.flatMap(type=>Array.from({length:siCounts[type.id]??0},()=>type));
  const seqAngles=Array.from({length:Math.max(0,siItems.length-1)},(_,i)=>siAngles[i]??120);
  const previewTypes=family==="SI"?siItems:state.vehicleTypes;
  const relationAllowed=(index:number): SoRelation[]=>{if(!selected)return["same","opposite"] as SoRelation[];const a=selected.entities[index],b=selected.entities[index+1];return a?.kind==="double"||b?.kind==="double"?["same","opposite","mixed"]:["same","opposite"];};
  const setRelation=(index:number,value:SoRelation)=>{if(!selected)return;const next=selectedRelations.map((r,i)=>i===index?value:r);setRelations({...relations,[selected.id]:next});};
  const changeMatrix=(kind:RouteKind,typeId:string,value:number)=>setMatrix({...matrix,[kind]:{...matrix[kind],[typeId]:value}});
  const saveTemplate=async()=>{
    if(!name.trim()){toast.error("תן שם לתבנית");return;}
    if(family==="SI"){
      if(siItems.length<2){toast.error("SI דורש לפחות 2 רכבים");return;}
      const template:SyncTemplate={id:createId("tpl"),family:"SI",name:name.trim(),mix:state.vehicleTypes.map(t=>`${t.name}×${siCounts[t.id]??0}`).join(" · "),constellation:siItems.map(t=>t.name).join(" — "),law:"n−1 angles · 45/90/120 · common phase free",values:seqAngles,vehicleCount:siItems.length,siPairs:seqAngles.map((angle,i)=>({first:i,second:i+1,angle})),isDefault:false,updatedAt:new Date().toISOString()};
      await save({...state,templates:[...state.templates,template]},"templates","create",template.name);setName("");return;
    }
    if(!selected){toast.error("בחר Layout חוקי");return;}
    if(selected.entities.some(e=>e.vehicleCount<1)){toast.error("Layout לא חוקי");return;}
    const singleCounts=matrix.single,doubleCounts=matrix.double,figure8Counts=matrix.figure8;
    const template:SyncTemplate={id:createId("tpl"),family:"SO",name:name.trim(),mix:state.vehicleTypes.map(t=>`${t.name}×${singleCounts[t.id]+doubleCounts[t.id]+figure8Counts[t.id]}`).filter(x=>!x.endsWith("×0")).join(" · "),constellation:selected.entities.map(e=>`${e.kind}:${state.vehicleTypes.find(t=>t.id===e.vehicleTypeId)?.name}`).join(" — "),law:"ordered hippodrome entities; one vehicle type per entity; same/opposite/mixed between adjacent entities",values:selectedRelations.map(relationCode),soSpec:{singleCounts,doubleCounts,figure8Counts,chain:selected.entities.map(e=>e.kind),relations:selectedRelations,entities:selected.entities.map(e=>({kind:e.kind,vehicleTypes:Array(e.vehicleCount).fill(e.vehicleTypeId)}))},isDefault:false,updatedAt:new Date().toISOString()};
    if(state.templates.some(t=>canonicalTemplateKey(t)===canonicalTemplateKey(template))){toast.warning("כבר קיימת תבנית שקולה");return;}
    await save({...state,templates:[...state.templates,template]},"templates","create",template.name);setName("");
  };
  return <><SectionHeader eyebrow="SRS · Templates" title="מחולל תבניות" description="+ / − לכל סוג רכב. SO מציג את כל סדרי ההיפודרומים האפשריים; שני סוגי רכב לעולם לא חולקים אותו Hippodrome."><Btn primary onClick={saveTemplate}><Save/>שמור תבנית</Btn></SectionHeader>
    <section className="glass-panel v09-template-workbench"><div className="v09-family-toggle"><button className={family==="SI"?"active":""} onClick={()=>setFamily("SI")}>SI</button><button className={family==="SO"?"active":""} onClick={()=>setFamily("SO")}>SO</button></div><label className="v09-field"><span>שם התבנית</span><input value={name} onChange={e=>setName(e.target.value)} placeholder="שם ברור"/></label>
    {family==="SI"?<div className="v09-template-layout"><div><h3>רכבים</h3><div className="v09-count-list">{state.vehicleTypes.map(type=><div key={type.id}><span><i style={{background:type.color}}/>{type.name}</span><Counter value={siCounts[type.id]??0} max={4} onChange={v=>setSiCounts({...siCounts,[type.id]:v})}/></div>)}</div><h3>זוויות עוקבות</h3><div className="v09-rel-list">{seqAngles.map((angle,index)=><label key={index}><span>{siItems[index]?.name} ↔ {siItems[index+1]?.name}</span><select value={angle} onChange={e=>setSiAngles(seqAngles.map((v,i)=>i===index?Number(e.target.value):v))}>{SI_ALLOWED_PAIR_ANGLES.map(v=><option key={v} value={v}>{v}°</option>)}</select></label>)}</div></div><div className="v09-preview-box"><TemplatePreviewV09 family="SI" values={seqAngles} vehicleTypes={previewTypes.length?previewTypes:state.vehicleTypes}/></div></div>:
    <div className="v09-so-builder"><div className="v09-so-matrix">{(["single","double","figure8"] as RouteKind[]).map(kind=><article key={kind}><h3>{kind==="single"?"Single Hippodrome":kind==="double"?"Double Hippodrome":"Figure‑8"}</h3>{state.vehicleTypes.map(type=><div key={type.id}><span><i style={{background:type.color}}/>{type.name}</span><Counter value={matrix[kind][type.id]??0} max={kind==="double"?8:6} onChange={v=>changeMatrix(kind,type.id,v)}/></div>)}</article>)}</div>
      <div className="v09-permutation-grid">{layouts.length?layouts.map(layout=><button key={layout.id} className={selected?.id===layout.id?"active":""} onClick={()=>setLayoutId(layout.id)}><TemplatePreviewV09 family="SO" values={(relations[layout.id]??Array(Math.max(0,layout.entities.length-1)).fill("same") as SoRelation[]).map(relationCode)} vehicleTypes={state.vehicleTypes} entities={layout.entities} compact/><strong>{layout.entities.map(e=>`${state.vehicleTypes.find(t=>t.id===e.vehicleTypeId)?.name}·${e.kind}`).join(" → ")}</strong><small>{layout.stacked?"כולל זוג מרכז משותף":"סדר גיאומטרי נפרד"}</small></button>):<div className="v09-empty">בחר לפחות שני רכבים</div>}</div>
      {selected&&<div className="v09-so-selected"><div className="v09-preview-box"><TemplatePreviewV09 family="SO" values={selectedRelations.map(relationCode)} vehicleTypes={state.vehicleTypes} entities={selected.entities}/></div><div><h3>סנכרון בין כל זוג סמוך</h3><div className="v09-rel-list">{selectedRelations.map((relation,index)=><label key={index}><span>{index+1} ↔ {index+2}</span><select value={relation} onChange={e=>setRelation(index,e.target.value as SoRelation)}>{relationAllowed(index).map(value=><option key={value} value={value}>{SO_RELATION_LABELS[value]}</option>)}</select></label>)}</div><p className="v09-hint">שינוי same / opposite / mixed משנה גם את מיקום הרכבים ב־Preview. Mixed מותר רק ליד Double.</p></div></div>}
    </div>}
    </section>
    <section className="glass-panel"><div className="v09-panel-head"><div><h3>בנק תבניות</h3><p>{state.templates.length} תבניות · ללא Arena</p></div></div><div className="v09-template-bank">{state.templates.map(t=><article key={t.id}><TemplatePreviewV09 family={t.family} values={t.values} vehicleTypes={state.vehicleTypes} entities={t.soSpec?.entities?.map((e,i)=>({id:`bank-${t.id}-${i}`,kind:e.kind,vehicleTypeId:e.vehicleTypes[0]??state.vehicleTypes[0].id,vehicleCount:e.vehicleTypes.length}))??[] } compact/><div><b>{t.name}</b><small>{t.law}</small></div><button disabled={t.isDefault} onClick={()=>save({...state,templates:state.templates.filter(x=>x.id!==t.id)},"templates","delete",t.name)}><Trash2/></button></article>)}</div></section>
  </>;
}

function ManualRouteEditor({points,onChange}:{points:{x:number;y:number}[];onChange:(p:{x:number;y:number}[])=>void}){
  const ref=useRef<SVGSVGElement|null>(null);const [drag,setDrag]=useState<number|null>(null);const pos=(e:React.PointerEvent<SVGSVGElement>)=>{const r=ref.current?.getBoundingClientRect();if(!r)return{x:0,y:0};return{x:(e.clientX-r.left)/r.width*700,y:(e.clientY-r.top)/r.height*260};};
  return <svg ref={ref} className="v09-gt-route-editor" viewBox="0 0 700 260" onPointerMove={e=>{if(drag===null)return;const p=pos(e);onChange(points.map((q,i)=>i===drag?p:q));}} onPointerUp={()=>setDrag(null)} onPointerLeave={()=>setDrag(null)}><rect width="700" height="260"/><path d={`M${points.map(p=>`${p.x},${p.y}`).join(" L")} Z`} fill="none"/><g>{points.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="8" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);setDrag(i);}}/>)}</g></svg>;
}

function GtSection(){
  const {state,save}=useWorkspace();const [serverId,setServerId]=useState("1");const [family,setFamily]=useState<Family>("SO");const [loaded,setLoaded]=useState(false);const [playing,setPlaying]=useState(false);const [timePct,setTimePct]=useState(36);const [clipStart,setClipStart]=useState(8);const [clipEnd,setClipEnd]=useState(92);const [syncScore,setSyncScore]=useState(82);const [routeScore,setRouteScore]=useState(88);const [routeWrong,setRouteWrong]=useState(false);const [correctedKind,setCorrectedKind]=useState<SoRouteKind|"compact">("double");const [points,setPoints]=useState([{x:90,y:170},{x:180,y:70},{x:310,y:82},{x:405,y:160},{x:535,y:192},{x:625,y:85}]);
  const scenario=getServerScenario(serverId),group=scenario.groups[family.toLowerCase() as "si"|"so"];const [participants,setParticipants]=useState<number[]>(group.members.map(m=>m.id));
  useEffect(()=>{if(!playing)return;const timer=window.setInterval(()=>setTimePct(v=>v>=clipEnd?clipStart:v+1),100);return()=>window.clearInterval(timer);},[playing,clipStart,clipEnd]);
  const changeServer=(id:string)=>{setServerId(id);const next=getServerScenario(id).groups[family.toLowerCase() as "si"|"so"];setParticipants(next.members.map(m=>m.id));};
  const saveGt=async()=>{if(participants.length<2){toast.error("GT קבוצתי דורש לפחות 2 משתתפים");return;}const quality=(v:number):GtSegment["quality"]=>v>=80?"good":v<50?"low":"medium";const base={family,serverId,groupId:group.id,start:"2026-09-06T00:00",end:"2026-09-06T01:00",vehicleCount:participants.length,routeType:routeWrong?String(correctedKind):(family==="SI"?"compact":"double"),participants,clipStartPct:clipStart,clipEndPct:clipEnd,routeCorrected:routeWrong,arena:state.arenas[0]};const additions:GtSegment[]=[{...base,id:createId("gt"),layer:"sync",quality:quality(syncScore),score:syncScore,label:`${group.id} Sync`},{...base,id:createId("gt"),layer:"route",quality:quality(routeScore),score:routeScore,label:`${group.id} Route`}];await save({...state,gtSegments:[...state.gtSegments,...additions]},"gt","approve",group.id);toast.success("GT נשמר עם Clip, עקבות ותיקון נתיב");};
  return <><SectionHeader eyebrow="Ground Truth" title="GT · חיתוך ותיקון ידני" description="העקבות המקוריות נשארות על המפה. שינוי Start/End מחליש את האזור שמחוץ ל־Clip, כך שקל לבחור גבולות."><Btn onClick={()=>setLoaded(true)}>שלוף טווח</Btn><Btn primary onClick={saveGt}><Save/>שמור GT</Btn></SectionHeader>
    <section className="glass-panel v09-gt-source"><div className="v09-form-grid"><label>שרת<select value={serverId} onChange={e=>changeServer(e.target.value)}>{state.servers.filter(s=>s.enabled).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>משפחה<select value={family} onChange={e=>{const f=e.target.value as Family;setFamily(f);setParticipants(getServerScenario(serverId).groups[f.toLowerCase() as "si"|"so"].members.map(m=>m.id));}}><option>SI</option><option>SO</option></select></label><label>Start<input type="datetime-local" defaultValue="2026-09-06T00:00"/></label><label>End<input type="datetime-local" defaultValue="2026-09-06T01:00"/></label></div>{loaded&&<div className="v09-gt-grid"><div><GtPlaybackV09 family={family} progress={timePct/100} clipStart={clipStart} clipEnd={clipEnd} vehicleTypes={state.vehicleTypes} serverId={serverId}/><div className="v09-player-row"><button onClick={()=>setPlaying(v=>!v)}>{playing?<Pause/>:<Play/>}</button><input type="range" min={clipStart} max={clipEnd} value={timePct} onChange={e=>setTimePct(Number(e.target.value))}/><b>{timePct}%</b></div><div className="v09-clip-controls"><label>תחלה · {clipStart}%<input type="range" min="0" max={clipEnd-5} value={clipStart} onChange={e=>{const v=Number(e.target.value);setClipStart(v);setTimePct(Math.max(v,timePct));}}/></label><label>סוף · {clipEnd}%<input type="range" min={clipStart+5} max="100" value={clipEnd} onChange={e=>{const v=Number(e.target.value);setClipEnd(v);setTimePct(Math.min(v,timePct));}}/></label></div></div><aside><h3>משתתפים</h3><div className="v09-participants">{group.members.map(m=><button key={m.id} className={participants.includes(m.id)?"active":""} onClick={()=>setParticipants(p=>p.includes(m.id)?p.filter(x=>x!==m.id):[...p,m.id])}>{m.id}</button>)}</div><label>Sync judgement · {syncScore}<input type="range" min="0" max="100" value={syncScore} onChange={e=>setSyncScore(Number(e.target.value))}/></label><label>Route judgement · {routeScore}<input type="range" min="0" max="100" value={routeScore} onChange={e=>setRouteScore(Number(e.target.value))}/></label><label className="v09-check"><input type="checkbox" checked={routeWrong} onChange={e=>setRouteWrong(e.target.checked)}/>סיווג Route שגוי</label>{routeWrong&&<select value={correctedKind} onChange={e=>setCorrectedKind(e.target.value as typeof correctedKind)}><option value="compact">SI compact</option><option value="single">SO single</option><option value="double">SO double</option><option value="figure8">SO figure‑8</option></select>}<h3>תיקון ידני על המפה</h3><p className="v09-hint">גרור את נקודות הציר הכחולות כדי לשנות את תוואי ה־GT עצמו.</p><ManualRouteEditor points={points} onChange={setPoints}/></aside></div>}</section>
  </>;
}

function InfluxSection(){
  const {state,save}=useWorkspace();const [url,setUrl]=useState(state.influx.url),[organization,setOrganization]=useState(state.influx.organization),[token,setToken]=useState(state.influx.token),[mappings,setMappings]=useState<InfluxFieldMapping[]>(structuredClone(state.influx.mappings)),[status,setStatus]=useState("לא נבדק");
  const update=(index:number,patch:Partial<InfluxFieldMapping>)=>setMappings(mappings.map((m,i)=>i===index?{...m,...patch}:m));
  const test=async()=>{setStatus("בודק…");try{const r=await fetch("/api/influx/test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url,organization,token})});const body=await r.json() as {ok?:boolean;error?:string};if(!r.ok||!body.ok)throw new Error(body.error??String(r.status));setStatus("Health/Auth עברו");}catch(e){setStatus(`נכשל: ${e instanceof Error?e.message:"unknown"}`);}};
  return <><SectionHeader eyebrow="Data adapter" title="InfluxDB 2" description="החיבור והמיפוי הופרדו כדי שהמסך יהיה קריא. כל Metric מציג Bucket, Measurement, Field, Transform ו־Fill."><Btn onClick={test}><Database/>בדיקת חיבור</Btn><Btn primary onClick={()=>save({...state,influx:{...state.influx,url,organization,token,mappings}},"influx","save-v09")}><Save/>שמור</Btn></SectionHeader><section className="glass-panel v09-influx"><div className="v09-connection-card"><label>URL<input value={url} onChange={e=>setUrl(e.target.value)}/></label><label>Organization<input value={organization} onChange={e=>setOrganization(e.target.value)}/></label><label>Token<input type="password" value={token} onChange={e=>setToken(e.target.value)}/></label><strong>{status}</strong></div><div className="v09-mapping-cards">{mappings.map((m,index)=><article key={m.systemKey}><header><b>{m.label}</b><code>{m.systemKey}</code></header><div className="v09-form-grid"><label>Bucket<input value={m.bucket} onChange={e=>update(index,{bucket:e.target.value})}/></label><label>Measurement<input value={m.measurement} onChange={e=>update(index,{measurement:e.target.value})}/></label><label>Key/Field<input value={m.key} onChange={e=>update(index,{key:e.target.value})}/></label><label>Mode<select value={m.valueMode} onChange={e=>update(index,{valueMode:e.target.value as InfluxFieldMapping["valueMode"]})}><option value="as-is">As-Is</option><option value="special">Map Value</option></select></label><label>Fill<select value={m.fillMode} onChange={e=>update(index,{fillMode:e.target.value as InfluxFieldMapping["fillMode"]})}><option value="linear">linear</option><option value="forward-fill">forward-fill</option></select></label>{m.valueMode==="special"&&<label>Source → Target<input value={`${m.sourceValue} → ${m.mappedValue}`} onChange={e=>{const [sourceValue,mappedValue]=e.target.value.split("→").map(x=>x.trim());update(index,{sourceValue,mappedValue});}}/></label>}</div></article>)}</div></section></>;
}

function RoutesSection(){
  const {state,save}=useWorkspace();const [draft,setDraft]=useState<RouteV09[]>(()=>structuredClone(state.routes) as RouteV09[]);const [selectedId,setSelectedId]=useState<string|null>(draft[0]?.id??null);const [linkSelection,setLinkSelection]=useState<string[]>([]);const selected=draft.find(r=>r.id===selectedId);
  const patch=(id:string,p:Partial<RouteV09>)=>setDraft(current=>current.map(r=>r.id===id?{...r,...p,updatedAt:new Date().toISOString()}:r));
  const add=()=>{const route:RouteV09={id:createId("route"),name:"היפודרום חדש",arena:state.arenas[0],vehicleType:state.vehicleTypes[0].name,family:"SO",geometry:"CLOSED_ROUTE",updatedAt:new Date().toISOString(),routeKind:"single",mapX:50,mapY:50,rotationDeg:0,scalePct:100,radiusPx:34,legLengthPx:110};setDraft([...draft,route]);setSelectedId(route.id);};
  const linkDouble=()=>{if(linkSelection.length!==2){toast.error("בחר בדיוק שני היפודרומים יחידים");return;}const a=draft.find(r=>r.id===linkSelection[0]),b=draft.find(r=>r.id===linkSelection[1]);if(!a||!b||a.family!=="SO"||b.family!=="SO"||a.routeKind==="double"||b.routeKind==="double"){toast.error("אפשר לחבר רק שני נתיבי SO שאינם Double");return;}const route:RouteV09={id:createId("double"),name:`כפול · ${a.name} + ${b.name}`,arena:a.arena,vehicleType:a.vehicleType,family:"SO",geometry:"DOUBLE_LINKED",updatedAt:new Date().toISOString(),routeKind:"double",mapX:50,mapY:50,rotationDeg:0,scalePct:100,linkedRouteIds:[a.id,b.id]};setDraft([...draft,route]);setSelectedId(route.id);setLinkSelection([]);toast.success("נוצר Double שמחבר את שני ההיפודרומים");};
  return <><SectionHeader eyebrow="Route bank" title="בנק נתיבים פרמטרי" description="C = מרכז, R = רדיוס, ↻ = זווית, L = אורך Leg. Circle הוא Leg=0. אפשר לבחור שני Hippodromes ולחבר אותם ל־Double."><Btn onClick={add}><Plus/>נתיב</Btn><Btn onClick={linkDouble} disabled={linkSelection.length!==2}><Link2/>חבר 2 לכפול</Btn><Btn primary onClick={()=>save({...state,routes:draft},"routes","save-v09")}><Save/>שמור</Btn></SectionHeader><section className="glass-panel v09-route-bank"><div className="v09-route-bank-layout"><RouteBankEditorV09 routes={draft} vehicleTypes={state.vehicleTypes} selectedId={selectedId} mapLabel={state.mapServers.find(m=>m.id===state.settings.defaultMap)?.name??"מפת הנדסה"} onSelect={setSelectedId} onPatch={patch}/><aside>{selected?<><p className="eyebrow">Route editor</p><h3>{selected.name}</h3><label>שם<input value={selected.name} onChange={e=>patch(selected.id,{name:e.target.value})}/></label><label>Arena · metadata<select value={selected.arena} onChange={e=>patch(selected.id,{arena:e.target.value})}>{state.arenas.map(a=><option key={a}>{a}</option>)}</select></label><label>סוג רכב<select value={selected.vehicleType} onChange={e=>patch(selected.id,{vehicleType:e.target.value})}>{state.vehicleTypes.map(t=><option key={t.id}>{t.name}</option>)}</select></label><label>משפחה<select value={selected.family} onChange={e=>patch(selected.id,{family:e.target.value as Family,legLengthPx:e.target.value==="SI"?0:(selected.legLengthPx??110)})}><option>SI</option><option>SO</option></select></label>{selected.family==="SO"&&<><div className="v09-param-readout"><span>Radius<b>{Math.round(selected.radiusPx??34)}</b></span><span>Leg<b>{Math.round(selected.legLengthPx??110)}</b></span><span>Angle<b>{Math.round(selected.rotationDeg??0)}°</b></span></div><button className={`v09-wide-toggle ${selected.figureEight||selected.routeKind==="figure8"?"active":""}`} onClick={()=>patch(selected.id,{figureEight:!(selected.figureEight||selected.routeKind==="figure8"),routeKind:(selected.figureEight||selected.routeKind==="figure8")?"single":"figure8"})}>הפוך לשמינייה / החזר להיפודרום</button></>}<p className="v09-hint">גרור C להזזה, R לרדיוס, ↻ לסיבוב ו־L לאורך הקטע הישר. אין צורך בנקודות חופשיות כדי לערוך Hippodrome רגיל.</p><button className="v09-danger" onClick={()=>{setDraft(draft.filter(r=>r.id!==selected.id));setSelectedId(null);}}><Trash2/>מחק</button></>:<p>בחר Route</p>}</aside></div><div className="v09-route-link-list"><b>בחירת שני Hippodromes לחיבור</b>{draft.filter(r=>r.family==="SO"&&r.routeKind!=="double").map(r=><label key={r.id}><input type="checkbox" checked={linkSelection.includes(r.id)} onChange={e=>setLinkSelection(current=>e.target.checked?[...current.filter(x=>x!==r.id),r.id].slice(-2):current.filter(x=>x!==r.id))}/><i style={{background:state.vehicleTypes.find(t=>t.name===r.vehicleType)?.color}}/>{r.name}</label>)}</div></section></>;
}

const testCases=[
  ["Route detection","SI circle/ellipse","compact classification + rotation"],["Route detection","Single hippodrome","outward semicircle turns + straight legs"],["Route detection","Double hippodrome","two linked hippodromes + period≈2×"],["Route detection","Figure‑8","self intersection + swapped legs"],["Route detection","FREE","reject noncyclic/noisy route"],["Route detection","Spikes","reject GNSS spikes without false revision"],
  ["Grouping","SI center","same center within tolerance"],["Grouping","SI rotation","opposite rotation rejected"],["Grouping","SI period","period mismatch rejected"],["Grouping","SO endpoint","adjacent/shared endpoints required"],["Grouping","SO axis","axis alignment gate"],["Grouping","SO 2×","single vs double period relation"],["Grouping","Score independence","membership unchanged when score changes"],
  ["Sync score","SI angle full","≤ full threshold = 100 position"],["Sync score","SI angle zero","≥ zero threshold = 0 position"],["Sync score","SI monotonic","larger angle error never improves score"],["Sync score","Wrong direction","60s gate → sync 0"],["Sync score","SO same","turn timing same semantics"],["Sync score","SO opposite","opposite quarter/turn semantics"],["Sync score","SO mixed","allowed only adjacent to Double"],["Route score","Distance","distance/b short axis"],["Route score","Tangent","velocity perpendicular/radial penalty"],["Route score","Curvature","turn geometry deviation"],
  ["Lifecycle","Candidate","60s known route candidate"],["Lifecycle","Confirm","300s new route confirm"],["Lifecycle","Revision","20% geometry/period + 120s stable"],["Lifecycle","History","bounded 600s history"],["Lifecycle","Join","membership confirmation"],["Lifecycle","Leave","hold then event boundary"],["Lifecycle","Disconnect","short gap does not split event"],
  ["Replay","Batch equivalence","1s grid = 5s batch semantics"],["Replay","Checkpoint","restore preserves revision/group state"],["Replay","Late sample","correction horizon deterministic"],["Load","Day duration","24h replay memory bounded"],["Load","Latency","p95 server→UI <10s"],["UI","Mobile RTL","no horizontal clipping + safe areas"],["UI","Template sheet","primary action always reachable"],["UI","PDF","summary + per-event maps embedded"],
];
const serverProfiles=[{id:"1",title:"שרת 01 · baseline",detail:"SO turn-lag, stable SI, score-trace validation"},{id:"2",title:"שרת 02 · membership/period",detail:"join/leave + SI angle drift + period change"},{id:"3",title:"שרת 03 · disconnect/geometry",detail:"temporary disconnect + geometry transition + recovery"}];
function TestsSection(){return <><SectionHeader eyebrow="Release gates" title="בדיקות מערכת מקיפות" description="התרחישים מוגדרים לפי SRS ולא מציגים PASS מזויף. CI מריץ Core + Web + Browser; כאן רואים את מטריצת הכיסוי."><ShieldCheck/></SectionHeader><section className="glass-panel"><div className="v09-server-scenarios">{serverProfiles.map(p=><article key={p.id}><b>{p.title}</b><p>{p.detail}</p></article>)}</div><div className="v09-test-matrix">{testCases.map(([category,name,detail],i)=><article key={`${category}-${name}`}><span>{String(i+1).padStart(2,"0")}</span><div><b>{name}</b><small>{category} · {detail}</small></div><em>CI gate</em></article>)}</div></section></>}

function SettingsSection(){
  const {state,save}=useWorkspace();const [vehicleTypes,setVehicleTypes]=useState<VehicleType[]>(structuredClone(state.vehicleTypes));
  const patchType=(id:string,patch:Partial<VehicleType>)=>setVehicleTypes(vehicleTypes.map(t=>t.id===id?{...t,...patch}:t));
  const patchRange=(typeId:string,index:number,patch:Partial<VehicleIdRange>)=>{const type=vehicleTypes.find(t=>t.id===typeId);if(!type)return;const ranges=(type.idRanges??[{min:type.minId,max:type.maxId}]).map((r,i)=>i===index?{...r,...patch}:r);patchType(typeId,{idRanges:ranges,minId:Math.min(...ranges.map(r=>r.min)),maxId:Math.max(...ranges.map(r=>r.max))});};
  const addRange=(typeId:string)=>{const type=vehicleTypes.find(t=>t.id===typeId);if(!type)return;const ranges=[...(type.idRanges??[]),{min:type.maxId+1,max:type.maxId+50}];patchType(typeId,{idRanges:ranges});};
  const removeRange=(typeId:string,index:number)=>{const type=vehicleTypes.find(t=>t.id===typeId);if(!type)return;const ranges=(type.idRanges??[]).filter((_,i)=>i!==index);patchType(typeId,{idRanges:ranges.length?ranges:[{min:type.minId,max:type.maxId}]});};
  return <><SectionHeader eyebrow="System config" title="הגדרות" description="שרתים, תרחישי סימולציה, סוגי רכב וטווחי מזהים מוצגים בכרטיסים ברורים — בלי רשימות פסיקים."><Btn primary onClick={()=>save({...state,vehicleTypes},"settings","save-v09")}><Save/>שמור</Btn></SectionHeader><section className="glass-panel v09-settings"><h3>שרתים ותרחישים</h3><div className="v09-server-cards">{state.servers.map((server,index)=><article key={server.id}><header><b>{server.name}</b><span>{server.enabled?"פעיל":"כבוי"}</span></header><p>{serverProfiles[index]?.detail??"Custom scenario"}</p><label>Influx tag<input defaultValue={server.influxTag}/></label><label>מפת בסיס<select defaultValue={state.settings.defaultMap}>{state.mapServers.filter(m=>m.enabled).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label></article>)}</div><h3>סוגי רכב וטווחי מזהים</h3><div className="v09-vehicle-settings">{vehicleTypes.map(type=><article key={type.id}><header><span><i style={{background:type.color}}/><input value={type.name} onChange={e=>patchType(type.id,{name:e.target.value})}/></span><b>{type.id}</b></header><div className="v09-range-list">{(type.idRanges??[{min:type.minId,max:type.maxId}]).map((range,index)=><div key={index}><label>מ־<input type="number" value={range.min} onChange={e=>patchRange(type.id,index,{min:Number(e.target.value)})}/></label><span>עד</span><label><input type="number" value={range.max} onChange={e=>patchRange(type.id,index,{max:Number(e.target.value)})}/></label><button onClick={()=>removeRange(type.id,index)}><Trash2/></button></div>)}</div><button className="v09-add-range" onClick={()=>addRange(type.id)}><Plus/>הוסף טווח</button></article>)}</div></section></>;
}

export function DeveloperViewV09(){
  const [section,setSection]=useState<DeveloperSection>("templates");
  return <div className="v09-developer"><nav className="v09-dev-nav glass-panel">{sections.map(item=><button type="button" key={item.id} className={section===item.id?"active":""} onClick={()=>setSection(item.id)}>{item.label}</button>)}</nav><main>{section==="score"&&<ScoreSection/>}{section==="templates"&&<TemplatesSection/>}{section==="gt"&&<GtSection/>}{section==="influx"&&<InfluxSection/>}{section==="routes"&&<RoutesSection/>}{section==="tests"&&<TestsSection/>}{section==="settings"&&<SettingsSection/>}</main></div>;
}
