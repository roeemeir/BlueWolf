import type { LiveRuntimeGroup, LiveRuntimeSnapshot } from "./live-runtime";

export type LiveNotification = {
  key: string;
  serverId: string;
  groupId: string;
  alertId: string;
  title: string;
  detail: string;
  severity: "warning" | "critical";
  activeSince: string | null;
  sourceLabel: "SIM" | "CORE";
};

/**
 * One current snapshot is the only notification source. In particular, a
 * disconnected or stale Core must never display previously cached/simulated
 * alerts as if they were live. The status indicator handles disconnection.
 */
export function currentRuntimeNotifications(snapshot: LiveRuntimeSnapshot | null | undefined): LiveNotification[] {
  if (!snapshot || snapshot.source.health !== "healthy") return [];
  if (snapshot.source.kind !== "simulation" && snapshot.source.kind !== "python-core") return [];
  const groups: LiveRuntimeGroup[] = snapshot.groupList ?? Object.values(snapshot.groups)
    .filter((group): group is LiveRuntimeGroup => group !== undefined);
  const notifications: LiveNotification[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const alert = group.alert;
    if (!alert || !alert.id || !alert.title || !alert.detail) continue;
    const key = `${snapshot.serverId}:${group.id}:${alert.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notifications.push({
      key,
      serverId: snapshot.serverId,
      groupId: group.id,
      alertId: alert.id,
      title: alert.title,
      detail: alert.detail,
      severity: alert.severity,
      activeSince: alert.activeSince ?? null,
      sourceLabel: snapshot.source.kind === "simulation" ? "SIM" : "CORE",
    });
  }
  return notifications.sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical") || a.key.localeCompare(b.key));
}
