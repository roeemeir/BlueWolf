"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Minus, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createId,
  SI_ALLOWED_PAIR_ANGLES,
  type SoRelation,
  type SyncTemplate,
  type VehicleType,
} from "@/lib/bluewolf";
import { useWorkspace } from "../app-context";
import { doubleHippodromeLoop, hippodromeLoop, pointOnClosed, svgClosedPath } from "../v09/geometry";
import { fixedVehicleTypes } from "../v09/map";

type Direction = 1 | -1;
type SoKind = "single" | "double";
type Slot = { index: number; direction: Direction };
type SoEntity = { id: string; kind: SoKind; slots: Slot[] };

const SO_COLOR = "#5d6ff4";
const kindLabel = (kind: SoKind) => kind === "single" ? "היפודרום יחיד" : "היפודרום כפול";
const capacity = (kind: SoKind) => kind === "single" ? 2 : 4;
const stepWidth = (kind: SoKind) => kind === "single" ? 1 : 2;
const directionLabel = (direction: Direction) => direction === 1 ? "קדימה" : "הפוך";

function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (value: number) => void }) {
  return <div className="v09-stepper"><button type="button" aria-label="הפחת" onClick={() => onChange(Math.max(0, value - 1))}><Minus /></button><b>{value}</b><button type="button" aria-label="הוסף" onClick={() => onChange(Math.min(max, value + 1))}><Plus /></button></div>;
}

function singlePhase(slot: Slot) { return slot.index === 0 ? .125 : .625; }
function doublePhase(slot: Slot) { return ((slot.index % 4) + .5) / 4; }
function normalizedQuarter(entity: SoEntity) {
  const slot = entity.slots[0];
  if (!slot) return 0;
  if (entity.kind === "single") return slot.index === 0 ? 0 : 2;
  return slot.index % 4;
}

function relationBetween(left: SoEntity, right: SoEntity): SoRelation {
  const a = left.slots[0]; const b = right.slots[0];
  if (!a || !b) return "same";
  const phaseDelta = (normalizedQuarter(right) - normalizedQuarter(left) + 4) % 4;
  if (phaseDelta === 0) return a.direction === b.direction ? "same" : "opposite";
  if (phaseDelta === 2) return a.direction === b.direction ? "opposite" : "same";
  return "mixed";
}

function relationLabel(value: SoRelation) { return value === "same" ? "זהה" : value === "opposite" ? "הפוך" : "מעורב"; }

function entitySignature(entity: SoEntity) {
  if (entity.kind === "single") {
    // Exact physical leg is intentionally ignored for Single identity.
    const directions = entity.slots.map((slot) => slot.direction).sort((a, b) => a - b).join(",");
    return `S:${entity.slots.length}:${directions}`;
  }
  return `D:${entity.slots.map((slot) => `${slot.index}:${slot.direction}`).join(",")}`;
}

function canonicalSo(entities: SoEntity[]) { return entities.map(entitySignature).join("|"); }

function canonicalExisting(template: SyncTemplate) {
  const entities = template.soSpec?.entities ?? [];
  return entities.map((entity) => {
    const kind: SoKind = entity.kind === "double" ? "double" : "single";
    const parsed: Slot[] = entity.vehicleTypes.map((token, index) => {
      const match = /^slot:(\d+):dir:(-?1)$/.exec(token);
      return match ? { index: Number(match[1]), direction: Number(match[2]) as Direction } : { index, direction: 1 };
    }).slice(0, capacity(kind));
    return entitySignature({ id: "legacy", kind, slots: parsed });
  }).join("|");
}

function smileSteps(entities: SoEntity[]) {
  if (!entities.length) return [] as number[];
  const middle = Math.floor((entities.length - 1) / 2);
  const steps = Array(entities.length).fill(0) as number[];
  for (let index = middle + 1; index < entities.length; index += 1) steps[index] = steps[index - 1] + stepWidth(entities[index].kind);
  for (let index = middle - 1; index >= 0; index -= 1) steps[index] = steps[index + 1] - stepWidth(entities[index].kind);
  return steps;
}

