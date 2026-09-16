export type OperatorTimelineWindowMinutes = 30 | 60 | 90;

export const OPERATOR_TIMELINE_WINDOWS: readonly OperatorTimelineWindowMinutes[] = [30, 60, 90];

export function filterByDataWindow<T extends { observedAt: string }>(
  rows: readonly T[],
  minutes: OperatorTimelineWindowMinutes,
): T[] {
  const timed = rows.map((row) => ({ row, timeMs: Date.parse(row.observedAt) }))
    .filter((item) => Number.isFinite(item.timeMs));
  if (!timed.length) return [];
  const latest = Math.max(...timed.map((item) => item.timeMs));
  const threshold = latest - minutes * 60_000;
  return timed.filter((item) => item.timeMs >= threshold && item.timeMs <= latest).map((item) => item.row);
}

export function scoreLayerDasharray(layer: "total" | "sync" | "route") {
  if (layer === "sync") return "8 5";
  if (layer === "route") return "2 5";
  return undefined;
}

export function groupVisible(groupId: string, explicitGroupIds: readonly string[]) {
  return explicitGroupIds.length === 0 || explicitGroupIds.includes(groupId);
}
