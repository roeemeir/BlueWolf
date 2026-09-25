"use client";

import { useEffect, useRef, useState } from "react";
import { traceScoreColor } from "@/lib/score-trace";
import { LoaderCircle, MapPinned, Radar } from "lucide-react";

import {
  SO_RELATION_LABELS,
  getServerScenario,
  relationFromCode,
  scoreSeriesForServer,
  type DemoGroupKey,
  type Family,
  type SavedRoute,
  type SoRelation,
  type SoRouteKind,
  type VehicleIconName,
  type VehicleType,
} from "@/lib/bluewolf";
import { WolfLogo } from "./wolf-logo";

export type GroupKey = DemoGroupKey;
export type ScoreLayer = "total" | "sync" | "route";
export const DEMO_GROUPS = getServerScenario("1").groups;
export const groupLineColor: Record<GroupKey, string> = { si: "#19a99a", so: "#3f70dc" };

type Point = { x: number; y: number };

export function LoadingScreen({ progress }: { progress: number }) {
  const stage = progress < 35 ? "טוען קונפיגורציה" : progress < 70 ? "מכין מנוע תנועה" : "מסנכרן סביבת עבודה";
  return <div className="loading-screen" role="status" aria-live="polite"><div className="loading-aurora" /><div className="loading-card glass-panel"><div className="loading-logo-wrap"><WolfLogo animated /></div><h1>זאב כחול</h1><p>{stage}</p><div className="loading-track"><span style={{ width: `${progress}%` }} /></div><div className="loading-meta"><span>{progress}%</span><span><LoaderCircle className="spin" /> מכין סביבת עבודה</span></div></div></div>;
}

export function ScoreRing({ value, color, size = "normal" }: { value: number; color: string; size?: "small" | "normal" | "large" }) {
  const safe = Math.max(0, Math.min(100, Math.round(value)));
  return <div className={`score-ring score-ring-${size}`} style={{ background: `conic-gradient(${color} ${safe * 3.6}deg, var(--score-track) 0deg)` }} aria-label={`ציון ${safe}`}><div><strong>{safe}</strong>{size === "large" && <span>כולל</span>}</div></div>;
}

export function VehicleIconGlyph({ icon, color = "currentColor" }: { icon: VehicleIconName; color?: string }) {
  if (icon === "truck") return <g stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M-8-6H3v12H-8zM3-2h5l3 4v4H3z" /><path d="M-5-8 0-12 5-8" /><circle cx="-4" cy="8" r="2" /><circle cx="7" cy="8" r="2" /></g>;
  if (icon === "shield") return <g stroke={color} strokeWidth="1.7" fill="none" strokeLinejoin="round"><path d="M0-12 9-7v8c0 6-4 10-9 13-5-3-9-7-9-13v-8z" /><path d="M0-12v-4m-3 3 3-3 3 3" /></g>;
  if (icon === "drone") return <g stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round"><path d="M0-10 4-4 0 2-4-4Z" /><path d="M0-10v-5m-2 2 2-2 2 2M-5-4h-7m17 0h7M-4 2l-6 6m14-6 6 6" /></g>;
  if (icon === "boat") return <g stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M0-14V1M0-11l8 8H0M-10 3h20l-5 8H-5z" /><path d="M-3-12 0-16 3-12" /></g>;
  return <g stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M-8-6h16v12H-8z" /><path d="M-5-8 0-13 5-8" /><circle cx="-5" cy="8" r="2" /><circle cx="5" cy="8" r="2" /></g>;
}

