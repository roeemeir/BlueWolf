"use client";

import { useMemo, useRef, useState } from "react";
import type { SavedRoute, VehicleType } from "@/lib/bluewolf";
import { hippodromeLoop } from "./visuals-v09";

export type RouteV09 = SavedRoute & {
  radiusPx?: number;
  legLengthPx?: number;
  figureEight?: boolean;
  linkedRouteIds?: string[];
};

type Point = { x: number; y: number };
type Handle = "center" | "radius" | "angle" | "leg";

type Props = {
  routes: RouteV09[];
  vehicleTypes: VehicleType[];
  selectedId: string | null;
  mapLabel: string;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<RouteV09>) => void;
};

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const rad=(deg:number)=>deg*Math.PI/180;
const rot=(p:Point,deg:number):Point=>({x:p.x*Math.cos(rad(deg))-p.y*Math.sin(rad(deg)),y:p.x*Math.sin(rad(deg))+p.y*Math.cos(rad(deg))});
const toPath=(pts:Point[])=>pts.length?`M${pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")} Z`:"";

function figureEight(center:Point,leg:number,radius:number,rotation:number,count=140){
  const sx=Math.max(radius*2.2,leg/2+radius),sy=Math.max(radius*1.35,20);const out:Point[]=[];
  for(let i=0;i<count;i++){const t=i/count*Math.PI*2;const local={x:sx*Math.sin(t),y:sy*Math.sin(2*t)};const r=rot(local,rotation);out.push({x:center.x+r.x,y:center.y+r.y});}
  return out;
}

function localParams(route:RouteV09){return {radius:clamp(route.radiusPx??34,14,95),leg:route.family==="SI"?0:clamp(route.legLengthPx??110,0,240),rotation:route.rotationDeg??0};}

