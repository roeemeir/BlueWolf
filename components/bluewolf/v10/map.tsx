"use client";

import { useMemo } from "react";
import type { ScoreThresholds, ScoreWeights, SoRelation, SyncTemplate, VehicleType } from "@/lib/bluewolf";
import { svgClosedPath } from "../v09/geometry";
import { fixedVehicleTypes } from "../v09/map";
import { analyzeNavigation, type NavigationAnalysis } from "./nav-engine";
import type { SoGroupingSettings } from "./grouping";
import type { WindMode } from "./wind";

export type V10GroupKey = "si" | "so";
export type OverlayKey = "trace" | "routes" | "hulls" | "relations" | "scoreTrace";
export const GROUP_COLORS: Record<V10GroupKey, string> = { si: "#14a89b", so: "#5d6ff4" };
const UNGROUPED_COLOR = "#7b8794";

function background(profile: string) {
  const engineering = profile.includes("engineering") || profile.includes("הנדסה");
  const ortho = profile.includes("ortho") || profile.includes("צילום") || profile.includes("wmts") || profile.includes("wms") || profile.includes("xyz");
  return <><defs><pattern id="v10-grid" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M38 0H0V38" fill="none" stroke="rgba(100,130,155,.12)" /></pattern><linearGradient id="v10-ortho" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--map-bg)"/><stop offset=".5" stopColor="rgba(58,101,78,.13)"/><stop offset="1" stopColor="rgba(73,91,120,.16)"/></linearGradient></defs><rect width="1000" height="570" fill={ortho ? "url(#v10-ortho)" : "var(--map-bg)"}/>{engineering && <rect width="1000" height="570" fill="url(#v10-grid)"/>}<g className="v09-base-context" fill="none"><path d="M-20 475 C170 390 300 505 475 395 S760 268 1030 338"/><path d="M60 88 C245 158 355 121 505 68 S765 53 960 120"/><path d="M-30 232 C180 178 320 266 480 214 S770 158 1040 238"/><path d="M420 112h102v64H420zM808 404h120v76H808z"/></g></>;
}

function VehicleArrow({ x,y,heading,color,id,selected,onClick,label }: { x:number;y:number;heading:number;color:string;id:number;selected:boolean;onClick:()=>void;label?:string }) {
  return <g className={`v09-vehicle ${selected?"selected":""}`} transform={`translate(${x} ${y})`} role="button" tabIndex={0} onClick={onClick} onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" ")onClick();}} aria-label={`רכב ${id}${label?` · ${label}`:""}`}>
    {selected&&<circle r="19" fill="none" stroke={color} strokeWidth="3" opacity=".45"/>}<g transform={`rotate(${heading})`}><circle r="13" fill="var(--map-card)" stroke={color} strokeWidth="2.5"/><path d="M0-16 8 10 0 6-8 10Z" fill={color}/></g><g transform="translate(0 27)"><rect x="-27" y="-9" width="54" height="18" rx="9" className="v09-id-bg"/><text y="4" textAnchor="middle" className="v09-id-text">{id}{label?" · חוץ":""}</text></g>
  </g>;
}
function relationBadge(x:number,y:number,relation:SoRelation){const label=relation==="same"?"זהה":relation==="opposite"?"הפוך":"מעורב";return <g transform={`translate(${x} ${y})`}><rect x="-34" y="-14" width="68" height="28" rx="14" className="v09-relation-bg"/><text y="4" textAnchor="middle" className="v09-relation-text">{label}</text></g>;}
function continuousScoreColor(score:number){const safe=Math.max(0,Math.min(100,score));return `hsl(${Math.round(safe*1.2)} 70% 47%)`;}