function VehicleMarker({ x, y, heading, id, color, icon, selected, onClick }: { x: number; y: number; heading: number; id: number; color: string; icon: VehicleIconName; selected?: boolean; onClick: () => void }) {
  return <g className={`v04-vehicle ${selected ? "selected" : ""}`} transform={`translate(${x} ${y})`} onClick={onClick} role="button" tabIndex={0} aria-label={`רכב ${id}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onClick(); }}>
    {selected && <circle r="19" className="v04-selection-ring" stroke={color} />}
    <g transform={`rotate(${heading})`} className="v04-vehicle-body"><path d="M0-18 7-9 10 9 0 14-10 9-7-9Z" fill="var(--map-card)" stroke={color} strokeWidth="2.4" /><path d="M0-18 4-11H-4Z" fill={color} /><g transform="scale(.72)"><VehicleIconGlyph icon={icon} color={color} /></g></g>
    <g className="v04-id-label" transform="translate(0 27)"><rect x="-17" y="-9" width="34" height="18" rx="9" /><text y="4" textAnchor="middle">{id}</text></g>
  </g>;
}

function distance(a: Point, b: Point) { return Math.hypot(b.x - a.x, b.y - a.y); }
function lerp(a: Point, b: Point, t: number): Point { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function unit(a: Point, b: Point) { const len = Math.max(.0001, distance(a, b)); return { x: (b.x - a.x) / len, y: (b.y - a.y) / len }; }
function normal(a: Point, b: Point) { const u = unit(a, b); return { x: -u.y, y: u.x }; }

function capsulePath(a: Point, b: Point, radius: number) {
  const n = normal(a, b); const p1 = { x: a.x + n.x * radius, y: a.y + n.y * radius }; const p2 = { x: b.x + n.x * radius, y: b.y + n.y * radius }; const p3 = { x: b.x - n.x * radius, y: b.y - n.y * radius }; const p4 = { x: a.x - n.x * radius, y: a.y - n.y * radius };
  return `M${p1.x},${p1.y} L${p2.x},${p2.y} A${radius},${radius} 0 0 0 ${p3.x},${p3.y} L${p4.x},${p4.y} A${radius},${radius} 0 0 0 ${p1.x},${p1.y} Z`;
}

function capsulePoint(a: Point, b: Point, radius: number, phase: number) {
  const p=((phase%1)+1)%1,u=unit(a,b),n=normal(a,b),leg=distance(a,b),turn=Math.PI*radius;
  let length=p*(2*leg+2*turn),point:Point,tangent:Point;
  if(length<leg){point={x:a.x+n.x*radius+u.x*length,y:a.y+n.y*radius+u.y*length};tangent=u;}
  else if((length-=leg)<turn){const t=length/radius;point={x:b.x+radius*(n.x*Math.cos(t)+u.x*Math.sin(t)),y:b.y+radius*(n.y*Math.cos(t)+u.y*Math.sin(t))};tangent={x:-n.x*Math.sin(t)+u.x*Math.cos(t),y:-n.y*Math.sin(t)+u.y*Math.cos(t)};}
  else if((length-=turn)<leg){point={x:b.x-n.x*radius-u.x*length,y:b.y-n.y*radius-u.y*length};tangent={x:-u.x,y:-u.y};}
  else {length-=leg;const t=length/radius;point={x:a.x-radius*(n.x*Math.cos(t)+u.x*Math.sin(t)),y:a.y-radius*(n.y*Math.cos(t)+u.y*Math.sin(t))};tangent={x:n.x*Math.sin(t)-u.x*Math.cos(t),y:n.y*Math.sin(t)-u.y*Math.cos(t)};}
  return {...point,heading:Math.atan2(tangent.y,tangent.x)*180/Math.PI+90};
}

function doubleOutline(a:Point,middle:Point,b:Point,radius:number):Point[]{
 const n1=normal(a,middle),n2=normal(middle,b),u1=unit(a,middle),u2=unit(middle,b);
 const denom=1+n1.x*n2.x+n1.y*n2.y;
 const offset={x:(n1.x+n2.x)*radius/denom,y:(n1.y+n2.y)*radius/denom};
 const points=[{x:a.x+n1.x*radius,y:a.y+n1.y*radius},{x:middle.x+offset.x,y:middle.y+offset.y},{x:b.x+n2.x*radius,y:b.y+n2.y*radius}];
 for(let i=1;i<=24;i++){const t=i*Math.PI/24;points.push({x:b.x+radius*(n2.x*Math.cos(t)+u2.x*Math.sin(t)),y:b.y+radius*(n2.y*Math.cos(t)+u2.y*Math.sin(t))});}
 points.push({x:middle.x-offset.x,y:middle.y-offset.y},{x:a.x-n1.x*radius,y:a.y-n1.y*radius});
 for(let i=1;i<=24;i++){const t=i*Math.PI/24;points.push({x:a.x-radius*(n1.x*Math.cos(t)+u1.x*Math.sin(t)),y:a.y-radius*(n1.y*Math.cos(t)+u1.y*Math.sin(t))});}
 return points;
}
function doublePath(a:Point,middle:Point,b:Point,radius:number){return doubleOutline(a,middle,b,radius).map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ')+' Z';}
function doublePoint(a:Point,middle:Point,b:Point,radius:number,phase:number){
 const points=doubleOutline(a,middle,b,radius);const lengths=points.slice(1).map((p,i)=>distance(points[i],p));let remaining=(((phase%1)+1)%1)*lengths.reduce((a,b)=>a+b,0);
 for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]){const p=lerp(points[i],points[i+1],remaining/lengths[i]);return {...p,heading:Math.atan2(points[i+1].y-points[i].y,points[i+1].x-points[i].x)*180/Math.PI+90};}remaining-=lengths[i];}
 return {...points[0],heading:0};
}

// Exact axes: -45°, -15°, +15°, +45°. Every adjacent hippodrome differs by exactly 30°.
const SO_ANCHORS: Point[] = [
  { x: 482.5, y: 355.5 },
  { x: 574.4, y: 263.6 },
  { x: 700, y: 230 },
  { x: 825.6, y: 263.6 },
  { x: 917.5, y: 355.5 },
];
const ringRadius: Record<string, number> = { inner: 48, middle: 82, outer: 116 };

function RelationBadge({ x, y, relation, side }: { x: number; y: number; relation: SoRelation; side: "left" | "right" }) {
  return <g className="v04-relation"><circle cx={x} cy={y} r="5" /><path d={side === "left" ? `M${x - 7} ${y - 7}l-24-22` : `M${x + 7} ${y - 7}l24-22`} /><rect x={side === "left" ? x - 116 : x + 14} y={y - 57} width="102" height="30" rx="15" /><text x={side === "left" ? x - 65 : x + 65} y={y - 38} textAnchor="middle">{SO_RELATION_LABELS[relation]} · 30°</text></g>;
}

function DirectionCue({ a, b, relation, reverse = false }: { a: Point; b: Point; relation: SoRelation; reverse?: boolean }) {
  const mid = lerp(a, b, .5); const u = unit(a, b); const sign = reverse ? -1 : 1; const end = { x: mid.x + u.x * 24 * sign, y: mid.y + u.y * 24 * sign }; const start = { x: mid.x - u.x * 24 * sign, y: mid.y - u.y * 24 * sign };
  if (relation === "mixed") return <g className="v04-direction-cue mixed"><line x1={start.x} y1={start.y - 5} x2={end.x} y2={end.y - 5} /><line x1={end.x} y1={end.y + 5} x2={start.x} y2={start.y + 5} /><circle cx={mid.x} cy={mid.y} r="4" /></g>;
  return <g className={`v04-direction-cue ${relation}`}><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} /><path d={`M${end.x},${end.y} l${-u.x * 8 + -u.y * 4},${-u.y * 8 + u.x * 4} M${end.x},${end.y} l${-u.x * 8 + u.y * 4},${-u.y * 8 - u.x * 4}`} /></g>;
}

export function LiveMap({ serverId, tick, selectedGroup, selectedVehicle, showTrace, showRoutes, showRelations, showGrid, vehicleTypes, templateValues, mapProfile = "engineering", animate = true, onSelectGroup, onSelectVehicle }: { serverId: string; tick: number; selectedGroup: GroupKey; selectedVehicle: number | null; showTrace: boolean; showRoutes: boolean; showRelations: boolean; showGrid: boolean; vehicleTypes: VehicleType[]; templateValues?: Partial<Record<GroupKey, number[]>>; mapProfile?: string; animate?: boolean; onSelectGroup: (key: GroupKey) => void; onSelectVehicle: (id: number, group: GroupKey) => void }) {
  const scenario = getServerScenario(serverId); const progress = ((tick * .028) + Number(serverId) * .013) % 1; const typeById = (typeId: string) => vehicleTypes.find((type) => type.id === typeId) ?? vehicleTypes[0]; const siCenter = { x: 235, y: 285 };
  const siPoints = scenario.groups.si.members.map((vehicle) => { const r = ringRadius[vehicle.ring ?? "middle"]; const angle = (progress + vehicle.phase) * Math.PI * 2; return { x: siCenter.x + Math.cos(angle) * r, y: siCenter.y + Math.sin(angle) * r, heading: angle * 180 / Math.PI + 180, vehicle }; });
  const soMembers = scenario.groups.so.members; const soPoints = soMembers.map((vehicle, index) => { const phase = (progress + vehicle.phase) % 1; if (index === 0) return { ...capsulePoint(SO_ANCHORS[0], SO_ANCHORS[1], 30, phase), vehicle }; if (index === soMembers.length - 1) return { ...capsulePoint(SO_ANCHORS[3], SO_ANCHORS[4], 30, phase), vehicle }; return { ...doublePoint(SO_ANCHORS[1], SO_ANCHORS[2], SO_ANCHORS[3], 28, index === 1 ? phase : (phase + .5) % 1), vehicle }; });
  const [traceFrames, setTraceFrames] = useState<{ server: string; tick: number; points: { x: number; y: number; id: number; sync: number }[] }[]>([]);
  useEffect(() => {
    const points = [...siPoints, ...soPoints].map(point => ({ x: point.x, y: point.y, id: point.vehicle.id, sync: point.vehicle.sync }));
    setTraceFrames(previous => [...previous.filter(frame => frame.server === serverId && frame.tick < tick && frame.tick >= tick - 360), { server: serverId, tick, points }]);
    // Navigation is deterministic for each server/tick; repainting the UI is not a sample.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, tick]);
  const relations = (templateValues?.so ?? [2, 0]).map(relationFromCode); const mapClass = mapProfile === "orthophoto" ? "orthophoto" : "engineering";
  return <svg className={`map-svg v04-live-map ${mapClass}`} viewBox="0 0 1000 570" role="img" aria-label="מפה חיה של קבוצות SI ו-SO">
    <defs><pattern id={`v04-grid-${serverId}`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" className="v04-grid-line" /></pattern></defs><rect width="1000" height="570" fill="var(--map-bg)" /><rect width="1000" height="570" className="v04-map-wash" />{showGrid && <rect width="1000" height="570" fill={`url(#v04-grid-${serverId})`} />}
    <g className="v04-map-labels"><text x="38" y="45">SI · טבעות</text><text x="455" y="45">SO · שרשרת היפודרומים</text><text x="455" y="68">קצה משותף · 30° מדויק בין שכנים</text></g>
    {showRoutes && <g className="v04-routes"><g className={selectedGroup === "si" ? "active" : ""} onClick={() => onSelectGroup("si")}>{(["inner", "middle", "outer"] as const).map((ring) => <circle key={ring} cx={siCenter.x} cy={siCenter.y} r={ringRadius[ring]} className="v04-si-route" />)}</g><g className={selectedGroup === "so" ? "active" : ""} onClick={() => onSelectGroup("so")}><path d={capsulePath(SO_ANCHORS[0], SO_ANCHORS[1], 30)} className="v04-so-route" /><path d={doublePath(SO_ANCHORS[1], SO_ANCHORS[2], SO_ANCHORS[3], 28)} className="v04-so-route double" /><path d={capsulePath(SO_ANCHORS[3], SO_ANCHORS[4], 30)} className="v04-so-route" /><circle cx={SO_ANCHORS[1].x} cy={SO_ANCHORS[1].y} r="7" className="v04-shared-end" /><circle cx={SO_ANCHORS[3].x} cy={SO_ANCHORS[3].y} r="7" className="v04-shared-end" /></g></g>}
    {showTrace && <g className="score-trace">{traceFrames.filter(frame => frame.server === serverId).slice(1).flatMap((frame, index) => frame.points.flatMap(point => { const prior = traceFrames[index]?.points.find(item => item.id === point.id); return prior ? [<line key={`${frame.tick}:${point.id}`} x1={prior.x} y1={prior.y} x2={point.x} y2={point.y} style={{ stroke: traceScoreColor(point.sync) }} />] : []; }))}</g>}
    {showRelations && selectedGroup === "so" && <g><RelationBadge x={SO_ANCHORS[1].x} y={SO_ANCHORS[1].y} relation={relations[0] ?? "opposite"} side="left" /><RelationBadge x={SO_ANCHORS[3].x} y={SO_ANCHORS[3].y} relation={relations[1] ?? "same"} side="right" /><DirectionCue a={SO_ANCHORS[0]} b={SO_ANCHORS[1]} relation={relations[0] ?? "opposite"} /><DirectionCue a={SO_ANCHORS[1]} b={SO_ANCHORS[2]} relation={relations[0] ?? "opposite"} reverse={relations[0] === "opposite"} /><DirectionCue a={SO_ANCHORS[2]} b={SO_ANCHORS[3]} relation={relations[1] ?? "same"} /><DirectionCue a={SO_ANCHORS[3]} b={SO_ANCHORS[4]} relation={relations[1] ?? "same"} reverse={relations[1] === "opposite"} /></g>}
    {showRelations && selectedGroup === "si" && <g className="v04-si-relations">{siPoints.map((point, index) => siPoints.slice(index + 1).map((other, offset) => { const pairIndex = index * siPoints.length - (index * (index + 1)) / 2 + offset; const angle = templateValues?.si?.[pairIndex] ?? 120; const mid = lerp(point, other, .5); return <g key={`${point.vehicle.id}-${other.vehicle.id}`}><line x1={point.x} y1={point.y} x2={other.x} y2={other.y} /><rect x={mid.x - 24} y={mid.y - 12} width="48" height="24" rx="12" /><text x={mid.x} y={mid.y + 4} textAnchor="middle">{angle}°</text></g>; }))}</g>}
    <g className="v04-vehicles">{siPoints.map((point) => <VehicleMarker key={point.vehicle.id} x={point.x} y={point.y} heading={point.heading} id={point.vehicle.id} color={groupLineColor.si} icon={typeById(point.vehicle.typeId)?.icon ?? "rover"} selected={selectedVehicle === point.vehicle.id} onClick={() => onSelectVehicle(point.vehicle.id, "si")} />)}{soPoints.map((point) => <VehicleMarker key={point.vehicle.id} x={point.x} y={point.y} heading={point.heading} id={point.vehicle.id} color={groupLineColor.so} icon={typeById(point.vehicle.typeId)?.icon ?? "rover"} selected={selectedVehicle === point.vehicle.id} onClick={() => onSelectVehicle(point.vehicle.id, "so")} />)}</g>
    <g className="v04-map-scale"><path d="M42 520h90" /><text x="42" y="510">100 מ׳</text><text x="955" y="535" textAnchor="end">{animate ? "LIVE" : "SNAPSHOT"}</text></g>
  </svg>;
}

export function TimelineChart({ serverId = "1", selected, layers, cursor, onCursor, fromLabel = "17:00", toLabel = "19:00", selectedVehicle }: { serverId?: string; selected: GroupKey; layers: ScoreLayer[]; cursor: number; onCursor: (value: number) => void; fromLabel?: string; toLabel?: string; selectedVehicle?: number | null }) {
  const series = scoreSeriesForServer(serverId, 120); const left = 52; const right = 962; const top = 20; const bottom = 205; const safe = Math.max(0, Math.min(series.length - 1, cursor)); const x = (index: number) => left + index / (series.length - 1) * (right - left); const y = (score: number) => bottom - score / 100 * (bottom - top); const layerPoints = (group: GroupKey, layer: ScoreLayer) => series.map((item) => `${x(item.index)},${y(item[group][layer])}`).join(" "); const eventBands = [{ from: 0, to: 38, group: "si" as GroupKey, label: "E1" }, { from: 43, to: 83, group: "so" as GroupKey, label: "E2" }, { from: 88, to: 119, group: "si" as GroupKey, label: "E3" }];
  return <svg className="timeline-svg v04-timeline" viewBox="0 0 1000 260" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const relative = (event.clientX - rect.left) / rect.width; onCursor(Math.round(Math.max(0, Math.min(1, relative)) * (series.length - 1))); }}>{[0, 25, 50, 75, 100].map((score) => <g key={score}><line x1={left} x2={right} y1={y(score)} y2={y(score)} className="chart-grid" /><text x="42" y={y(score) + 4} textAnchor="end" className="chart-label">{score}</text></g>)}{layers.flatMap((layer) => (["si", "so"] as GroupKey[]).map((group) => <polyline key={`${group}-${layer}`} points={layerPoints(group, layer)} fill="none" stroke={groupLineColor[group]} strokeWidth={group === selected && layer === "sync" ? 3.5 : 2} strokeDasharray={layer === "route" ? "8 5" : layer === "total" ? "2 4" : undefined} opacity={group === selected ? .95 : .48} />))}{selectedVehicle && <text x="958" y="18" textAnchor="end" className="chart-label">רכב {selectedVehicle}</text>}<line x1={x(safe)} x2={x(safe)} y1={top} y2={bottom} className="cursor-line" /><g className="v04-event-bands">{eventBands.map((band) => <g key={band.label}><rect x={x(band.from)} y="218" width={Math.max(12, x(band.to) - x(band.from))} height="14" rx="7" fill={groupLineColor[band.group]} opacity=".35" /><text x={x(band.from) + 5} y="248">{band.label}</text></g>)}</g><text x={left} y="254" className="chart-label">{fromLabel}</text><text x={right} y="254" textAnchor="end" className="chart-label">{toLabel}</text></svg>;
}

