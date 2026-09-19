"use client";

import { MapPinned, Plus, Save, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "./app-context";
import { VehicleRangeWorkbench } from "./vehicle-range-workbench";

/** General configuration is deliberately independent of QA and score calibration. */
export function GeneralSettingsWorkbench() {
  const { state, save } = useWorkspace();
  const [servers, setServers] = useState(() => structuredClone(state.servers));
  const [arenas, setArenas] = useState(() => [...state.arenas]);
  const [newArena, setNewArena] = useState("");
  const [saving, setSaving] = useState(false);

  const persist = async () => {
    const normalizedArenas = arenas.map((arena) => arena.trim());
    if (normalizedArenas.some((arena) => !arena) || new Set(normalizedArenas).size !== normalizedArenas.length) {
      toast.error("שמות הזירות חייבים להיות מלאים וייחודיים");
      return;
    }
    if (servers.some((server) => !server.name.trim()) || !servers.some((server) => server.enabled)) {
      toast.error("יש לתת שם לכל שרת ולהשאיר לפחות שרת אחד פעיל");
      return;
    }
    setSaving(true);
    try {
      const persisted = await save({ ...state, servers: servers.map((server) => ({ ...server, name: server.name.trim() })), arenas: normalizedArenas }, "settings", "save", "general-server-arena-configuration");
      if (!persisted) toast.error("השמירה לא הושלמה; ההגדרות הקודמות נשארו בתוקף");
    } finally {
      setSaving(false);
    }
  };

  return <div className="general-settings-workbench" dir="rtl" data-testid="general-settings-workbench">
    <style>{`
      .general-settings-workbench{display:grid;gap:16px;min-width:0}
      .general-settings-workbench .settings-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .general-settings-workbench .settings-head h2{margin:0;font-size:19px}
      .general-settings-workbench .settings-head p{color:var(--text-soft);font-size:12px;margin:5px 0 0}
      .general-settings-workbench .settings-panes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .general-settings-workbench .settings-pane{min-width:0;padding:16px;border:1px solid var(--line);border-radius:16px;background:var(--surface-strong)}
      .general-settings-workbench .settings-pane h3{display:flex;align-items:center;gap:7px;margin:0 0 12px;font-size:15px}
      .general-settings-workbench .settings-entry{display:flex;align-items:center;gap:9px;min-width:0;margin-top:9px}
      .general-settings-workbench .settings-entry input{min-width:0;flex:1;width:100%;height:40px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;color:var(--foreground);background:var(--surface-soft)}
      .general-settings-workbench .settings-entry small{color:var(--text-soft);overflow-wrap:anywhere;max-width:130px}
      .general-settings-workbench .settings-entry button{flex:0 0 auto;min-width:40px;min-height:40px}
      @media(max-width:760px){.general-settings-workbench .settings-panes{grid-template-columns:minmax(0,1fr)}.general-settings-workbench .settings-entry{flex-wrap:wrap}.general-settings-workbench .settings-entry input{font-size:16px;min-height:44px}.general-settings-workbench .settings-entry small{flex-basis:100%;max-width:100%}.general-settings-workbench .settings-head button{width:100%;min-height:44px}}
    `}</style>
    <section className="glass-panel" style={{ padding: 18 }}>
      <header className="settings-head"><div><p className="eyebrow">הגדרות כלליות</p><h2>שרתים וזירות</h2><p>שמות וזמינות השרתים וזירות התצוגה נשמרים בקונפיגורציית Workspace. הגדרות הרכבים נמצאות כאן בלבד.</p></div><Button disabled={saving} onClick={persist}><Save />{saving ? "שומר…" : "שמור הגדרות"}</Button></header>
      <div className="settings-panes" style={{ marginTop: 14 }}>
        <section className="settings-pane"><h3><Server size={18} />שרתים</h3>{servers.map((server, index) => <label key={server.id} className="settings-entry"><Switch aria-label={`שרת ${server.name} פעיל`} checked={server.enabled} onCheckedChange={(enabled) => setServers((current) => current.map((row, itemIndex) => itemIndex === index ? { ...row, enabled } : row))} /><input aria-label={`שם שרת ${server.id}`} value={server.name} onChange={(event) => setServers((current) => current.map((row, itemIndex) => itemIndex === index ? { ...row, name: event.target.value } : row))} /><small>Influx tag: {server.influxTag}</small></label>)}</section>
        <section className="settings-pane"><h3><MapPinned size={18} />זירות</h3>{arenas.map((arena, index) => <div className="settings-entry" key={`arena-${index}`}><input aria-label={`שם זירה ${index + 1}`} value={arena} onChange={(event) => setArenas((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /><Button variant="ghost" size="icon" aria-label={`מחק זירה ${arena}`} onClick={() => setArenas((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></Button></div>)}<div className="settings-entry"><input aria-label="שם זירה חדשה" value={newArena} placeholder="זירה חדשה" onChange={(event) => setNewArena(event.target.value)} /><Button variant="outline" size="icon" aria-label="הוסף זירה" onClick={() => { if (newArena.trim()) { setArenas((current) => [...current, newArena.trim()]); setNewArena(""); } }}><Plus size={16} /></Button></div></section>
      </div>
    </section>
    <VehicleRangeWorkbench />
  </div>;
}
