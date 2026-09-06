"use client";

import { useMemo } from "react";
import type { NavigationDataset } from "./navigation-data";
import type { AnalysisFrame } from "./navigation-history";
import type { NavigationDerivedAnalysis } from "./navigation-analyzer";

export type V12GroupKey = "si" | "so";
export type V12OverlayKey = "trace" | "routes" | "relations" | "scoreTrace";
export const GROUP_COLORS: Record<V12GroupKey, string> = { si: "#14a89b", so: "#5d6ff4" };
const UNGROUPED = "#7b8794";

function scoreColor(score: number) { const safe = Math.max(0, Math.min(100, score)); return `hsl(${Math.round(safe * 1.2)} 70% 47%)`; }
function transformFor(dataset: NavigationDataset) {
  const points = dataset.samples.filter((sample) => sample.active); if (!points.length) return (p: { x: number; y: number }) => ({ x: 500, y: 285 });
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x)), minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  const spanX = Math.max(80, maxX - minX), spanY = Math.max(60, maxY - minY), scale = Math.min(820 / spanX, 450 / spanY), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return (p: { x: number; y: number }) => ({ x: 500 + (p.x - cx) * scale, y: 285 - (p.y - cy) * scale });
}
function path(points: { x: number; y: number }[]) { return points.map((p, index) => `${index ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" "); }
function headingArrow(x: number, y: number, heading: number, color: string, id: number, selected: boolean, onClick: () => void) {
  return <g key={id} transform={`translate(${x} ${y})`} onClick={onClick} role="button" tabIndex={0} className="v09-vehicle">{selected && <circle r="20" fill="none" stroke={color} strokeWidth="3" opacity=".45"/>}<g transform={`rotate(${heading})`}><circle r="13" fill="var(--map-card)" stroke={color} strokeWidth="2.5"/><path d="M0-16 8 10 0 6-8 10Z" fill={color}/></g><g transform="translate(0 28)"><rect x="-24" y="-9" width="48" height="18" rx="9" className="v09-id-bg"/><text y="4" textAnchor="middle" className="v09-id-text">{id}</text></g></g>;
}
function nearestFrame(history: AnalysisFrame[], time: string) { if (!history.length) return null; const ms = Date.parse(time); let best = history[0], delta = Math.abs(Date.parse(best.timestamp) - ms); for (const frame of history.slice(1)) { const d = Math.abs(Date.parse(frame.timestamp) - ms); if (d < delta) { best = frame; delta = d; } } return best; }

export function V12LiveMap({ dataset, analysis, history, baseMap, overlays, selectedGroup, selectedVehicle, onSelectGroup, onSelectVehicle }: {
  dataset: NavigationDataset; analysis: NavigationDerivedAnalysis; history: AnalysisFrame[]; baseMap: string; overlays: Record<V12OverlayKey, boolean>; selectedGroup: V12GroupKey | null; selectedVehicle: number | null; onSelectGroup: (key: V12GroupKey) => void; onSelectVehicle: (id: number, key: V12GroupKey) => void;
}) {
  const transform = useMemo(() => transformFor(dataset), [dataset]);
  const memberToGroup = new Map<number, V12GroupKey>(); for (const key of ["si", "so"] as const) for (const id of analysis.groups[key].members) memberToGroup.set(id, key);
  const byVehicle = useMemo(() => { const map = new Map<number, typeof dataset.samples>(); for (const sample of dataset.samples) { const list = map.get(sample.vehicleId) ?? []; list.push(sample); map.set(sample.vehicleId, list); } return map; }, [dataset]);
  const engineering = baseMap.includes("engineering") || baseMap.includes("הנדסה");
  return <svg className="v09-live-map v12-live-map" viewBox="0 0 1000 570" role="img" aria-label="מפה חיה המבוססת על דגימות ניווט">
    <defs><pattern id="v12-grid" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M38 0H0V38" fill="none" stroke="rgba(100,130,155,.12)"/></pattern></defs><rect width="1000" height="570" fill="var(--map-bg)"/>{engineering && <rect width="1000" height="570" fill="url(#v12-grid)"/>}
    <g className="v09-map-heading"><text x="30" y="34">מקור: {analysis.provenance.source === "simulation" ? "סימולציית ניווט" : "InfluxDB"}</text><text x="30" y="56">{analysis.provenance.sampleCount} דגימות · {analysis.provenance.vehicleCount} רכבים · עד {analysis.provenance.latestSampleAt ? new Date(analysis.provenance.latestSampleAt).toLocaleString("he-IL") : "אין נתון"}</text></g>
    {overlays.routes && <g>{analysis.routes.map((route) => { const group = memberToGroup.get(route.vehicleId); const color = group ? GROUP_COLORS[group] : UNGROUPED; return <path key={route.key} d={path(route.points)} fill="none" stroke={color} strokeWidth={route.kind === "double" ? 5 : 4} strokeDasharray={group ? undefined : "9 6"} opacity={group ? .85 : .6}/>; })}</g>}
    {overlays.trace && <g>{[...byVehicle].flatMap(([id, samples]) => { const group = memberToGroup.get(id); const color = group ? GROUP_COLORS[group] : UNGROUPED; const step = Math.max(1, Math.floor(samples.length / 80)); return samples.filter((_, i) => i % step === 0).map((sample, index) => { const p = transform(sample); return <circle key={`${id}-${index}`} cx={p.x} cy={p.y} r="3.2" fill={color} opacity={.22 + .6 * index / Math.max(1, Math.ceil(samples.length / step))}/>; }); })}</g>}
    {overlays.scoreTrace && <g className="v09-score-trace">{[...byVehicle].flatMap(([id, samples]) => { const group = memberToGroup.get(id); if (!group) return []; const step = Math.max(1, Math.floor(samples.length / 70)); return samples.filter((_, i) => i % step === 0).map((sample, index) => { const frame = nearestFrame(history, sample.timestamp); const score = frame?.analysis.groups[group].vehicles[id]?.total ?? frame?.analysis.groups[group].score.total; if (score == null) return null; const p = transform(sample); return <circle key={`s-${id}-${index}`} cx={p.x} cy={p.y} r="4.5" fill={scoreColor(score)} stroke={GROUP_COLORS[group]} strokeWidth="1.1" opacity=".92"/>; }); })}</g>}
    {overlays.relations && selectedGroup === "si" && analysis.groups.si.members.slice(0, -1).map((id, index) => { const nextId = analysis.groups.si.members[index + 1], a = analysis.current[id], b = analysis.current[nextId]; if (!a || !b) return null; const angle = analysis.groups.si.observedAngles[index] ?? 0; return <g key={`${id}-${nextId}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y}/><text x={(a.x+b.x)/2} y={(a.y+b.y)/2-8} textAnchor="middle" className="v09-id-text">{angle.toFixed(1)}°</text></g>; })}
    {overlays.relations && selectedGroup === "so" && analysis.groups.so.members.slice(0, -1).map((id, index) => { const nextId = analysis.groups.so.members[index + 1], a = analysis.current[id], b = analysis.current[nextId]; if (!a || !b) return null; const relation = analysis.groups.so.observedRelations[index] ?? "mixed"; return <g key={`${id}-${nextId}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y}/><text x={(a.x+b.x)/2} y={(a.y+b.y)/2-8} textAnchor="middle" className="v09-id-text">{relation === "same" ? "זהה" : relation === "opposite" ? "הפוך" : "מעורב"}</text></g>; })}
    <g>{Object.entries(analysis.current).map(([rawId, current]) => { const id = Number(rawId), group = memberToGroup.get(id), color = group ? GROUP_COLORS[group] : UNGROUPED; return headingArrow(current.x, current.y, current.headingDeg, color, id, selectedVehicle === id, () => group ? onSelectVehicle(id, group) : undefined); })}</g>
    {overlays.scoreTrace && <g className="v09-score-legend v10-score-colorbar" transform="translate(30 492)"><rect width="270" height="60" rx="15"/><text x="14" y="17">ציון כולל לאורך העקבה</text>{Array.from({length:40},(_,index)=><rect key={index} x={14+index*(236/40)} y="25" width={236/40+1} height="12" fill={scoreColor(index/39*100)}/>)}<text x="14" y="52">0</text><text x="132" y="52" textAnchor="middle">50</text><text x="250" y="52" textAnchor="end">100</text></g>}
    <g transform="translate(720 28)" className="v10-map-group-legend"><circle cx="8" cy="0" r="7" fill={GROUP_COLORS.si}/><text x="20" y="4">SI</text><circle cx="78" cy="0" r="7" fill={GROUP_COLORS.so}/><text x="90" y="4">SO</text><circle cx="150" cy="0" r="7" fill={UNGROUPED}/><text x="162" y="4">לא מקובץ</text></g>
    {!analysis.available && <g transform="translate(500 285)"><rect x="-190" y="-55" width="380" height="110" rx="18" fill="var(--map-card)" stroke="var(--line)"/><text textAnchor="middle" y="-8" className="v09-id-text">אין נתוני ניווט זמינים לניתוח</text><text textAnchor="middle" y="22" className="v09-id-text">לא מוצגים ציונים או מיקומים חלופיים מהסימולטור</text></g>}
  </svg>;
}
