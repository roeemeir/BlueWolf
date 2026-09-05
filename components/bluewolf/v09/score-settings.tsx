"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { DEFAULT_WORKSPACE, THRESHOLD_DESCRIPTIONS, type ScoreThresholds, type ScoreWeights } from "@/lib/bluewolf";
import { useWorkspace } from "../app-context";
import { sensitivityEvidence } from "./scoring";

const groups: { title: string; fields: { key: keyof ScoreThresholds; label: string; unit: string; options: number[]; diagram: "angle"|"phase"|"distance"|"score"|"time" }[] }[] = [
  { title:"מיקום וסנכרון", fields:[
    {key:"siPositionFullDeg",label:"SI · 100 עד",unit:"°",options:[5,10,15,20],diagram:"angle"},{key:"siPositionZeroDeg",label:"SI · 0 החל מ־",unit:"°",options:[20,30,45,60],diagram:"angle"},{key:"soPositionFullPct",label:"SO · 100 עד",unit:"% מחזור",options:[2,5,10,15],diagram:"phase"},{key:"soPositionZeroPct",label:"SO · 0 החל מ־",unit:"% מחזור",options:[15,20,25,30],diagram:"phase"},{key:"periodFullPct",label:"מחזור · 100 עד",unit:"%",options:[2,5,10,15],diagram:"time"},{key:"periodZeroPct",label:"מחזור · 0 החל מ־",unit:"%",options:[15,20,25,30],diagram:"time"},{key:"motionFullPct",label:"תנועה · 100 עד",unit:"%",options:[5,10,15,20],diagram:"time"},{key:"motionZeroPct",label:"תנועה · 0 החל מ־",unit:"%",options:[20,30,40,50],diagram:"time"},
  ]},
  { title:"ביצוע נתיב", fields:[
    {key:"routeDistanceFullPct",label:"מרחק · 100 עד",unit:"% מ־b",options:[2,5,10,15],diagram:"distance"},{key:"routeDistanceZeroPct",label:"מרחק · 0 החל מ־",unit:"% מ־b",options:[20,30,40,50],diagram:"distance"},{key:"tangentFullDeg",label:"משיק · 100 עד",unit:"°",options:[5,10,15,20],diagram:"angle"},{key:"tangentZeroDeg",label:"משיק · 0 החל מ־",unit:"°",options:[30,45,60,90],diagram:"angle"},{key:"curvatureFullPct",label:"עקמומיות · 100 עד",unit:"%",options:[5,10,20,30],diagram:"distance"},{key:"curvatureZeroPct",label:"עקמומיות · 0 החל מ־",unit:"%",options:[50,75,100,125],diagram:"distance"},
  ]},
  { title:"תצוגה ואמינות", fields:[
    {key:"lowSpeedPct",label:"סף מהירות",unit:"% עבודה",options:[10,20,30,40,50],diagram:"time"},{key:"smoothingSeconds",label:"החלקה",unit:"שניות",options:[3,5,10,15,20,30],diagram:"time"},{key:"greenScore",label:"תחילת ירוק",unit:"נק׳",options:[70,75,80,85,90],diagram:"score"},{key:"redScore",label:"מתחת לאדום",unit:"נק׳",options:[30,40,50,60],diagram:"score"},
  ]},
];

function Diagram({ kind, value, unit }: { kind: string; value: number; unit: string }) {
  if (kind === "angle") return <svg viewBox="0 0 180 76" className="v09-threshold-diagram"><circle cx="50" cy="50" r="27"/><line x1="50" y1="50" x2="50" y2="20"/><line x1="50" y1="50" x2="76" y2="37"/><path d="M50 30 A20 20 0 0 1 68 41"/><text x="90" y="40">{value}{unit}</text><text x="90" y="58">סטיית זווית</text></svg>;
  if (kind === "phase") return <svg viewBox="0 0 180 76" className="v09-threshold-diagram"><ellipse cx="56" cy="39" rx="42" ry="22"/><circle cx="34" cy="23" r="5"/><circle cx="69" cy="57" r="5"/><path d="M37 18Q54 4 76 18"/><text x="106" y="35">{value}{unit}</text><text x="106" y="54">פער פאזה</text></svg>;
  if (kind === "distance") return <svg viewBox="0 0 180 76" className="v09-threshold-diagram"><path d="M12 55C42 18 78 18 106 55"/><circle cx="65" cy="30" r="5"/><line x1="65" y1="30" x2="65" y2="46"/><text x="116" y="34">{value}{unit}</text><text x="116" y="54">שגיאת נתיב</text></svg>;
  if (kind === "score") return <svg viewBox="0 0 180 76" className="v09-threshold-diagram"><rect x="12" y="25" width="145" height="16" rx="8"/><rect x="12" y="25" width="55" height="16" rx="8" className="bad"/><rect x="67" y="25" width="48" height="16" className="warn"/><rect x="115" y="25" width="42" height="16" rx="8" className="good"/><line x1={12+145*value/100} y1="17" x2={12+145*value/100} y2="49"/><text x="12" y="66">0</text><text x="146" y="66">100</text></svg>;
  return <svg viewBox="0 0 180 76" className="v09-threshold-diagram"><line x1="12" y1="52" x2="164" y2="52"/><path d="M18 18H68L132 52H160"/><circle cx="68" cy="18" r="4"/><circle cx="132" cy="52" r="4"/><text x="82" y="17">100</text><text x="140" y="43">0</text><text x="12" y="70">{value}{unit}</text></svg>;
}

