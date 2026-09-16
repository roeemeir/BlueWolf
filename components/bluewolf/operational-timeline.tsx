"use client";

import { useState } from "react";

import type { EventRecomputeResult } from "@/lib/investigation-contract";
import {
  getLiveRuntimeHistory,
  type LiveRuntimeHistoryGroup,
  type LiveRuntimeHistoryPoint,
} from "@/lib/live-runtime-history";
import {
  filterByDataWindow,
  groupVisible,
  OPERATOR_TIMELINE_WINDOWS,
  scoreLayerDasharray,
  type OperatorTimelineWindowMinutes,
} from "@/lib/operator-timeline";
import { historyWithEventRecompute } from "@/lib/operator-retroactive-result";
import {
  DISPLAY_SMOOTHING_OPTIONS_SECONDS,
  smoothRuntimeHistoryForDisplay,
  type DisplaySmoothingSeconds,
} from "@/lib/display-score-smoothing";
import type { ScoreLayer } from "./visuals";

type GroupMeta = { id: string; color: string; name: string };
type EventSpan = { id: string; groupId: string; color: string; from: number; to: number };

function groupsFor(point: LiveRuntimeHistoryPoint): LiveRuntimeHistoryGroup[] { return point.groups; }

function timeLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function pathFor(history: LiveRuntimeHistoryPoint[], groupId: string, layer: ScoreLayer, x: (index: number) => number, y: (score: number) => number) {
  let path = "";
  let drawing = false;
  history.forEach((point, index) => {
    const group = groupsFor(point).find((item) => item.id === groupId);
    if (!group || !group.scoreValid) { drawing = false; return; }
    const score = group[layer];
    if (!Number.isFinite(score)) { drawing = false; return; }
    path += `${drawing ? "L" : "M"}${x(index).toFixed(2)},${y(score).toFixed(2)} `;
    drawing = true;
  });
  return path.trim();
}

function eventSpans(history: LiveRuntimeHistoryPoint[], metadata: Map<string, GroupMeta>): EventSpan[] {
  const spans = new Map<string, EventSpan>();
  history.forEach((point, index) => {
    for (const group of groupsFor(point)) {
      if (!group.event?.active) continue;
      const key = `${group.id}:${group.event.id}`;
      const current = spans.get(key);
      if (current) current.to = index;
      else spans.set(key, { id: group.event.id, groupId: group.id, color: metadata.get(group.id)?.color ?? group.color, from: index, to: index });
    }
  });
  return [...spans.values()];
}