function SoPreview({ entities }: { entities: SoEntity[] }) {
  if (!entities.length) return <div className="v09-empty-preview">הוסף היפודרום יחיד או כפול.</div>;
  const steps = smileSteps(entities);
  const maxStep = Math.max(1, ...steps.map((value) => Math.abs(value)));
  const scale = Math.min(112, 300 / maxStep);
  const centers = steps.map((step) => ({ x: 380 + step * scale, y: 155 + Math.abs(step) * 13 }));
  const paths = entities.map((entity, index) => {
    const angle = steps[index] * 20;
    return entity.kind === "double"
      ? doubleHippodromeLoop(centers[index], 20, 48, 52, 26, angle)
      : hippodromeLoop(centers[index], 25, 84, angle);
  });
  const relations = entities.slice(0, -1).map((entity, index) => relationBetween(entity, entities[index + 1]));

  return <svg className="v09-template-svg v10-smile-preview" viewBox="0 0 760 340" role="img" aria-label="תצוגת תבנית SO בצורת חיוך">
    <rect width="760" height="340" rx="18" />
    <path d="M70 115 Q380 310 690 115" className="v10-smile-guide" />
    {entities.map((entity, index) => <g key={entity.id}>
      <path d={svgClosedPath(paths[index])} fill="none" stroke={SO_COLOR} strokeWidth={entity.kind === "double" ? 5 : 4} />
      <text x={centers[index].x} y={centers[index].y + 86} textAnchor="middle" className="v10-route-label">{kindLabel(entity.kind)} · {steps[index] * 20}°</text>
      {entity.slots.map((slot) => {
        const phase = entity.kind === "single" ? singlePhase(slot) : doublePhase(slot);
        const point = pointOnClosed(paths[index], phase);
        const heading = point.heading + (slot.direction === -1 ? 180 : 0);
        return <g key={slot.index} transform={`translate(${point.x} ${point.y}) rotate(${heading})`} className="v10-slot-arrow">
          <circle r="11" fill="var(--map-card)" stroke={SO_COLOR} strokeWidth="2.5" />
          <path d="M0-14 7 9 0 5-7 9Z" fill={SO_COLOR} />
        </g>;
      })}
    </g>)}
    {relations.map((relation, index) => {
      const a = centers[index]; const b = centers[index + 1]; const x = (a.x + b.x) / 2; const y = Math.min(a.y, b.y) - 62;
      return <g key={index}><rect x={x - 34} y={y - 14} width="68" height="28" rx="14" className="v09-relation-bg" /><text x={x} y={y + 4} textAnchor="middle" className="v09-relation-text">{relationLabel(relation)}</text></g>;
    })}
    <text x="380" y="24" textAnchor="middle" className="v10-preview-rule">מרכז 0° · כל יחיד ±20° · כפול = שתי מדרגות</text>
  </svg>;
}

function TemplatePreviewSI({ items, angles }: { items: VehicleType[]; angles: number[] }) {
  const cumulative = [0]; angles.forEach((value) => cumulative.push((cumulative.at(-1) ?? 0) + value));
  const points = items.map((_, index) => { const a = (cumulative[index] - 90) * Math.PI / 180; const r = index % 2 ? 62 : 88; return { x: 210 + Math.cos(a) * r, y: 130 + Math.sin(a) * r }; });
  return <svg className="v09-template-svg" viewBox="0 0 420 270"><rect width="420" height="270" rx="18" /><circle cx="210" cy="130" r="88" className="v09-ring" /><circle cx="210" cy="130" r="62" className="v09-ring" />{points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="10" fill={items[index]?.color ?? SO_COLOR} />)}{angles.map((angle, index) => { const a = points[index]; const b = points[index + 1]; if (!a || !b) return null; return <text key={index} x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} textAnchor="middle">{angle}°</text>; })}</svg>;
}