export function RouteBankEditorV09({routes,vehicleTypes,selectedId,mapLabel,onSelect,onPatch}:Props){
  const svgRef=useRef<SVGSVGElement|null>(null);
  const [drag,setDrag]=useState<{id:string;handle:Handle}|null>(null);
  const byId=useMemo(()=>new Map(routes.map(r=>[r.id,r])),[routes]);
  const pointer=(event:React.PointerEvent<SVGSVGElement>)=>{const rect=svgRef.current?.getBoundingClientRect();if(!rect)return{x:0,y:0};return{x:(event.clientX-rect.left)/Math.max(1,rect.width)*1000,y:(event.clientY-rect.top)/Math.max(1,rect.height)*560};};
  const centerOf=(route:RouteV09)=>({x:(route.mapX??50)/100*1000,y:(route.mapY??50)/100*560});
  const stop=()=>setDrag(null);

  const handleMove=(route:RouteV09,handle:Handle,p:Point)=>{
    const center=centerOf(route),{rotation}=localParams(route),dx=p.x-center.x,dy=p.y-center.y;
    if(handle==="center"){onPatch(route.id,{mapX:clamp(p.x/10,4,96),mapY:clamp(p.y/5.6,7,93)});return;}
    if(handle==="angle"){onPatch(route.id,{rotationDeg:Math.round(Math.atan2(dy,dx)*180/Math.PI)});return;}
    const local=rot({x:dx,y:dy},-rotation);
    if(handle==="radius"){onPatch(route.id,{radiusPx:clamp(Math.abs(local.y),14,95)});return;}
    if(handle==="leg"){onPatch(route.id,{legLengthPx:clamp(Math.abs(local.x)*2,0,240)});}
  };

  return <svg ref={svgRef} className="v09-route-editor-map" viewBox="0 0 1000 560" role="img" aria-label="בנק נתיבים פרמטרי" onPointerMove={(event)=>{if(!drag)return;const route=byId.get(drag.id);if(route)handleMove(route,drag.handle,pointer(event));}} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}>
    <defs><pattern id="v09-route-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40"/></pattern><filter id="v09-shadow"><feDropShadow dx="0" dy="4" stdDeviation="5" floodOpacity=".2"/></filter></defs>
    <rect width="1000" height="560" className="v09-route-map-bg"/><rect width="1000" height="560" fill="url(#v09-route-grid)" className="v09-route-map-grid"/>
    <g className="v09-route-context" fill="none"><path d="M-30 478 C170 372 315 515 500 385 S780 260 1040 315"/><path d="M50 95 C240 155 380 126 555 70 S820 55 960 116"/><path d="M100 315 C280 250 430 295 590 230 S820 170 935 190"/></g>
    <g className="v09-map-label"><rect x="24" y="20" width="190" height="34" rx="17"/><text x="119" y="42" textAnchor="middle">{mapLabel}</text></g>

    {routes.map(route=>{
      const center=centerOf(route),params=localParams(route),type=vehicleTypes.find(v=>v.name===route.vehicleType),color=type?.color??"#8295a4",selected=selectedId===route.id;
      if(route.routeKind==="double"&&route.linkedRouteIds?.length===2){const first=byId.get(route.linkedRouteIds[0]),second=byId.get(route.linkedRouteIds[1]);if(first&&second){const a=centerOf(first),b=centerOf(second);return <g key={route.id} className={`v09-double-link ${selected?"selected":""}`} onClick={()=>onSelect(route.id)}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth="7" strokeLinecap="round" opacity=".9"/><circle cx={(a.x+b.x)/2} cy={(a.y+b.y)/2} r="14" fill="var(--panel)" stroke={color} strokeWidth="3"/><text x={(a.x+b.x)/2} y={(a.y+b.y)/2+4} textAnchor="middle">2</text></g>;}}
      const points=route.family==="SI"?Array.from({length:120},(_,i)=>{const t=i/120*Math.PI*2;return{x:center.x+Math.cos(t)*params.radius,y:center.y+Math.sin(t)*params.radius};}):route.figureEight||route.routeKind==="figure8"?figureEight(center,params.leg,params.radius,params.rotation):hippodromeLoop(center,params.leg,params.radius,params.rotation,130);
      const angleHandleLocal={x:params.leg/2+params.radius+38,y:0},angleHandleRot=rot(angleHandleLocal,params.rotation),angleHandle={x:center.x+angleHandleRot.x,y:center.y+angleHandleRot.y};
      const radiusLocal=rot({x:0,y:-params.radius},params.rotation),radiusHandle={x:center.x+radiusLocal.x,y:center.y+radiusLocal.y};
      const legLocal=rot({x:params.leg/2,y:0},params.rotation),legHandle={x:center.x+legLocal.x,y:center.y+legLocal.y};
      return <g key={route.id} className={`v09-param-route ${selected?"selected":""}`} onClick={()=>onSelect(route.id)}>
        <path d={toPath(points)} fill="none" stroke="transparent" strokeWidth="26" pointerEvents="stroke" onPointerDown={(event)=>{event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);setDrag({id:route.id,handle:"center"});onSelect(route.id);}}/>
        <path d={toPath(points)} fill="none" stroke={color} strokeWidth={selected?6:4.5} filter="url(#v09-shadow)" pointerEvents="none"/>
        {selected&&<g className="v09-route-handles">
          <line x1={center.x} y1={center.y} x2={angleHandle.x} y2={angleHandle.y} className="axis angle-axis"/>
          <line x1={center.x} y1={center.y} x2={radiusHandle.x} y2={radiusHandle.y} className="axis radius-axis"/>
          {route.family==="SO"&&<line x1={center.x} y1={center.y} x2={legHandle.x} y2={legHandle.y} className="axis leg-axis"/>}
          <circle cx={center.x} cy={center.y} r="10" className="handle center" onPointerDown={(e)=>{e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);setDrag({id:route.id,handle:"center"});}}/><text x={center.x} y={center.y+4} textAnchor="middle">C</text>
          <circle cx={radiusHandle.x} cy={radiusHandle.y} r="9" className="handle radius" onPointerDown={(e)=>{e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);setDrag({id:route.id,handle:"radius"});}}/><text x={radiusHandle.x} y={radiusHandle.y+4} textAnchor="middle">R</text>
          <circle cx={angleHandle.x} cy={angleHandle.y} r="9" className="handle angle" onPointerDown={(e)=>{e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);setDrag({id:route.id,handle:"angle"});}}/><text x={angleHandle.x} y={angleHandle.y+4} textAnchor="middle">↻</text>
          {route.family==="SO"&&<><circle cx={legHandle.x} cy={legHandle.y} r="9" className="handle leg" onPointerDown={(e)=>{e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);setDrag({id:route.id,handle:"leg"});}}/><text x={legHandle.x} y={legHandle.y+4} textAnchor="middle">L</text></>}
        </g>}
        <g className="v09-route-label" transform={`translate(${center.x} ${center.y+params.radius+42})`}><rect x="-75" y="-14" width="150" height="28" rx="14"/><text y="5" textAnchor="middle">{route.name}</text></g>
      </g>;
    })}
  </svg>;
}
