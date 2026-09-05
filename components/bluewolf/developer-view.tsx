"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Beaker,
  Check,
  CheckCircle2,
  ChevronLeft,
  Database,
  Layers3,
  LoaderCircle,
  MapPinned,
  Pause,
  Play,
  Plus,
  Save,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_WORKSPACE,
  SI_ALLOWED_PAIR_ANGLES,
  SO_RELATION_LABELS,
  THRESHOLD_DESCRIPTIONS,
  canonicalTemplateKey,
  createId,
  getServerScenario,
  relationCode,
  type DeveloperSection,
  type Family,
  type GtSegment,
  type InfluxFieldMapping,
  type RingRole,
  type SavedRoute,
  type ScoreThresholds,
  type ScoreWeights,
  type SoRelation,
  type SoRouteKind,
  type SyncTemplate,
  type VehicleType,
} from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";
import { GtPlayback, RouteBankMap, TemplatePreview, VehicleIconGlyph } from "./visuals";

const sectionItems: { id: DeveloperSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "score", label: "ציון וספים", icon: Activity },
  { id: "templates", label: "תבניות", icon: Layers3 },
  { id: "gt", label: "GT ו־Sweep", icon: Beaker },
  { id: "influx", label: "InfluxDB 2", icon: Database },
  { id: "routes", label: "בנק נתיבים", icon: MapPinned },
  { id: "tests", label: "בדיקות מערכת", icon: ShieldCheck },
  { id: "settings", label: "הגדרות", icon: Settings2 },
];

function SectionHeader({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return <header className="developer-section-header glass-panel"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>{children}</header>;
}

function rebalance<T extends Record<string, number>>(group: T, changedKey: keyof T, nextValue: number): T {
  const keys = Object.keys(group) as (keyof T)[];
  const others = keys.filter((key) => key !== changedKey);
  const remaining = Math.max(0, 100 - nextValue);
  const previousOtherSum = others.reduce((sum, key) => sum + group[key], 0);
  const result = { ...group, [changedKey]: nextValue } as T;
  let used = 0;
  others.forEach((key, index) => {
    const value = index === others.length - 1 ? remaining - used : Math.round((previousOtherSum ? group[key] / previousOtherSum : 1 / Math.max(1, others.length)) * remaining / 5) * 5;
    result[key] = Math.max(0, value) as T[keyof T];
    used += result[key];
  });
  return result;
}

function WeightControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <div className="weight-control"><div><span>{label}</span><b>{value}%</b></div><Slider value={[value]} onValueChange={(values) => onChange(values[0])} min={0} max={100} step={5} /></div>;
}

function WeightCard<T extends Record<string, number>>({ title, values, labels, description, onChange }: { title: string; values: T; labels: Record<keyof T, string>; description: string; onChange: (values: T) => void }) {
  return <article className="settings-card glass-panel"><header><div><h3>{title}</h3><p>{description}</p></div><Badge variant="outline">100%</Badge></header>{(Object.keys(values) as (keyof T)[]).map((key) => <WeightControl key={String(key)} label={labels[key]} value={values[key]} onChange={(value) => onChange(rebalance(values, key, value))} />)}</article>;
}

const thresholdGroups: { title: string; fields: { key: keyof ScoreThresholds; label: string; unit: string; options: number[] }[] }[] = [
  { title: "מיקום וסנכרון", fields: [
    { key: "siPositionFullDeg", label: "SI · 100 עד", unit: "°", options: [5, 10, 15, 20] },
    { key: "siPositionZeroDeg", label: "SI · 0 החל מ־", unit: "°", options: [20, 30, 45, 60] },
    { key: "soPositionFullPct", label: "SO · 100 עד", unit: "% מחזור", options: [2, 5, 10, 15] },
    { key: "soPositionZeroPct", label: "SO · 0 החל מ־", unit: "% מחזור", options: [15, 20, 25, 30] },
    { key: "periodFullPct", label: "מחזור · 100 עד", unit: "%", options: [2, 5, 10, 15] },
    { key: "periodZeroPct", label: "מחזור · 0 החל מ־", unit: "%", options: [15, 20, 25, 30] },
    { key: "motionFullPct", label: "תנועה · 100 עד", unit: "%", options: [5, 10, 15, 20] },
    { key: "motionZeroPct", label: "תנועה · 0 החל מ־", unit: "%", options: [20, 30, 40, 50] },
  ] },
  { title: "ביצוע נתיב", fields: [
    { key: "routeDistanceFullPct", label: "מרחק · 100 עד", unit: "% מ־b", options: [2, 5, 10, 15] },
    { key: "routeDistanceZeroPct", label: "מרחק · 0 החל מ־", unit: "% מ־b", options: [20, 30, 40, 50] },
    { key: "tangentFullDeg", label: "משיק · 100 עד", unit: "°", options: [5, 10, 15, 20] },
    { key: "tangentZeroDeg", label: "משיק · 0 החל מ־", unit: "°", options: [30, 45, 60, 90] },
    { key: "curvatureFullPct", label: "עקמומיות · 100 עד", unit: "%", options: [5, 10, 20, 30] },
    { key: "curvatureZeroPct", label: "עקמומיות · 0 החל מ־", unit: "%", options: [50, 75, 100, 125] },
  ] },
  { title: "תצוגה ואמינות", fields: [
    { key: "lowSpeedPct", label: "סף מהירות", unit: "% עבודה", options: [10, 20, 30, 40, 50] },
    { key: "smoothingSeconds", label: "החלקה", unit: "שניות", options: [3, 5, 10, 15, 20, 30] },
    { key: "greenScore", label: "תחילת ירוק", unit: "נק׳", options: [70, 75, 80, 85, 90] },
    { key: "redScore", label: "מתחת לאדום", unit: "נק׳", options: [30, 40, 50, 60] },
  ] },
];