export function V10TemplateBuilder() {
  const { state, save } = useWorkspace();
  const types = useMemo(() => fixedVehicleTypes(state.vehicleTypes), [state.vehicleTypes]);
  const [family, setFamily] = useState<"SI" | "SO">("SO");
  const [name, setName] = useState("");
  const [siCounts, setSiCounts] = useState<Record<string, number>>(() => Object.fromEntries(types.map((type) => [type.id, 1])));
  const [siAngles, setSiAngles] = useState<number[]>([120, 120]);
  const [entities, setEntities] = useState<SoEntity[]>([
    { id: createId("so-node"), kind: "single", slots: [{ index: 0, direction: 1 }] },
    { id: createId("so-node"), kind: "double", slots: [{ index: 0, direction: 1 }, { index: 2, direction: 1 }] },
    { id: createId("so-node"), kind: "single", slots: [{ index: 0, direction: 1 }] },
  ]);
  const [duplicate, setDuplicate] = useState<{ existing: SyncTemplate; candidate: SyncTemplate } | null>(null);

  const siItems = types.flatMap((type) => Array.from({ length: siCounts[type.id] ?? 0 }, () => type));
  const sequentialAngles = Array.from({ length: Math.max(0, siItems.length - 1) }, (_, index) => siAngles[index] ?? 120);
  const relations = entities.slice(0, -1).map((entity, index) => relationBetween(entity, entities[index + 1]));
  const totalVehicles = entities.reduce((sum, entity) => sum + entity.slots.length, 0);

  const addEntity = (kind: SoKind) => setEntities((current) => [...current, { id: createId("so-node"), kind, slots: [{ index: 0, direction: 1 }] }]);
  const patchCount = (id: string, value: number) => setEntities((current) => current.map((entity) => {
    if (entity.id !== id) return entity;
    const count = Math.min(capacity(entity.kind), Math.max(0, value));
    const slots = Array.from({ length: count }, (_, index) => entity.slots[index] ?? { index, direction: 1 as Direction }).map((slot, index) => ({ ...slot, index }));
    return { ...entity, slots };
  }));
  const flipDirection = (id: string, slotIndex: number) => setEntities((current) => current.map((entity) => entity.id === id ? { ...entity, slots: entity.slots.map((slot) => slot.index === slotIndex ? { ...slot, direction: (slot.direction === 1 ? -1 : 1) as Direction } : slot) } : entity));

  const buildTemplate = (): SyncTemplate | null => {
    if (!name.trim()) { toast.error("תן שם לתבנית"); return null; }
    if (family === "SI") {
      if (siItems.length < 2) { toast.error("SI דורש לפחות שני רכבים"); return null; }
      return { id: createId("tpl"), family: "SI", name: name.trim(), mix: types.map((type) => `${type.name}×${siCounts[type.id] ?? 0}`).filter((value) => !value.endsWith("×0")).join(" · "), constellation: siItems.map((type) => type.name).join(" — "), law: "n−1 sequential angles; free common phase", values: sequentialAngles, vehicleCount: siItems.length, siPairs: sequentialAngles.map((angle, index) => ({ first: index, second: index + 1, angle })), isDefault: false, updatedAt: new Date().toISOString() };
    }
    if (totalVehicles < 2 || entities.some((entity) => entity.slots.length === 0)) { toast.error("SO דורש לפחות שני רכבים ולפחות רכב אחד בכל חוליה"); return null; }
    return {
      id: createId("tpl"), family: "SO", name: name.trim(),
      mix: `${totalVehicles} רכבים · ללא תלות בסוג רכב`,
      constellation: entities.map((entity) => `${kindLabel(entity.kind)}×${entity.slots.length}`).join(" — "),
      law: "SO generic · smile 20°/step · Single=2 halves · Double=4 quarters · relation derived from slot+direction",
      values: relations.map((relation) => relation === "same" ? 0 : relation === "opposite" ? 2 : 1),
      soSpec: {
        singleCounts: { generic: entities.filter((entity) => entity.kind === "single").reduce((sum, entity) => sum + entity.slots.length, 0) },
        doubleCounts: { generic: entities.filter((entity) => entity.kind === "double").reduce((sum, entity) => sum + entity.slots.length, 0) },
        figure8Counts: { generic: 0 },
        chain: entities.map((entity) => entity.kind),
        relations,
        entities: entities.map((entity) => ({ kind: entity.kind, vehicleTypes: entity.slots.map((slot) => `slot:${slot.index}:dir:${slot.direction}`) })),
      },
      isDefault: false, updatedAt: new Date().toISOString(),
    };
  };

  const persist = async (candidate: SyncTemplate, replaceId?: string) => {
    const templates = replaceId ? state.templates.map((template) => template.id === replaceId ? { ...candidate, id: replaceId } : template) : [...state.templates, candidate];
    await save({ ...state, templates }, "templates", "create-v10", candidate.name);
    toast.success(replaceId ? "התבנית הזהה הוחלפה" : "התבנית נשמרה");
    setDuplicate(null); setName("");
  };

  const saveTemplate = async () => {
    const candidate = buildTemplate(); if (!candidate) return;
    if (candidate.family === "SO") {
      const key = canonicalSo(entities);
      const existing = state.templates.find((template) => template.family === "SO" && canonicalExisting(template) === key);
      if (existing) { setDuplicate({ existing, candidate }); return; }
    }
    await persist(candidate);
  };

  return <div className="v09-template-builder v10-template-builder">
    <header className="v09-section-header"><div><p className="eyebrow">SRS v1.2 · Template Builder</p><h2>מחולל תבניות</h2><p>ב־SO התבנית גנרית: אין סוגי רכב ואין גדלים אבסולוטיים. מיקום וכיוון בלבד.</p></div><div className="v09-family-switch"><button className={family === "SI" ? "active" : ""} onClick={() => setFamily("SI")}>SI</button><button className={family === "SO" ? "active" : ""} onClick={() => setFamily("SO")}>SO</button></div></header>
    <div className="v09-template-layout"><div className="v09-builder-controls"><label className="v09-field"><span>שם התבנית</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="שם קצר" /></label>
      {family === "SI" ? <><h3>כמות לפי סוג רכב</h3><div className="v09-type-steppers">{types.map((type) => <div key={type.id}><span><i style={{ background: type.color }} />{type.name}</span><Stepper value={siCounts[type.id] ?? 0} max={3} onChange={(value) => setSiCounts((current) => ({ ...current, [type.id]: value }))} /></div>)}</div><h3>זווית בין כל זוג עוקב</h3><div className="v09-angle-list">{sequentialAngles.map((angle, index) => <label key={index}><span>{siItems[index]?.name} → {siItems[index + 1]?.name}</span><select value={angle} onChange={(event) => { const next = [...siAngles]; next[index] = Number(event.target.value); setSiAngles(next); }}>{SI_ALLOWED_PAIR_ANGLES.map((value) => <option key={value} value={value}>{value}°</option>)}</select></label>)}</div></> : <>
        <div className="v10-so-toolbar"><button onClick={() => addEntity("single")}><Plus />הוסף יחיד</button><button onClick={() => addEntity("double")}><Plus />הוסף כפול</button><span>שמינייה שקולה ליחיד מבחינת חוק הסנכרון</span></div>
        <div className="v10-chain-editor">{entities.map((entity, entityIndex) => <article key={entity.id}><header><div><b>{entityIndex + 1}. {kindLabel(entity.kind)}</b><small>{entity.kind === "single" ? "2 חצאים · עד 2 רכבים" : "4 רבעים · עד 4 רכבים · שתי מדרגות"}</small></div><button aria-label="מחק חוליה" onClick={() => setEntities((current) => current.filter((item) => item.id !== entity.id))}><Trash2 /></button></header><div className="v10-entity-row"><span>מספר רכבים</span><Stepper value={entity.slots.length} max={capacity(entity.kind)} onChange={(value) => patchCount(entity.id, value)} /></div><div className="v10-slot-list">{entity.slots.map((slot) => <button type="button" key={slot.index} onClick={() => flipDirection(entity.id, slot.index)}><ArrowLeftRight /><span>{entity.kind === "single" ? `חצי ${slot.index + 1}` : `רבע ${slot.index + 1}`}</span><b>{directionLabel(slot.direction)}</b><RotateCcw /></button>)}</div></article>)}</div>
        <div className="v10-derived-relations"><h3>יחסי שכנים · נגזרים אוטומטית</h3>{relations.map((relation, index) => <span key={index}>{index + 1} ↔ {index + 2}: <b>{relationLabel(relation)}</b></span>)}</div>
      </>}
      {duplicate && <div className="v10-duplicate"><b>נמצאה תבנית זהה</b><p>{duplicate.existing.name}</p><small>{duplicate.existing.constellation}</small><div><button onClick={() => setDuplicate(null)}>ביטול</button><button className="primary" onClick={() => persist(duplicate.candidate, duplicate.existing.id)}>החלף קיימת</button></div></div>}
      <button type="button" className="v09-primary-button" onClick={saveTemplate}><Save />שמור תבנית</button>
    </div><div className="v09-preview-column"><p className="eyebrow">Preview אידיאלי · latest semantics</p>{family === "SI" ? <TemplatePreviewSI items={siItems} angles={sequentialAngles} /> : <SoPreview entities={entities} />}<div className="v09-preview-note">SO: צבע גנרי בלבד. הרכב והגודל האמיתי מתאימים את עצמם לתבנית בזמן שימוש.</div></div></div>
  </div>;
}
