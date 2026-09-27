"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { GtScenario, GtScenarioFamily, GtScenarioGroup } from "@/lib/gt-scenario-contract";
import { useWorkspace } from "./app-context";

type ScenarioSummary = {
  id: string; name: string; serverId: string; arena: string; startAt: string; endAt: string;
  groupCount: number; revision: number; updatedAt: string;
};

type ListPayload = { items?: ScenarioSummary[]; total?: number; error?: string };
type ReadPayload = { scenario?: GtScenario; error?: string };

function scenarioId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `gt-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function groupId() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return `grp-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function localInput(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function isoFromInput(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("זמן GT אינו תקין");
  return date.toISOString();
}

function parseParticipants(value: string) {
  const ids = value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean).map(Number);
  if (!ids.length || ids.some((id) => !Number.isInteger(id) || id < 0)) throw new Error("יש להזין מספרי רכב שלמים, לדוגמה 101,102,103");
  if (new Set(ids).size !== ids.length) throw new Error("יש מספר רכב כפול באותה קבוצה");
  return ids;
}

function emptyGroup(family: GtScenarioFamily, routes: readonly { id: string; family: string }[], templates: readonly { id: string; family: string }[]): GtScenarioGroup {
  return {
    id: groupId(),
    name: family === "SI" ? "קבוצת SI" : "קבוצת SO",
    family,
    routeId: routes.find((route) => route.family === family)?.id ?? "",
    templateId: templates.find((template) => template.family === family)?.id ?? "",
    participantIds: [],
  };
}

