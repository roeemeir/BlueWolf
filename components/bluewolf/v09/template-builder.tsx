"use client";

import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Save } from "lucide-react";
import { toast } from "sonner";

import type { SoRelation, SoRouteKind, SyncTemplate, VehicleType } from "@/lib/bluewolf";
import { createId, SI_ALLOWED_PAIR_ANGLES, SO_RELATION_LABELS } from "@/lib/bluewolf";
import { useWorkspace } from "../app-context";
import { doubleHippodromeLoop, figureEightLoop, hippodromeLoop, pointOnClosed, svgClosedPath } from "./geometry";
import { fixedVehicleTypes, TYPE_COLORS } from "./map";

const KINDS = ["single", "double", "figure8"] as const;
type Kind = typeof KINDS[number];
type Counts = Record<Kind, Record<string, number>>;
type Entity = { uid: string; kind: Kind; typeId: string; typeName: string; count: number; color: string };
type Layout = { key: string; entities: Entity[]; overlapPair: number | null };

const capFor = (kind: Kind) => kind === "double" ? 4 : 2;
const kindLabel = (kind: Kind) => kind === "single" ? "היפודרום יחיד" : kind === "double" ? "היפודרום כפול" : "שמינייה";

function emptyCounts(types: VehicleType[]): Counts {
  return { single: Object.fromEntries(types.map((type) => [type.id, 0])), double: Object.fromEntries(types.map((type) => [type.id, 0])), figure8: Object.fromEntries(types.map((type) => [type.id, 0])) } as Counts;
}

function Stepper({ value, onChange, max = 8 }: { value: number; onChange: (value: number) => void; max?: number }) {
  return <div className="v09-stepper"><button type="button" aria-label="הפחת" onClick={() => onChange(Math.max(0, value - 1))}><Minus /></button><b>{value}</b><button type="button" aria-label="הוסף" onClick={() => onChange(Math.min(max, value + 1))}><Plus /></button></div>;
}

function packEntities(counts: Counts, types: VehicleType[]) {
  const entities: Entity[] = [];
  for (const kind of KINDS) {
    for (const type of types) {
      let remaining = counts[kind][type.id] ?? 0;
      let part = 1;
      while (remaining > 0) {
        const count = Math.min(capFor(kind), remaining);
        entities.push({ uid: `${kind}-${type.id}-${part}`, kind, typeId: type.id, typeName: type.name, count, color: type.color });
        remaining -= count;
        part += 1;
      }
    }
  }
  return entities;
}

function mirrorKey(entities: Entity[], overlapPair: number | null) {
  const f = entities.map((entity) => `${entity.kind}:${entity.typeId}:${entity.count}`).join("|");
  const r = [...entities].reverse().map((entity) => `${entity.kind}:${entity.typeId}:${entity.count}`).join("|");
  const overlapForward = overlapPair == null ? "n" : String(overlapPair);
  const overlapReverse = overlapPair == null ? "n" : String(Math.max(0, entities.length - 2 - overlapPair));
  const fk = `${f}#${overlapForward}`;
  const rk = `${r}#${overlapReverse}`;
  return fk < rk ? fk : rk;
}

function permutations(input: Entity[], limit = 18) {
  const results: Entity[][] = [];
  const seen = new Set<string>();
  const visit = (prefix: Entity[], remaining: Entity[]) => {
    if (results.length >= limit) return;
    if (!remaining.length) {
      const key = mirrorKey(prefix, null);
      if (!seen.has(key)) { seen.add(key); results.push(prefix); }
      return;
    }
    remaining.forEach((entity, index) => {
      if (remaining.slice(0, index).some((candidate) => candidate.kind === entity.kind && candidate.typeId === entity.typeId && candidate.count === entity.count)) return;
      visit([...prefix, entity], [...remaining.slice(0, index), ...remaining.slice(index + 1)]);
    });
  };
  visit([], input);
  return results;
}

function layoutsFor(counts: Counts, types: VehicleType[]) {
  const entities = packEntities(counts, types);
  const vehicles = entities.reduce((sum, entity) => sum + entity.count, 0);
  if (vehicles < 2) return [] as Layout[];
  const output: Layout[] = [];
  const seen = new Set<string>();
  for (const order of permutations(entities, 20)) {
    const baseKey = mirrorKey(order, null);
    if (!seen.has(baseKey)) { seen.add(baseKey); output.push({ key: baseKey, entities: order, overlapPair: null }); }
    for (let index = 0; index < order.length - 1; index += 1) {
      const left = order[index]; const right = order[index + 1];
      // Distinct routes may share a center; different vehicle types never share one route entity.
      if (left.kind === "single" && right.kind === "single" && left.typeId !== right.typeId) {
        const key = mirrorKey(order, index);
        if (!seen.has(key)) { seen.add(key); output.push({ key, entities: order, overlapPair: index }); }
      }
      if (output.length >= 28) return output;
    }
  }
  return output;
}

