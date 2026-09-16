"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyRound, Map, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkspaceState } from "@/lib/bluewolf";
import { normalizeMapSources, type MapSourceKind, type MapTokenMode, type OperationalMapSource } from "@/lib/map-source-config";
import { useWorkspace } from "./app-context";

function nextId(existing: readonly OperationalMapSource[]) {
  let index = 1;
  while (existing.some((item) => item.id === `map-${index}`)) index += 1;
  return `map-${index}`;
}

function toWorkspaceSources(sources: OperationalMapSource[]) {
  return sources.map((source) => ({ ...source, urlTemplate: source.baseUrl })) as unknown as WorkspaceState["mapServers"];
}

export function MapSourceGovernanceWorkbench() {
  const { state, save } = useWorkspace();
  const sources = useMemo(() => normalizeMapSources(state.mapServers), [state.mapServers]);
  const [selectedId, setSelectedId] = useState(() => sources.find((source) => source.isDefault)?.id ?? sources[0]?.id ?? "");
  const selected = sources.find((source) => source.id === selectedId) ?? sources[0];
  const [draft, setDraft] = useState<OperationalMapSource | null>(selected ?? null);
  const [token, setToken] = useState("");
  const [tokenConfigured, setTokenConfigured] = useState<boolean | null>(null);

  useEffect(() => { setDraft(selected ?? null); setToken(""); }, [selected?.id]);
  useEffect(() => {
    let cancelled = false;
    async function loadStatus() {
      if (!selected || selected.tokenMode === "none") { setTokenConfigured(selected ? true : null); return; }
      try {
        const response = await fetch(`/api/map-sources/token?sourceId=${encodeURIComponent(selected.id)}`, { cache: "no-store" });
        const payload = await response.json() as { configured?: boolean };
        if (!cancelled) setTokenConfigured(response.ok ? payload.configured === true : null);
      } catch { if (!cancelled) setTokenConfigured(null); }
    }
    void loadStatus();
    return () => { cancelled = true; };
  }, [selected?.id, selected?.tokenMode]);

  const patch = <K extends keyof OperationalMapSource>(key: K, value: OperationalMapSource[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);

  const addSource = (kind: MapSourceKind) => {
    const id = nextId(sources);
    const created: OperationalMapSource = {
      id, name: kind.toUpperCase(), kind, baseUrl: "https://maps.internal/", attribution: "", enabled: true, isDefault: sources.length === 0,
      layer: kind === "xyz" ? undefined : "layer", style: "", format: "image/png", version: kind === "wms" ? "1.3.0" : kind === "wmts" ? "1.0.0" : undefined,
      crs: kind === "wms" ? "CRS:84" : undefined, tileMatrixSet: kind === "wmts" ? "WebMercatorQuad" : undefined, tokenMode: "none",
    };
    setSelectedId(id);
    setDraft(created);
  };

  const saveDraft = async () => {
    if (!draft) return;
    try {
      const normalized = normalizeMapSources([...sources.filter((source) => source.id !== draft.id), draft]);
      const withDefault = normalized.map((source) => draft.isDefault ? { ...source, isDefault: source.id === draft.id } : source);
      const defaultMap = withDefault.find((source) => source.isDefault && source.enabled)?.id ?? state.settings.defaultMap;
      const next = { ...state, mapServers: toWorkspaceSources(withDefault), settings: { ...state.settings, defaultMap } };
      if (await save(next, "map-source", "save-map-source", `saved ${draft.id} (${draft.kind})`)) toast.success("מקור המפה נשמר. token נשמר בנפרד בצד השרת.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "שמירת מקור המפה נכשלה"); }
  };

  const saveToken = async () => {
    if (!draft || draft.tokenMode === "none") return;
    const response = await fetch("/api/map-sources/token", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: draft.id, token }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { toast.error(payload.error ?? "שמירת token נכשלה"); return; }
    setToken(""); setTokenConfigured(true); toast.success("ה־token נשמר ב־SQLite הסודי ואינו חלק מה־Workspace.");
  };

  const removeToken = async () => {
    if (!draft) return;
    const response = await fetch(`/api/map-sources/token?sourceId=${encodeURIComponent(draft.id)}`, { method: "DELETE" });
    if (!response.ok) { toast.error("מחיקת token נכשלה"); return; }
    setToken(""); setTokenConfigured(false); toast.success("ה־token נמחק.");
  };

  return <section className="glass-panel" dir="rtl" data-requirements="BW-OFF-010 BW-OFF-012" style={{ padding: 16, marginBottom: 16 }}>
    <div className="section-toolbar"><div><p className="eyebrow">Offline GIS</p><h3>מקורות מפה פרטיים · XYZ / WMS / WMTS</h3><p className="card-hint">ה־token לעולם אינו נשמר ב־Workspace ואינו נשלח לדפדפן בעת טעינת מפה; ה־proxy המקומי מזריק אותו רק לבקשת upstream.</p></div><div className="toolbar-actions"><Button variant="outline" size="sm" onClick={() => addSource("wms")}><Plus />WMS</Button><Button variant="outline" size="sm" onClick={() => addSource("wmts")}><Plus />WMTS</Button></div></div>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,.7fr) minmax(0,2fr)", gap: 14, marginTop: 12 }}>
      <div style={{ display: "grid", gap: 7, alignContent: "start" }}>{sources.map((source) => <button type="button" key={source.id} onClick={() => setSelectedId(source.id)} className={selectedId === source.id ? "active" : ""} style={{ textAlign: "right", padding: 10, borderRadius: 10 }}><strong>{source.name}</strong><div className="card-hint">{source.kind.toUpperCase()} · {source.id}</div></button>)}</div>
      {draft ? <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><Label>שם</Label><Input value={draft.name} onChange={(event) => patch("name", event.target.value)} /></div><div><Label>סוג</Label><Select value={draft.kind} onValueChange={(value) => patch("kind", value as MapSourceKind)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="xyz">XYZ</SelectItem><SelectItem value="wms">WMS</SelectItem><SelectItem value="wmts">WMTS</SelectItem></SelectContent></Select></div></div>
        <div><Label>URL פנימי / פרטי</Label><Input value={draft.baseUrl} onChange={(event) => patch("baseUrl", event.target.value)} dir="ltr" /></div>
        {draft.kind !== "xyz" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><Label>Layer</Label><Input value={draft.layer ?? ""} onChange={(event) => patch("layer", event.target.value)} /></div><div><Label>Format</Label><Input value={draft.format ?? "image/png"} onChange={(event) => patch("format", event.target.value)} dir="ltr" /></div></div>}
        {draft.kind === "wms" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><Label>CRS</Label><Input value={draft.crs ?? "CRS:84"} onChange={(event) => patch("crs", event.target.value)} dir="ltr" /></div><div><Label>Version</Label><Input value={draft.version ?? "1.3.0"} onChange={(event) => patch("version", event.target.value)} dir="ltr" /></div></div>}
        {draft.kind === "wmts" && <div><Label>Tile Matrix Set</Label><Input value={draft.tileMatrixSet ?? ""} onChange={(event) => patch("tileMatrixSet", event.target.value)} dir="ltr" /></div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><Label>Token mode</Label><Select value={draft.tokenMode} onValueChange={(value) => patch("tokenMode", value as MapTokenMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">ללא token</SelectItem><SelectItem value="bearer">Bearer header</SelectItem><SelectItem value="query">Query parameter</SelectItem></SelectContent></Select></div>{draft.tokenMode === "query" && <div><Label>Query parameter</Label><Input value={draft.tokenQueryParam ?? "token"} onChange={(event) => patch("tokenQueryParam", event.target.value)} dir="ltr" /></div>}</div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={draft.enabled} onChange={(event) => patch("enabled", event.target.checked)} />פעיל</label><label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={draft.isDefault} onChange={(event) => patch("isDefault", event.target.checked)} />ברירת מחדל מבצעית</label>
        <div className="toolbar-actions"><Button onClick={saveDraft}><Save />שמור מקור</Button></div>
        {draft.tokenMode !== "none" && <div className="glass-panel" style={{ padding: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span><KeyRound /> Token פרטי</span><strong>{tokenConfigured === true ? "מוגדר" : tokenConfigured === false ? "לא מוגדר" : "סטטוס לא זמין"}</strong></div><div style={{ display: "flex", gap: 8, marginTop: 8 }}><Input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="הזן token חדש — הערך לא ייקרא חזרה" dir="ltr" /><Button onClick={saveToken} disabled={!token.trim()}>שמור token</Button><Button variant="outline" onClick={removeToken}><Trash2 /></Button></div></div>}
      </div> : <div className="empty-state"><Map /><strong>אין מקור מפה</strong></div>}
    </div>
  </section>;
}