function pairCountToVehicleCount(pairCount: number) { for (let n = 2; n <= 5; n += 1) if (n * (n - 1) / 2 === pairCount) return n; return 3; }
function firstPairIndex(second: number) { return second - 1; }

export function TemplatePreview({ family, values, siPositions, compact = false, title, vehicleTypes = [], soKinds = ["single", "double", "single"] }: { family: Family | GroupKey; values: number[]; siPositions?: import("@/lib/bluewolf").SiPosition[]; compact?: boolean; title?: string; vehicleTypes?: VehicleType[]; soKinds?: SoRouteKind[] }) {
  const normalized = family.toUpperCase() as Family; const typeColors = vehicleTypes.length ? vehicleTypes.map((item) => item.color) : ["#ff9f43", "#34b7eb", "#9068ff", "#d16ff2", "#4fbf79"];
  if (normalized === "SI") {
    const count = siPositions?.length ?? pairCountToVehicleCount(values.length);
    const positions = siPositions?.map(slot => slot.angleDeg) ?? Array.from({length:count},(_,index) => index === 0 ? 0 : values[firstPairIndex(index)] ?? 90);
    const colors = { inner: "#ff9f43", middle: "#34b7eb", outer: "#9068ff" };
    const points = positions.map((angle,index) => {
      const ring = siPositions?.[index].ring ?? (["inner","middle","outer","middle","outer"] as const)[index];
      const radius = { inner:42,middle:64,outer:86 }[ring]; const rad=(angle-90)*Math.PI/180;
      return {x:200+Math.cos(rad)*radius,y:115+Math.sin(rad)*radius,color:colors[ring]};
    });
    return <div className="si-placement-preview"><svg className={`template-preview-svg v04-template-preview ${compact ? "compact" : ""}`} viewBox="0 0 400 230" role="img" aria-label={title ?? "תצוגת תבנית SI"}><rect width="400" height="230" rx="20" />{Array.from({length:12},(_,index) => {const rad=(index*30-90)*Math.PI/180;return <g key={index}><line className="preview-spoke" x1="200" y1="115" x2={200+86*Math.cos(rad)} y2={115+86*Math.sin(rad)} /><text x={200+103*Math.cos(rad)} y={119+103*Math.sin(rad)} textAnchor="middle">{index*30}°</text></g>;})}<circle cx="200" cy="115" r="42" className="ring inner" /><circle cx="200" cy="115" r="64" className="ring middle" /><circle cx="200" cy="115" r="86" className="ring outer" />{points.map((point,index)=><g key={index}><circle cx={point.x} cy={point.y} r="9" fill={point.color}/><text x={point.x} y={point.y+4} textAnchor="middle" style={{fill:"#122333",fontSize:10}}>{index+1}</text></g>)}</svg>{!compact && <div className="si-pair-summary">{positions.map((angle,index)=><span key={index}>{vehicleTypes[index]?.name ?? `רכב ${index+1}`} {index+1}: <bdi>{angle}°</bdi></span>)}<small>הפרשים נגזרים: {values.map((angle,index)=><bdi key={index}> {angle}°{index < values.length-1 ? " · " : ""}</bdi>)}</small></div>}</div>;
  }
  const relations = values.map(relationFromCode); const a = { x: 53, y: 141 }; const b = { x: 115, y: 79 }; const c = { x: 200, y: 56 }; const d = { x: 285, y: 79 }; const e = { x: 347, y: 141 };
  return <svg className={`template-preview-svg v04-template-preview ${compact ? "compact" : ""}`} viewBox="0 0 400 220" role="img" aria-label={title ?? "תצוגת תבנית SO"}><rect width="400" height="220" rx="20" /><g className="v04-preview-so"><path d={capsulePath(a, b, 21)} /><path d={doublePath(b, c, d, 19)} className="double" /><path d={capsulePath(d, e, 21)} /><circle cx={b.x} cy={b.y} r="5" /><circle cx={d.x} cy={d.y} r="5" /><g className="v04-preview-relation"><rect x="67" y="18" width="96" height="25" rx="12" /><text x="115" y="35" textAnchor="middle">{SO_RELATION_LABELS[relations[0] ?? "opposite"]} · 30°</text><rect x="237" y="18" width="96" height="25" rx="12" /><text x="285" y="35" textAnchor="middle">{SO_RELATION_LABELS[relations[1] ?? "same"]} · 30°</text></g><DirectionCue a={a} b={b} relation={relations[0] ?? "opposite"} /><DirectionCue a={b} b={c} relation={relations[0] ?? "opposite"} reverse={relations[0] === "opposite"} /><DirectionCue a={c} b={d} relation={relations[1] ?? "same"} /><DirectionCue a={d} b={e} relation={relations[1] ?? "same"} reverse={relations[1] === "opposite"} />{[82, 165, 235, 318].map((x, index) => <circle key={x} cx={x} cy={[132, 88, 88, 132][index]} r="7" fill={typeColors[index % typeColors.length]} />)}<text x="200" y="205" textAnchor="middle">{soKinds.map((kind) => kind === "double" ? "כפול" : "יחיד").join(" — ")}</text></g></svg>;
}