function relationOptions(layout: Layout, index: number): SoRelation[] {
  const a = layout.entities[index]; const b = layout.entities[index + 1];
  return a?.kind === "double" || b?.kind === "double" ? ["same", "opposite", "mixed"] : ["same", "opposite"];
}

function TemplatePreviewSI({ types, items, angles }: { types: VehicleType[]; items: VehicleType[]; angles: number[] }) {
  const cumulative = [0];
  angles.forEach((angle) => cumulative.push((cumulative.at(-1) ?? 0) + angle));
  const radii = [88, 64, 88, 64, 88, 64];
  const points = items.map((_, index) => { const angle = (cumulative[index] - 90) * Math.PI / 180; const radius = radii[index % radii.length]; return { x: 210 + Math.cos(angle) * radius, y: 130 + Math.sin(angle) * radius }; });
  return <svg className="v09-template-svg" viewBox="0 0 420 270"><rect width="420" height="270" rx="18" /><circle cx="210" cy="130" r="42" className="v09-ring" /><circle cx="210" cy="130" r="64" className="v09-ring" /><circle cx="210" cy="130" r="88" className="v09-ring" />{points.map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r="10" fill={items[index]?.color ?? types[index % types.length]?.color ?? TYPE_COLORS[0]} /><text x={point.x} y={point.y - 15} textAnchor="middle">{items[index]?.name ?? `R${index + 1}`}</text></g>)}{angles.map((angle, index) => { const a = points[index]; const b = points[index + 1]; if (!a || !b) return null; const x = (a.x + b.x) / 2; const y = (a.y + b.y) / 2; return <g key={index} className="v09-pair"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /><rect x={x - 23} y={y - 11} width="46" height="22" rx="11" /><text x={x} y={y + 4} textAnchor="middle">{angle}°</text></g>; })}</svg>;
}

function soEntityPath(entity: Entity, center: { x: number; y: number }, order: number, overlapped: boolean) {
  const radius = overlapped ? (order % 2 ? 25 : 34) : 28;
  if (entity.kind === "double") return doubleHippodromeLoop(center, 22, 58, 62, 28, -12 + order * 7);
  if (entity.kind === "figure8") return figureEightLoop(center, 28, 78, -16 + order * 9);
  return hippodromeLoop(center, radius, 82, -24 + order * 16);
}

export function TemplatePreviewSO({ layout, relations }: { layout: Layout | null; relations: SoRelation[] }) {
  if (!layout) return <div className="v09-empty-preview">הוסף לפחות שני רכבים כדי לראות את כל הפרמוטציות.</div>;
  const entityCenters: { x: number; y: number }[] = [];
  const groups: number[] = [];
  let group = 0;
  layout.entities.forEach((_, index) => { if (index > 0 && layout.overlapPair !== index - 1) group += 1; groups.push(group); });
  const groupCount = Math.max(...groups, 0) + 1;
  const step = groupCount <= 1 ? 0 : Math.min(132, 315 / Math.max(1, groupCount - 1));
  const start = 210 - step * (groupCount - 1) / 2;
  layout.entities.forEach((_, index) => entityCenters.push({ x: start + groups[index] * step, y: 135 + 25 * Math.sin(groups[index] * 1.1) }));
  const phases: number[] = [0.12];
  for (let index = 1; index < layout.entities.length; index += 1) {
    const relation = relations[index - 1] ?? "same";
    phases[index] = phases[index - 1] + (relation === "same" ? 0 : relation === "opposite" ? 0.5 : 0.25);
  }
  return <svg className="v09-template-svg" viewBox="0 0 420 270"><rect width="420" height="270" rx="18" />{layout.entities.map((entity, index) => { const center = entityCenters[index]; const overlapped = layout.overlapPair === index || layout.overlapPair === index - 1; const path = soEntityPath(entity, center, index, overlapped); return <g key={entity.uid}><path d={svgClosedPath(path)} fill="none" stroke={entity.color} strokeWidth={overlapped ? 4.6 : 4} /><text x={center.x} y={center.y + 63} textAnchor="middle" fill={entity.color}>{kindLabel(entity.kind)} · {entity.typeName}</text>{Array.from({ length: entity.count }, (_, vehicleIndex) => { const point = pointOnClosed(path, phases[index] + vehicleIndex / Math.max(2, entity.count)); return <g key={vehicleIndex} transform={`translate(${point.x} ${point.y}) rotate(${point.heading})`}><circle r="9" fill="var(--map-card)" stroke={entity.color} strokeWidth="2" /><path d="M0-10 6 7 0 4-6 7Z" fill={entity.color} /></g>; })}</g>; })}{layout.entities.slice(0, -1).map((entity, index) => { const a = entityCenters[index]; const b = entityCenters[index + 1]; const relation = relations[index] ?? "same"; const sameCenter = layout.overlapPair === index; const x = sameCenter ? a.x : (a.x + b.x) / 2; const y = sameCenter ? a.y - 70 : (a.y + b.y) / 2 - 48; return <g key={`r-${entity.uid}`}><rect x={x - 32} y={y - 13} width="64" height="26" rx="13" className="v09-relation-bg" /><text x={x} y={y + 4} textAnchor="middle" className="v09-relation-text">{SO_RELATION_LABELS[relation]}</text>{sameCenter && <text x={x} y={y - 18} textAnchor="middle" className="v09-overlap-label">מרכז משותף</text>}</g>; })}</svg>;
}