function WeightGroup({ title, values, onChange }: { title: string; values: Record<string,number>; onChange: (next: Record<string,number>) => void }) {
  const labels:Record<string,string>={position:"מיקום/פאזה",period:"מחזור",motion:"תנועה",distance:"מרחק",tangent:"משיק",curvature:"עקמומיות",sync:"Sync",route:"Route"};
  const set=(key:string,value:number)=>{const keys=Object.keys(values),rest=keys.filter(k=>k!==key),remain=100-value,current=rest.reduce((s,k)=>s+values[k],0)||1;let used=0;const next={...values,[key]:value};rest.forEach((k,i)=>{const v=i===rest.length-1?remain-used:Math.round((values[k]/current*remain)/5)*5;next[k]=Math.max(0,v);used+=next[k];});onChange(next)};
  return <article className="v09-weight-card"><header><h3>{title}</h3><b>100%</b></header>{Object.entries(values).map(([key,value])=><label key={key}><span>{labels[key]??key}<b>{value}%</b></span><input type="range" min="0" max="100" step="5" value={value} onChange={event=>set(key,Number(event.target.value))}/></label>)}</article>;
}

export function V09ScoreSettings() {
  const {state,save,revision}=useWorkspace();
  const[thresholds,setThresholds]=useState<ScoreThresholds>(structuredClone(state.thresholds));
  const[weights,setWeights]=useState<ScoreWeights>(structuredClone(state.weights));
  const[open,setOpen]=useState<string|null>(null);
  const evidence=sensitivityEvidence(thresholds,weights);
  return <div><header className="v09-section-header"><div><p className="eyebrow">SCORING · CORE CONTRACT</p><h2>משקולות וספים</h2><p>כל סף נשאר ב־Closed Grid. ציורי ההסבר הוחזרו ונפתחים גם בלחיצה במובייל.</p></div><div className={`v09-sensitivity ${evidence.pass?"pass":"fail"}`}><b>בדיקת רגישות SI</b><span>120°→120°: {evidence.perfect.sync}</span><span>120°→105°: {evidence.moderate.sync}</span><span>120°→90°: {evidence.wrong.sync}</span></div></header>
    <div className="v09-weight-grid"><WeightGroup title="Sync" values={weights.sync} onChange={next=>setWeights({...weights,sync:next as ScoreWeights["sync"]})}/><WeightGroup title="Route" values={weights.route} onChange={next=>setWeights({...weights,route:next as ScoreWeights["route"]})}/><WeightGroup title="Total" values={weights.total} onChange={next=>setWeights({...weights,total:next as ScoreWeights["total"]})}/></div>
    <section className="v09-thresholds">{groups.map(group=><article key={group.title}><h3>{group.title}</h3><div>{group.fields.map(field=><section key={field.key} className={open===field.key?"open":""}><header><span>{field.label}</span><button type="button" onClick={()=>setOpen(open===field.key?null:String(field.key))}>?</button></header><select value={thresholds[field.key]} onChange={event=>setThresholds({...thresholds,[field.key]:Number(event.target.value)})}>{field.options.map(value=><option key={value} value={value}>{value} {field.unit}</option>)}</select><div className="v09-threshold-help"><Diagram kind={field.diagram} value={thresholds[field.key]} unit={field.unit}/><p>{THRESHOLD_DESCRIPTIONS[field.key]}</p></div></section>)}</div></article>)}</section>
    <div className="v09-sticky-save"><button onClick={()=>{setThresholds(structuredClone(DEFAULT_WORKSPACE.thresholds));setWeights(structuredClone(DEFAULT_WORKSPACE.weights));}}>ברירת מחדל</button><button className="primary" onClick={async()=>{await save({...state,thresholds,weights},"scoring","save-v09",`v${revision+1}`);toast.success("הספים נשמרו")}}><Save/>שמור גרסה</button></div>
  </div>;
}
