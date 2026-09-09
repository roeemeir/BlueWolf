"use client";

import { useMemo, useState } from "react";
import { Layers3, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SI_ALLOWED_PAIR_ANGLES,
  canonicalTemplateKey,
  createId,
  type Family,
  type SiPairRule,
  type SyncTemplate,
  type VehicleType,
} from "@/lib/bluewolf";
import {
  SO_QUARTERS,
  compatibilitySoFields,
  emptyRouteInstance,
  normalizedSoSpec,
  quarterRelation,
  routeRelation,
  soCapacity,
  soConstellationLabel,
  soTemplateSummary,
  validateSoSpec,
  type SoNormalizedRouteKind,
  type SoNormalizedTemplateSpec,
  type SoQuarter,
  type SoRouteInstance,
  type SyncTemplateWithNormalizedSo,
} from "@/lib/so-template-model";
import { useWorkspace } from "./app-context";
import { TemplatePreview, VehicleIconGlyph } from "./visuals";

const RELATION_LABELS = { same: "זהה", opposite: "הפוך", mixed: "מעורב" } as const;

function pairKey(first: number, second: number) { return `${first}-${second}`; }

function SectionHeader({ children }: { children?: React.ReactNode }) {
  return <header className="developer-section-header glass-panel"><div><p className="eyebrow">SRS v1.1 · Template semantics</p><h2>תבניות SI / SO</h2><p>SI נשאר זוגות זווית. SO מוגדר באמצעות Route Instances, Vehicle Slots ורבעים Q0–Q3; relation נגזר אוטומטית.</p></div>{children}</header>;
}

