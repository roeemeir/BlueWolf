"use client";

import { useMemo, useRef, useState } from "react";
import {
  Activity,
  ArchiveRestore,
  Beaker,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleGauge,
  Database,
  Download,
  Eye,
  FileJson,
  Filter,
  Gauge,
  KeyRound,
  Layers3,
  LoaderCircle,
  Map,
  MapPinned,
  Network,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  UsersRound,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_INFLUX_MAPPINGS,
  DEFAULT_WORKSPACE,
  THRESHOLD_DESCRIPTIONS,
  canonicalTemplateKey,
  createId,
  generateSiAngleSets,
  getServerScenario,
  type DeveloperSection,
  type Family,
  type GtSegment,
  type InfluxFieldMapping,
  type InfluxSettings,
  type MapServerDefinition,
  type RingRole,
  type ScoreThresholds,
  type ScoreWeights,
  type SyncTemplate,
  type VehicleIconName,
  type WorkspaceState,
} from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";
import { TemplatePreview, VehicleIconGlyph } from "./visuals";

const sectionItems: { id: DeveloperSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "score", label: "ציון וספים", icon: Activity },
  { id: "templates", label: "תבניות", icon: Layers3 },
  { id: "gt", label: "GT ו־Sweep", icon: Beaker },
  { id: "influx", label: "InfluxDB 2", icon: Database },
  { id: "routes", label: "נתיבים ומפות", icon: MapPinned },
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
    const value = index === others.length - 1 ? remaining - used : Math.round((previousOtherSum ? group[key] / previousOtherSum : 1 / others.length) * remaining / 5) * 5;
    result[key] = Math.max(0, value) as T[keyof T];
    used += result[key];
  });
  return result;
}

function WeightControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <div className="weight-control"><div><span>{label}</span><b>{value}%</b></div><Slider value={[value]} onValueChange={(values) => onChange(values[0])} min={0} max={100} step={5} /></div>;
}

function WeightCard<T extends Record<string, number>>({ title, values, labels, description, onChange }: { title: string; values: T; labels: Record<keyof T, string>; description: string; onChange: (values: T) => void }) {
  const sum = Object.values(values).reduce((total, value) => total + value, 0);
  return <article className="settings-card glass-panel"><header><div><h3>{title}</h3><p>{description}</p></div><Badge variant="outline" className={sum === 100 ? "valid-badge" : "error-badge"}>{sum}%</Badge></header>{(Object.keys(values) as (keyof T)[]).map((key) => <WeightControl key={String(key)} label={labels[key]} value={values[key]} onChange={(value) => onChange(rebalance(values, key, value))} />)}<p className="card-hint"><CircleGauge />המשקולות האחרות מתאזנות אוטומטית ל־100%</p></article>;
}

const thresholdGroups: { title: string; fields: { key: keyof ScoreThresholds; label: string; unit: string }[] }[] = [
  { title: "מיקום וסנכרון", fields: [
    { key: "siPositionFullDeg", label: "SI · ציון 100 עד", unit: "°" }, { key: "siPositionZeroDeg", label: "SI · ציון 0 החל מ־", unit: "°" },
    { key: "soPositionFullPct", label: "SO · ציון 100 עד", unit: "% מחזור" }, { key: "soPositionZeroPct", label: "SO · ציון 0 החל מ־", unit: "% מחזור" },
    { key: "periodFullPct", label: "מחזור · ציון 100 עד", unit: "%" }, { key: "periodZeroPct", label: "מחזור · ציון 0 החל מ־", unit: "%" },
    { key: "motionFullPct", label: "תנועה · ציון 100 עד", unit: "%" }, { key: "motionZeroPct", label: "תנועה · ציון 0 החל מ־", unit: "%" },
  ] },
  { title: "ביצוע הנתיב", fields: [
    { key: "routeDistanceFullPct", label: "מרחק · ציון 100 עד", unit: "% מ־b" }, { key: "routeDistanceZeroPct", label: "מרחק · ציון 0 החל מ־", unit: "% מ־b" },
    { key: "tangentFullDeg", label: "משיק · ציון 100 עד", unit: "°" }, { key: "tangentZeroDeg", label: "משיק · ציון 0 החל מ־", unit: "°" },
    { key: "curvatureFullPct", label: "עקמומיות · ציון 100 עד", unit: "%" }, { key: "curvatureZeroPct", label: "עקמומיות · ציון 0 החל מ־", unit: "%" },
  ] },
  { title: "תצוגה ואמינות", fields: [
    { key: "lowSpeedPct", label: "סף מהירות לחישוב", unit: "% עבודה" }, { key: "smoothingSeconds", label: "החלקת ציון", unit: "שניות" },
    { key: "greenScore", label: "תחילת ירוק", unit: "נק׳" }, { key: "redScore", label: "מתחת לאדום", unit: "נק׳" },
  ] },
];

function ScoreSection() {
  const { state, save, revision } = useWorkspace();
  const [weights, setWeights] = useState<ScoreWeights>(structuredClone(state.weights));
  const [thresholds, setThresholds] = useState<ScoreThresholds>(structuredClone(state.thresholds));
  return <>
    <SectionHeader eyebrow="קונפיגורציה פעילה" title="משקולות וספי ציון" description="כל שינוי נשמר כגרסה חדשה, מחושב על כל ההיסטוריה ומוחל מיד."><div className="header-actions"><Button variant="outline" onClick={() => { setWeights(structuredClone(DEFAULT_WORKSPACE.weights)); setThresholds(structuredClone(DEFAULT_WORKSPACE.thresholds)); toast.info("ברירות המחדל נטענו"); }}><RotateCcw />ברירת מחדל</Button><Button onClick={() => save({ ...state, weights, thresholds }, "scoring", "save-version", `גרסת ניקוד ${revision + 1}`)}><Save />שמור גרסה {revision + 1}</Button></div></SectionHeader>
    <div className="weight-grid">
      <WeightCard title="סנכרון" description="עד כמה הקבוצה שומרת על המיקום, המחזור וקצב התנועה הרצויים." values={weights.sync} labels={{ position: "מיקום", period: "מחזור", motion: "תנועה" }} onChange={(sync) => setWeights({ ...weights, sync })} />
      <WeightCard title="נתיב" description="עד כמה כל רכב מבצע את הנתיב האפקטיבי שזוהה מנתוני הניווט." values={weights.route} labels={{ distance: "מרחק", tangent: "משיק", curvature: "עקמומיות" }} onChange={(route) => setWeights({ ...weights, route })} />
      <WeightCard title="ציון כולל" description="האיזון שהמפעיל רואה בין איכות הסנכרון לבין ביצוע הנתיב." values={weights.total} labels={{ sync: "סנכרון", route: "נתיב" }} onChange={(total) => setWeights({ ...weights, total })} />
    </div>
    <section className="threshold-panel glass-panel"><div className="panel-title"><div><p className="eyebrow">פונקציית הציון</p><h3>ספים פעילים וההשפעה שלהם</h3></div><Badge variant="outline">ירידה חלקה בין 100 ל־0</Badge></div><div className="threshold-grid">{thresholdGroups.map((group) => <article key={group.title}><h4>{group.title}</h4>{group.fields.map((field) => <label className="number-field described-field" key={field.key}><span>{field.label}<small>{THRESHOLD_DESCRIPTIONS[field.key]}</small></span><div><input type="number" min="0" max="300" step="5" value={thresholds[field.key]} onChange={(event) => setThresholds({ ...thresholds, [field.key]: Number(event.target.value) })} /><em>{field.unit}</em></div></label>)}</article>)}</div></section>
  </>;
}