export function V09TemplateBuilder() {
  const { state, save } = useWorkspace();
  const types = useMemo(() => fixedVehicleTypes(state.vehicleTypes), [state.vehicleTypes]);
  const [family, setFamily] = useState<"SI" | "SO">("SO");
  const [name, setName] = useState("");
  const [siCounts, setSiCounts] = useState<Record<string, number>>(() => Object.fromEntries(types.map((type) => [type.id, 1])));
  const [siAngles, setSiAngles] = useState<number[]>([120, 120]);
  const [counts, setCounts] = useState<Counts>(() => emptyCounts(types));
  const layouts = useMemo(() => layoutsFor(counts, types), [counts, types]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [relationsByKey, setRelationsByKey] = useState<Record<string, SoRelation[]>>({});
  const selected = layouts.find((layout) => layout.key === selectedKey) ?? layouts[0] ?? null;
  const relations = selected ? (relationsByKey[selected.key] ?? Array.from({ length: Math.max(0, selected.entities.length - 1) }, (_, index) => relationOptions(selected, index)[0])) : [];
  useEffect(() => { if (layouts.length && !layouts.some((layout) => layout.key === selectedKey)) setSelectedKey(layouts[0].key); }, [layouts, selectedKey]);
  const siItems = types.flatMap((type) => Array.from({ length: siCounts[type.id] ?? 0 }, () => type));
  useEffect(() => { const required = Math.max(0, siItems.length - 1); setSiAngles((current) => Array.from({ length: required }, (_, index) => current[index] ?? 120)); }, [siItems.length]);
  const totalSo = KINDS.reduce((sum, kind) => sum + types.reduce((typeSum, type) => typeSum + (counts[kind][type.id] ?? 0), 0), 0);

  const changeCount = (kind: Kind, typeId: string, value: number) => setCounts((current) => ({ ...current, [kind]: { ...current[kind], [typeId]: value } }));
  const changeRelation = (index: number, value: SoRelation) => { if (!selected) return; const next = relations.map((relation, itemIndex) => itemIndex === index ? value : relation); setRelationsByKey((current) => ({ ...current, [selected.key]: next })); };

  const saveTemplate = async () => {
    if (!name.trim()) { toast.error("תן שם לתבנית"); return; }
    let template: SyncTemplate;
    if (family === "SI") {
      if (siItems.length < 2) { toast.error("SI דורש לפחות שני רכבים"); return; }
      template = { id: createId("tpl"), family: "SI", name: name.trim(), mix: types.map((type) => `${type.name}×${siCounts[type.id] ?? 0}`).filter((value) => !value.endsWith("×0")).join(" · "), constellation: siItems.map((type) => type.name).join(" — "), law: "n−1 sequential angles; free common phase", values: siAngles, vehicleCount: siItems.length, siPairs: siAngles.map((angle, index) => ({ first: index, second: index + 1, angle })), isDefault: false, updatedAt: new Date().toISOString() };
    } else {
      if (!selected || totalSo < 2) { toast.error("SO דורש לפחות שני רכבים"); return; }
      const singleCounts = counts.single; const doubleCounts = counts.double; const figure8Counts = counts.figure8;
      template = { id: createId("tpl"), family: "SO", name: name.trim(), mix: selected.entities.map((entity) => `${entity.typeName}×${entity.count}`).join(" · "), constellation: selected.entities.map((entity, index) => `${kindLabel(entity.kind)}:${entity.typeName}${selected.overlapPair === index ? " ⊙" : ""}`).join(" — "), law: "ordered route entities; one vehicle type per route entity; optional co-located distinct routes", values: relations.map((relation) => relation === "same" ? 0 : relation === "opposite" ? 1 : 2), soSpec: { singleCounts, doubleCounts, figure8Counts, chain: selected.entities.map((entity) => entity.kind as SoRouteKind), relations, entities: selected.entities.map((entity, index) => ({ kind: entity.kind, vehicleTypes: Array(entity.count).fill(entity.typeId), overlapWithNext: selected.overlapPair === index } as never)) } as never, isDefault: false, updatedAt: new Date().toISOString() } as SyncTemplate;
    }
    await save({ ...state, vehicleTypes: types, templates: [...state.templates, template] }, "templates", "create-v09", template.name);
    toast.success("התבנית נשמרה");
    setName("");
  };

  return <div className="v09-template-builder">
    <header className="v09-section-header"><div><p className="eyebrow">SRS v1.1 · Template Builder</p><h2>מחולל תבניות</h2><p>מספרים משנים עם +/−. ב־SO כל שינוי יוצר מיד את כל סדרי ההיפודרומים החוקיים.</p></div><div className="v09-family-switch"><button className={family === "SI" ? "active" : ""} onClick={() => setFamily("SI")}>SI</button><button className={family === "SO" ? "active" : ""} onClick={() => setFamily("SO")}>SO</button></div></header>
    <div className="v09-template-layout"><div className="v09-builder-controls"><label className="v09-field"><span>שם התבנית</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="שם קצר" /></label>
      {family === "SI" ? <><h3>כמות לפי סוג רכב</h3><div className="v09-type-steppers">{types.map((type) => <div key={type.id}><span><i style={{ background: type.color }} />{type.name}</span><Stepper value={siCounts[type.id] ?? 0} onChange={(value) => setSiCounts((current) => ({ ...current, [type.id]: value }))} max={3} /></div>)}</div><h3>זווית בין כל זוג עוקב</h3><div className="v09-angle-list">{siAngles.map((angle, index) => <label key={index}><span>{siItems[index]?.name} → {siItems[index + 1]?.name}</span><select value={angle} onChange={(event) => setSiAngles((current) => current.map((value, itemIndex) => itemIndex === index ? Number(event.target.value) : value))}>{SI_ALLOWED_PAIR_ANGLES.map((value) => <option key={value} value={value}>{value}°</option>)}</select></label>)}</div></> : <>
        <div className="v09-so-count-groups">{KINDS.map((kind) => <section key={kind}><h3>{kindLabel(kind)}</h3>{types.map((type) => <div key={type.id} className="v09-count-row"><span><i style={{ background: type.color }} />{type.name}</span><Stepper value={counts[kind][type.id] ?? 0} onChange={(value) => changeCount(kind, type.id, value)} max={kind === "double" ? 8 : 6} /></div>)}</section>)}</div>
        <div className="v09-layout-title"><h3>פרמוטציות של סדר ההיפודרומים</h3><span>{layouts.length} אפשרויות · {totalSo} רכבים</span></div>
        <div className="v09-layout-options">{layouts.length ? layouts.map((layout, index) => <button type="button" key={layout.key} className={(selected?.key === layout.key) ? "active" : ""} onClick={() => setSelectedKey(layout.key)}><b>#{index + 1}</b><span>{layout.entities.map((entity, itemIndex) => `${kindLabel(entity.kind)}·${entity.typeName}${layout.overlapPair === itemIndex ? " ⊙" : ""}`).join(" → ")}</span><small>{layout.overlapPair == null ? "מרכזים נפרדים" : "כולל זוג מסלולים במרכז משותף"}</small></button>) : <p className="v09-empty">בחר לפחות שני רכבים. רכבים מסוגים שונים לעולם לא נארזים באותו היפודרום.</p>}</div>
        {selected && <><h3>סנכרון בין כל זוג סמוך</h3><div className="v09-relation-editors">{relations.map((relation, index) => <label key={index}><span>{selected.entities[index].typeName} ↔ {selected.entities[index + 1].typeName}</span><select value={relation} onChange={(event) => changeRelation(index, event.target.value as SoRelation)}>{relationOptions(selected, index).map((option) => <option key={option} value={option}>{SO_RELATION_LABELS[option]}</option>)}</select></label>)}</div></>}
      </>}
      <button type="button" className="v09-primary-button" onClick={saveTemplate}><Save />שמור תבנית</button>
    </div><div className="v09-preview-column"><p className="eyebrow">Preview אידיאלי · משתנה מיידית</p>{family === "SI" ? <TemplatePreviewSI types={types} items={siItems} angles={siAngles} /> : <TemplatePreviewSO layout={selected} relations={relations} />}<div className="v09-preview-note">צבע המסלול והאייקון = סוג רכב. פוליגון קבוצה אינו חלק מתבנית.</div></div></div>
  </div>;
}