export function OperationalTimeline({
  serverId,
  selectedGroupId,
  layers,
  cursor,
  onCursor,
  selectedVehicle,
  recomputeOverride,
}: {
  serverId: string;
  selectedGroupId: string;
  layers: ScoreLayer[];
  cursor: number;
  onCursor: (value: number) => void;
  selectedVehicle?: number | null;
  recomputeOverride?: EventRecomputeResult | null;
}) {
  const [windowMinutes, setWindowMinutes] = useState<OperatorTimelineWindowMinutes>(30);
  const [smoothingSeconds, setSmoothingSeconds] = useState<DisplaySmoothingSeconds>(10);
  const [explicitGroupIds, setExplicitGroupIds] = useState<string[]>([]);
  const originalHistory = getLiveRuntimeHistory(serverId);
  const recomputeGroup = recomputeOverride
    ? originalHistory.flatMap((point) => point.groups).find((group) => group.id === recomputeOverride.groupId)
    : undefined;
  const rawHistory = recomputeOverride && recomputeGroup
    ? historyWithEventRecompute(originalHistory, recomputeOverride, recomputeGroup)
    : originalHistory;
  const displayHistory = smoothRuntimeHistoryForDisplay(rawHistory, smoothingSeconds);
  const history = filterByDataWindow(displayHistory, windowMinutes);
  const metadata = new Map<string, GroupMeta>();
  for (const point of history) for (const group of groupsFor(point)) {
    if (!metadata.has(group.id)) metadata.set(group.id, { id: group.id, color: group.color, name: group.name });
  }
  const groups = [...metadata.values()];
  const visibleGroups = groups.filter((group) => groupVisible(group.id, explicitGroupIds));
  const left = 52; const right = 962; const top = 20; const bottom = 205; const count = history.length;
  const safeCursor = count === 0 ? 0 : Math.max(0, Math.min(count - 1, cursor));
  const x = (index: number) => count <= 1 ? (left + right) / 2 : left + index / (count - 1) * (right - left);
  const y = (score: number) => bottom - Math.max(0, Math.min(100, score)) / 100 * (bottom - top);
  const events = eventSpans(history, metadata).filter((span) => groupVisible(span.groupId, explicitGroupIds));
  const toggleGroup = (groupId: string) => setExplicitGroupIds((current) => {
    if (current.length === 0) return [groupId];
    const next = current.includes(groupId) ? current.filter((item) => item !== groupId) : [...current, groupId];
    return next.length === groups.length ? [] : next;
  });

  return <div className="operational-timeline-shell" dir="rtl" data-requirements="OP-04 OP-05 BW-SYNC-013">
    <div className="v04-timeline-controls" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
      <div className="segmented-control" aria-label="חלון זמן לפי נתוני Core">
        {OPERATOR_TIMELINE_WINDOWS.map((minutes) => <button type="button" key={minutes} className={windowMinutes === minutes ? "active" : ""} onClick={() => setWindowMinutes(minutes)}>{minutes} דק׳</button>)}
      </div>
      <div className="segmented-control" aria-label="החלקת תצוגה בלבד">
        {DISPLAY_SMOOTHING_OPTIONS_SECONDS.map((seconds) => <button type="button" key={seconds} className={smoothingSeconds === seconds ? "active" : ""} onClick={() => setSmoothingSeconds(seconds)}>{seconds === 0 ? "RAW" : `${seconds}ש׳`}</button>)}
      </div>
      <div className="segmented-control" aria-label="סינון קבוצות מפורש">
        <button type="button" className={explicitGroupIds.length === 0 ? "active" : ""} onClick={() => setExplicitGroupIds([])}>כל הקבוצות</button>
        {groups.map((group) => <button type="button" key={group.id} className={explicitGroupIds.includes(group.id) ? "active" : ""} onClick={() => toggleGroup(group.id)} style={{ borderColor: group.color }}>{group.name}</button>)}
      </div>
    </div>
    {recomputeOverride && <div className="card-hint" data-op04-version>אירוע {recomputeOverride.eventId} מוצג מ־run {recomputeOverride.runId.slice(0, 12)} · code {recomputeOverride.codeVersion.slice(0, 12)} · config {recomputeOverride.configVersion.slice(0, 12)}</div>}
    <svg className="timeline-svg v04-timeline operational-timeline" viewBox="0 0 1000 260" role="img" aria-label={`היסטוריית ציוני Python Core · ${windowMinutes} דקות לפי זמן הנתונים · smoothing ${smoothingSeconds}s display only`} onClick={(event) => {
      if (count === 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const relative = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      onCursor(Math.round(relative * (count - 1)));
    }}>
      {[0, 25, 50, 75, 100].map((score) => <g key={score}><line x1={left} x2={right} y1={y(score)} y2={y(score)} className="chart-grid" /><text x="42" y={y(score) + 4} textAnchor="end" className="chart-label">{score}</text></g>)}
      {count === 0 && <text x="500" y="120" textAnchor="middle" className="chart-label">אין history מבצעי בחלון שנבחר</text>}
      {visibleGroups.flatMap((group) => layers.map((layer) => {
        const path = pathFor(history, group.id, layer, x, y);
        if (!path) return null;
        const selected = group.id === selectedGroupId;
        return <path key={`${group.id}-${layer}`} d={path} fill="none" stroke={group.color} strokeWidth={selected && layer === "sync" ? 3.5 : 2} strokeDasharray={scoreLayerDasharray(layer)} opacity={selected ? .95 : .42} />;
      }))}
      {selectedVehicle && <text x="958" y="18" textAnchor="end" className="chart-label">רכב {selectedVehicle}</text>}
      {count > 0 && <line x1={x(safeCursor)} x2={x(safeCursor)} y1={top} y2={bottom} className="cursor-line" />}
      <g className="v04-event-bands">{events.map((span) => <g key={`${span.groupId}:${span.id}`}><rect x={x(span.from)} y="218" width={Math.max(8, x(span.to) - x(span.from) + 6)} height="14" rx="7" fill={span.color} opacity=".35" /><text x={x(span.from) + 5} y="248">{span.id}</text></g>)}</g>
      {count > 0 && <><text x={left} y="254" className="chart-label">{timeLabel(history[0].observedAt)}</text><text x={right} y="254" textAnchor="end" className="chart-label">{timeLabel(history[count - 1].observedAt)}</text></>}
    </svg>
    <div className="card-hint" style={{ marginTop: 4 }}>חלון הזמן נמדד יחסית ל־timestamp האחרון בנתונים, לא לשעון המחשב. החלקה היא לתצוגה בלבד ({smoothingSeconds === 0 ? "RAW" : `${smoothingSeconds} שנ׳`}); ציוני Core, התראות ואירועים נשארים raw. כולל — רציף · סנכרון — מקווקו · נתיב — נקודות.</div>
  </div>;
}