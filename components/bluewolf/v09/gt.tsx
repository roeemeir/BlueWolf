"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pause, Play, Save } from "lucide-react";
import { toast } from "sonner";

import { createId, type Family, type GtSegment } from "@/lib/bluewolf";
import { useWorkspace } from "../app-context";
import { fixedVehicleTypes } from "./map";
import { getV09Scenario } from "./simulator";
import { clamp, hippodromeLoop, pointOnClosed, svgClosedPath, type Point } from "./geometry";

function pointer(svg: SVGSVGElement, event: React.PointerEvent) { const rect=svg.getBoundingClientRect(); return {x:(event.clientX-rect.left)/Math.max(1,rect.width)*900,y:(event.clientY-rect.top)/Math.max(1,rect.height)*460}; }

export function V09GT() {
  const {state,save}=useWorkspace();
  const types=fixedVehicleTypes(state.vehicleTypes);
  const [serverId,setServerId]=useState("1");
  const [family,setFamily]=useState<Family>("SO");
  const [loaded,setLoaded]=useState(true);
  const [playing,setPlaying]=useState(false);
  const [time,setTime]=useState(36);
  const [start,setStart]=useState(8);
  const [end,setEnd]=useState(92);
  const [sync,setSync]=useState(82);
  const [routeScore,setRouteScore]=useState(88);
  const [wrong,setWrong]=useState(false);
  const [participants,setParticipants]=useState<number[]>(()=>getV09Scenario("1",108).groups.so.members.map(member=>member.id));
  const [anchors,setAnchors]=useState<Point[]>([{x:350,y:230},{x:450,y:230},{x:450,y:175},{x:510,y:140}]);
  const [drag,setDrag]=useState<number|null>(null);
  const svgRef=useRef<SVGSVGElement|null>(null);
  const scenario=getV09Scenario(serverId,Math.round(time*3));
  const group=scenario.groups[family.toLowerCase() as "si"|"so"];

  useEffect(()=>{if(!playing)return;const timer=window.setInterval(()=>setTime(value=>value>=end?start:value+1),90);return()=>window.clearInterval(timer)},[playing,start,end]);
  const rawRoutes=scenario.routes.filter(route=>group.members.some(member=>member.routeKey===route.key));
  const currentPositions=group.members.map(member=>{const route=rawRoutes.find(item=>item.key===member.routeKey)??scenario.routes[0];return{member,route,point:pointOnClosed(route.points,member.phase+(time/100-.36))}});
  const corrected=hippodromeLoop({x:anchors[0].x,y:anchors[0].y},Math.max(12,Math.hypot(anchors[2].x-anchors[1].x,anchors[2].y-anchors[1].y)),Math.max(0,Math.hypot(anchors[1].x-anchors[0].x,anchors[1].y-anchors[0].y)*2),Math.atan2(anchors[1].y-anchors[0].y,anchors[1].x-anchors[0].x)*180/Math.PI);
  const resetParticipants=(nextServer:string,nextFamily:Family)=>setParticipants(getV09Scenario(nextServer,Math.round(time*3)).groups[nextFamily.toLowerCase() as "si"|"so"].members.map(member=>member.id));
  const saveGt=async()=>{const quality=(value:number):GtSegment["quality"]=>value>=80?"good":value<50?"low":"medium";const base={family,serverId,groupId:group.id,start:"2026-09-05T17:00",end:"2026-09-05T19:00",vehicleCount:participants.length,routeType:wrong?"manual-corrected":family==="SI"?"compact":"double",label:`${group.id} · clip ${start}%–${end}%`,participants,clipStartPct:start,clipEndPct:end,routeCorrected:wrong};const additions:GtSegment[]=[{...base,id:createId("gt"),layer:"sync",quality:quality(sync),score:sync},{...base,id:createId("gt"),layer:"route",quality:quality(routeScore),score:routeScore}];await save({...state,vehicleTypes:types,gtSegments:[...state.gtSegments,...additions]},"gt","approve-v09",group.id);toast.success("GT נשמר עם clip, עקבות ותיקון ידני")};
  return <div><header className="v09-section-header"><div><p className="eyebrow">GROUND TRUTH</p><h2>GT · Playback, Clip ותיקון ידני</h2><p>העקבות המקוריות תמיד מוצגות. שינוי Start/End מעמעם מיד את החלק שמחוץ ל־Clip.</p></div><button className="primary" onClick={saveGt}><Save/>שמור GT</button></header>
    <section className="v09-panel"><div className="v09-gt-source"><label>שרת<select value={serverId} onChange={event=>{const value=event.target.value;setServerId(value);resetParticipants(value,family)}}>{state.servers.filter(item=>item.enabled).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>משפחה<select value={family} onChange={event=>{const value=event.target.value as Family;setFamily(value);resetParticipants(serverId,value)}}><option>SI</option><option>SO</option></select></label><button onClick={()=>{setLoaded(true);toast.success("הטווח נטען")}}>{loaded?"טען מחדש":"שלוף טווח"}</button></div>
      <div className="v09-gt-grid"><div><svg ref={svgRef} className="v09-gt-map" viewBox="0 0 900 460" onPointerMove={event=>{if(drag==null||!svgRef.current)return;const p=pointer(svgRef.current,event);setAnchors(current=>current.map((item,index)=>index===drag?p:item))}} onPointerUp={()=>setDrag(null)} onPointerLeave={()=>setDrag(null)}><defs><pattern id="v09-gt-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36"/></pattern></defs><rect width="900" height="460"/><rect width="900" height="460" fill="url(#v09-gt-grid)"/>{rawRoutes.map((route,index)=><g key={route.key}><path d={svgClosedPath(route.points)} fill="none" stroke={types.find(type=>type.id===route.typeId)?.color??types[index%Math.max(1,types.length)]?.color??"#888"} className="v09-gt-route"/>{Array.from({length:70},(_,dot)=>{const phase=dot/70;const p=pointOnClosed(route.points,phase);const pct=phase*100;const inside=pct>=start&&pct<=end;return <circle key={dot} cx={p.x} cy={p.y} r={inside?3.7:2.6} fill={types.find(type=>type.id===route.typeId)?.color??"#888"} opacity={inside?.78:.13}/>})}</g>)}{currentPositions.map(({member,point})=>{const color=types.find(type=>type.id===member.typeId)?.color??"#888";return <g key={member.id} transform={`translate(${point.x} ${point.y}) rotate(${point.heading})`}><circle r="12" fill="var(--map-card)" stroke={color} strokeWidth="2"/><path d="M0-14 7 9 0 5-7 9Z" fill={color}/><text y="29" textAnchor="middle">{member.id}</text></g>})}{wrong&&<g className="v09-manual-correction"><path d={svgClosedPath(corrected)} fill="none" stroke="#0a84ff" strokeDasharray="7 5" strokeWidth="4"/>{anchors.map((point,index)=><g key={index}><circle cx={point.x} cy={point.y} r="9" className="v09-axis-handle" onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);setDrag(index)}}/><text x={point.x+12} y={point.y-12}>{["מרכז","אורך","רדיוס","זווית"][index]}</text></g>)}</g>}</svg><div className="v09-playback"><button onClick={()=>setPlaying(value=>!value)}>{playing?<Pause/>:<Play/>}</button><input type="range" min={start} max={end} value={clamp(time,start,end)} onChange={event=>setTime(Number(event.target.value))}/><b>{time}%</b></div><div className="v09-clip-controls"><label>Start · {start}%<input type="range" min="0" max={Math.max(0,end-5)} value={start} onChange={event=>{const value=Number(event.target.value);setStart(value);setTime(current=>Math.max(current,value))}}/></label><label>End · {end}%<input type="range" min={Math.min(100,start+5)} max="100" value={end} onChange={event=>{const value=Number(event.target.value);setEnd(value);setTime(current=>Math.min(current,value))}}/></label></div></div>
        <aside className="v09-gt-judgement"><h3>משתתפים</h3><div className="v09-participants">{group.members.map(member=><button key={member.id} className={participants.includes(member.id)?"active":""} onClick={()=>setParticipants(current=>current.includes(member.id)?current.filter(id=>id!==member.id):[...current,member.id])}>{member.id}</button>)}</div><label>Sync סובייקטיבי · {sync}<input type="range" min="0" max="100" value={sync} onChange={event=>setSync(Number(event.target.value))}/></label><label>Route סובייקטיבי · {routeScore}<input type="range" min="0" max="100" value={routeScore} onChange={event=>setRouteScore(Number(event.target.value))}/></label><label className="v09-check"><input type="checkbox" checked={wrong} onChange={event=>setWrong(event.target.checked)}/>Route classified wrong</label>{wrong&&<div className="v09-callout"><b>תיקון על המפה</b><p>גרור את נקודות הציר: מרכז, אורך, רדיוס וזווית. התוואי הכחול מתעדכן בזמן אמת.</p></div>}<button className="primary" onClick={saveGt}><Check/>אשר GT</button></aside></div>
    </section><section className="v09-panel"><h3>בנק GT</h3><div className="v09-gt-bank">{state.gtSegments.map(item=><div key={item.id}><b>{item.groupId}</b><span>{item.layer} · {item.score}</span><small>{item.label}</small></div>)}</div></section>
  </div>;
}