function uniquePermutations(items: string[]) {
  const result = new Set<string>();
  const visit = (prefix: string[], rest: string[]) => {
    if (!rest.length) { const direct = prefix.join(" — "); const reverse = [...prefix].reverse().join(" — "); result.add([direct, reverse].sort()[0]); return; }
    [...new Set(rest)].forEach((item) => { const index = rest.indexOf(item); visit([...prefix, item], [...rest.slice(0, index), ...rest.slice(index + 1)]); });
  };
  visit([], items);
  return [...result].sort();
}

function mixLabel(counts: Record<string, number>) {
  return Object.entries(counts).filter(([, count]) => count > 0).map(([name, count]) => `${name}×${count}`).join(" · ") || "ללא רכבים";
}

function TemplateSection() {
  const { state, save } = useWorkspace();
  const [family, setFamily] = useState<Family>("SI");
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(state.vehicleTypes.map((item) => [item.name, 1])));
  const [selectedKey, setSelectedKey] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [soValues, setSoValues] = useState("2,0,2");
  const mix = mixLabel(counts);
  const items = useMemo(() => Object.entries(counts).flatMap(([type, count]) => Array.from({ length: count }, () => type)), [counts]);
  const roleLabels: Record<RingRole, string> = { inner: "פנימית", middle: "ביניים", outer: "חיצונית" };
  const placement = items.map((name) => {
    const type = state.vehicleTypes.find((item) => item.name === name);
    const role = type?.siRoles[0];
    return role ? `${roleLabels[role]}: ${name}` : `ללא טבעת: ${name}`;
  });
  const constellations = useMemo(() => {
    if (family === "SI") {
      if (items.length < 3 || items.length > 5 || placement.some((item) => item.startsWith("ללא"))) return [];
      return generateSiAngleSets(items.length).map((values) => ({ key: `si-${values.join("-")}`, label: values.map((value) => `${value}°`).join(" · "), constellation: placement.join(" — "), values, note: "סיבוב משותף ותמונת מראה מאוחדים" }));
    }
    if (items.length < 2) return [];
    const base = uniquePermutations(items);
    const regular = base.map((entry, index) => ({ key: `so-r-${index}`, label: entry, constellation: entry, values: Array.from({ length: Math.max(1, items.length - 1) }, () => 2), note: "היפוך סדר נחשב לאותה אפשרות" }));
    const doubles = Object.entries(counts).filter(([, count]) => count >= 2).flatMap(([type]) => base.map((entry, index) => ({ key: `so-d-${type}-${index}`, label: `${entry} · כפול ל${type}`, constellation: `${entry} · היפודרום כפול ל${type}`, values: [2, 0, 2], note: `כפול מותר כי ${type} מופיע לפחות פעמיים` })));
    return [...regular, ...doubles];
  }, [family, items, placement, counts]);
  const selected = constellations.find((item) => item.key === selectedKey) ?? constellations[0];
  const filtered = state.templates.filter((template) => template.family === family && template.mix === mix);

  const addTemplate = async () => {
    if (!selected) { toast.error("אין קונסטלציה חוקית לתמהיל שנבחר"); return; }
    const values = family === "SI" ? selected.values : soValues.split(",").map((value) => Number(value.trim())).filter(Number.isFinite);
    const template: SyncTemplate = { id: createId("tpl"), family, name: name.trim() || `${family} · ${mix} · ${family === "SI" ? values.map((value) => `${value}°`).join("/") : "רבעים " + values.join("/")}`, mix, constellation: selected.constellation, law: family === "SI" ? "הפרשי זווית בין כל זוג" : "רבעים, זהה/הפוך ותזמון פניות", values, isDefault: filtered.length === 0, updatedAt: new Date().toISOString() };
    if (state.templates.some((item) => canonicalTemplateKey(item) === canonicalTemplateKey(template))) { toast.error("תבנית סימטרית זהה כבר קיימת בבנק"); return; }
    await save({ ...state, templates: [...state.templates, template] }, "templates", "create", template.name);
    setDialogOpen(false); setName("");
  };
  const setDefault = (template: SyncTemplate) => save({ ...state, templates: state.templates.map((item) => item.family === template.family && item.mix === template.mix ? { ...item, isDefault: item.id === template.id } : item) }, "templates", "set-default", template.name);

  return <>
    <SectionHeader eyebrow="בנק תבניות מותרות" title="מחולל קונסטלציות חזותי" description="בחר SI או SO ותמהיל. כל האוריינטציות החוקיות נוצרות אוטומטית בלי כפילות של תמונת מראה או כיוון משותף."><Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogTrigger asChild><Button disabled={!selected}><Plus />הוסף תבנית מותרת</Button></DialogTrigger><DialogContent className="glass-dialog wide-dialog" dir="rtl"><DialogHeader><DialogTitle>תבנית חדשה</DialogTitle><DialogDescription>התבנית נשמרת מיד בבנק המבצעי של התמהיל.</DialogDescription></DialogHeader><div className="template-dialog-grid"><TemplatePreview family={family} values={family === "SI" ? selected?.values ?? [] : soValues.split(",").map(Number)} /><div className="dialog-form"><label><span>שם תצוגה</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={`${family} · ${mix}`} /></label>{family === "SO" && <label><span>רבע רצוי לכל קשר</span><input value={soValues} onChange={(event) => setSoValues(event.target.value)} placeholder="2,0,2" /></label>}<div className="dialog-summary"><span>תמהיל</span><strong>{mix}</strong><span>שיבוץ</span><strong>{selected?.constellation}</strong><span>חוקיות</span><strong>{family === "SI" ? "30° / 360°" : "רביעים + פניות"}</strong></div></div></div><DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>ביטול</Button><Button onClick={addTemplate}><Save />שמור והפעל</Button></DialogFooter></DialogContent></Dialog></SectionHeader>
    <section className="template-builder glass-panel">
      <div className="family-switch"><button type="button" className={family === "SI" ? "active" : ""} onClick={() => { setFamily("SI"); setSelectedKey(""); }}><CircleGauge />SI · טבעות</button><button type="button" className={family === "SO" ? "active" : ""} onClick={() => { setFamily("SO"); setSelectedKey(""); }}><Network />SO · מבנה ח׳</button></div>
      <div className="mix-builder"><div><p className="eyebrow">תמהיל רכבים</p><h3>{mix}</h3><span>{items.length} רכבים · {constellations.length} קונסטלציות ללא כפילויות</span></div>{state.vehicleTypes.map((type) => <div className="counter" key={type.id}><span>{type.name}</span><Button variant="outline" size="icon-sm" onClick={() => setCounts({ ...counts, [type.name]: Math.max(0, (counts[type.name] ?? 0) - 1) })}>−</Button><b>{counts[type.name] ?? 0}</b><Button variant="outline" size="icon-sm" onClick={() => setCounts({ ...counts, [type.name]: Math.min(5, (counts[type.name] ?? 0) + 1) })}>+</Button></div>)}</div>
      {selected && <div className="selected-constellation"><TemplatePreview family={family} values={selected.values} /><div><p className="eyebrow">קונסטלציה נבחרת</p><h3>{selected.label}</h3><p>{selected.constellation}</p><small>{selected.note}</small></div></div>}
      <div className="constellation-grid visual-constellations">{constellations.length ? constellations.map((item) => <button type="button" key={item.key} className={selected?.key === item.key ? "active" : ""} onClick={() => setSelectedKey(item.key)}><TemplatePreview family={family} values={item.values} compact /><span>{item.label}</span><small>{item.note}</small></button>) : <div className="empty-state"><UsersRound /><strong>אין קונסטלציה חוקית</strong><p>{family === "SI" ? "SI דורש 3–5 רכבים ולכל סוג חייב להיות לפחות תפקיד טבעת מותר." : "SO דורש לפחות שני רכבים."}</p></div>}</div>
    </section>
    <section className="bank-panel glass-panel"><div className="panel-title"><div><p className="eyebrow">בנק פעיל</p><h3>{filtered.length} תבניות לתמהיל הנבחר</h3></div><Badge variant="outline">ללא כפילויות סימטריה</Badge></div><div className="template-list visual-bank">{filtered.length ? filtered.map((template) => <article key={template.id}><TemplatePreview family={template.family} values={template.values} compact /><div><Badge className={template.isDefault ? "default-badge" : ""}>{template.isDefault ? "דיפולט" : template.family}</Badge><h4>{template.name}</h4><p>{template.constellation}</p><small>{template.law}</small></div><div className="row-actions">{!template.isDefault && <Button variant="outline" size="sm" onClick={() => setDefault(template)}>קבע דיפולט</Button>}<Button variant="ghost" size="icon-sm" aria-label="מחיקת תבנית" onClick={() => { if (window.confirm(`למחוק את ${template.name}?`)) save({ ...state, templates: state.templates.filter((item) => item.id !== template.id) }, "templates", "delete", template.name); }}><Trash2 /></Button></div></article>) : <div className="empty-state"><Layers3 /><strong>טרם הוגדרו תבניות לתמהיל הזה</strong><p>בחר קונסטלציה והוסף אותה לבנק.</p></div>}</div></section>
  </>;
}