function SiBuilder({ name, setName, vehicleTypes, onSave }: { name: string; setName: (value: string) => void; vehicleTypes: VehicleType[]; onSave: (template: SyncTemplate) => void }) {
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(vehicleTypes.map((type, index) => [type.id, index < 3 ? 1 : 0])));
  const items = useMemo(() => vehicleTypes.flatMap((type) => Array.from({ length: counts[type.id] ?? 0 }, () => type)).slice(0, 5), [counts, vehicleTypes]);
  const [angles, setAngles] = useState<Record<string, number>>({ "0-1": 120, "0-2": 120, "1-2": 120 });
  const pairs = useMemo<SiPairRule[]>(() => {
    const result: SiPairRule[] = [];
    for (let first = 0; first < items.length; first += 1) for (let second = first + 1; second < items.length; second += 1) result.push({ first, second, angle: angles[pairKey(first, second)] ?? 90 });
    return result;
  }, [items.length, angles]);

  const save = () => {
    if (items.length < 2 || items.length > 5) { toast.error("SI דורש 2–5 רכבים"); return; }
    const mix = vehicleTypes.map((type) => `${type.name}×${counts[type.id] ?? 0}`).filter((value) => !value.endsWith("×0")).join(" · ");
    onSave({
      id: createId("tpl-si"), family: "SI", name: name.trim() || `SI · ${items.length} רכבים`, mix,
      constellation: items.map((item) => item.name).join(" — "), law: "זווית 45° / 90° / 120° לכל זוג",
      values: pairs.map((pair) => pair.angle), siPairs: pairs, isDefault: false, updatedAt: new Date().toISOString(),
    });
  };

  return <div className="v11-template-grid">
    <section className="glass-panel v11-template-form"><label><span>שם התבנית</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="שם קצר וברור" /></label><h3>הרכב רכבים</h3><div className="v04-count-grid">{vehicleTypes.map((type) => <label key={type.id}><span><i style={{ background: type.color }} />{type.name}</span><Select value={String(counts[type.id] ?? 0)} onValueChange={(value) => setCounts({ ...counts, [type.id]: Number(value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[0,1,2,3].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select></label>)}</div><h3>זווית לכל זוג</h3><div className="v04-pair-grid">{pairs.map((pair) => <label key={pairKey(pair.first, pair.second)}><span>{items[pair.first]?.name} ↔ {items[pair.second]?.name}</span><Select value={String(pair.angle)} onValueChange={(value) => setAngles({ ...angles, [pairKey(pair.first, pair.second)]: Number(value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SI_ALLOWED_PAIR_ANGLES.map((angle) => <SelectItem key={angle} value={String(angle)}>{angle}°</SelectItem>)}</SelectContent></Select></label>)}</div><Button onClick={save}><Save />שמור תבנית SI</Button></section>
    <section className="glass-panel v11-template-preview"><p className="eyebrow">Preview אידיאלי</p><TemplatePreview family="SI" values={pairs.map((pair) => pair.angle)} vehicleTypes={items} /><p>ב־Builder צבע מייצג Vehicle Type בלבד. במצב חי צבע מייצג Group.</p></section>
  </div>;
}

function VehicleSlot({ route, slotIndex, vehicleTypes, onChange }: { route: SoRouteInstance; slotIndex: number; vehicleTypes: VehicleType[]; onChange: (route: SoRouteInstance) => void }) {
  const slot = route.slots[slotIndex];
  return <div className={`v11-quarter-slot ${slot.vehicleTypeId ? "occupied" : "empty"}`}>
    <label><span>Slot {slotIndex + 1}</span><Select value={slot.vehicleTypeId ?? "empty"} onValueChange={(value) => onChange({ ...route, slots: route.slots.map((item, index) => index === slotIndex ? { ...item, vehicleTypeId: value === "empty" ? null : value } : item) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="empty">ריק</SelectItem>{vehicleTypes.map((type) => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select></label>
    <label><span>Quarter</span><Select value={slot.quarter} onValueChange={(value) => onChange({ ...route, slots: route.slots.map((item, index) => index === slotIndex ? { ...item, quarter: value as SoQuarter } : item) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SO_QUARTERS.map((quarter) => <SelectItem key={quarter} value={quarter}>{quarter}</SelectItem>)}</SelectContent></Select></label>
  </div>;
}

function SoRouteCard({ route, index, total, vehicleTypes, onChange, onDelete }: { route: SoRouteInstance; index: number; total: number; vehicleTypes: VehicleType[]; onChange: (route: SoRouteInstance) => void; onDelete: () => void }) {
  const changeKind = (kind: SoNormalizedRouteKind) => {
    const next = emptyRouteInstance(kind, route.id);
    const capacity = soCapacity(kind);
    next.slots = next.slots.map((slot, slotIndex) => route.slots[slotIndex] ? { ...slot, vehicleTypeId: route.slots[slotIndex].vehicleTypeId, quarter: route.slots[slotIndex].quarter } : slot).slice(0, capacity);
    onChange(next);
  };
  return <article className="v11-so-route glass-panel"><header><div><span className="v11-route-index">R{index + 1}</span><strong>{route.kind === "double" ? "Double Hippodrome" : route.kind === "figure8" ? "Figure‑8" : "Single Hippodrome"}</strong></div><div className="row-actions"><Badge variant="outline">{soCapacity(route.kind)} Slots</Badge><Button variant="ghost" size="icon-sm" disabled={total <= 1} onClick={onDelete}><Trash2 /></Button></div></header><label className="v11-route-kind"><span>Route Type</span><Select value={route.kind} onValueChange={(value) => changeKind(value as SoNormalizedRouteKind)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">Single</SelectItem><SelectItem value="double">Double</SelectItem><SelectItem value="figure8">Figure‑8 · Single-SO semantics</SelectItem></SelectContent></Select></label><div className="v11-quarter-map">{SO_QUARTERS.map((quarter) => { const occupied = route.slots.find((slot) => slot.quarter === quarter && slot.vehicleTypeId); const type = vehicleTypes.find((item) => item.id === occupied?.vehicleTypeId); return <div key={quarter} className={`quarter-${quarter.toLowerCase()} ${occupied ? "occupied" : ""}`}><b>{quarter}</b>{type ? <><svg viewBox="-15 -15 30 30"><VehicleIconGlyph icon={type.icon} color={type.color} /></svg><small>{type.name}</small></> : <small>ריק</small>}</div>; })}</div><div className="v11-slot-grid">{route.slots.map((_, slotIndex) => <VehicleSlot key={route.slots[slotIndex].id} route={route} slotIndex={slotIndex} vehicleTypes={vehicleTypes} onChange={onChange} />)}</div></article>;
}

function SoBuilder({ name, setName, vehicleTypes, onSave }: { name: string; setName: (value: string) => void; vehicleTypes: VehicleType[]; onSave: (template: SyncTemplateWithNormalizedSo) => void }) {
  const [spec, setSpec] = useState<SoNormalizedTemplateSpec>(() => ({ schemaVersion: "bluewolf.so-template.v1", routeInstances: [emptyRouteInstance("single", "draft-r1"), emptyRouteInstance("double", "draft-r2")] }));
  const relations = spec.routeInstances.slice(0, -1).map((route, index) => routeRelation(route, spec.routeInstances[index + 1]));
  const compatibility = compatibilitySoFields(spec);
  const previewTypes = spec.routeInstances.flatMap((route) => route.slots.map((slot) => vehicleTypes.find((type) => type.id === slot.vehicleTypeId)).filter(Boolean) as VehicleType[]);

  const patchRoute = (index: number, route: SoRouteInstance) => setSpec({ ...spec, routeInstances: spec.routeInstances.map((item, itemIndex) => itemIndex === index ? route : item) });
  const addRoute = () => setSpec({ ...spec, routeInstances: [...spec.routeInstances, emptyRouteInstance("single")] });
  const save = () => {
    try {
      validateSoSpec(spec);
      const occupied = spec.routeInstances.flatMap((route) => route.slots).filter((slot) => slot.vehicleTypeId);
      if (occupied.length < 1) throw new Error("יש לשבץ לפחות רכב אחד בתבנית SO");
      const template: SyncTemplateWithNormalizedSo = {
        id: createId("tpl-so"), family: "SO", name: name.trim() || "SO · Route Instances",
        mix: soTemplateSummary(spec, vehicleTypes), constellation: soConstellationLabel(spec),
        law: "Route Instances + Vehicle Slots + Quarter; relation נגזר אוטומטית",
        values: compatibility.values, soSpec: compatibility.soSpec, soV11: structuredClone(spec),
        isDefault: false, updatedAt: new Date().toISOString(),
      };
      onSave(template);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "תבנית SO אינה חוקית");
    }
  };

  return <div className="v11-so-builder"><section className="glass-panel v11-so-heading"><label><span>שם התבנית</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="שם קצר וברור" /></label><div><Button variant="outline" onClick={addRoute}><Plus />Route Instance</Button><Button onClick={save}><Save />שמור תבנית SO</Button></div></section><div className="v11-so-chain">{spec.routeInstances.map((route, index) => <div className="v11-so-chain-item" key={route.id}><SoRouteCard route={route} index={index} total={spec.routeInstances.length} vehicleTypes={vehicleTypes} onChange={(next) => patchRoute(index, next)} onDelete={() => setSpec({ ...spec, routeInstances: spec.routeInstances.filter((_, itemIndex) => itemIndex !== index) })} />{index < spec.routeInstances.length - 1 && <div className={`v11-derived-relation relation-${relations[index]}`}><span>R{index + 1} ↔ R{index + 2}</span><strong>{RELATION_LABELS[relations[index]]}</strong><small>נגזר מ־Quarter · אינו editable</small></div>}</div>)}</div><section className="glass-panel v11-template-preview"><p className="eyebrow">Preview / Compatibility</p><TemplatePreview family="SO" values={compatibility.values} vehicleTypes={previewTypes} soKinds={compatibility.soSpec.chain} /><p>Single/Figure‑8: עד 2 Slots · Double: עד 4 Slots. Double Figure‑8 אינו סוג חוקי.</p></section></div>;
}

export function TemplateBuilderV11() {
  const { state, save } = useWorkspace();
  const [family, setFamily] = useState<Family>("SO");
  const [name, setName] = useState("");

  const saveTemplate = async (template: SyncTemplate) => {
    if (state.templates.some((item) => canonicalTemplateKey(item) === canonicalTemplateKey(template))) { toast.warning("כבר קיימת תבנית שקולה"); return; }
    await save({ ...state, templates: [...state.templates, template] }, "templates", "create-v11", template.name);
    setName("");
    toast.success("התבנית נשמרה");
  };

  return <div className="v11-template-workspace"><SectionHeader><div className="segmented-control"><button type="button" className={family === "SI" ? "active" : ""} onClick={() => setFamily("SI")}>SI</button><button type="button" className={family === "SO" ? "active" : ""} onClick={() => setFamily("SO")}>SO · Quarter</button></div></SectionHeader>{family === "SI" ? <SiBuilder name={name} setName={setName} vehicleTypes={state.vehicleTypes} onSave={saveTemplate} /> : <SoBuilder name={name} setName={setName} vehicleTypes={state.vehicleTypes} onSave={saveTemplate} />}<section className="glass-panel v11-template-bank"><div className="panel-title"><div><p className="eyebrow">Template Bank</p><h3>{state.templates.length} תבניות</h3></div><Layers3 /></div><div className="v11-template-bank-list">{state.templates.map((template) => { const normalized = template.family === "SO" ? normalizedSoSpec(template) : null; return <article key={template.id}><div><strong>{template.name}</strong><p>{template.law}</p><small>{template.mix}</small>{normalized && <Badge variant="outline">{normalized.routeInstances.length} Route Instances</Badge>}</div><Button variant="ghost" size="icon-sm" disabled={template.isDefault} onClick={() => save({ ...state, templates: state.templates.filter((item) => item.id !== template.id) }, "templates", "delete", template.name)}><Trash2 /></Button></article>; })}</div></section></div>;
}
