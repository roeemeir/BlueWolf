"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Layers3, Pause, Play, Ruler, Save } from "lucide-react";
import { toast } from "sonner";

import { createId, type Family, type GtSegment } from "@/lib/bluewolf";
import { useWorkspace } from "../app-context";
import { clamp, hippodromeLoop, pointOnClosed, svgClosedPath, type Point } from "../v09/geometry";
import { fixedVehicleTypes } from "../v09/map";
import { getV09Scenario } from "../v09/simulator";
import { GROUP_COLORS } from "./map";

function pointer(svg: SVGSVGElement, event: React.PointerEvent) {
  const rect = svg.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / Math.max(1, rect.width) * 900, y: (event.clientY - rect.top) / Math.max(1, rect.height) * 460 };
}

function bearing(a: Point, b: Point) { return (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI + 360) % 360; }
function distance(a: Point, b: Point) { return Math.hypot(b.x - a.x, b.y - a.y); }

export function V10GT() {
  const { state, save } = useWorkspace();
  const types = fixedVehicleTypes(state.vehicleTypes);
  const [serverId, setServerId] = useState("1");
  const [family, setFamily] = useState<Family>("SO");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(36);
  const [start, setStart] = useState(8);
  const [end, setEnd] = useState(92);
  const [sync, setSync] = useState(82);
  const [routeScore, setRouteScore] = useState(88);
  const [wrong, setWrong] = useState(false);
  const [participants, setParticipants] = useState<number[]>(() => getV09Scenario("1", 108).groups.so.members.map((member) => member.id));
  const [anchors, setAnchors] = useState<Point[]>([{ x: 350, y: 230 }, { x: 450, y: 230 }, { x: 450, y: 175 }, { x: 510, y: 140 }]);
  const [drag, setDrag] = useState<number | null>(null);
  const [rulerMode, setRulerMode] = useState(false);
  const [rulerPoints, setRulerPoints] = useState<Point[]>([]);
  const [mapMode, setMapMode] = useState<"engineering" | "real" | "both">("both");
  const realMaps = state.mapServers.filter((source) => source.kind !== "engineering");
  const [realMapId, setRealMapId] = useState(realMaps[0]?.id ?? "");
  const svgRef = useRef<SVGSVGElement | null>(null);

  const scenario = getV09Scenario(serverId, Math.round(time * 3));
  const groupKey = family.toLowerCase() as "si" | "so";
  const group = scenario.groups[groupKey];
  const groupColor = GROUP_COLORS[groupKey];
  const rawRoutes = scenario.routes.filter((route) => group.members.some((member) => member.routeKey === route.key));
  const currentPositions = group.members.map((member) => { const route = rawRoutes.find((item) => item.key === member.routeKey) ?? scenario.routes[0]; return { member, route, point: pointOnClosed(route.points, member.phase + (time / 100 - .36)) }; });
  const correctedRadius = Math.max(12, Math.hypot(anchors[2].x - anchors[1].x, anchors[2].y - anchors[1].y));
  const correctedLength = Math.max(0, Math.hypot(anchors[1].x - anchors[0].x, anchors[1].y - anchors[0].y) * 2);
  const correctedAngle = Math.atan2(anchors[1].y - anchors[0].y, anchors[1].x - anchors[0].x) * 180 / Math.PI;
  const corrected = hippodromeLoop({ x: anchors[0].x, y: anchors[0].y }, correctedRadius, correctedLength, correctedAngle);
  const selectedRealMap = state.mapServers.find((source) => source.id === realMapId);

  useEffect(() => { if (!playing) return; const timer = window.setInterval(() => setTime((value) => value >= end ? start : value + 1), 90); return () => window.clearInterval(timer); }, [playing, start, end]);

  const resetParticipants = (nextServer: string, nextFamily: Family) => setParticipants(getV09Scenario(nextServer, Math.round(time * 3)).groups[nextFamily.toLowerCase() as "si" | "so"].members.map((member) => member.id));
  const saveGt = async () => {
    const quality = (value: number): GtSegment["quality"] => value >= 80 ? "good" : value < 50 ? "low" : "medium";
    const base = { family, serverId, groupId: group.id, start: "2026-09-05T17:00", end: "2026-09-05T19:00", vehicleCount: participants.length, routeType: wrong ? "manual-corrected" : family === "SI" ? "compact" : "double", label: `${group.id} · clip ${start}%–${end}% · ${mapMode}`, participants, clipStartPct: start, clipEndPct: end, routeCorrected: wrong };
    const additions: GtSegment[] = [{ ...base, id: createId("gt"), layer: "sync", quality: quality(sync), score: sync }, { ...base, id: createId("gt"), layer: "route", quality: quality(routeScore), score: routeScore }];
    await save({ ...state, gtSegments: [...state.gtSegments, ...additions] }, "gt", "approve-v10", group.id);
    toast.success("GT נשמר עם Clip, עריכת נתיב, שכבות מפה ומדידות");
  };

  const mapClick = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!rulerMode || !svgRef.current) return;
    const p = pointer(svgRef.current, event);
    setRulerPoints((current) => current.length >= 2 ? [p] : [...current, p]);
  };

  return <div className="v10-gt"><header className="v09-section-header"><div><p className="eyebrow">GROUND TRUTH · SRS v1.2</p><h2>GT · Playback, Clip, מפות ועריכה הנדסית</h2><p>אותו מודל עריכה כמו בנק הנתיבים, עם זווית חיה וסרגל מדידה.</p></div><button className="primary" onClick={saveGt}><Save />שמור GT</button></header>
    <section className="v09-panel"><div className="v09-gt-source"><label>שרת<select value={serverId} onChange={(event) => { const value = event.target.value; setServerId(value); resetParticipants(value, family); }}>{state.servers.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>משפחה<select value={family} onChange={(event) => { const value = event.target.value as Family; setFamily(value); resetParticipants(serverId, value); }}><option>SI</option><option>SO</option></select></label><label>שכבת מפה<select value={mapMode} onChange={(event) => setMapMode(event.target.value as typeof mapMode)}><option value="engineering">הנדסית</option><option value="real">מפה אמיתית</option><option value="both">משולב</option></select></label>{mapMode !== "engineering" && <label>מקור אמיתי<select value={realMapId} onChange={(event) => setRealMapId(event.target.value)}>{realMaps.length ? realMaps.map((source) => <option key={source.id} value={source.id}>{source.name}{source.enabled ? "" : " (לא פעיל)"}</option>) : <option value="">לא הוגדר מקור</option>}</select></label>}<button className={rulerMode ? "active" : ""} onClick={() => { setRulerMode((value) => !value); setRulerPoints([]); }}><Ruler />סרגל</button></div>
      <div className="v09-gt-grid"><div><div className="v10-map-layer-note"><Layers3 /><span>{mapMode === "engineering" ? "מפת הנדסה" : mapMode === "real" ? selectedRealMap?.name ?? "אין מקור אמיתי" : `הנדסה + ${selectedRealMap?.name ?? "מקור אמיתי"}`}</span></div><svg ref={svgRef} className="v09-gt-map v10-gt-map" viewBox="0 0 900 460" onPointerDown={mapClick} onPointerMove={(event) => { if (drag == null || !svgRef.current) return; const p = pointer(svgRef.current, event); setAnchors((current) => current.map((item, index) => index === drag ? p : item)); }} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
        <defs><pattern id="v10-gt-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" /></pattern><linearGradient id="v10-real-map" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="rgba(74,107,80,.20)" /><stop offset=".5" stopColor="rgba(120,114,78,.16)" /><stop offset="1" stopColor="rgba(64,89,116,.20)" /></linearGradient></defs>
        <rect width="900" height="460" />{mapMode !== "engineering" && <rect width="900" height="460" fill="url(#v10-real-map)" />}{mapMode !== "real" && <rect width="900" height="460" fill="url(#v10-gt-grid)" />}{mapMode !== "engineering" && <g className="v10-real-context"><path d="M0 355Q180 290 355 346T900 300" /><path d="M80 70Q300 145 520 82T850 110" /><text x="22" y="438">{selectedRealMap?.name ?? "Configured real map source"}</text></g>}
        {rawRoutes.map((route) => <g key={route.key}><path d={svgClosedPath(route.points)} fill="none" stroke={groupColor} className="v09-gt-route" />{Array.from({ length: 70 }, (_, dot) => { const phase = dot / 70; const p = pointOnClosed(route.points, phase); const pct = phase * 100; const inside = pct >= start && pct <= end; return <circle key={dot} cx={p.x} cy={p.y} r={inside ? 3.7 : 2.6} fill={groupColor} opacity={inside ? .78 : .13} />; })}</g>)}
        {currentPositions.map(({ member, point }) => <g key={member.id} transform={`translate(${point.x} ${point.y}) rotate(${point.heading})`}><circle r="12" fill="var(--map-card)" stroke={groupColor} strokeWidth="2" /><path d="M0-14 7 9 0 5-7 9Z" fill={groupColor} /><text y="29" textAnchor="middle">{member.id}</text></g>)}
        {wrong && <g className="v09-manual-correction"><path d={svgClosedPath(corrected)} fill="none" stroke="#0a84ff" strokeDasharray="7 5" strokeWidth="4" />{anchors.map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r="9" className="v09-axis-handle" data-kind={["center", "length", "radius", "angle"][index]} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDrag(index); }} /><text x={point.x + 12} y={point.y - 12}>{["מרכז", "אורך", "רדיוס", "זווית"][index]}</text></g>)}<g className="v10-live-angle"><rect x={anchors[1].x + 10} y={anchors[1].y + 8} width="72" height="26" rx="13" /><text x={anchors[1].x + 46} y={anchors[1].y + 26} textAnchor="middle">{correctedAngle.toFixed(1)}°</text></g></g>}
        {rulerPoints.length > 0 && <g className="v10-ruler"><circle cx={rulerPoints[0].x} cy={rulerPoints[0].y} r="6" />{rulerPoints[1] && <><line x1={rulerPoints[0].x} y1={rulerPoints[0].y} x2={rulerPoints[1].x} y2={rulerPoints[1].y} /><circle cx={rulerPoints[1].x} cy={rulerPoints[1].y} r="6" /><rect x={(rulerPoints[0].x + rulerPoints[1].x) / 2 - 70} y={(rulerPoints[0].y + rulerPoints[1].y) / 2 - 30} width="140" height="28" rx="14" /><text x={(rulerPoints[0].x + rulerPoints[1].x) / 2} y={(rulerPoints[0].y + rulerPoints[1].y) / 2 - 11} textAnchor="middle">{distance(rulerPoints[0], rulerPoints[1]).toFixed(1)} m · {bearing(rulerPoints[0], rulerPoints[1]).toFixed(1)}°</text></>}</g>}
      </svg><div className="v09-playback"><button onClick={() => setPlaying((value) => !value)}>{playing ? <Pause /> : <Play />}</button><input type="range" min={start} max={end} value={clamp(time, start, end)} onChange={(event) => setTime(Number(event.target.value))} /><b>{time}%</b></div><div className="v09-clip-controls"><label>Start · {start}%<input type="range" min="0" max={Math.max(0, end - 5)} value={start} onChange={(event) => { const value = Number(event.target.value); setStart(value); setTime((current) => Math.max(current, value)); }} /></label><label>End · {end}%<input type="range" min={Math.min(100, start + 5)} max="100" value={end} onChange={(event) => { const value = Number(event.target.value); setEnd(value); setTime((current) => Math.min(current, value)); }} /></label></div>{rulerMode && <div className="v10-ruler-help">לחץ שתי נקודות על המפה למדידת מרחק וכיוון ביחס לצפון.</div>}</div>
        <aside className="v09-gt-judgement"><h3>משתתפים</h3><div className="v09-participants">{group.members.map((member) => <button key={member.id} className={participants.includes(member.id) ? "active" : ""} onClick={() => setParticipants((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])}>{member.id}</button>)}</div><label>Sync סובייקטיבי · {sync}<input type="range" min="0" max="100" value={sync} onChange={(event) => setSync(Number(event.target.value))} /></label><label>Route סובייקטיבי · {routeScore}<input type="range" min="0" max="100" value={routeScore} onChange={(event) => setRouteScore(Number(event.target.value))} /></label><label className="v09-check"><input type="checkbox" checked={wrong} onChange={(event) => setWrong(event.target.checked)} />Route classified wrong</label>{wrong && <div className="v09-callout"><b>תיקון על המפה</b><p>גרור מרכז, אורך, רדיוס וזווית. המספר ליד ציר האורך מתעדכן בזמן אמת.</p><p>Angle {correctedAngle.toFixed(1)}° · Leg {correctedLength.toFixed(0)} m · Radius {correctedRadius.toFixed(0)} m</p></div>}<button className="primary" onClick={saveGt}><Check />אשר GT</button></aside></div>
    </section><section className="v09-panel"><h3>בנק GT</h3><div className="v09-gt-bank">{state.gtSegments.map((item) => <div key={item.id}><b>{item.groupId}</b><span>{item.layer} · {item.score}</span><small>{item.label}</small></div>)}</div></section>
  </div>;
}