function ScoreSection() {
  const { state, save, revision } = useWorkspace();
  const [weights, setWeights] = useState<ScoreWeights>(structuredClone(state.weights));
  const [thresholds, setThresholds] = useState<ScoreThresholds>(structuredClone(state.thresholds));
  const [help, setHelp] = useState<string | null>(null);
  return <>
    <SectionHeader eyebrow="קונפיגורציה" title="משקולות וספים" description="כל סף נבחר מגריד מאושר. Membership מבני נשאר נפרד מהציון."><div className="header-actions"><Button variant="outline" onClick={() => { setWeights(structuredClone(DEFAULT_WORKSPACE.weights)); setThresholds(structuredClone(DEFAULT_WORKSPACE.thresholds)); }}>ברירת מחדל</Button><Button onClick={() => save({ ...state, weights, thresholds }, "scoring", "save-version", `v${revision + 1}`)}><Save />שמור גרסה</Button></div></SectionHeader>
    <div className="weight-grid"><WeightCard title="סנכרון" description="מיקום/פאזה 60%, מחזור 20%, תנועה 20% בבסיס." values={weights.sync} labels={{ position: "מיקום", period: "מחזור", motion: "תנועה" }} onChange={(sync) => setWeights({ ...weights, sync })} /><WeightCard title="נתיב" description="מרחק 15%, משיק 70%, עקמומיות 15% בבסיס." values={weights.route} labels={{ distance: "מרחק", tangent: "משיק", curvature: "עקמומיות" }} onChange={(route) => setWeights({ ...weights, route })} /><WeightCard title="כולל" description="Sync 75% מול Route 25% בבסיס." values={weights.total} labels={{ sync: "סנכרון", route: "נתיב" }} onChange={(total) => setWeights({ ...weights, total })} /></div>
    <section className="threshold-panel glass-panel"><div className="panel-title"><div><p className="eyebrow">Closed grid</p><h3>ספים מאושרים</h3></div><Badge variant="outline">ללא מספר חופשי</Badge></div><div className="v04-threshold-grid">{thresholdGroups.map((group) => <article key={group.title}><h4>{group.title}</h4>{group.fields.map((field) => <label key={field.key}><span>{field.label}<button type="button" className="v08-help-button" onClick={() => setHelp(help === field.key ? null : field.key)}>?</button>{help === field.key && <small className="v08-help-box">{THRESHOLD_DESCRIPTIONS[field.key]}<i className="v08-transfer-curve" /></small>}</span><Select value={String(thresholds[field.key])} onValueChange={(value) => setThresholds({ ...thresholds, [field.key]: Number(value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{field.options.map((value) => <SelectItem key={value} value={String(value)}>{value} {field.unit}</SelectItem>)}</SelectContent></Select></label>)}</article>)}</div></section>
  </>;
}

function countItems(counts: Record<string, number>, vehicleTypes: VehicleType[]) {
  return vehicleTypes.flatMap((type) => Array.from({ length: counts[type.id] ?? 0 }, () => type));
}

function countLabel(counts: Record<string, number>, vehicleTypes: VehicleType[]) {
  return vehicleTypes.map((type) => `${type.name}×${counts[type.id] ?? 0}`).filter((entry) => !entry.endsWith("×0")).join(" · ") || "ללא רכבים";
}

type SoEntity = { kind: "single" | "double" | "figure8"; vehicles: number };
type SoLayoutOption = { entities: SoEntity[]; relations: SoRelation[]; key: string };

function packEntities(kind: SoEntity["kind"], total: number): SoEntity[] {
  const cap = kind === "double" ? 4 : 2;
  const result: SoEntity[] = [];
  let remaining = total;
  while (remaining > 0) {
    const vehicles = Math.min(cap, remaining);
    result.push({ kind, vehicles });
    remaining -= vehicles;
  }
  return result;
}

function canonicalSoKey(entities: SoEntity[], relations: SoRelation[]) {
  const encode = (items: SoEntity[], rels: SoRelation[]) => `${items.map((item) => `${item.kind}:${item.vehicles}`).join("|")}#${rels.join("|")}`;
  const forward = encode(entities, relations);
  const reverse = encode([...entities].reverse(), [...relations].reverse());
  return forward < reverse ? forward : reverse;
}

function uniqueEntityPermutations(entities: SoEntity[], limit = 18) {
  const results: SoEntity[][] = [];
  const seen = new Set<string>();
  function visit(prefix: SoEntity[], remaining: SoEntity[]) {
    if (results.length >= limit) return;
    if (!remaining.length) {
      const key = canonicalSoKey(prefix, Array(Math.max(0, prefix.length - 1)).fill("same"));
      if (!seen.has(key)) { seen.add(key); results.push(prefix); }
      return;
    }
    remaining.forEach((entity, index) => visit([...prefix, entity], [...remaining.slice(0, index), ...remaining.slice(index + 1)]));
  }
  visit([], entities);
  return results;
}

function legalSoLayouts(singleTotal: number, doubleTotal: number, figureTotal: number): SoLayoutOption[] {
  const total = singleTotal + doubleTotal + figureTotal;
  if (total < 2) return [];
  const packed = [...packEntities("single", singleTotal), ...packEntities("double", doubleTotal), ...packEntities("figure8", figureTotal)];
  const output: SoLayoutOption[] = [];
  const keys = new Set<string>();
  for (const entities of uniqueEntityPermutations(packed)) {
    const baseRelations: SoRelation[] = Array.from({ length: Math.max(0, entities.length - 1) }, (_, index) => index % 2 ? "opposite" : "same");
    const candidates: SoRelation[][] = [baseRelations];
    baseRelations.forEach((_, index) => {
      if (entities[index]?.kind === "double" || entities[index + 1]?.kind === "double") {
        const mixed = [...baseRelations]; mixed[index] = "mixed"; candidates.push(mixed);
      }
    });
    for (const relations of candidates) {
      const key = canonicalSoKey(entities, relations);
      if (keys.has(key)) continue;
      keys.add(key);
      output.push({ entities, relations, key });
      if (output.length >= 16) return output;
    }
  }
  return output;
}

function TemplateSection() {
  const { state, save } = useWorkspace();
  const [family, setFamily] = useState<Family>("SI");
  const [name, setName] = useState("");
  const [siCounts, setSiCounts] = useState<Record<string, number>>({ storm: 1, lightning: 1, thunder: 1 });
  const [siAngles, setSiAngles] = useState<number[]>([120, 120]);
  const [singleCounts, setSingleCounts] = useState<Record<string, number>>({ storm: 1, lightning: 0, thunder: 0 });
  const [doubleCounts, setDoubleCounts] = useState<Record<string, number>>({ storm: 0, lightning: 2, thunder: 0 });
  const [figureCounts, setFigureCounts] = useState<Record<string, number>>({ storm: 0, lightning: 0, thunder: 0 });
  const [selectedLayoutKey, setSelectedLayoutKey] = useState<string>("");
  const [relationOverrides, setRelationOverrides] = useState<Record<string, SoRelation[]>>({});

  const siItems = countItems(siCounts, state.vehicleTypes).slice(0, 6);
  const sequentialValues = Array.from({ length: Math.max(0, siItems.length - 1) }, (_, index) => siAngles[index] ?? 120);
  const singleTotal = Object.values(singleCounts).reduce((sum, value) => sum + value, 0);
  const doubleTotal = Object.values(doubleCounts).reduce((sum, value) => sum + value, 0);
  const figureTotal = Object.values(figureCounts).reduce((sum, value) => sum + value, 0);
  const layouts = useMemo(() => legalSoLayouts(singleTotal, doubleTotal, figureTotal), [singleTotal, doubleTotal, figureTotal]);
  const selectedLayout = layouts.find((item) => item.key === selectedLayoutKey) ?? layouts[0];
  const selectedRelations = selectedLayout ? (relationOverrides[selectedLayout.key] ?? selectedLayout.relations) : [];
  const previewTypes = family === "SI" ? siItems : [...countItems(singleCounts, state.vehicleTypes), ...countItems(doubleCounts, state.vehicleTypes), ...countItems(figureCounts, state.vehicleTypes)];
  const previewKinds: SoRouteKind[] = selectedLayout?.entities.map((entity) => entity.kind === "figure8" ? "figure8" : entity.kind) ?? [];
  const previewValues = selectedRelations.map(relationCode);

  const setSiCount = (typeId: string, count: number) => {
    setSiCounts({ ...siCounts, [typeId]: count });
    const nextCount = Math.max(0, Math.min(6, Object.values({ ...siCounts, [typeId]: count }).reduce((sum, value) => sum + value, 0)) - 1);
    setSiAngles(Array.from({ length: nextCount }, (_, index) => siAngles[index] ?? 120));
  };

  const saveTemplate = async () => {
    if (family === "SI") {
      if (siItems.length < 2 || siItems.length > 6) { toast.error("SI דורש 2–6 רכבים"); return; }
      const template: SyncTemplate = {
        id: createId("tpl-si"), family: "SI", name: name || `SI · ${siItems.length} רכבים`,
        mix: countLabel(siCounts, state.vehicleTypes), constellation: siItems.map((item) => item.name).join(" — "),
        law: "שרשרת n−1 של 45° / 90° / 120°; התאמה עם common phase חופשי",
        values: sequentialValues,
        siPairs: sequentialValues.map((angle, index) => ({ first: index, second: index + 1, angle })),
        isDefault: false, updatedAt: new Date().toISOString(), vehicleCount: siItems.length,
      };
      await save({ ...state, templates: [...state.templates, template] }, "templates", "create", template.name);
      setName("");
      return;
    }
    if (!selectedLayout) { toast.error("SO דורש לפחות 2 רכבים ו־Layout חוקי"); return; }
    const template: SyncTemplate = {
      id: createId("tpl-so"), family: "SO", name: name || "SO · שרשרת ישויות",
      mix: `יחיד: ${countLabel(singleCounts, state.vehicleTypes)} · כפול: ${countLabel(doubleCounts, state.vehicleTypes)} · 8: ${countLabel(figureCounts, state.vehicleTypes)}`,
      constellation: selectedLayout.entities.map((entity) => `${entity.kind === "double" ? "כפול" : entity.kind === "figure8" ? "8" : "יחיד"}×${entity.vehicles}`).join(" — "),
      law: "קשר גיאומטרי + same/opposite/mixed בין ישויות סמוכות; mixed רק ליד Double",
      values: previewValues,
      soSpec: ({ singleCounts, doubleCounts, figure8Counts: figureCounts, chain: previewKinds, relations: selectedRelations } as unknown) as SyncTemplate["soSpec"],
      isDefault: false, updatedAt: new Date().toISOString(),
    };
    const signature = `${template.family}:${canonicalSoKey(selectedLayout.entities, selectedRelations)}:${template.mix}`;
    const duplicate = state.templates.some((item) => canonicalTemplateKey(item) === canonicalTemplateKey(template));
    if (duplicate) { toast.warning("כבר קיימת תבנית שקולה"); return; }
    await save({ ...state, templates: [...state.templates, template] }, "templates", "create", signature);
    setName("");
  };

  const relationOptions = (index: number): SoRelation[] => {
    if (!selectedLayout) return ["same", "opposite"];
    const left = selectedLayout.entities[index];
    const right = selectedLayout.entities[index + 1];
    return left?.kind === "double" || right?.kind === "double" ? ["same", "opposite", "mixed"] : ["same", "opposite"];
  };

  const updateRelation = (index: number, relation: SoRelation) => {
    if (!selectedLayout) return;
    const relations = selectedRelations.map((item, itemIndex) => itemIndex === index ? relation : item);
    setRelationOverrides((current) => ({ ...current, [selectedLayout.key]: relations }));
  };

  return <>
    <SectionHeader eyebrow="SRS · Templates" title="תבניות SI / SO" description="SI = n−1 יחסים עוקבים. SO = occupancy חוקי, ישויות רלוונטיות בלבד, ללא זווית גיאומטרית קשיחה." />
    <div className="v04-template-editor glass-panel"><div className="segmented-control v04-family-switch"><button type="button" className={family === "SI" ? "active" : ""} onClick={() => setFamily("SI")}>SI</button><button type="button" className={family === "SO" ? "active" : ""} onClick={() => setFamily("SO")}>SO</button></div><div className="v04-template-editor-body"><div className="v04-template-form"><label><span>שם התבנית</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="שם קצר וברור" /></label>
      {family === "SI" ? <><h3>הרכב רכבים</h3><div className="v04-count-grid">{state.vehicleTypes.map((type) => <label key={type.id}><span><i style={{ background: type.color }} />{type.name}</span><Select value={String(siCounts[type.id] ?? 0)} onValueChange={(value) => setSiCount(type.id, Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[0,1,2,3].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select></label>)}</div><h3>יחסים עוקבים · n−1</h3><div className="v04-pair-grid">{sequentialValues.map((angle, index) => <label key={index}><span>{siItems[index]?.name ?? `R${index + 1}`} → {siItems[index + 1]?.name ?? `R${index + 2}`}</span><Select value={String(angle)} onValueChange={(value) => setSiAngles(sequentialValues.map((item, itemIndex) => itemIndex === index ? Number(value) : item))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SI_ALLOWED_PAIR_ANGLES.map((value) => <SelectItem key={value} value={String(value)}>{value}°</SelectItem>)}</SelectContent></Select></label>)}</div></> : <>
        <div className="v04-so-counts"><article><h3>Single · סה״כ לפי סוג</h3>{state.vehicleTypes.map((type) => <label key={type.id}><span><i style={{ background: type.color }} />{type.name}</span><Select value={String(singleCounts[type.id] ?? 0)} onValueChange={(value) => setSingleCounts({ ...singleCounts, [type.id]: Number(value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[0,1,2,3,4,5,6].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select></label>)}</article><article><h3>Double · סה״כ לפי סוג</h3>{state.vehicleTypes.map((type) => <label key={type.id}><span><i style={{ background: type.color }} />{type.name}</span><Select value={String(doubleCounts[type.id] ?? 0)} onValueChange={(value) => setDoubleCounts({ ...doubleCounts, [type.id]: Number(value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[0,1,2,3,4,5,6,7,8].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select></label>)}</article><article><h3>Figure‑8 · סה״כ לפי סוג</h3>{state.vehicleTypes.map((type) => <label key={type.id}><span><i style={{ background: type.color }} />{type.name}</span><Select value={String(figureCounts[type.id] ?? 0)} onValueChange={(value) => setFigureCounts({ ...figureCounts, [type.id]: Number(value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[0,1,2,3,4].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select></label>)}</article></div>
        <h3>Layouts חוקיים · סימטריות כפולות מוסרות</h3><div className="v04-route-option-list">{layouts.length ? layouts.map((layout) => <button type="button" key={layout.key} className={(selectedLayout?.key === layout.key) ? "active" : ""} onClick={() => setSelectedLayoutKey(layout.key)}>{layout.entities.map((entity) => `${entity.kind === "double" ? "כפול" : entity.kind === "figure8" ? "8" : "יחיד"}×${entity.vehicles}`).join(" — ")}<small>{layout.relations.map((relation) => SO_RELATION_LABELS[relation]).join(" · ") || "ישות אחת"}</small></button>) : <p className="card-hint">בחר לפחות 2 רכבים. לכל Single עד 2, לכל Double עד 4, לכל Figure‑8 עד 2; הכמויות נארזות אוטומטית לישויות חוקיות.</p>}</div>
        {selectedLayout && <><h3>יחס בין ישויות סמוכות</h3><div className="v04-pair-grid">{selectedRelations.map((relation, index) => <label key={index}><span>{index + 1} ↔ {index + 2}</span><Select value={relation} onValueChange={(value) => updateRelation(index, value as SoRelation)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{relationOptions(index).map((value) => <SelectItem key={value} value={value}>{SO_RELATION_LABELS[value]}</SelectItem>)}</SelectContent></Select></label>)}</div></>}
      </>}
    </div><div className="v04-template-preview-pane"><p className="eyebrow">Preview אידיאלי</p><TemplatePreview family={family} values={family === "SI" ? sequentialValues : previewValues} vehicleTypes={previewTypes} soKinds={previewKinds} /><p>Template Preview: צבע = סוג רכב. Live: צבע = קבוצה. Double הוא נתיב רציף אחד.</p><Button onClick={saveTemplate}><Save />שמור תבנית</Button></div></div></div>
    <section className="v04-template-bank glass-panel"><div className="panel-title"><div><p className="eyebrow">בנק תבניות</p><h3>{state.templates.length} תבניות</h3></div><Badge variant="outline">ללא Arena</Badge></div><div className="v04-template-bank-grid">{state.templates.map((template) => <article key={template.id}><TemplatePreview family={template.family} values={template.values} compact vehicleTypes={state.vehicleTypes} soKinds={template.soSpec?.chain} /><div><strong>{template.name.replaceAll("חיוך", "שרשרת")}</strong><p>{template.law}</p><small>{template.mix}</small></div><Button variant="ghost" size="icon-sm" disabled={template.isDefault} onClick={() => save({ ...state, templates: state.templates.filter((item) => item.id !== template.id) }, "templates", "delete", template.name)}><Trash2 /></Button></article>)}</div></section>
  </>;
}

function GtSection() {
  const { state, save } = useWorkspace();
  const [serverId, setServerId] = useState("1");
  const [arena, setArena] = useState(state.arenas[0] ?? "זירה א׳");
  const [family, setFamily] = useState<Family>("SO");
  const [from, setFrom] = useState("2026-09-03T07:30");
  const [to, setTo] = useState("2026-09-03T08:30");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [timePct, setTimePct] = useState(36);
  const [clipStart, setClipStart] = useState(8);
  const [clipEnd, setClipEnd] = useState(92);
  const [syncJudgement, setSyncJudgement] = useState(82);
  const [routeJudgement, setRouteJudgement] = useState(88);
  const [routeWrong, setRouteWrong] = useState(false);
  const [correctedKind, setCorrectedKind] = useState<SoRouteKind | "compact">("double");
  const scenario = getServerScenario(serverId);
  const group = scenario.groups[family.toLowerCase() as "si" | "so"];
  const [participants, setParticipants] = useState<number[]>(group.members.map((member) => member.id));

  useEffect(() => { if (!playing) return; const timer = window.setInterval(() => setTimePct((value) => value >= clipEnd ? clipStart : value + 1), 90); return () => window.clearInterval(timer); }, [playing, clipStart, clipEnd]);

  const load = () => {
    setLoading(true); setProgress(5);
    const timer = window.setInterval(() => setProgress((value) => { const next = Math.min(100, value + 12); if (next >= 100) { window.clearInterval(timer); setLoading(false); setLoaded(true); setPlaying(true); } return next; }), 100);
  };

  const saveGt = async () => {
    if (participants.length < 2) { toast.error("GT קבוצתי דורש לפחות 2 משתתפים"); return; }
    const qualityFor = (value: number): GtSegment["quality"] => value >= 80 ? "good" : value < 50 ? "low" : "medium";
    const base = { family, serverId, groupId: group.id, start: from, end: to, vehicleCount: participants.length, routeType: routeWrong ? String(correctedKind) : (family === "SI" ? "compact" : "double"), label: `${group.id} · clip ${clipStart}%–${clipEnd}% · ${arena}` };
    const additions: GtSegment[] = [
      { ...base, id: createId("gt"), layer: "sync", quality: qualityFor(syncJudgement), score: syncJudgement },
      { ...base, id: createId("gt"), layer: "route", quality: qualityFor(routeJudgement), score: routeJudgement },
    ];
    await save({ ...state, gtSegments: [...state.gtSegments, ...additions] }, "gt", "approve", `${group.id} · ${participants.join(",")}`);
    toast.success("GT נשמר עם Clip, משתתפים ושני ציונים נפרדים");
  };

  return <>
    <SectionHeader eyebrow="Ground Truth" title="Playback, Clip ותיקון סיווג" description="GT הוא ראיית כיול: אותם נתונים, אותו זמן, משתתפים מפורשים, Sync ו־Route נפרדים." />
    <section className="v04-gt-source glass-panel"><div className="gt-source-grid"><label><span>שרת</span><Select value={serverId} onValueChange={(value) => { setServerId(value); const next = getServerScenario(value).groups[family.toLowerCase() as "si" | "so"]; setParticipants(next.members.map((member) => member.id)); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label><label><span>זירה · metadata</span><Select value={arena} onValueChange={setArena}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.arenas.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>משפחה</span><Select value={family} onValueChange={(value) => { const nextFamily = value as Family; setFamily(nextFamily); const next = getServerScenario(serverId).groups[nextFamily.toLowerCase() as "si" | "so"]; setParticipants(next.members.map((member) => member.id)); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SI">SI</SelectItem><SelectItem value="SO">SO</SelectItem></SelectContent></Select></label><label><span>התחלה</span><input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><span>סיום</span><input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label><Button onClick={load} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Search />}{loading ? "טוען" : "שלוף טווח"}</Button></div>{loading && <Progress value={progress} />}
      {loaded && <div className="v04-gt-review"><div className="v04-gt-player"><GtPlayback family={family} progress={timePct / 100} vehicleTypes={state.vehicleTypes} /><div className="v04-player-controls"><Button variant="outline" size="icon" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause /> : <Play />}</Button><Slider value={[timePct]} min={clipStart} max={clipEnd} step={1} onValueChange={(values) => setTimePct(values[0])} /><b>{timePct}%</b></div><div className="v08-clip-grid"><label><span>Clip start · {clipStart}%</span><Slider value={[clipStart]} min={0} max={Math.max(0, clipEnd - 5)} step={1} onValueChange={(values) => { setClipStart(values[0]); setTimePct(Math.max(values[0], timePct)); }} /></label><label><span>Clip end · {clipEnd}%</span><Slider value={[clipEnd]} min={Math.min(100, clipStart + 5)} max={100} step={1} onValueChange={(values) => { setClipEnd(values[0]); setTimePct(Math.min(values[0], timePct)); }} /></label></div></div>
        <aside><p className="eyebrow">GT judgement</p><h3>משתתפים</h3><div className="v08-participants">{group.members.map((member) => <button type="button" key={member.id} className={participants.includes(member.id) ? "active" : ""} onClick={() => setParticipants((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])}>{member.id}</button>)}</div><label><span>Sync סובייקטיבי · {syncJudgement}</span><Slider value={[syncJudgement]} min={0} max={100} step={1} onValueChange={(values) => setSyncJudgement(values[0])} /></label><label><span>Route סובייקטיבי · {routeJudgement}</span><Slider value={[routeJudgement]} min={0} max={100} step={1} onValueChange={(values) => setRouteJudgement(values[0])} /></label><label className="v08-checkbox"><Switch checked={routeWrong} onCheckedChange={setRouteWrong} />Route classified wrong</label>{routeWrong && <Select value={correctedKind} onValueChange={(value) => setCorrectedKind(value as typeof correctedKind)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="compact">SI compact</SelectItem><SelectItem value="single">SO single</SelectItem><SelectItem value="double">SO double</SelectItem><SelectItem value="figure8">SO figure‑8</SelectItem></SelectContent></Select>}<Button onClick={saveGt}><Check />אשר ושמור GT</Button></aside></div>}
    </section>
    <section className="gt-bank glass-panel"><div className="panel-title"><div><p className="eyebrow">בנק GT</p><h3>{state.gtSegments.length} תיוגים</h3></div><Badge variant="outline">Scenario bank</Badge></div><div className="v04-gt-table">{state.gtSegments.map((item) => <div key={item.id}><strong>{item.groupId}</strong><span>{item.family} · {item.routeType}</span><span>{item.start.slice(11)}–{item.end.slice(11)}</span><span>{item.layer === "sync" ? "Sync" : "Route"}</span><Badge>{item.quality}</Badge><b>{item.score}</b></div>)}</div></section>
  </>;
}

function InfluxSection() {
  const { state, save } = useWorkspace();
  const [url, setUrl] = useState(state.influx.url);
  const [organization, setOrganization] = useState(state.influx.organization);
  const [token, setToken] = useState(state.influx.token);
  const [mappings, setMappings] = useState<InfluxFieldMapping[]>(structuredClone(state.influx.mappings));
  const [connection, setConnection] = useState<{ state: "idle" | "testing" | "ok" | "bad"; text: string }>({ state: "idle", text: "לא נבדק" });
  const update = (index: number, patch: Partial<InfluxFieldMapping>) => setMappings(mappings.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const testConnection = async () => {
    setConnection({ state: "testing", text: "בודק Health/Auth אמיתי..." });
    try {
      const response = await fetch("/api/influx/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, organization, token }) });
      const body = await response.json() as { ok?: boolean; stage?: string; status?: number; error?: string; authenticated?: boolean };
      if (!response.ok || !body.ok) throw new Error(body.error ?? `${body.stage ?? "request"} ${body.status ?? response.status}`);
      setConnection({ state: "ok", text: body.authenticated ? "Health + authentication עברו" : "Health עבר; ללא Auth כי חסר Token/Organization" });
    } catch (error) {
      setConnection({ state: "bad", text: `החיבור נכשל: ${error instanceof Error ? error.message : "unknown"}` });
    }
  };
  return <>
    <SectionHeader eyebrow="Data adapter" title="InfluxDB 2" description="Bucket · Measurement · Key/Field · As-Is/Map Value · Fill לכל מטריקה."><div className="header-actions"><Button variant="outline" onClick={testConnection} disabled={connection.state === "testing"}>{connection.state === "testing" ? <LoaderCircle className="spin" /> : <Database />}בדיקת חיבור</Button><Button onClick={() => save({ ...state, influx: { ...state.influx, url, organization, token, mappings } }, "influx", "save", url)}><Save />שמור</Button></div></SectionHeader>
    <section className="v04-influx glass-panel"><div className="v04-connection-grid"><label><span>URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} /></label><label><span>Organization</span><input value={organization} onChange={(event) => setOrganization(event.target.value)} /></label><label><span>Token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} /></label></div><div className={`v08-connection-state ${connection.state}`}>{connection.text}</div><div className="v04-mapping-table"><div className="table-head"><span>Metric</span><span>Bucket</span><span>Measurement</span><span>Key/Field</span><span>Mode</span><span>Source → Target</span><span>Fill</span></div>{mappings.map((item, index) => <div className="table-row v08-mapping-row" key={item.systemKey}><strong>{item.label}</strong><input value={item.bucket} onChange={(event) => update(index, { bucket: event.target.value })} /><input value={item.measurement} onChange={(event) => update(index, { measurement: event.target.value })} /><input value={item.key} onChange={(event) => update(index, { key: event.target.value })} /><Select value={item.valueMode} onValueChange={(value) => update(index, { valueMode: value as InfluxFieldMapping["valueMode"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="as-is">As-Is</SelectItem><SelectItem value="special">Map Value</SelectItem></SelectContent></Select><input value={item.valueMode === "as-is" ? "—" : `${item.sourceValue} → ${item.mappedValue}`} onChange={(event) => { const [sourceValue, mappedValue] = event.target.value.split("→").map((value) => value.trim()); update(index, { sourceValue: sourceValue ?? "", mappedValue: mappedValue ?? "" }); }} disabled={item.valueMode === "as-is"} /><Select value={item.fillMode} onValueChange={(value) => update(index, { fillMode: value as InfluxFieldMapping["fillMode"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="linear">linear</SelectItem><SelectItem value="forward-fill">forward-fill</SelectItem></SelectContent></Select></div>)}</div></section>
  </>;
}

function RoutesSection() {
  const { state, save } = useWorkspace();
  const [family, setFamily] = useState<"all" | Family>("all");
  const [arena, setArena] = useState("all");
  const [vehicleType, setVehicleType] = useState("all");
  const [draftRoutes, setDraftRoutes] = useState<SavedRoute[]>(structuredClone(state.routes));
  const [selectedId, setSelectedId] = useState<string | null>(draftRoutes[0]?.id ?? null);
  const selected = draftRoutes.find((item) => item.id === selectedId);
  const filtered = draftRoutes.filter((route) => (family === "all" || route.family === family) && (arena === "all" || route.arena === arena) && (vehicleType === "all" || route.vehicleType === vehicleType));
  const patchSelected = (patch: Partial<SavedRoute>) => selected && setDraftRoutes(draftRoutes.map((item) => item.id === selected.id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item));
  const addRoute = () => { const route: SavedRoute = { id: createId("route"), name: "נתיב חדש", arena: state.arenas[0], vehicleType: state.vehicleTypes[0].name, family: "SO", geometry: "CLOSED_ROUTE", updatedAt: new Date().toISOString(), routeKind: "single", mapX: 50, mapY: 50, rotationDeg: 0, scalePct: 100 }; setDraftRoutes([...draftRoutes, route]); setSelectedId(route.id); };
  return <>
    <SectionHeader eyebrow="Route bank" title="בנק נתיבים" description="Route אחד = רשומה אחת. כל הנתיבים על מפה הנדסית אחת. Arena הוא metadata בלבד."><div className="header-actions"><Button variant="outline" onClick={addRoute}><Plus />נתיב</Button><Button onClick={() => save({ ...state, routes: draftRoutes }, "routes", "save-bank", `${draftRoutes.length} routes`)}><Save />שמור בנק</Button></div></SectionHeader>
    <section className="v04-route-bank glass-panel"><div className="filter-bar"><Select value={family} onValueChange={(value) => setFamily(value as "all" | Family)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">SI + SO</SelectItem><SelectItem value="SI">SI</SelectItem><SelectItem value="SO">SO</SelectItem></SelectContent></Select><Select value={arena} onValueChange={setArena}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל הזירות</SelectItem>{state.arenas.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={vehicleType} onValueChange={setVehicleType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל סוגי הרכב</SelectItem>{state.vehicleTypes.map((item) => <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>)}</SelectContent></Select><Badge variant="outline">{filtered.length} נתיבים</Badge></div><div className="v04-route-bank-layout"><RouteBankMap routes={filtered} vehicleTypes={state.vehicleTypes} selectedId={selectedId} onSelect={setSelectedId} onMove={(id, x, y) => setDraftRoutes(draftRoutes.map((route) => route.id === id ? { ...route, mapX: x, mapY: y } : route))} /><aside>{selected ? <><p className="eyebrow">עריכת Route</p><h3>{selected.name}</h3><label><span>שם</span><input value={selected.name} onChange={(event) => patchSelected({ name: event.target.value })} /></label><label><span>Arena · metadata</span><Select value={selected.arena} onValueChange={(value) => patchSelected({ arena: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.arenas.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>סוג רכב</span><Select value={selected.vehicleType} onValueChange={(value) => patchSelected({ vehicleType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.vehicleTypes.map((item) => <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>)}</SelectContent></Select></label><label><span>משפחה</span><Select value={selected.family} onValueChange={(value) => patchSelected({ family: value as Family })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SI">SI</SelectItem><SelectItem value="SO">SO</SelectItem></SelectContent></Select></label>{selected.family === "SO" && <label><span>סוג נתיב</span><Select value={selected.routeKind === "double" || selected.routeKind === "figure8" ? selected.routeKind : "single"} onValueChange={(value) => patchSelected({ routeKind: value as SoRouteKind })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">Single hippodrome</SelectItem><SelectItem value="double">Double hippodrome</SelectItem><SelectItem value="figure8">Figure‑8</SelectItem></SelectContent></Select></label>}<label><span>סיבוב · {selected.rotationDeg ?? 0}°</span><Slider value={[selected.rotationDeg ?? 0]} min={-180} max={180} step={5} onValueChange={(values) => patchSelected({ rotationDeg: values[0] })} /></label><label><span>Scale · {selected.scalePct ?? 100}%</span><Slider value={[selected.scalePct ?? 100]} min={60} max={160} step={5} onValueChange={(values) => patchSelected({ scalePct: values[0] })} /></label><p className="card-hint">גרור את Route על המפה. עריכת control-points חופשית תישמר במודל הגיאומטריה בגרסת ה־integration, ולא מסומנת כאן כ־PASS.</p><Button variant="destructive" onClick={() => { setDraftRoutes(draftRoutes.filter((item) => item.id !== selected.id)); setSelectedId(null); }}><Trash2 />מחק</Button></> : <div className="empty-state"><MapPinned /><strong>בחר נתיב על המפה</strong></div>}</aside></div></section>
  </>;
}

const qaCategories = [
  ["זיהוי נתיב", "SI / Single SO / Double רציף / Figure‑8 / FREE / spikes"],
  ["שיוך קבוצות", "Geometry + Period בלבד; SI center+rotation; SO endpoint+axis+period"],
  ["ציון סנכרון", "SI angles/ring law; SO phase/turn semantics; low reliability"],
  ["ציון נתיב", "distance / tangent / curvature / low speed"],
  ["Lifecycle", "60s candidate / 300s confirm / 120s revision / group hold / Events"],
  ["Latency / Load", "p95 server→UI <10s + day-duration replay"],
  ["Checkpoint / Replay", "batch equivalence / restore / overlap"],
];

function TestsSection() {
  return <>
    <SectionHeader eyebrow="Executable evidence" title="בדיקות מערכת לפי פונקציונליות" description="לא מציגים PASS מזויף. הכרטיסים הם Release Gates; PASS יגיע רק מריצת test runner בפועל."><Badge variant="outline">SRS Gate</Badge></SectionHeader>
    <div className="v04-qa-grid">{qaCategories.map(([title, detail]) => <article className="glass-panel" key={title}><header><ShieldCheck /><div><strong>{title}</strong><span>נדרש executable evidence</span></div><Badge variant="outline">NOT RUN</Badge></header><p>{detail}</p><footer><span>מקור: docs/BLUE_WOLF_SRS.md</span><span>אין hardcoded PASS</span></footer></article>)}</div>
    <section className="v04-qa-summary glass-panel"><div><p className="eyebrow">Release rule</p><h3>UI test button אינו בדיקה</h3><p>המערכת לא תחליף סטטוס ל־PASS באמצעות timeout. תוצאת QA תוצג כאן רק לאחר קריאת artifact/runner אמיתי.</p></div><Button variant="outline" onClick={() => toast.info("הרצה אמיתית מתבצעת ב־test runner של הפרויקט, לא בדמו בדפדפן") }><Play />הצג דרישות Runner</Button></section>
  </>;
}

function parseRanges(value: string) {
  return value.split(",").map((part) => part.trim()).filter(Boolean).flatMap((part) => {
    const [minRaw, maxRaw] = part.split(/[-–]/).map((item) => Number(item.trim()));
    const min = Number.isFinite(minRaw) ? minRaw : NaN;
    const max = Number.isFinite(maxRaw) ? (maxRaw ?? minRaw) : minRaw;
    return Number.isFinite(min) && Number.isFinite(max) ? [{ min: Math.min(min, max), max: Math.max(min, max) }] : [];
  });
}

function SettingsSection() {
  const { state, save } = useWorkspace();
  const [servers, setServers] = useState(structuredClone(state.servers));
  const [arenas, setArenas] = useState([...state.arenas]);
  const [newArena, setNewArena] = useState("");
  const [vehicleTypes, setVehicleTypes] = useState(structuredClone(state.vehicleTypes));
  const [mapServers, setMapServers] = useState(structuredClone(state.mapServers));
  const roleLabels: Record<RingRole, string> = { inner: "פנימית", middle: "ביניים", outer: "חיצונית" };
  return <>
    <SectionHeader eyebrow="System config" title="שרתים, מפות, Arena וסוגי רכב" description="Data servers, Map servers ו־Arena הם ישויות נפרדות. סוג רכב תומך במספר טווחי מזהים."><Button onClick={() => save({ ...state, servers, arenas, vehicleTypes, mapServers }, "settings", "save", "server-map-arena-decoupled")}><Save />שמור</Button></SectionHeader>
    <div className="v04-settings-grid"><section className="glass-panel"><h3><Server />שרתי נתונים</h3>{servers.map((server, index) => <div className="v04-setting-row" key={server.id}><Switch checked={server.enabled} onCheckedChange={(enabled) => setServers(servers.map((item, itemIndex) => itemIndex === index ? { ...item, enabled } : item))} /><input value={server.name} onChange={(event) => setServers(servers.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><small>ttag / Influx tag: {server.influxTag}</small></div>)}</section>
      <section className="glass-panel"><h3><MapPinned />Map sources</h3>{mapServers.map((map, index) => <div className="v08-map-source" key={map.id}><Switch checked={map.enabled} onCheckedChange={(enabled) => setMapServers(mapServers.map((item, itemIndex) => itemIndex === index ? { ...item, enabled } : item))} /><input value={map.name} onChange={(event) => setMapServers(mapServers.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><input value={map.urlTemplate} onChange={(event) => setMapServers(mapServers.map((item, itemIndex) => itemIndex === index ? { ...item, urlTemplate: event.target.value } : item))} /><small>Engineering / WMS / WMTS / own server · token נשמר רק בסביבת deployment מאובטחת</small></div>)}</section>
      <section className="glass-panel"><h3><MapPinned />Arena metadata</h3>{arenas.map((arena, index) => <div className="v04-setting-row" key={`${arena}-${index}`}><input value={arena} onChange={(event) => setArenas(arenas.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /><Button variant="ghost" size="icon-sm" onClick={() => setArenas(arenas.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></Button></div>)}<div className="v04-setting-row"><input value={newArena} onChange={(event) => setNewArena(event.target.value)} placeholder="Arena חדשה" /><Button variant="outline" onClick={() => { if (newArena.trim()) { setArenas([...arenas, newArena.trim()]); setNewArena(""); } }}><Plus /></Button></div></section>
      <section className="glass-panel"><h3><UsersRound />סוגי רכב וטווחים</h3>{vehicleTypes.map((type, index) => <div className="v04-vehicle-type-row v08-vehicle-type" key={type.id}><span className="v04-type-swatch" style={{ background: type.color }} /><svg viewBox="-15 -15 30 30"><VehicleIconGlyph icon={type.icon} color={type.color} /></svg><input value={type.name} onChange={(event) => setVehicleTypes(vehicleTypes.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><input defaultValue={(type.idRanges?.length ? type.idRanges : [{ min: type.minId, max: type.maxId }]).map((range) => `${range.min}–${range.max}`).join(", ")} onBlur={(event) => { const ranges = parseRanges(event.target.value); if (!ranges.length) { toast.error("טווח מזהים לא תקין"); return; } setVehicleTypes(vehicleTypes.map((item, itemIndex) => itemIndex === index ? { ...item, minId: ranges[0].min, maxId: ranges[0].max, idRanges: ranges } : item)); }} /><small>{type.siRoles.map((role) => roleLabels[role]).join(", ")}</small></div>)}</section>
    </div>
  </>;
}

export function DeveloperView() {
  const [section, setSection] = useState<DeveloperSection>("score");
  const content: Record<DeveloperSection, React.ReactNode> = {
    score: <ScoreSection />,
    templates: <TemplateSection />,
    gt: <GtSection />,
    influx: <InfluxSection />,
    routes: <RoutesSection />,
    tests: <TestsSection />,
    settings: <SettingsSection />,
  };
  return <div className="developer-workspace v04-developer"><aside className="developer-nav glass-panel"><div className="developer-nav-title"><SlidersHorizontal /><div><strong>מצב מפתחים</strong><span>v0.8 · SRS controlled</span></div></div><nav>{sectionItems.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><Icon /><span>{item.label}</span><ChevronLeft /></button>; })}</nav><div className="core-state"><CheckCircle2 /><div><strong>Release Gate</strong><span>PASS רק מעדות executable</span></div></div></aside><main className="developer-content">{content[section]}</main></div>;
}
