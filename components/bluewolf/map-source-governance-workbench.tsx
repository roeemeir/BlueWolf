"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyRound, Map, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkspaceState } from "@/lib/bluewolf";
import { normalizeMapSource, normalizeMapSources, type MapSourceKind, type MapTokenMode, type OperationalMapSource } from "@/lib/map-source-config";
import { compatibleMatrixSets, type WmtsCapabilitiesCatalog, type WmtsLayerSelection } from "@/lib/wmts-capabilities";
import { useWorkspace } from "./app-context";

function nextId(existing: readonly OperationalMapSource[]) {
  let index = 1;
  while (existing.some((item) => item.id === `map-${index}`)) index += 1;
  return `map-${index}`;
}

function toWorkspaceSources(sources: OperationalMapSource[]) {
  return sources.map((source) => ({ ...source, urlTemplate: source.baseUrl })) as unknown as WorkspaceState["mapServers"];
}

type CapabilitiesResponse = {
  ok?: boolean;
  catalog?: WmtsCapabilitiesCatalog;
  defaults?: WmtsLayerSelection[];
  unsupportedLayers?: string[];
  error?: string;
};

export function MapSourceGovernanceWorkbench() {
  const { state, save } = useWorkspace();
  const sources = useMemo(() => normalizeMapSources(state.mapServers), [state.mapServers]);
  const initialSource = sources.find((source) => source.isDefault) ?? sources[0];
  const [selectedId, setSelectedId] = useState(() => initialSource?.id ?? "");
  const selected = sources.find((source) => source.id === selectedId);
  const [draft, setDraft] = useState<OperationalMapSource | null>(initialSource ?? null);
  const [token, setToken] = useState("");
  const [tokenConfigured, setTokenConfigured] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);

  const selectSource = (source: OperationalMapSource) => {
    setSelectedId(source.id);
    setDraft(source);
    setToken("");
    setTokenConfigured(null);
  };

  useEffect(() => {
    let cancelled = false;
    async function loadStatus() {
      if (!selected || selected.tokenMode === "none") return;
      try {
        const response = await fetch(`/api/map-sources/token?sourceId=${encodeURIComponent(selected.id)}`, { cache: "no-store" });
        const payload = await response.json() as { configured?: boolean };
        if (!cancelled) setTokenConfigured(response.ok ? payload.configured === true : null);
      } catch { if (!cancelled) setTokenConfigured(null); }
    }
    void loadStatus();
    return () => { cancelled = true; };
  }, [selected]);

  const patch = <K extends keyof OperationalMapSource>(key: K, value: OperationalMapSource[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);

  const addSource = (kind: MapSourceKind) => {
    const id = nextId(sources);
    const created: OperationalMapSource = {
      id, name: kind.toUpperCase(), kind, baseUrl: kind === "xyz" ? "https://maps.internal/{z}/{x}/{y}.png" : "https://maps.internal/", attribution: "", enabled: true, isDefault: sources.length === 0,
      layer: kind === "wms" ? "layer" : kind === "wmts" ? "layer" : undefined, style: "", format: "image/png", version: kind === "wms" ? "1.3.0" : kind === "wmts" ? "1.0.0" : undefined,
      crs: kind === "wms" ? "CRS:84" : undefined, tileMatrixSet: kind === "wmts" ? "WebMercatorQuad" : undefined, tokenMode: "none",
    };
    setSelectedId(id);
    setDraft(created);
    setTokenConfigured(null);
    setToken("");
  };

  const persistSource = async (candidate: OperationalMapSource, action: string, detail: string) => {
    const normalizedCandidate = normalizeMapSource(candidate);
    const normalized = normalizeMapSources([...sources.filter((source) => source.id !== normalizedCandidate.id), normalizedCandidate]);
    const withDefault = normalized.map((source) => normalizedCandidate.isDefault ? { ...source, isDefault: source.id === normalizedCandidate.id } : source);
    const defaultMap = withDefault.find((source) => source.isDefault && source.enabled)?.id ?? state.settings.defaultMap;
    const next = { ...state, mapServers: toWorkspaceSources(withDefault), settings: { ...state.settings, defaultMap } };
    if (!await save(next, "map-source", action, detail)) return null;
    const saved = withDefault.find((source) => source.id === normalizedCandidate.id) ?? normalizedCandidate;
    setSelectedId(saved.id);
    setDraft(saved);
    return saved;
  };

  const saveDraft = async () => {
    if (!draft) return;
    try {
      if (await persistSource(draft, "save-map-source", `saved ${draft.id} (${draft.kind})`)) toast.success("מקור המפה נשמר. ה־token נשמר בנפרד בצד השרת.");
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

  const testCapabilities = async () => {
    if (!draft || draft.kind !== "wmts") return;
    if (!sources.some((source) => source.id === draft.id)) { toast.error("שמור קודם את מקור ה־WMTS ואת ה־token, ואז הרץ Test"); return; }
    setTesting(true);
    try {
      const response = await fetch(`/api/map-sources/capabilities?sourceId=${encodeURIComponent(draft.id)}`, { cache: "no-store" });
      const payload = await response.json() as CapabilitiesResponse;
      if (!response.ok || !payload.catalog || !payload.defaults) throw new Error(payload.error ?? "GetCapabilities נכשל");
      const discovered = normalizeMapSource({ ...draft, wmtsCatalog: payload.catalog, wmtsLayers: payload.defaults, layer: undefined, tileMatrixSet: undefined });
      const saved = await persistSource(discovered, "wmts-get-capabilities", `discovered ${payload.catalog.layers.length} layers and ${payload.catalog.tileMatrixSets.length} matrix sets`);
      if (!saved) return;
      const unsupported = payload.unsupportedLayers?.length ? ` · ${payload.unsupportedLayers.length} שכבות לא תואמות לא יוצגו` : "";
      toast.success(`GetCapabilities תקין: ${payload.catalog.layers.length} שכבות, ${payload.catalog.tileMatrixSets.length} MatrixSets${unsupported}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "GetCapabilities נכשל"); }
    finally { setTesting(false); }
  };

  const updateWmtsLayer = (layerId: string, patchValue: Partial<WmtsLayerSelection>) => {
    setDraft((current) => {
      if (!current?.wmtsLayers) return current;
      return { ...current, wmtsLayers: current.wmtsLayers.map((item) => item.layer === layerId ? { ...item, ...patchValue } : item) };
    });
  };

  return <section className="glass-panel" dir="rtl" data-requirements="BW-OFF-010 BW-OFF-012" style={{ padding: 16, marginBottom: 16 }}>
    <div className="section-toolbar"><div><p className="eyebrow">Offline GIS</p><h3>מקורות מפה פרטיים · WMTS 1.0.0</h3><p className="card-hint">URL + token נשמרים מקומית. Test מבצע GetCapabilities אמיתי דרך ה־proxy המקומי; ה־token אינו נשמר ב־Workspace ואינו חוזר לדפדפן.</p></div><div className="toolbar-actions"><Button variant="outline" size="sm" onClick={() => addSource("wms")}><Plus />WMS legacy</Button><Button variant="outline" size="sm" onClick={() => addSource("wmts")}><Plus />WMTS</Button></div></div>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,.7fr) minmax(0,2fr)", gap: 14, marginTop: 12 }}>
      <div style={{ display: "grid", gap: 7, alignContent: "start" }}>{sources.map((source) => <button type="button" key={source.id} onClick={() => selectSource(source)} className={selectedId === source.id ? "active" : ""} style={{ textAlign: "right", padding: 10, borderRadius: 10 }}><strong>{source.name}</strong><div className="card-hint">{source.kind.toUpperCase()} · {source.id}{source.kind === "wmts" && source.wmtsCatalog ? ` · ${source.wmtsCatalog.layers.length} שכבות` : ""}</div></button>)}</div>
      {draft ? <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><Label>שם</Label><Input value={draft.name} onChange={(event) => patch("name", event.target.value)} /></div><div><Label>סוג</Label><Select value={draft.kind} onValueChange={(value) => patch("kind", value as MapSourceKind)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="xyz">XYZ legacy</SelectItem><SelectItem value="wms">WMS legacy</SelectItem><SelectItem value="wmts">WMTS</SelectItem></SelectContent></Select></div></div>
        <div><Label>URL פנימי / פרטי</Label><Input value={draft.baseUrl} onChange={(event) => patch("baseUrl", event.target.value)} dir="ltr" /></div>
        {draft.kind === "wms" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><Label>Layer</Label><Input value={draft.layer ?? ""} onChange={(event) => patch("layer", event.target.value)} /></div><div><Label>CRS</Label><Select value={draft.crs ?? "CRS:84"} onValueChange={(value) => patch("crs", value)}><SelectTrigger dir="ltr"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CRS:84">CRS:84</SelectItem><SelectItem value="EPSG:4326">EPSG:4326</SelectItem></SelectContent></Select></div></div>}
        {draft.kind === "wmts" && !draft.wmtsCatalog && <p className="card-hint">לאחר שמירת המקור וה־token לחץ Test/GetCapabilities. שדות Layer/Matrix ידניים נשמרים רק לתאימות למקורות ישנים.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><Label>Token mode</Label><Select value={draft.tokenMode} onValueChange={(value) => patch("tokenMode", value as MapTokenMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">ללא token</SelectItem><SelectItem value="bearer">Bearer header</SelectItem><SelectItem value="query">Query parameter</SelectItem></SelectContent></Select></div>{draft.tokenMode === "query" && <div><Label>Query parameter</Label><Input value={draft.tokenQueryParam ?? "token"} onChange={(event) => patch("tokenQueryParam", event.target.value)} dir="ltr" /></div>}</div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={draft.enabled} onChange={(event) => patch("enabled", event.target.checked)} />פעיל</label><label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={draft.isDefault} onChange={(event) => patch("isDefault", event.target.checked)} />ברירת מחדל מבצעית</label>
        <div className="toolbar-actions"><Button onClick={saveDraft}><Save />שמור מקור</Button>{draft.kind === "wmts" && <Button variant="outline" onClick={testCapabilities} disabled={testing}><RefreshCw />{testing ? "בודק…" : "Test / GetCapabilities"}</Button>}</div>
        {draft.tokenMode !== "none" && <div className="glass-panel" style={{ padding: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span><KeyRound /> Token פרטי</span><strong>{tokenConfigured === true ? "מוגדר" : tokenConfigured === false ? "לא מוגדר" : "סטטוס לא זמין"}</strong></div><div style={{ display: "flex", gap: 8, marginTop: 8 }}><Input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="הזן token חדש — הערך לא ייקרא חזרה" dir="ltr" /><Button onClick={saveToken} disabled={!token.trim()}>שמור token</Button><Button variant="outline" onClick={removeToken}><Trash2 /></Button></div></div>}
        {draft.kind === "wmts" && draft.wmtsCatalog && draft.wmtsLayers && <div className="glass-panel" style={{ padding: 12, display: "grid", gap: 10 }}>
          <div><strong>{draft.wmtsCatalog.serviceTitle ?? "WMTS"}</strong><p className="card-hint">{draft.wmtsCatalog.layers.length} Layers · {draft.wmtsCatalog.tileMatrixSets.length} TileMatrixSets · {draft.wmtsCatalog.getTileKvpUrls.length ? "KVP + REST לפי Capabilities" : "REST ResourceURL לפי Capabilities"}</p></div>
          {draft.wmtsLayers.map((selection) => {
            const layer = draft.wmtsCatalog?.layers.find((item) => item.identifier === selection.layer);
            const matrixSets = layer && draft.wmtsCatalog ? compatibleMatrixSets(draft.wmtsCatalog, layer) : [];
            return <div key={selection.layer} data-wmts-config-layer={selection.layer} style={{ display: "grid", gridTemplateColumns: "minmax(160px,1.2fr) repeat(4,minmax(100px,1fr))", gap: 8, alignItems: "end", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={selection.enabled} onChange={(event) => updateWmtsLayer(selection.layer, { enabled: event.target.checked })} /><span><strong>{layer?.title ?? selection.layer}</strong><small style={{ display: "block" }}>{selection.layer}</small></span></label>
              <div><Label>Style</Label><Select value={selection.style} onValueChange={(value) => updateWmtsLayer(selection.layer, { style: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{layer?.styles.map((style) => <SelectItem key={style.identifier} value={style.identifier}>{style.title ?? style.identifier}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Format</Label><Select value={selection.format} onValueChange={(value) => updateWmtsLayer(selection.layer, { format: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{layer?.formats.map((format) => <SelectItem key={format} value={format}>{format}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>MatrixSet</Label><Select value={selection.tileMatrixSet} onValueChange={(value) => updateWmtsLayer(selection.layer, { tileMatrixSet: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{matrixSets.map((matrixSet) => <SelectItem key={matrixSet.identifier} value={matrixSet.identifier}>{matrixSet.identifier}</SelectItem>)}</SelectContent></Select></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}><span><Label>Opacity</Label><Input type="number" min="0" max="1" step="0.05" value={selection.opacity} onChange={(event) => updateWmtsLayer(selection.layer, { opacity: Number(event.target.value) })} /></span><span><Label>סדר</Label><Input type="number" min="0" step="1" value={selection.order} onChange={(event) => updateWmtsLayer(selection.layer, { order: Number(event.target.value) })} /></span></div>
            </div>;
          })}
          <div className="toolbar-actions"><Button onClick={saveDraft}><Save />שמור שכבות ברירת מחדל</Button></div>
        </div>}
      </div> : <div className="empty-state"><Map /><strong>אין מקור מפה</strong></div>}
    </div>
  </section>;
}