export function EventMiniMap({ family, color }: { family: GroupKey; color: string }) { return <div className="event-mini-map v04-event-mini"><MapPinned /><span>{family.toUpperCase()}</span>{family === "si" ? <div className="mini-circle-route" style={{ borderColor: color }} /> : <svg viewBox="0 0 80 36"><path d={capsulePath({ x: 8, y: 26 }, { x: 30, y: 8 }, 5)} stroke={color} fill="none" /><path d={capsulePath({ x: 30, y: 8 }, { x: 50, y: 8 }, 5)} stroke={color} fill="none" /><path d={capsulePath({ x: 50, y: 8 }, { x: 72, y: 26 }, 5)} stroke={color} fill="none" /></svg>}</div>; }

export function EventOverviewMap({ eventLabels = ["E1", "E2", "E3"] }: { eventLabels?: string[] }) { return <svg className="v04-overview-map" viewBox="0 0 720 300"><rect width="720" height="300" rx="22" /><g className="v04-overview-routes"><circle cx="150" cy="150" r="75" /><circle cx="150" cy="150" r="49" /><path d={capsulePath({ x: 330, y: 205 }, { x: 405, y: 130 }, 22)} /><path d={capsulePath({ x: 405, y: 130 }, { x: 510, y: 102 }, 20)} /><path d={capsulePath({ x: 510, y: 102 }, { x: 585, y: 177 }, 22)} /></g>{eventLabels.map((label, index) => <g className="v04-overview-event" key={label} transform={`translate(${[150, 420, 560][index % 3]} ${[150, 145, 175][index % 3]})`}><circle r="17" /><text y="5" textAnchor="middle">{label}</text></g>)}</svg>; }

