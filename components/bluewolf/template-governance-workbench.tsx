"use client";

import { useMemo, useState } from "react";
import { CircleDot, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SO_RELATION_LABELS,
  canonicalTemplateKey,
  createId,
  relationCode,
  type Family,
  type RingRole,
  type SiPosition,
  type SoRelation,
  type SoRouteKind,
  type SyncTemplate,
  type VehicleType,
} from "@/lib/bluewolf";
import {
  deriveSiPairRules,
  describeSiMix,
  placeSiVehicle,
  removeSiVehicle,
  validateSiPositions,
} from "@/lib/si-direct-placement";
import { useWorkspace } from "./app-context";
import { TemplatePreview } from "./visuals";

const RINGS: { id: RingRole; label: string; radius: number }[] = [
  { id: "inner", label: "פנימית", radius: 86 },
  { id: "middle", label: "ביניים", radius: 142 },
  { id: "outer", label: "חיצונית", radius: 198 },
];
const ANGLES = Array.from({ length: 12 }, (_, index) => index * 30);

function polar(angleDeg: number, radius: number) {
  const angle = (angleDeg - 90) * Math.PI / 180;
  return { x: 250 + Math.cos(angle) * radius, y: 250 + Math.sin(angle) * radius };
}

function countLabel(counts: Record<string, number>, vehicleTypes: VehicleType[]) {
  return vehicleTypes
    .map((type) => `${type.name}×${counts[type.id] ?? 0}`)
    .filter((entry) => !entry.endsWith("×0"))
    .join(" · ") || "ללא רכבים";
}

function countItems(counts: Record<string, number>, vehicleTypes: VehicleType[]) {
  return vehicleTypes.flatMap((type) => Array.from({ length: counts[type.id] ?? 0 }, () => type));
}

function ringLabel(ring: RingRole) {
  return RINGS.find((item) => item.id === ring)?.label ?? ring;
}