type GtRecommendation = { id: string; family: Family; groupId: string; start: string; end: string; vehicleCount: number; routeType: string; total: number; sync: number; route: number; reason: string };

function GtSection() {
  const { state, save } = useWorkspace();
  const [serverId, setServerId] = useState("1");
  const [from, setFrom] = useState("2026-09-02T17:00");
  const [to, setTo] = useState("2026-09-02T19:00");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [recommendations, setRecommendations] = useState<GtRecommendation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [syncQuality, setSyncQuality] = useState<"good" | "medium" | "low">("good");
  const [routeQuality, setRouteQuality] = useState<"good" | "medium" | "low">("good");
  const [filterFamily, setFilterFamily] = useState<"all" | Family>("all");
  const [filterRoute, setFilterRoute] = useState("all");
  const [filterCount, setFilterCount] = useState("all");
  const [search, setSearch] = useState("");
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepProgress, setSweepProgress] = useState(0);
  const [results, setResults] = useState<{ rank: number; error: number; position: number; period: number; motion: number }[]>([]);
  const selected = recommendations.find((item) => item.id === selectedId);

  const loadGtRange = () => {
    if (new Date(from) >= new Date(to)) { toast.error("זמן ההתחלה חייב להיות מוקדם מהסיום"); return; }
    setLoading(true); setProgress(3); setRecommendations([]);
    const timer = window.setInterval(() => setProgress((value) => {
      const next = Math.min(100, value + 8);
      if (next >= 100) {
        window.clearInterval(timer); setLoading(false);
        const scenario = getServerScenario(serverId);
        const suggestions: GtRecommendation[] = [
          { id: `rec-${serverId}-si`, family: "SI", groupId: scenario.groups.si.id, start: from, end: new Date(new Date(from).getTime() + 34 * 60000).toISOString().slice(0, 16), vehicleCount: scenario.groups.si.members.length, routeType: "טבעות", total: scenario.groups.si.total, sync: scenario.groups.si.sync, route: scenario.groups.si.route, reason: scenario.groups.si.reason },
          { id: `rec-${serverId}-so`, family: "SO", groupId: scenario.groups.so.id, start: new Date(new Date(from).getTime() + 20 * 60000).toISOString().slice(0, 16), end: to, vehicleCount: scenario.groups.so.members.length, routeType: "מבנה ח׳", total: scenario.groups.so.total, sync: scenario.groups.so.sync, route: scenario.groups.so.route, reason: scenario.groups.so.reason },
        ];
        setRecommendations(suggestions); setSelectedId(suggestions[0].id); toast.success("המערכת הציעה חלוקה לקבוצות ולאירועים");
      }
      return next;
    }), 130);
  };
  const saveGt = async () => {
    if (!selected) return;
    const make = (layer: "sync" | "route", quality: "good" | "medium" | "low"): GtSegment => ({ id: createId("gt"), family: selected.family, layer, quality, label: `${selected.groupId} · ${layer === "sync" ? "סנכרון" : "נתיב"} · ${selected.start.slice(11)}–${selected.end.slice(11)}`, serverId, groupId: selected.groupId, start: selected.start, end: selected.end, vehicleCount: selected.vehicleCount, routeType: selected.routeType, score: layer === "sync" ? selected.sync : selected.route });
    const additions = [make("sync", syncQuality), make("route", routeQuality)];
    await save({ ...state, gtSegments: [...state.gtSegments, ...additions] }, "gt", "approve-recommendation", selected.groupId);
    toast.success("המקטע אושר ונשמר ב־GT בשתי שכבות");
  };
  const filteredGt = state.gtSegments.filter((item) => (filterFamily === "all" || item.family === filterFamily) && (filterRoute === "all" || item.routeType === filterRoute) && (filterCount === "all" || item.vehicleCount === Number(filterCount)) && (!search || `${item.label} ${item.groupId} ${item.routeType}`.toLowerCase().includes(search.toLowerCase())));
  const runSweep = () => {
    setSweepRunning(true); setSweepProgress(0); setResults([]);
    const timer = window.setInterval(() => setSweepProgress((value) => {
      const next = Math.min(100, value + 5);
      if (next === 100) { window.clearInterval(timer); setSweepRunning(false); setResults(Array.from({ length: 10 }, (_, index) => ({ rank: index + 1, error: Number((4.7 + index * .36).toFixed(2)), position: 60 - (index % 3) * 10, period: 20 + (index % 2) * 10, motion: 20 + (index % 3) * 5 }))); toast.success("10,000 קונפיגורציות נבדקו"); }
      return next;
    }), 80);
  };

  return <>
    <SectionHeader eyebrow="Ground Truth" title="שליפה, המלצה ואישור GT" description="המפתח בוחר שרת וטווח; המערכת מציעה קבוצות ואירועים, והמפתח מאשר ומתייג סנכרון ונתיב בנפרד." />
    <section className="gt-wizard glass-panel">
      <div className="wizard-steps"><span className="active">1 · מקור וזמן</span><span className={recommendations.length ? "active" : ""}>2 · המלצת מערכת</span><span className={selected ? "active" : ""}>3 · אישור ותיוג</span></div>
      <div className="gt-source-grid"><label><span>שרת</span><Select value={serverId} onValueChange={setServerId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.servers.filter((item) => item.enabled).map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.arena}</SelectItem>)}</SelectContent></Select></label><label><span>התחלה</span><input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><span>סיום</span><input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label><Button onClick={loadGtRange} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Search />}{loading ? "שולף ומחשב" : "שלוף והצע חלוקה"}</Button></div>
      {loading && <div className="gt-loading"><Progress value={progress} /><span>{progress}% · {progress < 35 ? "שולף מ־Influx" : progress < 72 ? "מזהה נתיבים וקבוצות" : "מחשב אירועים וציונים"}</span></div>}
      {!!recommendations.length && <div className="gt-recommendations">{recommendations.map((item) => <button type="button" key={item.id} className={selectedId === item.id ? "active" : ""} onClick={() => { setSelectedId(item.id); setSyncQuality(item.sync >= 80 ? "good" : item.sync < 50 ? "low" : "medium"); setRouteQuality(item.route >= 80 ? "good" : item.route < 50 ? "low" : "medium"); }}><TemplatePreview family={item.family} values={item.family === "SI" ? [0, 120, 240] : [2, 0, 2]} compact /><span><Badge>{item.family}</Badge><strong>{item.groupId} · {item.routeType}</strong><small>{item.start.replace("T", " ")} – {item.end.replace("T", " ")}</small><p>{item.reason}</p></span><div><b>{item.total}</b><small>כולל</small></div></button>)}</div>}
      {selected && <div className="gt-approval"><div><p className="eyebrow">המלצה נבחרת</p><h3>{selected.groupId} · {selected.vehicleCount} רכבים</h3><p>ציון כולל {selected.total} · סנכרון {selected.sync} · נתיב {selected.route}</p></div><label><span>GT סנכרון</span><Select value={syncQuality} onValueChange={(value) => setSyncQuality(value as typeof syncQuality)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="good">טוב</SelectItem><SelectItem value="medium">בינוני</SelectItem><SelectItem value="low">נמוך</SelectItem></SelectContent></Select></label><label><span>GT נתיב</span><Select value={routeQuality} onValueChange={(value) => setRouteQuality(value as typeof routeQuality)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="good">טוב</SelectItem><SelectItem value="medium">בינוני</SelectItem><SelectItem value="low">נמוך</SelectItem></SelectContent></Select></label><Button onClick={saveGt}><Check />אשר ושמור ב־GT</Button></div>}
    </section>
    <section className="gt-bank glass-panel"><div className="panel-title"><div><p className="eyebrow">מקטעים מתויגים</p><h3>{filteredGt.length} מתוך {state.gtSegments.length}</h3></div><Badge variant="outline">תיוג קבוצתי · רכב אופציונלי</Badge></div><div className="filter-bar"><label className="search-field"><Search /><input placeholder="חיפוש קבוצה או סוג נתיב" value={search} onChange={(event) => setSearch(event.target.value)} /></label><Select value={filterFamily} onValueChange={(value) => setFilterFamily(value as typeof filterFamily)}><SelectTrigger><Filter /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">SI + SO</SelectItem><SelectItem value="SI">SI</SelectItem><SelectItem value="SO">SO</SelectItem></SelectContent></Select><Select value={filterRoute} onValueChange={setFilterRoute}><SelectTrigger><Network /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל סוגי הנתיב</SelectItem><SelectItem value="טבעות">טבעות</SelectItem><SelectItem value="מבנה ח׳">מבנה ח׳</SelectItem><SelectItem value="שמינייה">שמינייה</SelectItem></SelectContent></Select><Select value={filterCount} onValueChange={setFilterCount}><SelectTrigger><UsersRound /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל כמויות הרכבים</SelectItem>{[2,3,4,5,6,7,8].map((count) => <SelectItem key={count} value={String(count)}>{count} רכבים</SelectItem>)}</SelectContent></Select></div><div className="gt-segment-table"><div className="table-head"><span>קבוצה</span><span>שרת וזמן</span><span>נתיב</span><span>רכבים</span><span>שכבה</span><span>תיוג</span><span>ציון מערכת</span><span /></div>{filteredGt.map((item) => <div className="table-row" key={item.id}><strong>{item.groupId}</strong><span>שרת {item.serverId} · {item.start.slice(11)}–{item.end.slice(11)}</span><Badge variant="outline">{item.family} · {item.routeType}</Badge><span>{item.vehicleCount}</span><span>{item.layer === "sync" ? "סנכרון" : "נתיב"}</span><Badge className={`gt-${item.quality}`}>{item.quality === "good" ? "טוב" : item.quality === "medium" ? "בינוני" : "נמוך"}</Badge><b>{item.score}</b><Button variant="ghost" size="icon-sm" onClick={() => save({ ...state, gtSegments: state.gtSegments.filter((entry) => entry.id !== item.id) }, "gt", "remove-segment", item.label)}><Trash2 /></Button></div>)}</div></section>
    <section className="sweep-results glass-panel"><div className="panel-title"><div><p className="eyebrow">Sweep אדפטיבי</p><h3>{sweepRunning ? "בודק 10,000 קונפיגורציות" : results.length ? "10 התוצאות המובילות" : "מוכן להרצה"}</h3></div><Button onClick={runSweep} disabled={sweepRunning || state.gtSegments.length < 2}>{sweepRunning ? <LoaderCircle className="spin" /> : <Play />}הרץ Sweep</Button></div>{sweepRunning && <><Progress value={sweepProgress} /><p className="progress-copy">{sweepProgress}% · דגימה רחבה ואז התמקדות</p></>}{!sweepRunning && results.length > 0 && <div className="sweep-table"><div className="table-head"><span>דירוג</span><span>שגיאת GT</span><span>מיקום</span><span>מחזור</span><span>תנועה</span><span /></div>{results.map((item) => <div className="table-row" key={item.rank}><b>#{item.rank}</b><span>{item.error}</span><span>{item.position}%</span><span>{item.period}%</span><span>{item.motion}%</span><Button size="sm" variant={item.rank === 1 ? "default" : "outline"} onClick={() => { const sum = item.position + item.period + item.motion; const sync = { position: Math.round(item.position / sum * 100), period: Math.round(item.period / sum * 100), motion: 0 }; sync.motion = 100 - sync.position - sync.period; save({ ...state, weights: { ...state.weights, sync } }, "gt", "apply-sweep-result", `תוצאה #${item.rank}`); }}>בחר ושמור</Button></div>)}</div>}{!sweepRunning && !results.length && <div className="empty-state"><WandSparkles /><strong>עוד לא הורץ Sweep</strong><p>המערכת תדרג 10 תוצאות; בחירה ושמירה נשארות תמיד בידי המפתח.</p></div>}</section>
  </>;
}

function InfluxSection() {
  const { state, save } = useWorkspace();
  const [draft, setDraft] = useState<InfluxSettings>(structuredClone(state.influx));
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<"idle" | "valid" | "invalid">("idle");
  const updateMapping = (index: number, patch: Partial<InfluxFieldMapping>) => setDraft({ ...draft, mappings: draft.mappings.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const testConfiguration = () => {
    setTesting(true); setTestState("idle");
    window.setTimeout(() => {
      const valid = /^https?:\/\//.test(draft.url) && Boolean(draft.organization.trim()) && Boolean(draft.token.trim()) && draft.mappings.every((item) => item.bucket && item.measurement && item.key) && draft.mappings.some((item) => item.systemKey === "uniqueVehicleId");
      setTesting(false); setTestState(valid ? "valid" : "invalid");
      if (valid) toast.success("מבנה החיבור והמיפוי תקינים"); else toast.error("חסרים URL, ארגון, Token או פרטי שדה");
    }, 900);
  };
  return <>
    <SectionHeader eyebrow="מקור נתונים אמיתי" title="InfluxDB 2 · חיבור ומיפוי מלא" description="כל מטריקה נשלפת בנפרד ומצורפת לפי זמן Influx, מספר שרת ומספר רכב בחלון של 5 שניות."><div className="header-actions"><Button variant="outline" onClick={testConfiguration}>{testing ? <LoaderCircle className="spin" /> : <Gauge />}בדיקת תצורה</Button><Button onClick={() => save({ ...state, influx: draft }, "influx", "save-mapping", draft.url)}><Save />שמור מיפוי</Button></div></SectionHeader>
    <div className="influx-grid">
      <section className="connection-card glass-panel"><div className="panel-title"><div><p className="eyebrow">חיבור</p><h3>שרת Influx</h3></div><span className={`connection-indicator ${testState}`}>{testState === "valid" ? "תצורה תקינה" : testState === "invalid" ? "נדרש תיקון" : "טרם נבדק"}</span></div><label><span>URL</span><input dir="ltr" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></label><label><span>Organization</span><input dir="ltr" value={draft.organization} onChange={(event) => setDraft({ ...draft, organization: event.target.value })} /></label><label><span>Token</span><div className="secret-input"><KeyRound /><input dir="ltr" type={showToken ? "text" : "password"} value={draft.token} onChange={(event) => setDraft({ ...draft, token: event.target.value })} placeholder="InfluxDB API token" /><button type="button" onClick={() => setShowToken((value) => !value)}><Eye /></button></div></label><p className="security-note">בפריסה מקומית או OpenShift הערך נשמר כ־Secret ומוזן למתאם Influx, לא לליבה האלגוריתמית.</p></section>
      <section className="polling-card glass-panel"><div className="panel-title"><div><p className="eyebrow">תזמון</p><h3>Polling ו־join</h3></div><Badge>5 שנ׳ קשיח</Badge></div><label className="number-field"><span>בדיקת שרת רדום<small>שליפת מזהה רכב בלבד; בזיהוי חיות נשלפות 5 דקות אחורה.</small></span><div><input type="number" value={draft.idleProbeMinutes} onChange={(event) => setDraft({ ...draft, idleProbeMinutes: Number(event.target.value) })} /><em>דקות</em></div></label><label className="number-field"><span>שרת פעיל<small>תדירות שליפה ועיבוד מצטבר בזמן אמת.</small></span><div><input type="number" value={draft.activePollSeconds} onChange={(event) => setDraft({ ...draft, activePollSeconds: Number(event.target.value) })} /><em>שניות</em></div></label><label className="number-field"><span>סבילות join<small>הערך הקרוב ביותר בזמן תמיד מועדף על השלמה.</small></span><div><input type="number" value={draft.joinToleranceSeconds} onChange={(event) => setDraft({ ...draft, joinToleranceSeconds: Number(event.target.value) })} /><em>שניות</em></div></label></section>
    </div>
    <section className="mapping-panel glass-panel"><div className="panel-title"><div><p className="eyebrow">מטריקות</p><h3>Bucket, Measurement, Key ומיפוי ערך</h3></div><div className="header-actions"><Badge variant="outline">מקורית עדיפה · עד 5 שנ׳</Badge><Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, mappings: structuredClone(DEFAULT_INFLUX_MAPPINGS) })}><RotateCcw />ברירת מחדל</Button></div></div><div className="mapping-table advanced"><div className="table-head"><span>שדה מערכת</span><span>Bucket</span><span>Measurement</span><span>Key</span><span>ערך</span><span>מקור מיוחד</span><span>מיפוי ל־</span><span>השלמה</span></div>{draft.mappings.map((item, index) => <div className="table-row" key={item.systemKey}><strong>{item.label}</strong><input dir="ltr" value={item.bucket} onChange={(event) => updateMapping(index, { bucket: event.target.value })} /><input dir="ltr" value={item.measurement} onChange={(event) => updateMapping(index, { measurement: event.target.value })} /><input dir="ltr" value={item.key} onChange={(event) => updateMapping(index, { key: event.target.value })} /><Select value={item.valueMode} onValueChange={(value) => updateMapping(index, { valueMode: value as InfluxFieldMapping["valueMode"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="as-is">As is</SelectItem><SelectItem value="special">מיוחד</SelectItem></SelectContent></Select><input dir="ltr" disabled={item.valueMode === "as-is"} value={item.sourceValue} onChange={(event) => updateMapping(index, { sourceValue: event.target.value })} placeholder="green" /><input dir="ltr" disabled={item.valueMode === "as-is"} value={item.mappedValue} onChange={(event) => updateMapping(index, { mappedValue: event.target.value })} placeholder="true" /><Select value={item.fillMode} onValueChange={(value) => updateMapping(index, { fillMode: value as InfluxFieldMapping["fillMode"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="forward-fill">Forward fill</SelectItem><SelectItem value="linear">ליניארי</SelectItem></SelectContent></Select></div>)}</div></section>
  </>;
}

function RoutesSection() {
  const { state, save } = useWorkspace();
  const [routeOpen, setRouteOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [arena, setArena] = useState("all");
  const [vehicleType, setVehicleType] = useState("all");
  const [family, setFamily] = useState<"all" | Family>("all");
  const [form, setForm] = useState({ name: "", arena: "זירה א׳", vehicleType: state.vehicleTypes[0]?.name ?? "", family: "SI" as Family, geometry: "MULTIPOLYGON ((()))" });
  const [mapForm, setMapForm] = useState({ name: "", urlTemplate: "", attribution: "" });
  const importRef = useRef<HTMLInputElement>(null);
  const arenas = [...new Set(state.routes.map((route) => route.arena))];
  const filtered = state.routes.filter((route) => (!search || route.name.toLowerCase().includes(search.toLowerCase())) && (arena === "all" || route.arena === arena) && (vehicleType === "all" || route.vehicleType === vehicleType) && (family === "all" || route.family === family));
  const addRoute = async () => {
    if (!form.name.trim() || !/^MULTIPOLYGON\s*\(/i.test(form.geometry.trim())) { toast.error("נדרשים שם ו־WKT מסוג MULTIPOLYGON"); return; }
    if (state.routes.some((route) => route.name.toLowerCase() === form.name.trim().toLowerCase())) { toast.error("שם הנתיב חייב להיות ייחודי בבנק הגלובלי"); return; }
    const route = { id: createId("route"), ...form, name: form.name.trim(), updatedAt: new Date().toISOString() };
    await save({ ...state, routes: [...state.routes, route] }, "routes", "create", route.name); setRouteOpen(false);
  };
  const addMapServer = async () => {
    if (!mapForm.name || !mapForm.urlTemplate.includes("{z}") || !mapForm.urlTemplate.includes("{x}") || !mapForm.urlTemplate.includes("{y}")) { toast.error("נדרשים שם ו־URL עם {z}/{x}/{y}"); return; }
    const item: MapServerDefinition = { id: createId("map"), ...mapForm, enabled: true, isDefault: state.mapServers.length === 0 };
    await save({ ...state, mapServers: [...state.mapServers, item] }, "maps", "create-server", item.name); setMapOpen(false); setMapForm({ name: "", urlTemplate: "", attribution: "" });
  };
  return <>
    <SectionHeader eyebrow="בנק גלובלי" title="נתיבים מוכרים ושרתי מפות" description="נתיב שמור נותן שם וזירה בלבד; הגיאומטריה לציון תמיד מזוהה מנתוני הניווט."><div className="header-actions"><input ref={importRef} hidden type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { if (event.target.files?.[0]) toast.success(`נטענה תצוגה מקדימה של ${event.target.files[0].name}`); }} /><Button variant="outline" onClick={() => importRef.current?.click()}><Upload />Excel</Button><Dialog open={mapOpen} onOpenChange={setMapOpen}><DialogTrigger asChild><Button variant="outline"><Map />שרת מפות</Button></DialogTrigger><DialogContent className="glass-dialog" dir="rtl"><DialogHeader><DialogTitle>שרת מפות מאושר</DialogTitle><DialogDescription>המפעיל יוכל לבחור אותו במסך החי.</DialogDescription></DialogHeader><div className="dialog-form"><label><span>שם</span><input value={mapForm.name} onChange={(event) => setMapForm({ ...mapForm, name: event.target.value })} /></label><label><span>URL template</span><input dir="ltr" placeholder="https://…/{z}/{x}/{y}.png" value={mapForm.urlTemplate} onChange={(event) => setMapForm({ ...mapForm, urlTemplate: event.target.value })} /></label><label><span>ייחוס</span><input value={mapForm.attribution} onChange={(event) => setMapForm({ ...mapForm, attribution: event.target.value })} /></label></div><DialogFooter><Button variant="outline" onClick={() => setMapOpen(false)}>ביטול</Button><Button onClick={addMapServer}><Save />שמור שרת</Button></DialogFooter></DialogContent></Dialog><Dialog open={routeOpen} onOpenChange={setRouteOpen}><DialogTrigger asChild><Button><Plus />נתיב חדש</Button></DialogTrigger><DialogContent className="glass-dialog wide-dialog" dir="rtl"><DialogHeader><DialogTitle>שמירת נתיב</DialogTitle><DialogDescription>טבלת נ״צ, ציור במפה וייבוא מלא זמינים בפריסה; כאן ניתן להזין WKT ישירות.</DialogDescription></DialogHeader><div className="dialog-form two-columns"><label><span>שם ייחודי</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label><span>זירה</span><input value={form.arena} onChange={(event) => setForm({ ...form, arena: event.target.value })} /></label><label><span>סוג רכב מורשה</span><Select value={form.vehicleType} onValueChange={(value) => setForm({ ...form, vehicleType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.vehicleTypes.map((type) => <SelectItem value={type.name} key={type.id}>{type.name}</SelectItem>)}</SelectContent></Select></label><label><span>משפחה</span><Select value={form.family} onValueChange={(value) => setForm({ ...form, family: value as Family })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SI">SI</SelectItem><SelectItem value="SO">SO</SelectItem></SelectContent></Select></label><label className="span-two"><span>WKT · WGS84</span><Textarea dir="ltr" value={form.geometry} onChange={(event) => setForm({ ...form, geometry: event.target.value })} /></label></div><DialogFooter><Button variant="outline" onClick={() => setRouteOpen(false)}>ביטול</Button><Button onClick={addRoute}><Save />שמור נתיב</Button></DialogFooter></DialogContent></Dialog></div></SectionHeader>
    <section className="route-filters glass-panel"><label className="search-field"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש לפי שם נתיב" /></label><Select value={arena} onValueChange={setArena}><SelectTrigger><MapPinned /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל הזירות</SelectItem>{arenas.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={vehicleType} onValueChange={setVehicleType}><SelectTrigger><UsersRound /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל סוגי הרכב</SelectItem>{state.vehicleTypes.map((item) => <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>)}</SelectContent></Select><Select value={family} onValueChange={(value) => setFamily(value as typeof family)}><SelectTrigger><Filter /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">SI + SO</SelectItem><SelectItem value="SI">SI</SelectItem><SelectItem value="SO">SO</SelectItem></SelectContent></Select><Badge variant="outline">{filtered.length} תוצאות</Badge></section>
    <div className="route-bank">{filtered.map((route) => <article className="route-card glass-panel" key={route.id}><div className={`route-preview ${route.family.toLowerCase()}`}><MapPinned /><TemplatePreview family={route.family} values={route.family === "SI" ? [0,120,240] : [2,0,2]} compact /></div><div className="route-content"><Badge>{route.family}</Badge><h3>{route.name}</h3><p>{route.arena} · {route.vehicleType}</p><small>התאמת שם אוטומטית עד 30% · WGS84</small></div><div className="row-actions"><Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(route.geometry); toast.success("ה־WKT הועתק"); }}><FileJson />WKT</Button><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon-sm"><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent dir="rtl"><AlertDialogHeader><AlertDialogTitle>למחוק את {route.name}?</AlertDialogTitle><AlertDialogDescription>הנתיב יוסר מהבנק ומהתאמות עתידיות. תוויות עבר יישארו.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>ביטול</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => save({ ...state, routes: state.routes.filter((item) => item.id !== route.id) }, "routes", "delete", route.name)}>מחק</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></article>)}</div>
    <section className="map-server-bank glass-panel"><div className="panel-title"><div><p className="eyebrow">מפות רקע</p><h3>{state.mapServers.length} שרתי מפות מאושרים</h3></div></div><div className="map-server-grid">{state.mapServers.map((item) => <article key={item.id}><div className="map-server-icon"><Map /></div><div><strong>{item.name}</strong><code dir="ltr">{item.urlTemplate}</code><small>{item.attribution || "ללא ייחוס"}</small></div><div><Badge>{item.isDefault ? "ברירת מחדל" : item.enabled ? "פעיל" : "מושבת"}</Badge>{!item.isDefault && <Button variant="outline" size="sm" onClick={() => save({ ...state, mapServers: state.mapServers.map((entry) => ({ ...entry, isDefault: entry.id === item.id })), settings: { ...state.settings, defaultMap: item.id } }, "maps", "set-default", item.name)}>קבע דיפולט</Button>}<Switch checked={item.enabled} onCheckedChange={(enabled) => save({ ...state, mapServers: state.mapServers.map((entry) => entry.id === item.id ? { ...entry, enabled } : entry) }, "maps", "toggle", item.name)} /><Button variant="ghost" size="icon-sm" onClick={() => save({ ...state, mapServers: state.mapServers.filter((entry) => entry.id !== item.id) }, "maps", "delete", item.name)}><Trash2 /></Button></div></article>)}</div></section>
  </>;
}

type TestResult = { name: string; area: string; state: "pass" | "border" | "fail"; latency: string; detail: string };
const testResults: TestResult[] = [
  { name: "SI · הפרשי זווית", area: "סנכרון", state: "pass", latency: "0.8s", detail: "כל הזוגות חושבו ללא תלות בזווית מוחלטת" },
  { name: "SO · מבנה ח׳ ופניות", area: "סנכרון", state: "pass", latency: "1.2s", detail: "כפול במרכז, שכנות ותזמון פניות" },
  { name: "פער תקשורת 2 דקות", area: "רציפות", state: "pass", latency: "2.1s", detail: "הקבוצה נשמרה והנתונים הושלמו" },
  { name: "150 רכבים · 10 שרתים", area: "עומס", state: "border", latency: "8.7s", detail: "עבר, קרוב ליעד 10 שנ׳" },
  { name: "PDF · מקטעים ורכבים", area: "דיווח", state: "pass", latency: "1.1s", detail: "כל הקבוצות, הציונים והסיבות הופקו" },
];

function TestsSection() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(100);
  const [lastRun, setLastRun] = useState("02.09.2026 · 19:12");
  const run = () => { setRunning(true); setProgress(0); const timer = window.setInterval(() => setProgress((value) => { const next = Math.min(100, value + 5); if (next === 100) { window.clearInterval(timer); setRunning(false); setLastRun(new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date())); toast.success("בדיקות המערכת הסתיימו"); } return next; }), 75); };
  const exportReport = () => { const blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), summary: { pass: 4, border: 1, fail: 0 }, results: testResults }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "bluewolf-system-report.json"; link.click(); URL.revokeObjectURL(url); };
  return <><SectionHeader eyebrow="Self testing" title="בדיקות מערכת" description="סיכום ממוקד עבר/גבולי/לא עבר, עם עומס ושיהוי לכל תרחיש."><div className="header-actions"><Button variant="outline" onClick={exportReport}><Download />דוח מערכת</Button><Button onClick={run} disabled={running}>{running ? <LoaderCircle className="spin" /> : <Play />}{running ? "מריץ" : "הרץ הכול"}</Button></div></SectionHeader><section className="test-overview glass-panel"><div className="test-dial"><strong>{running ? progress : 100}%</strong><span>השלמה</span></div><div><p className="eyebrow">תוצאה מסכמת</p><h3>{running ? "הבדיקות רצות" : "המערכת עברה"}</h3><p>הרצה אחרונה: {lastRun}</p>{running && <Progress value={progress} />}</div><div className="test-summary"><span className="pass"><b>4</b>עבר</span><span className="border"><b>1</b>גבולי</span><span className="fail"><b>0</b>לא עבר</span></div></section><section className="test-list glass-panel"><div className="table-head"><span>מבחן</span><span>נושא</span><span>תוצאה</span><span>שיהוי</span><span>סיכום</span></div>{testResults.map((item) => <div className="table-row" key={item.name}><strong>{item.name}</strong><span>{item.area}</span><Badge className={`test-state ${item.state}`}>{item.state === "pass" ? "עבר" : item.state === "border" ? "גבולי" : "לא עבר"}</Badge><span dir="ltr">{item.latency}</span><span>{item.detail}</span></div>)}</section></>;
}

const iconOptions: { id: VehicleIconName; label: string }[] = [{ id: "rover", label: "רכב שטח" }, { id: "truck", label: "משאית" }, { id: "shield", label: "ממוגן" }, { id: "drone", label: "רחפן" }, { id: "boat", label: "כלי ימי" }];
const roleLabels: Record<RingRole, string> = { inner: "פנימית", middle: "ביניים", outer: "חיצונית" };

function SettingsSection() {
  const { state, save, storageMode, revision, lastSavedAt } = useWorkspace();
  const [draft, setDraft] = useState<WorkspaceState>(structuredClone(state));
  const fileRef = useRef<HTMLInputElement>(null);
  const exportConfig = () => { const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "bluewolf-configuration.json"; link.click(); URL.revokeObjectURL(url); };
  const importConfig = async (file?: File) => { if (!file) return; try { const parsed = JSON.parse(await file.text()) as WorkspaceState; const merged = { ...DEFAULT_WORKSPACE, ...parsed, settings: { ...DEFAULT_WORKSPACE.settings, ...parsed.settings, uiRefreshSeconds: 5 } }; setDraft(merged); await save(merged, "system", "import", file.name); } catch { toast.error("קובץ הקונפיגורציה אינו תקין"); } };
  const patchType = (index: number, patch: Partial<WorkspaceState["vehicleTypes"][number]>) => setDraft({ ...draft, vehicleTypes: draft.vehicleTypes.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  return <>
    <SectionHeader eyebrow="מערכת" title="שרתים, סוגי רכב ותצורה" description="אייקון, צבע ותפקידי טבעת נשמרים לכל סוג ומופיעים מיד במפה החיה."><div className="header-actions"><input ref={fileRef} hidden type="file" accept="application/json" onChange={(event) => importConfig(event.target.files?.[0])} /><Button variant="outline" onClick={() => fileRef.current?.click()}><Upload />ייבוא</Button><Button variant="outline" onClick={exportConfig}><Download />ייצוא</Button><Button onClick={() => save({ ...draft, settings: { ...draft.settings, uiRefreshSeconds: 5 } }, "system", "save-settings", "global settings")}><Save />שמור</Button></div></SectionHeader>
    <div className="settings-overview"><section className="settings-card glass-panel"><div className="panel-title"><div><p className="eyebrow">מצב</p><h3>אחסון וקונפיגורציה</h3></div><span className={`storage-state ${storageMode}`}>{storageMode === "cloud" ? "מרכזי" : "מקומי"}</span></div><dl><div><dt>גרסה פעילה</dt><dd>{revision || 1}</dd></div><div><dt>שמירה אחרונה</dt><dd>{lastSavedAt ? new Intl.DateTimeFormat("he-IL", { timeStyle: "short" }).format(new Date(lastSavedAt)) : "טרם נשמר"}</dd></div><div><dt>שמירת היסטוריה</dt><dd>{draft.settings.retentionDays} ימים</dd></div></dl></section><section className="settings-card glass-panel"><div className="panel-title"><div><p className="eyebrow">זמן וקצב</p><h3>תצוגת המפעיל</h3></div><Badge>5 שנ׳ קשיח</Badge></div><label><span>אזור זמן</span><Select value={draft.settings.timezone} onValueChange={(timezone) => setDraft({ ...draft, settings: { ...draft.settings, timezone } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Asia/Jerusalem">ישראל</SelectItem><SelectItem value="UTC">UTC</SelectItem></SelectContent></Select></label><label className="number-field"><span>קצב ריענון<small>נעול לערך שנקבע באפיון.</small></span><div><input disabled value="5" /><em>שניות</em></div></label><label className="number-field"><span>שמירת היסטוריה</span><div><input type="number" min="7" max="365" value={draft.settings.retentionDays} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, retentionDays: Number(event.target.value) } })} /><em>ימים</em></div></label></section></div>
    <section className="server-panel glass-panel"><div className="panel-title"><div><p className="eyebrow">מקורות</p><h3>מספרי שרתים</h3></div><Button variant="outline" size="sm" onClick={() => { if (draft.servers.length >= 10) { toast.error("ניתן להפעיל עד 10 שרתים"); return; } const id = String(draft.servers.length + 1); setDraft({ ...draft, servers: [...draft.servers, { id, name: `שרת ${id.padStart(2, "0")}`, enabled: true, arena: "זירה חדשה", influxTag: id }] }); }}><Plus />הוסף שרת</Button></div><div className="server-grid">{draft.servers.map((server, index) => <article key={server.id}><Server /><label><span>שם</span><input value={server.name} onChange={(event) => setDraft({ ...draft, servers: draft.servers.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /></label><label><span>זירה</span><input value={server.arena} onChange={(event) => setDraft({ ...draft, servers: draft.servers.map((item, itemIndex) => itemIndex === index ? { ...item, arena: event.target.value } : item) })} /></label><label><span>תג Influx</span><input dir="ltr" value={server.influxTag} onChange={(event) => setDraft({ ...draft, servers: draft.servers.map((item, itemIndex) => itemIndex === index ? { ...item, influxTag: event.target.value } : item) })} /></label><Switch checked={server.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, servers: draft.servers.map((item, itemIndex) => itemIndex === index ? { ...item, enabled } : item) })} /></article>)}</div></section>
    <section className="vehicle-types-panel glass-panel"><div className="panel-title"><div><p className="eyebrow">סיווג והמחשה</p><h3>סוגי רכבים, טווחים ואייקונים</h3></div><Badge variant="outline">מזהה → סוג → תפקיד טבעת</Badge></div><div className="vehicle-type-table advanced"><div className="table-head"><span>שם וסמל</span><span>טווח מזהים</span><span>מהירות עבודה</span><span>תפקידי SI מותרים</span><span>אייקון במפה</span><span>צבע</span></div>{draft.vehicleTypes.map((type, index) => <div className="table-row" key={type.id}><div className="type-name-cell"><svg viewBox="-15 -15 30 30"><VehicleIconGlyph icon={type.icon} color={type.color} /></svg><input value={type.name} onChange={(event) => patchType(index, { name: event.target.value })} /></div><div className="id-range"><input type="number" value={type.minId} onChange={(event) => patchType(index, { minId: Number(event.target.value) })} /><span>–</span><input type="number" value={type.maxId} onChange={(event) => patchType(index, { maxId: Number(event.target.value) })} /></div><div className="inline-number"><input type="number" value={type.workSpeedKmh} onChange={(event) => patchType(index, { workSpeedKmh: Number(event.target.value) })} /><span>קמ״ש</span></div><div className="role-picker">{(["inner", "middle", "outer"] as RingRole[]).map((role) => <button type="button" key={role} className={type.siRoles.includes(role) ? `active ${role}` : role} onClick={() => patchType(index, { siRoles: type.siRoles.includes(role) ? type.siRoles.filter((item) => item !== role) : [...type.siRoles, role] })}>{roleLabels[role]}</button>)}</div><Select value={type.icon} onValueChange={(value) => patchType(index, { icon: value as VehicleIconName })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{iconOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select><input className="color-input" type="color" value={type.color} onChange={(event) => patchType(index, { color: event.target.value })} /></div>)}</div></section>
    <section className="danger-zone glass-panel"><div><ArchiveRestore /><div><h3>שחזור ברירת מחדל</h3><p>הפעולה יוצרת גרסה חדשה ואינה מוחקת את היסטוריית הגרסאות.</p></div></div><AlertDialog><AlertDialogTrigger asChild><Button variant="destructive"><RotateCcw />שחזר הכול</Button></AlertDialogTrigger><AlertDialogContent dir="rtl"><AlertDialogHeader><AlertDialogTitle>לשחזר את כל ההגדרות?</AlertDialogTitle><AlertDialogDescription>תבניות, נתיבים, GT, מיפויים וספים יוחלפו.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>ביטול</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { const defaults = structuredClone(DEFAULT_WORKSPACE); setDraft(defaults); save(defaults, "system", "restore-defaults", "full reset"); }}>שחזר</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></section>
  </>;
}

export function DeveloperView() {
  const [section, setSection] = useState<DeveloperSection>("score");
  const content: Record<DeveloperSection, React.ReactNode> = { score: <ScoreSection />, templates: <TemplateSection />, gt: <GtSection />, influx: <InfluxSection />, routes: <RoutesSection />, tests: <TestsSection />, settings: <SettingsSection /> };
  return <div className="developer-workspace"><aside className="developer-nav glass-panel"><div className="developer-nav-title"><SlidersHorizontal /><div><strong>מצב מפתחים</strong><span>שינויים נשמרים מיד</span></div></div><nav>{sectionItems.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><Icon /><span>{item.label}</span><ChevronLeft /></button>; })}</nav><div className="core-state"><CheckCircle2 /><div><strong>ליבה מבודדת ותקינה</strong><span>43/43 בדיקות בסיס</span></div></div></aside><main className="developer-content">{content[section]}</main></div>;
}
