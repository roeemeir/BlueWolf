"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { scoreSeriesForServer } from "@/lib/bluewolf";
import { operatorWindowForServer, subscribeOperatorWindow } from "@/lib/operator-shared-window";
import { groupVisible, scoreLayerDasharray } from "@/lib/operator-timeline";
import { ScoreLegend } from "./score-legend";
import { groupLineColor, type GroupKey, type ScoreLayer } from "./visuals";

const GROUPS: { id: GroupKey; name: string }[] = [
  { id: "si", name: "SI" },
  { id: "so", name: "SO" },
];

export function SimulationTimeline({
  serverId,
  selected,
  layers,
  cursor,
  onCursor,
  selectedVehicle,
}: {
  serverId: string;
  selected: GroupKey;
  layers: ScoreLayer[];
  cursor: number;
  onCursor: (value: number) => void;
  selectedVehicle?: number | null;
}) {
  const subscribeWindow = useCallback((notify: () => void) => subscribeOperatorWindow(serverId, notify), [serverId]);
  const windowMinutes = useSyncExternalStore(subscribeWindow, () => operatorWindowForServer(serverId), () => 30);
  const [explicitGroups, setExplicitGroups] = useState<GroupKey[]>([]);
  // Simulation score samples are one data-minute apart by contract. The slice is
  // therefore anchored to the newest simulation sample, never to wall-clock time.
  const fullSeries = scoreSeriesForServer(serverId, 90);
  const series = fullSeries.slice(-windowMinutes);
  const visibleGroups = GROUPS.filter((group) => groupVisible(group.id, explicitGroups));
  const left = 52;
  const right = 962;
  const top = 20;
  const bottom = 205;
  const count = series.length;
  const safe = count === 0 ? 0 : Math.max(0, Math.min(count - 1, cursor));
  const x = (index: number) => count <= 1 ? (left + right) / 2 : left + index / (count - 1) * (right - left);
  const y = (score: number) => bottom - Math.max(0, Math.min(100, score)) / 100 * (bottom - top);
  const pointsFor = (group: GroupKey, layer: ScoreLayer) => series.map((item, index) => `${x(index)},${y(item[group][layer])}`).join(" ");
  const toggleGroup = (group: GroupKey) => setExplicitGroups((current) => {
    if (current.length === 0) return [group];
    const next = current.includes(group) ? current.filter((item) => item !== group) : [...current, group];
    return next.length === GROUPS.length ? [] : next;
  });

  return <div className="simulation-timeline-shell" dir="rtl" data-requirements="OP-05 BW-UI-013">
    <div className="v04-timeline-controls" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
      <span className="card-hint" data-sim-shared-window>חלון משותף למפה ולגרף: {windowMinutes} דקות</span>
      <div className="segmented-control" aria-label="סינון קבוצות סימולציה">
        <button type="button" className={explicitGroups.length === 0 ? "active" : ""} onClick={() => setExplicitGroups([])}>כל הקבוצות</button>
        {GROUPS.map((group) => <button type="button" key={group.id} className={explicitGroups.includes(group.id) ? "active" : ""} onClick={() => toggleGroup(group.id)} style={{ borderColor: groupLineColor[group.id] }}>{group.name}</button>)}
      </div>
    </div>
    <ScoreLegend layers={layers} />
    <svg className="timeline-svg v04-timeline" viewBox="0 0 1000 260" role="img" aria-label={`גרף סימולציה · ${windowMinutes} דקות לפי זמן הנתונים`} onClick={(event) => {
      if (!count) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const relative = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      onCursor(Math.round(relative * (count - 1)));
    }}>
      {[0, 25, 50, 75, 100].map((score) => <g key={score}><line x1={left} x2={right} y1={y(score)} y2={y(score)} className="chart-grid" /><text x="42" y={y(score) + 4} textAnchor="end" className="chart-label">{score}</text></g>)}
      {visibleGroups.flatMap((group) => layers.map((layer) => <polyline key={`${group.id}-${layer}`} points={pointsFor(group.id, layer)} fill="none" stroke={groupLineColor[group.id]} strokeWidth={group.id === selected && layer === "sync" ? 3.5 : 2} strokeDasharray={scoreLayerDasharray(layer)} opacity={group.id === selected ? .95 : .48} />))}
      {selectedVehicle && <text x="958" y="18" textAnchor="end" className="chart-label">רכב {selectedVehicle}</text>}
      {count > 0 && <line x1={x(safe)} x2={x(safe)} y1={top} y2={bottom} className="cursor-line" />}
      <text x={left} y="254" className="chart-label">−{windowMinutes} דק׳</text>
      <text x={right} y="254" textAnchor="end" className="chart-label">עכשיו בנתוני SIM</text>
    </svg>
    <div className="card-hint" style={{ marginTop: 4 }}>בחירת קבוצה במפה משנה הדגשה בלבד; המקרא מציג רק שכבות פעילות ואינו משמש מסנן.</div>
  </div>;
}
