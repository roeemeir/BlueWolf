"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { toast } from "sonner";

import { DEFAULT_WORKSPACE, type WorkspaceState } from "@/lib/bluewolf";

type StorageMode = "cloud" | "local";

type WorkspaceContextValue = {
  state: WorkspaceState;
  setState: Dispatch<SetStateAction<WorkspaceState>>;
  save: (next: WorkspaceState, category: string, action: string, detail?: string) => Promise<boolean>;
  ready: boolean;
  loadProgress: number;
  storageMode: StorageMode;
  revision: number;
  lastSavedAt: string | null;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function hydrateState(value: Partial<WorkspaceState> | null | undefined): WorkspaceState {
  if (!value) return structuredClone(DEFAULT_WORKSPACE);
  return {
    ...structuredClone(DEFAULT_WORKSPACE),
    ...value,
    weights: {
      sync: { ...DEFAULT_WORKSPACE.weights.sync, ...value.weights?.sync },
      route: { ...DEFAULT_WORKSPACE.weights.route, ...value.weights?.route },
      total: { ...DEFAULT_WORKSPACE.weights.total, ...value.weights?.total },
    },
    thresholds: { ...DEFAULT_WORKSPACE.thresholds, ...value.thresholds },
    influx: { ...DEFAULT_WORKSPACE.influx, ...value.influx, mappings: { ...DEFAULT_WORKSPACE.influx.mappings, ...value.influx?.mappings } },
    settings: { ...DEFAULT_WORKSPACE.settings, ...value.settings },
  };
}

function getWorkspaceId() {
  const key = "bluewolf-workspace-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = `bw-${crypto.randomUUID()}`;
  window.localStorage.setItem(key, created);
  return created;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(() => structuredClone(DEFAULT_WORKSPACE));
  const [ready, setReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(8);
  const [storageMode, setStorageMode] = useState<StorageMode>("local");
  const [revision, setRevision] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");

  useEffect(() => {
    let cancelled = false;
    const progressTimer = window.setInterval(() => setLoadProgress((value) => Math.min(value + 7, 88)), 90);

    async function load() {
      const id = getWorkspaceId();
      setWorkspaceId(id);
      const fallback = window.localStorage.getItem("bluewolf-workspace-state");
      try {
        const response = await fetch("/api/workspace", { headers: { "x-bluewolf-workspace": id } });
        if (!response.ok) throw new Error("cloud unavailable");
        const payload = await response.json() as { state?: Partial<WorkspaceState> | null; revision?: number; updatedAt?: string | null };
        if (cancelled) return;
        const next = hydrateState(payload.state ?? (fallback ? JSON.parse(fallback) : null));
        setState(next);
        setRevision(payload.revision ?? 0);
        setLastSavedAt(payload.updatedAt ?? null);
        setStorageMode("cloud");
      } catch {
        if (cancelled) return;
        if (fallback) {
          try { setState(hydrateState(JSON.parse(fallback))); } catch { setState(hydrateState(null)); }
        }
        setStorageMode("local");
      } finally {
        window.clearInterval(progressTimer);
        if (!cancelled) {
          setLoadProgress(100);
          window.setTimeout(() => setReady(true), 480);
        }
      }
    }
    load();
    return () => { cancelled = true; window.clearInterval(progressTimer); };
  }, []);

  const save = useCallback(async (next: WorkspaceState, category: string, action: string, detail = "") => {
    setState(next);
    window.localStorage.setItem("bluewolf-workspace-state", JSON.stringify(next));
    if (!workspaceId) return false;
    const saveToast = toast.loading("שומר את הקונפיגורציה…");
    try {
      const response = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-bluewolf-workspace": workspaceId },
        body: JSON.stringify({ state: next, category, action, detail }),
      });
      if (!response.ok) throw new Error("save failed");
      const payload = await response.json() as { revision?: number };
      setRevision(payload.revision ?? revision + 1);
      setLastSavedAt(new Date().toISOString());
      setStorageMode("cloud");
      toast.success("נשמר והפך לפעיל", { id: saveToast });
      return true;
    } catch {
      setStorageMode("local");
      toast.warning("נשמר במכשיר; האחסון המרכזי אינו זמין כרגע", { id: saveToast });
      return false;
    }
  }, [revision, workspaceId]);

  const value = useMemo(() => ({ state, setState, save, ready, loadProgress, storageMode, revision, lastSavedAt }), [state, save, ready, loadProgress, storageMode, revision, lastSavedAt]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}