export function GtScenarioWorkbench() {
  const { state } = useWorkspace();
  const now = new Date();
  const plusHour = new Date(now.getTime() + 60 * 60_000);
  const [scenario, setScenario] = useState<GtScenario>(() => ({
    id: scenarioId(), name: "", serverId: state.servers.find((item) => item.enabled)?.id ?? state.servers[0]?.id ?? "1",
    arena: state.arenas[0] ?? "זירה א׳", startAt: now.toISOString(), endAt: plusHour.toISOString(),
    groups: [emptyGroup("SI", state.routes, state.templates)], notes: "", revision: 0,
  }));
  const [participantDrafts, setParticipantDrafts] = useState<Record<string, string>>({});
  const [items, setItems] = useState<ScenarioSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const pageSize = 50;

  const routeById = useMemo(() => new Map(state.routes.map((route) => [route.id, route])), [state.routes]);
  const templateById = useMemo(() => new Map(state.templates.map((template) => [template.id, template])), [state.templates]);

  const loadList = async (nextOffset = offset, nextQuery = query) => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ q: nextQuery, limit: String(pageSize), offset: String(nextOffset) });
      const response = await fetch(`/api/gt-scenarios?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as ListPayload;
      if (!response.ok) throw new Error(payload.error ?? "טעינת בנק GT נכשלה");
      setItems(payload.items ?? []); setTotal(payload.total ?? 0); setOffset(nextOffset);
    } catch (error) { toast.error(error instanceof Error ? error.message : "טעינת בנק GT נכשלה"); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ q: "", limit: "50", offset: "0" });
    void fetch(`/api/gt-scenarios?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as ListPayload;
        if (!response.ok) throw new Error(payload.error ?? "טעינת בנק GT נכשלה");
        if (cancelled) return;
        setItems(payload.items ?? []);
        setTotal(payload.total ?? 0);
        setOffset(0);
      })
      .catch((error) => { if (!cancelled) toast.error(error instanceof Error ? error.message : "טעינת בנק GT נכשלה"); });
    return () => { cancelled = true; };
  }, []); // local SQLite bank is independent of demo/runtime groups

  const patchGroup = (id: string, patch: Partial<GtScenarioGroup>) => setScenario((current) => ({ ...current, groups: current.groups.map((group) => group.id === id ? { ...group, ...patch } : group) }));

  const changeFamily = (group: GtScenarioGroup, family: GtScenarioFamily) => {
    const routeId = state.routes.find((route) => route.family === family)?.id ?? "";
    const templateId = state.templates.find((template) => template.family === family)?.id ?? "";
    patchGroup(group.id, { family, routeId, templateId });
  };

  const addGroup = (family: GtScenarioFamily) => setScenario((current) => ({ ...current, groups: [...current.groups, emptyGroup(family, state.routes, state.templates)] }));

  const saveScenario = async () => {
    setBusy(true);
    try {
      const groups = scenario.groups.map((group) => ({ ...group, participantIds: parseParticipants(participantDrafts[group.id] ?? group.participantIds.join(",")) }));
      const candidate: GtScenario = {
        ...scenario,
        name: scenario.name.trim() || `GT ${scenario.serverId} · ${scenario.arena}`,
        startAt: isoFromInput(localInput(scenario.startAt)),
        endAt: isoFromInput(localInput(scenario.endAt)),
        groups,
      };
      for (const group of groups) {
        const route = routeById.get(group.routeId); const template = templateById.get(group.templateId);
        if (!route || route.family !== group.family) throw new Error(`הנתיב של ${group.name} אינו תואם למשפחה ${group.family}`);
        if (!template || template.family !== group.family) throw new Error(`התבנית של ${group.name} אינה תואמת למשפחה ${group.family}`);
      }
      const response = await fetch("/api/gt-scenarios", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: candidate, expectedRevision: scenario.revision }),
      });
      const payload = await response.json() as { scenario?: GtScenario; error?: string; conflict?: boolean };
      if (response.status === 409) throw new Error("התרחיש השתנה במקביל; טען אותו מחדש לפני שמירה");
      if (!response.ok || !payload.scenario) throw new Error(payload.error ?? "שמירת GT נכשלה");
      setScenario(payload.scenario);
      setParticipantDrafts(Object.fromEntries(payload.scenario.groups.map((group) => [group.id, group.participantIds.join(",")])));
      await loadList(0, query);
      toast.success(`תרחיש GT נשמר: ${payload.scenario.groups.length} קבוצות`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "שמירת GT נכשלה"); }
    finally { setBusy(false); }
  };

  const loadScenario = async (id: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/gt-scenarios?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = await response.json() as ReadPayload;
      if (!response.ok || !payload.scenario) throw new Error(payload.error ?? "טעינת תרחיש GT נכשלה");
      setScenario(payload.scenario);
      setParticipantDrafts(Object.fromEntries(payload.scenario.groups.map((group) => [group.id, group.participantIds.join(",")])));
    } catch (error) { toast.error(error instanceof Error ? error.message : "טעינת תרחיש GT נכשלה"); }
    finally { setBusy(false); }
  };

  const deleteScenario = async (item: ScenarioSummary) => {
    const response = await fetch(`/api/gt-scenarios?id=${encodeURIComponent(item.id)}&revision=${item.revision}`, { method: "DELETE" });
    if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: string }; toast.error(payload.error ?? "מחיקת GT נכשלה"); return; }
    if (scenario.id === item.id) newScenario();
    await loadList(Math.max(0, Math.min(offset, Math.max(0, total - 1 - pageSize))), query);
  };

  const newScenario = () => {
    const start = new Date(); const end = new Date(start.getTime() + 60 * 60_000);
    const group = emptyGroup("SI", state.routes, state.templates);
    setScenario({ id: scenarioId(), name: "", serverId: state.servers.find((item) => item.enabled)?.id ?? state.servers[0]?.id ?? "1", arena: state.arenas[0] ?? "זירה א׳", startAt: start.toISOString(), endAt: end.toISOString(), groups: [group], notes: "", revision: 0 });
    setParticipantDrafts({ [group.id]: "" });
  };

  return <section className="glass-panel gt-scenario-workbench" dir="rtl" data-requirements="BW-DEV-008 BW-DEV-015">
    <style>{`
      .gt-scenario-workbench{padding:16px;margin-bottom:16px;overflow:hidden}.gt-main-grid{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(0,2fr);gap:14px;margin-top:12px}.gt-bank{display:grid;gap:8px;align-content:start;min-width:0}.gt-editor{display:grid;gap:12px;min-width:0}.gt-meta-grid{display:grid;grid-template-columns:1.2fr .8fr .8fr;gap:8px}.gt-time-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.gt-group-grid{display:grid;grid-template-columns:.7fr 1fr 1fr 1fr;gap:8px}.gt-meta-grid label,.gt-time-grid label,.gt-group-grid label{min-width:0}.gt-meta-grid input,.gt-time-grid input,.gt-group-grid input,.gt-group-grid [data-slot="select-trigger"],.gt-meta-grid [data-slot="select-trigger"]{width:100%;min-width:0}.gt-add-actions{display:flex;gap:8px;flex-wrap:wrap}
      @media(max-width:900px){.gt-main-grid{grid-template-columns:1fr}.gt-bank{order:2}.gt-editor{order:1}.gt-meta-grid,.gt-group-grid{grid-template-columns:1fr 1fr}}
      @media(max-width:600px){.gt-scenario-workbench{padding:12px}.gt-meta-grid,.gt-time-grid,.gt-group-grid{grid-template-columns:1fr}.gt-group-grid [data-slot="select-trigger"],.gt-meta-grid [data-slot="select-trigger"]{width:100%}.gt-add-actions{display:grid;grid-template-columns:1fr}.gt-add-actions button{width:100%}.section-toolbar{align-items:stretch}.section-toolbar>.toolbar-actions{display:grid;grid-template-columns:1fr 1fr}.section-toolbar>.toolbar-actions button{width:100%}}
    `}</style>
    <div className="section-toolbar"><div><p className="eyebrow">Ground Truth · SQLite</p><h3>בנק תרחישי GT רב־קבוצתי</h3><p className="card-hint">תרחיש אחד יכול לכלול עד 64 קבוצות. כל קבוצה מקבלת נתיב, תבנית ורשימת רכבים מפורשת; אין תלות ב־demo scenario.</p></div><div className="toolbar-actions"><Button variant="outline" onClick={newScenario}><Plus />חדש</Button><Button onClick={saveScenario} disabled={busy}><Save />שמור תרחיש</Button></div></div>

    <div className="gt-main-grid">
      <aside className="gt-bank">
        <div style={{ display: "flex", gap: 6 }}><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש בשם" /><Button variant="outline" size="icon" onClick={() => loadList(0, query)}><Search /></Button><Button variant="outline" size="icon" onClick={() => loadList(offset, query)}><RefreshCw /></Button></div>
        <small>{total} תרחישים · מציג {items.length} · offset {offset}</small>
        {items.map((item) => <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}><button type="button" onClick={() => loadScenario(item.id)} style={{ textAlign: "right", padding: 9, borderRadius: 8 }}><strong>{item.name}</strong><div className="card-hint">{item.serverId} · {item.arena} · {item.groupCount} קבוצות · r{item.revision}</div></button><Button variant="ghost" size="icon-sm" onClick={() => deleteScenario(item)}><Trash2 /></Button></div>)}
        <div style={{ display: "flex", justifyContent: "space-between" }}><Button variant="outline" size="sm" disabled={offset === 0} onClick={() => loadList(Math.max(0, offset - pageSize), query)}>הקודם</Button><Button variant="outline" size="sm" disabled={offset + pageSize >= total} onClick={() => loadList(offset + pageSize, query)}>הבא</Button></div>
      </aside>

      <div className="gt-editor">
        <div className="gt-meta-grid"><label><Label>שם תרחיש</Label><Input value={scenario.name} onChange={(event) => setScenario({ ...scenario, name: event.target.value })} /></label><label><Label>שרת</Label><Select value={scenario.serverId} onValueChange={(value) => setScenario({ ...scenario, serverId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.servers.map((server) => <SelectItem key={server.id} value={server.id}>{server.name}</SelectItem>)}</SelectContent></Select></label><label><Label>זירה</Label><Select value={scenario.arena} onValueChange={(value) => setScenario({ ...scenario, arena: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.arenas.map((arena) => <SelectItem key={arena} value={arena}>{arena}</SelectItem>)}</SelectContent></Select></label></div>
        <div className="gt-time-grid"><label><Label>התחלה</Label><Input type="datetime-local" value={localInput(scenario.startAt)} onChange={(event) => setScenario({ ...scenario, startAt: isoFromInput(event.target.value) })} /></label><label><Label>סיום</Label><Input type="datetime-local" value={localInput(scenario.endAt)} onChange={(event) => setScenario({ ...scenario, endAt: isoFromInput(event.target.value) })} /></label></div>

        {scenario.groups.map((group, index) => <article key={group.id} className="glass-panel" style={{ padding: 12 }}>
          <div className="section-toolbar"><strong>קבוצה {index + 1} · {group.name}</strong><Button variant="ghost" size="icon-sm" disabled={scenario.groups.length === 1} onClick={() => setScenario({ ...scenario, groups: scenario.groups.filter((item) => item.id !== group.id) })}><Trash2 /></Button></div>
          <div className="gt-group-grid"><label><Label>משפחה</Label><Select value={group.family} onValueChange={(value) => changeFamily(group, value as GtScenarioFamily)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SI">SI</SelectItem><SelectItem value="SO">SO</SelectItem></SelectContent></Select></label><label><Label>שם קבוצה</Label><Input value={group.name} onChange={(event) => patchGroup(group.id, { name: event.target.value })} /></label><label><Label>נתיב</Label><Select value={group.routeId} onValueChange={(value) => patchGroup(group.id, { routeId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.routes.filter((route) => route.family === group.family).map((route) => <SelectItem key={route.id} value={route.id}>{route.name}</SelectItem>)}</SelectContent></Select></label><label><Label>תבנית</Label><Select value={group.templateId} onValueChange={(value) => patchGroup(group.id, { templateId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.templates.filter((template) => template.family === group.family).map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select></label></div>
          <label style={{ display: "grid", gap: 5, marginTop: 8 }}><Label>מספרי רכבים בקבוצה</Label><Input dir="ltr" value={participantDrafts[group.id] ?? group.participantIds.join(",")} onChange={(event) => setParticipantDrafts({ ...participantDrafts, [group.id]: event.target.value })} placeholder="101,102,103" /></label>
        </article>)}
        <div className="gt-add-actions"><Button variant="outline" onClick={() => addGroup("SI")}><Plus />קבוצת SI</Button><Button variant="outline" onClick={() => addGroup("SO")}><Plus />קבוצת SO</Button></div>
        <label><Label>הערות תרחיש</Label><Textarea value={scenario.notes} onChange={(event) => setScenario({ ...scenario, notes: event.target.value })} /></label>
      </div>
    </div>
  </section>;
}
