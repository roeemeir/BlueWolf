export type OperatorSharedWindowMinutes = 30 | 60 | 90;

export const OPERATOR_SHARED_WINDOWS: readonly OperatorSharedWindowMinutes[] = [30, 60, 90];

// Explicitly client-side, per-server UI state. Never changes persisted Core
// evidence, source timestamps, backend retention or the shared historical cursor.
const selectedByServer = new Map<string, OperatorSharedWindowMinutes>();
const listenersByServer = new Map<string, Set<(minutes: OperatorSharedWindowMinutes) => void>>();

export function operatorWindowForServer(serverId: string): OperatorSharedWindowMinutes {
  return selectedByServer.get(serverId) ?? 30;
}

export function setOperatorWindowForServer(serverId: string, minutes: OperatorSharedWindowMinutes) {
  if (!OPERATOR_SHARED_WINDOWS.includes(minutes)) throw new Error("operator time window must be 30, 60 or 90 minutes");
  if (selectedByServer.get(serverId) === minutes) return;
  selectedByServer.set(serverId, minutes);
  for (const notify of listenersByServer.get(serverId) ?? []) notify(minutes);
}

export function subscribeOperatorWindow(serverId: string, notify: (minutes: OperatorSharedWindowMinutes) => void): () => void {
  const listeners = listenersByServer.get(serverId) ?? new Set<(minutes: OperatorSharedWindowMinutes) => void>();
  listenersByServer.set(serverId, listeners);
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
    if (listeners.size === 0) listenersByServer.delete(serverId);
  };
}

export function resetOperatorWindow(serverId?: string) {
  if (serverId) {
    selectedByServer.delete(serverId);
    for (const notify of listenersByServer.get(serverId) ?? []) notify(30);
  } else {
    for (const id of selectedByServer.keys()) resetOperatorWindow(id);
  }
}
