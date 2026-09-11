"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { toast } from "sonner";

import { DEFAULT_INFLUX_MAPPINGS, DEFAULT_WORKSPACE, type InfluxFieldMapping, type WorkspaceState } from "@/lib/bluewolf";

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
  const incomingMappings = value.influx?.mappings;
  const mappings: InfluxFieldMapping[] = Array.isArray(incomingMappings)
    ? DEFAULT_INFLUX_MAPPINGS.map((fallback) => ({ ...fallback, ...(incomingMappings.find((item) => item.systemKey === fallback.systemKey) ?? {}) }))
    : DEFAULT_INFLUX_MAPPINGS;
  return {
    ...structuredClone(DEFAULT_WORKSPACE),
    ...value,
    weights: {
      sync: { ...DEFAULT_WORKSPACE.weights.sync, ...value.weights?.sync },
      route: { ...DEFAULT_WORKSPACE.weights.route, ...value.weights?.route },
      total: { ...DEFAULT_WORKSPACE.weights.total, ...value.weights?.total },
    },
    thresholds: { ...DEFAULT_WORKSPACE.thresholds, ...value.thresholds },
    influx: { ...DEFAULT_WORKSPACE.influx, ...value.influx, stream: { ...DEFAULT_WORKSPACE.influx.stream, ...value.influx?.stream }, mappings },
    mapServers: value.mapServers?.length ? value.mapServers : structuredClone(DEFAULT_WORKSPACE.mapServers),
    activeTemplateOverrides: { ...DEFAULT_WORKSPACE.activeTemplateOverrides, ...value.activeTemplateOverrides },
    templateApplications: { ...DEFAULT_WORKSPACE.templateApplications, ...value.templateApplications },
    servers: value.servers?.map((server, index) => ({ ...DEFAULT_WORKSPACE.servers[index % DEFAULT_WORKSPACE.servers.length], ...server })) ?? structuredClone(DEFAULT_WORKSPACE.servers),
    arenas: value.arenas?.length ? value.arenas : structuredClone(DEFAULT_WORKSPACE.arenas),
    vehicleTypes: value.vehicleTypes?.map((type, index) => ({ ...DEFAULT_WORKSPACE.vehicleTypes[index % DEFAULT_WORKSPACE.vehicleTypes.length], ...type })) ?? structuredClone(DEFAULT_WORKSPACE.vehicleTypes),
    routes: value.routes?.map((route, index) => ({ ...DEFAULT_WORKSPACE.routes[index % DEFAULT_WORKSPACE.routes.length], ...route })) ?? structuredClone(DEFAULT_WORKSPACE.routes),
    templates: value.templates?.map((template) => ({ ...template })) ?? structuredClone(DEFAULT_WORKSPACE.templates),
    gtSegments: value.gtSegments?.map((segment, index) => ({ ...DEFAULT_WORKSPACE.gtSegments[index % DEFAULT_WORKSPACE.gtSegments.length], ...segment })) ?? structuredClone(DEFAULT_WORKSPACE.gtSegments),
    settings: { ...DEFAULT_WORKSPACE.settings, ...value.settings },
    investigationEdits: { ...DEFAULT_WORKSPACE.investigationEdits, ...value.investigationEdits },
  };
}

function getWorkspaceId() {
  const key = "bluewolf-workspace-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const created = `bw-${Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("")}`;
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
          window.setTimeout(() => setReady(true), 320);
        }
      }
    }
    load();
    return () => { cancelled = true; window.clearInterval(progressTimer); };
  }, []);

  const save = useCallback(async (next: WorkspaceState, category: string, action: string, detail = "") => {
    if (!workspaceId) return false;
    const saveToast = toast.loading("שומר את הקונפיגורציה…");
    try {
      const response = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-bluewolf-workspace": workspaceId },
        body: JSON.stringify({ state: next, category, action, detail, expectedRevision: revision }),
      });
      if (response.status === 409) { toast.error("הפריט השתנה במקביל. רענן לפני שמירה נוספת; השינויים לא הופעלו.", { id: saveToast }); return false; }
      if (!response.ok) throw new Error("save failed");
      const payload = await response.json() as { revision?: number };
      setState(next);
      window.localStorage.setItem("bluewolf-workspace-state", JSON.stringify({ ...next, influx: { ...next.influx, token: "" } }));
      setRevision(payload.revision ?? revision + 1);
      setLastSavedAt(new Date().toISOString());
      setStorageMode("cloud");
      toast.success("נשמר והפך לפעיל", { id: saveToast });
      return true;
    } catch {
      setStorageMode("local");
      toast.error("השמירה נכשלה. השינוי לא הופעל; נסה שוב כשהשרת זמין", { id: saveToast });
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