export function V10LiveMap({ serverId,tick,baseMap,overlays,vehicleTypes,selectedGroup,selectedVehicle,siAngles,soRelations,trailMinutes,windMode="off",thresholds,weights,siTemplate,soTemplate,groupingSettings,onSelectGroup,onSelectVehicle,compact=false }: {
  serverId:string;tick:number;baseMap:string;overlays:Record<OverlayKey,boolean>;vehicleTypes:VehicleType[];selectedGroup:V10GroupKey|null;selectedVehicle:number|null;siAngles:number[];soRelations:SoRelation[];trailMinutes:number;windMode?:WindMode;thresholds:ScoreThresholds;weights:ScoreWeights;siTemplate?:SyncTemplate;soTemplate?:SyncTemplate;groupingSettings:SoGroupingSettings;onSelectGroup:(group:V10GroupKey)=>void;onSelectVehicle:(vehicle:number,group:V10GroupKey)=>void;compact?:boolean;
}) {
  const types=useMemo(()=>fixedVehicleTypes(vehicleTypes),[vehicleTypes]);
  const analysis=useMemo(()=>analyzeNavigation({serverId,tick,windMode,thresholds,weights,siTemplate,soTemplate,groupingSettings}),[serverId,tick,windMode,thresholds,weights,siTemplate,soTemplate,groupingSettings]);
  const scenario=analysis.scenario;
  const routeGroups=new Map<string,V10GroupKey>(); for(const key of ["si","so"] as V10GroupKey[]) for(const member of scenario.groups[key].members) routeGroups.set(member.routeKey,key);
  const groupedPositions=(["si","so"] as V10GroupKey[]).flatMap((groupKey)=>scenario.groups[groupKey].members.map((vehicle)=>({vehicle,groupKey,nav:analysis.nav[vehicle.id]})).filter((item)=>item.nav));
  const ungrouped=(scenario.ungroupedMembers??[]).map((vehicle)=>({vehicle,nav:analysis.nav[vehicle.id]})).filter((item)=>item.nav);
  const siPositions=groupedPositions.filter((item)=>item.groupKey==="si"); const soPositions=groupedPositions.filter((item)=>item.groupKey==="so");
  const traceSamples=Math.max(12,Math.min(48,Math.round(Math.max(5,trailMinutes)*1.2))); const scoreSamples=Math.max(16,Math.min(48,Math.round(Math.max(5,trailMinutes)*1.2))); const historyCount=Math.max(traceSamples,scoreSamples);
  const history=useMemo(()=>Array.from({length:historyCount},(_,index)=>analyzeNavigation({serverId,tick:tick-(index+1)*Math.max(10,trailMinutes*60/historyCount),windMode,thresholds,weights,siTemplate,soTemplate,groupingSettings})),[historyCount,serverId,tick,trailMinutes,windMode,thresholds,weights,siTemplate,soTemplate,groupingSettings]);
  const hulls={si:"M70 120Q235 64 396 130L400 444Q240 508 72 438Z",so:"M420 105Q690 42 986 118L995 440Q740 525 420 454Z"};
  return <svg className={`v09-live-map v10-live-map ${compact?"compact":""}`} viewBox="0 0 1000 570" role="img" aria-label={`מפה חיה · ${scenario.title}`}>
    {background(baseMap)}<g className="v09-map-heading"><text x="32" y="36">{scenario.title}</text><text x="32" y="57">{scenario.subtitle}</text><text x="32" y="78">עקבה: {trailMinutes} דקות{windMode!=="off"?" · רוח משוערת מוצגת כהסבר בלבד":""}</text></g>
    {overlays.hulls&&<g className="v09-hulls"><path d={hulls.si} fill="rgba(20,168,155,.045)" stroke={GROUP_COLORS.si} onClick={()=>onSelectGroup("si")}/><path d={hulls.so} fill="rgba(93,111,244,.045)" stroke={GROUP_COLORS.so} onClick={()=>onSelectGroup("so")}/></g>}
    {overlays.routes&&<g className="v09-routes">{scenario.routes.map((route)=>{const group=routeGroups.get(route.key);const isUngrouped=(scenario.ungroupedMembers??[]).some((member)=>member.routeKey===route.key);const color=group?GROUP_COLORS[group]:UNGROUPED_COLOR;return <path key={route.key} d={svgClosedPath(route.points)} fill="none" stroke={color} strokeWidth={route.kind==="double"?5.6:4.6} opacity={group?.toString()? .92:isUngrouped?.72:.28} strokeDasharray={isUngrouped?"9 6":undefined}/>;})}</g>}
    {overlays.trace&&<g className="v09-trace-dots">{groupedPositions.flatMap((item)=>history.slice(0,traceSamples).map((snapshot,index)=>{const p=snapshot.nav[item.vehicle.id];if(!p)return null;return <circle key={`trace-${item.vehicle.id}-${index}`} cx={p.x} cy={p.y} r="3.7" fill={GROUP_COLORS[item.groupKey]} opacity={.18+.62*(1-index/traceSamples)}/>;}))}</g>}
    {overlays.scoreTrace&&<g className="v09-score-trace">{groupedPositions.flatMap((item)=>history.slice(0,scoreSamples).map((snapshot,index)=>{const p=snapshot.nav[item.vehicle.id];const score=snapshot[item.groupKey].vehicles[item.vehicle.id]?.total??snapshot[item.groupKey].score.total;if(!p)return null;return <circle key={`score-${item.vehicle.id}-${index}`} cx={p.x} cy={p.y} r="5" style={{fill:continuousScoreColor(score)}} stroke={GROUP_COLORS[item.groupKey]} strokeWidth="1.35" opacity=".93"/>;}))}</g>}
    {overlays.relations&&selectedGroup==="si"&&<g className="v09-si-relations">{siPositions.slice(0,-1).map((a,index)=>{const b=siPositions[index+1];const x=(a.nav.x+b.nav.x)/2,y=(a.nav.y+b.nav.y)/2;const angle=analysis.si.observedAngles[index]??0;return <g key={`${a.vehicle.id}-${b.vehicle.id}`}><line x1={a.nav.x} y1={a.nav.y} x2={b.nav.x} y2={b.nav.y}/><rect x={x-23} y={y-11} width="46" height="22" rx="11"/><text x={x} y={y+4} textAnchor="middle">{angle.toFixed(0)}°</text></g>;})}<text x="230" y="525" textAnchor="middle" className="v09-template-caption">תבנית: {siAngles.join("° · ")}°</text></g>}
    {overlays.relations&&selectedGroup==="so"&&<g>{soPositions.slice(0,-1).map((item,index)=>{const next=soPositions[index+1];return <g key={index}>{relationBadge((item.nav.x+next.nav.x)/2,(item.nav.y+next.nav.y)/2-36,analysis.so.observedRelations[Math.min(index,analysis.so.observedRelations.length-1)]??soRelations[index]??"same")}</g>;})}</g>}
    <g className="v09-vehicles">{groupedPositions.map((item)=><VehicleArrow key={item.vehicle.id} x={item.nav.x} y={item.nav.y} heading={item.nav.heading} color={GROUP_COLORS[item.groupKey]} id={item.vehicle.id} selected={selectedVehicle===item.vehicle.id} onClick={()=>onSelectVehicle(item.vehicle.id,item.groupKey)}/>)}{ungrouped.map((item)=><VehicleArrow key={`u-${item.vehicle.id}`} x={item.nav.x} y={item.nav.y} heading={item.nav.heading} color={UNGROUPED_COLOR} id={item.vehicle.id} selected={selectedVehicle===item.vehicle.id} onClick={()=>{}} label="לא מקובץ"/>)}</g>
    {overlays.scoreTrace&&<g className="v09-score-legend v10-score-colorbar" transform="translate(30 492)"><rect width="270" height="60" rx="15"/><text x="14" y="17">ציון עקבה רציף</text>{Array.from({length:40},(_,index)=><rect key={index} x={14+index*(236/40)} y="25" width={236/40+1} height="12" style={{fill:continuousScoreColor(index/39*100),stroke:"none"}}/>)}<text x="14" y="52">0</text><text x="132" y="52" textAnchor="middle">50</text><text x="250" y="52" textAnchor="end">100</text></g>}
    <g className="v09-map-scale"><path d="M842 522h100"/><text x="842" y="511">100 מ׳</text></g><g className="v10-map-group-legend" transform="translate(690 28)"><circle cx="8" cy="0" r="7" fill={GROUP_COLORS.si}/><text x="20" y="4">SI</text><circle cx="75" cy="0" r="7" fill={GROUP_COLORS.so}/><text x="87" y="4">SO</text><circle cx="142" cy="0" r="7" fill={UNGROUPED_COLOR}/><text x="154" y="4">לא מקובץ</text></g>
    {types.length===0&&<text x="500" y="550" textAnchor="middle">אין סוגי רכב מוגדרים</text>}
  </svg>;
}