export function TemplateGovernanceWorkbench() {
  const { state, save } = useWorkspace();
  const [family, setFamily] = useState<Family>("SI");
  const [name, setName] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState(state.vehicleTypes[0]?.id ?? "");
  const [siPositions, setSiPositions] = useState<SiPosition[]>([]);
  const [singleCounts, setSingleCounts] = useState<Record<string, number>>({});
  const [doubleCounts, setDoubleCounts] = useState<Record<string, number>>({});
  const [chain, setChain] = useState<SoRouteKind[]>(["single", "double", "single"]);
  const [relations, setRelations] = useState<SoRelation[]>(["opposite", "same"]);

  const selectedType = state.vehicleTypes.find((type) => type.id === selectedTypeId) ?? null;
  const typeById = useMemo(() => new Map(state.vehicleTypes.map((type) => [type.id, type])), [state.vehicleTypes]);
  const siPreviewTypes = siPositions.map((position) => typeById.get(position.typeId)).filter((type): type is VehicleType => Boolean(type));
  const siPairs = deriveSiPairRules(siPositions);
  const siValues = siPairs.map((pair) => pair.angle);
  const soValues = relations.map(relationCode);
  const soPreviewTypes = [...countItems(singleCounts, state.vehicleTypes), ...countItems(doubleCounts, state.vehicleTypes)];

  const clickSlot = (ring: RingRole, angleDeg: number) => {
    const occupiedIndex = siPositions.findIndex((position) => position.ring === ring && position.angleDeg === angleDeg);
    if (occupiedIndex >= 0) {
      setSiPositions(removeSiVehicle(siPositions, occupiedIndex));
      return;
    }
    if (!selectedType) {
      toast.error("בחר סוג רכב לפני הצבה");
      return;
    }
    const placed = placeSiVehicle(siPositions, selectedType, ring, angleDeg);
    if (!placed.ok) {
      const messages = {
        "invalid-angle": "מיקום SI חייב להיות בכפולות של 30°",
        "ring-not-allowed": `${selectedType.name} אינו מורשה בטבעת ${ringLabel(ring)}`,
        "slot-occupied": "המיקום כבר תפוס",
        "max-vehicles": "SI תומך בעד 5 רכבים בתבנית",
      } as const;
      toast.error(messages[placed.reason]);
      return;
    }
    setSiPositions(placed.positions);
  };

  const saveSi = async () => {
    const validation = validateSiPositions(siPositions, state.vehicleTypes);
    if (validation) {
      toast.error(validation);
      return;
    }
    const mix = describeSiMix(siPositions, state.vehicleTypes);
    const constellation = siPositions.map((position) => {
      const type = typeById.get(position.typeId);
      return `${type?.name ?? position.typeId}@${ringLabel(position.ring)}:${position.angleDeg}°`;
    }).join(" — ");
    const template: SyncTemplate = {
      id: createId("tpl-si"),
      family: "SI",
      name: name.trim() || `SI · ${siPositions.length} רכבים`,
      mix,
      constellation,
      law: "הצבה ישירה על טבעות SI ב־30°; siPositions הוא מקור האמת",
      values: siValues,
      siPairs,
      siPositions: siPositions.map((position) => ({ ...position })),
      isDefault: false,
      updatedAt: new Date().toISOString(),
    };
    if (state.templates.some((item) => canonicalTemplateKey(item) === canonicalTemplateKey(template))) {
      toast.warning("כבר קיימת תבנית SI שקולה בסיבוב/מראה");
      return;
    }
    const ok = await save({ ...state, templates: [...state.templates, template] }, "templates", "create-direct-si", template.name);
    if (ok) {
      setName("");
      setSiPositions([]);
    }
  };

  const saveSo = async () => {
    const totalVehicles = Object.values(singleCounts).reduce((sum, value) => sum + value, 0) + Object.values(doubleCounts).reduce((sum, value) => sum + value, 0);
    if (totalVehicles < 1) {
      toast.error("יש לבחור לפחות רכב אחד לתבנית SO");
      return;
    }
    if (chain.length < 1 || relations.length !== Math.max(0, chain.length - 1)) {
      toast.error("שרשרת SO ויחסי השכנות אינם עקביים");
      return;
    }
    const mix = `יחיד: ${countLabel(singleCounts, state.vehicleTypes)} · כפול: ${countLabel(doubleCounts, state.vehicleTypes)}`;
    const template: SyncTemplate = {
      id: createId("tpl-so"),
      family: "SO",
      name: name.trim() || "SO · שרשרת היפודרומים",
      mix,
      constellation: chain.map((kind) => kind === "double" ? "כפול" : "יחיד").join(" — "),
      law: "קצה משותף + יחס זהה/הפוך/מעורב בין שכנים",
      values: soValues,
      soSpec: { singleCounts, doubleCounts, chain, relations },
      isDefault: false,
      updatedAt: new Date().toISOString(),
    };
    if (state.templates.some((item) => canonicalTemplateKey(item) === canonicalTemplateKey(template))) {
      toast.warning("כבר קיימת תבנית SO שקולה");
      return;
    }
    const ok = await save({ ...state, templates: [...state.templates, template] }, "templates", "create-so", template.name);
    if (ok) setName("");
  };

  const saveTemplate = () => family === "SI" ? saveSi() : saveSo();

  return <section className="glass-panel" dir="rtl" data-requirements="BW-SYNC-001 BW-SYNC-002 BW-SYNC-003 BW-SYNC-004 BW-SYNC-005" data-testid="template-governance-workbench" style={{ padding: 18, marginBottom: 16 }}>
    <header className="developer-section-header" style={{ marginBottom: 16 }}>
      <div><p className="eyebrow">Template source of truth</p><h2>עורך תבניות SI / SO</h2><p>ב־SI אין מוני רכבים ואין הזנת זוויות pair-specific. בוחרים סוג רכב ולוחצים ישירות על אחת מ־12 הנקודות בשלוש הטבעות; חוקי הזוגות נגזרים אוטומטית מהמיקומים.</p></div>
      <div className="header-actions"><Badge variant="outline">{state.templates.length} תבניות</Badge></div>
    </header>

    <div className="segmented-control v04-family-switch" style={{ marginBottom: 14 }}>
      <button type="button" className={family === "SI" ? "active" : ""} onClick={() => setFamily("SI")}>SI · הצבה ישירה</button>
      <button type="button" className={family === "SO" ? "active" : ""} onClick={() => setFamily("SO")}>SO</button>
    </div>

    <label style={{ display: "grid", gap: 6, marginBottom: 14 }}><span>שם התבנית</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="שם קצר וברור" /></label>

    {family === "SI" ? <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1.2fr) minmax(260px, .8fr)", gap: 18, alignItems: "start" }}>
      <div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }} data-testid="si-vehicle-palette">
          {state.vehicleTypes.map((type) => <button type="button" key={type.id} data-testid={`si-palette-${type.id}`} onClick={() => setSelectedTypeId(type.id)} aria-pressed={selectedTypeId === type.id} style={{ border: selectedTypeId === type.id ? "2px solid currentColor" : "1px solid currentColor", borderRadius: 10, padding: "8px 10px", background: "transparent", opacity: selectedTypeId === type.id ? 1 : .7 }}><strong>{type.name}</strong><small style={{ display: "block" }}>{type.siRoles.map(ringLabel).join(" / ") || "ללא טבעת"}</small></button>)}
        </div>
        <svg viewBox="0 0 500 500" data-testid="si-direct-ring-board" aria-label="SI direct placement board with three rings and 30 degree slots" style={{ width: "100%", maxWidth: 560, aspectRatio: "1", border: "1px solid currentColor", borderRadius: 16 }}>
          <circle cx="250" cy="250" r="6" fill="currentColor" opacity=".45" />
          {RINGS.map((ring) => <g key={ring.id}>
            <circle cx="250" cy="250" r={ring.radius} fill="none" stroke="currentColor" strokeWidth="2" opacity=".32" />
            <text x="250" y={250 - ring.radius + 16} textAnchor="middle" fill="currentColor" fontSize="12" opacity=".7">{ring.label}</text>
            {ANGLES.map((angleDeg) => {
              const point = polar(angleDeg, ring.radius);
              const occupiedIndex = siPositions.findIndex((position) => position.ring === ring.id && position.angleDeg === angleDeg);
              const occupied = occupiedIndex >= 0 ? siPositions[occupiedIndex] : null;
              const occupiedType = occupied ? typeById.get(occupied.typeId) : null;
              const allowed = Boolean(selectedType?.siRoles.includes(ring.id));
              return <g key={`${ring.id}-${angleDeg}`} role="button" tabIndex={0} data-testid={`si-slot-${ring.id}-${angleDeg}`} aria-label={`${ring.label} ${angleDeg} degrees${occupiedType ? ` ${occupiedType.name}` : ""}`} onClick={() => clickSlot(ring.id, angleDeg)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); clickSlot(ring.id, angleDeg); } }} style={{ cursor: occupied || allowed ? "pointer" : "not-allowed" }}>
                <circle cx={point.x} cy={point.y} r={occupied ? 13 : 8} fill={occupied ? (occupiedType?.color ?? "currentColor") : "transparent"} stroke="currentColor" strokeWidth={occupied ? 2.5 : 1.3} opacity={occupied ? 1 : allowed ? .65 : .16} />
                {ring.id === "outer" && <text x={point.x} y={point.y - 13} textAnchor="middle" fill="currentColor" fontSize="9" opacity=".65">{angleDeg}°</text>}
                {occupiedType && <text x={point.x} y={point.y + 3} textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="700">{occupiedType.name.slice(0, 2)}</text>}
              </g>;
            })}
          </g>)}
        </svg>
        <p className="card-hint">לחיצה על נקודה ריקה מציבה את סוג הרכב הנבחר. לחיצה על נקודה תפוסה מסירה אותה. טבעת שאינה מורשית לסוג הרכב אינה ניתנת להצבה.</p>
      </div>
      <aside style={{ display: "grid", gap: 12 }}>
        <div><strong>מיקומים שנבחרו</strong><div style={{ display: "grid", gap: 6, marginTop: 8 }} data-testid="si-position-list">{siPositions.length ? siPositions.map((position, index) => <button type="button" key={`${position.typeId}-${position.ring}-${position.angleDeg}`} onClick={() => setSiPositions(removeSiVehicle(siPositions, index))} style={{ display: "flex", justifyContent: "space-between", gap: 10, border: "1px solid currentColor", borderRadius: 8, padding: 8, background: "transparent" }}><span>{typeById.get(position.typeId)?.name ?? position.typeId}</span><span>{ringLabel(position.ring)} · {position.angleDeg}° · הסר</span></button>) : <span className="card-hint">עדיין לא הוצבו רכבים.</span>}</div></div>
        <TemplatePreview family="SI" values={siValues} vehicleTypes={siPreviewTypes} siPositions={siPositions} />
        <div className="card-hint">מקור אמת: {siPositions.length} `siPositions`. קיימים {siPairs.length} זוגות נגזרים לתאימות לאחור בלבד.</div>
      </aside>
    </div> : <div style={{ display: "grid", gap: 16 }}>
      <div className="v04-so-counts">
        <article><h3>היפודרום יחיד · כמה מכל סוג</h3>{state.vehicleTypes.map((type) => <label key={type.id}><span>{type.name}</span><Select value={String(singleCounts[type.id] ?? 0)} onValueChange={(value) => setSingleCounts({ ...singleCounts, [type.id]: Number(value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[0,1,2,3,4].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select></label>)}</article>
        <article><h3>היפודרום כפול · כמה מכל סוג</h3>{state.vehicleTypes.map((type) => <label key={type.id}><span>{type.name}</span><Select value={String(doubleCounts[type.id] ?? 0)} onValueChange={(value) => setDoubleCounts({ ...doubleCounts, [type.id]: Number(value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[0,1,2,3,4].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select></label>)}</article>
      </div>
      <div><h3>מיקום יחסי בשרשרת</h3><div className="v04-chain-grid">{chain.map((kind, index) => <label key={index}><span>מיקום {index + 1}</span><Select value={kind} onValueChange={(value) => setChain(chain.map((item, itemIndex) => itemIndex === index ? value as SoRouteKind : item))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">יחיד</SelectItem><SelectItem value="double">כפול</SelectItem></SelectContent></Select></label>)}</div></div>
      <div><h3>יחס בין היפודרומים סמוכים</h3><div className="v04-pair-grid">{relations.map((relation, index) => <label key={index}><span>{index + 1} ↔ {index + 2}</span><Select value={relation} onValueChange={(value) => setRelations(relations.map((item, itemIndex) => itemIndex === index ? value as SoRelation : item))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(SO_RELATION_LABELS) as SoRelation[]).map((value) => <SelectItem key={value} value={value}>{SO_RELATION_LABELS[value]}</SelectItem>)}</SelectContent></Select></label>)}</div></div>
      <TemplatePreview family="SO" values={soValues} vehicleTypes={soPreviewTypes} soKinds={chain} />
    </div>}

    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><Button onClick={saveTemplate} data-testid="template-governance-save"><Save />שמור תבנית</Button></div>

    <section style={{ marginTop: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><div><p className="eyebrow">Template bank</p><h3>{state.templates.length} תבניות</h3></div><CircleDot /></div>
      <div className="v04-template-bank-grid">{state.templates.map((template) => <article key={template.id}><TemplatePreview family={template.family} values={template.values} siPositions={template.siPositions} compact vehicleTypes={state.vehicleTypes} soKinds={template.soSpec?.chain} /><div><strong>{template.name}</strong><p>{template.law}</p><small>{template.mix}</small></div><Button variant="ghost" size="icon-sm" disabled={template.isDefault} onClick={() => save({ ...state, templates: state.templates.filter((item) => item.id !== template.id) }, "templates", "delete", template.name)}><Trash2 /></Button></article>)}</div>
    </section>
  </section>;
}