export function GtPlayback({ family, progress, vehicleTypes }: { family: Family; progress: number; vehicleTypes: VehicleType[] }) { const tick = Math.round(progress * 90); return <div className="v04-gt-playback"><LiveMap serverId="1" tick={tick} selectedGroup={family.toLowerCase() as GroupKey} selectedVehicle={null} showTrace={false} showRoutes showRelations showGrid={false} vehicleTypes={vehicleTypes} animate={false} onSelectGroup={() => undefined} onSelectVehicle={() => undefined} /></div>; }

export function RouteBankMap({ routes, vehicleTypes, selectedId, onSelect, onMove }: { routes: SavedRoute[]; vehicleTypes: VehicleType[]; selectedId: string | null; onSelect: (id: string) => void; onMove: (id: string, x: number, y: number) => void }) {
  const svgRef = useRef<SVGSVGElement>(null); const [dragId, setDragId] = useState<string | null>(null); const pointer = (event: React.PointerEvent<SVGSVGElement>) => { const rect = svgRef.current?.getBoundingClientRect(); if (!rect) return { x: 50, y: 50 }; return { x: Math.max(5, Math.min(95, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(8, Math.min(92, (event.clientY - rect.top) / rect.height * 100)) }; };
  return <svg ref={svgRef} className="v04-route-bank-map" viewBox="0 0 900 460" onPointerMove={(event) => { if (!dragId) return; const p = pointer(event); onMove(dragId, p.x, p.y); }} onPointerUp={() => setDragId(null)} onPointerLeave={() => setDragId(null)}><defs><pattern id="route-bank-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" /></pattern></defs><rect width="900" height="460" /><rect width="900" height="460" fill="url(#route-bank-grid)" />{routes.map((route) => { const type = vehicleTypes.find((item) => item.name === route.vehicleType); const x = (route.mapX ?? 50) / 100 * 900; const y = (route.mapY ?? 50) / 100 * 460; const color = type?.color ?? "#8396a4"; const rotation = route.rotationDeg ?? 0; return <g key={route.id} className={`v04-bank-route ${selectedId === route.id ? "selected" : ""}`} transform={`translate(${x} ${y}) rotate(${rotation})`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDragId(route.id); onSelect(route.id); }} onClick={() => onSelect(route.id)}>{route.family === "SI" ? <><circle r="45" stroke={color} /><circle r="28" stroke={color} opacity=".5" /></> : route.routeKind === "double" ? <><path d={capsulePath({ x: -65, y: 0 }, { x: 0, y: 0 }, 20)} stroke={color} /><path d={capsulePath({ x: 0, y: 0 }, { x: 65, y: 0 }, 20)} stroke={color} /></> : <path d={capsulePath({ x: -58, y: 0 }, { x: 58, y: 0 }, 23)} stroke={color} />}<g transform={`rotate(${-rotation}) translate(0 65)`}><rect x="-62" y="-13" width="124" height="26" rx="13" /><text y="5" textAnchor="middle">{route.name}</text></g></g>; })}</svg>;
}

export function MapLoadingOverlay({ progress, label }: { progress: number; label: string }) { return <div className="map-loading-overlay"><div className="map-loader-radar"><Radar /><i /><i /><i /></div><strong>{label}</strong><span>{progress}%</span><div className="loading-track compact"><span style={{ width: `${progress}%` }} /></div></div>; }