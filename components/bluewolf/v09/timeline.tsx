"use client";

import { v09ScoreSeries } from "./simulator";
import { GROUP_COLORS, type V09GroupKey } from "./map";

export type TimelineLayer = "total" | "sync" | "route";

const STYLE: Record<TimelineLayer, { width: number; dash?: string; label: string }> = {
  total: { width: 4.2, label: "כולל" },
  sync: { width: 2.5, dash: "10 6", label: "סנכרון" },
  route: { width: 2.3, dash: "2 7", label: "נתיב" },
};

function formatClock(minuteAgo: number) {
  const end = 19 * 60;
  const value = end - minuteAgo;
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function V09Timeline({ serverId, windowMinutes, layers, cursor, onCursor }: { serverId: string; windowMinutes: 30 | 60 | 90 | 120; layers: TimelineLayer[]; cursor: number; onCursor: (value: number) => void }) {
  const full = v09ScoreSeries(serverId, 120);
  const visible = full.slice(full.length - (windowMinutes + 1));
  const left = 56; const right = 1040; const top = 24; const bottom = 246;
  const x = (index: number) => left + index / Math.max(1, visible.length - 1) * (right - left);
  const y = (score: number) => bottom - score / 100 * (bottom - top);
  const safeCursor = Math.max(0, Math.min(visible.length - 1, cursor));
  const path = (group: V09GroupKey, layer: TimelineLayer) => visible.map((item, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(item[group][layer]).toFixed(1)}`).join(" ");
  const tickCount = windowMinutes === 30 ? 3 : windowMinutes === 60 ? 4 : 6;
  const timeTicks = Array.from({ length: tickCount + 1 }, (_, index) => Math.round(index * windowMinutes / tickCount));

  return <div className="v09-timeline-wrap">
    <svg className="v09-timeline" viewBox="0 0 1100 330" role="img" aria-label={`ציונים ב-${windowMinutes} הדקות האחרונות`} onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
      onCursor(Math.round(ratio * (visible.length - 1)));
    }}>
      {[0, 25, 50, 75, 100].map((score) => <g key={score}><line x1={left} x2={right} y1={y(score)} y2={y(score)} className="v09-chart-grid" /><text x="44" y={y(score) + 4} textAnchor="end" className="v09-chart-label">{score}</text></g>)}
      {(["si", "so"] as V09GroupKey[]).flatMap((group) => layers.map((layer) => <path key={`${group}-${layer}`} d={path(group, layer)} fill="none" stroke={GROUP_COLORS[group]} strokeWidth={STYLE[layer].width} strokeDasharray={STYLE[layer].dash} strokeLinecap="round" strokeLinejoin="round" />))}
      <line x1={x(safeCursor)} x2={x(safeCursor)} y1={top} y2={bottom} className="v09-cursor-line" />
      {timeTicks.map((ago) => { const index = visible.length - 1 - Math.round(ago / windowMinutes * (visible.length - 1)); return <g key={ago}><line x1={x(index)} x2={x(index)} y1={bottom} y2={bottom + 5} className="v09-chart-tick" /><text x={x(index)} y="270" textAnchor="middle" className="v09-chart-label">{formatClock(ago)}</text></g>; })}
      <g transform="translate(62 296)" className="v09-group-legend"><circle cx="7" cy="0" r="6" fill={GROUP_COLORS.si} /><text x="20" y="4">קבוצת SI</text><circle cx="115" cy="0" r="6" fill={GROUP_COLORS.so} /><text x="128" y="4">קבוצת SO</text></g>
      <g transform="translate(390 296)" className="v09-style-legend">{layers.map((layer, index) => <g key={layer} transform={`translate(${index * 170} 0)`}><line x1="0" x2="34" y1="0" y2="0" stroke="currentColor" strokeWidth={STYLE[layer].width} strokeDasharray={STYLE[layer].dash} /><text x="44" y="4">{STYLE[layer].label}</text></g>)}</g>
    </svg>
    <div className="v09-timeline-caption"><span>חלון מוצג בפועל: {windowMinutes} דקות</span><span>שתי הקבוצות מוצגות בו־זמנית</span></div>
  </div>;
}
