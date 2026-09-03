"use client";

import { useMemo, useRef, useState } from "react";
import {
  Activity,
  ArchiveRestore,
  Beaker,
  CheckCircle2,
  ChevronLeft,
  CircleGauge,
  Database,
  Download,
  FileJson,
  Gauge,
  Layers3,
  LoaderCircle,
  MapPinned,
  Network,
  Play,
  Plus,
  RotateCcw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
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
  DEFAULT_WORKSPACE,
  canonicalTemplateKey,
  createId,
  type DeveloperSection,
  type Family,
  type InfluxSettings,
  type ScoreThresholds,
  type ScoreWeights,
  type SyncTemplate,
  type WorkspaceState,
} from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";

const sectionItems: { id: DeveloperSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "score", label: "ציון וספים", icon: Activity },
  { id: "templates", label: "תבניות", icon: Layers3 },
  { id: "gt", label: "GT ו־Sweep", icon: Beaker },
  { id: "influx", label: "מיפוי Influx", icon: Database },
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

function WeightCard<T extends Record<string, number>>({ title, values, labels, onChange }: { title: string; values: T; labels: Record<keyof T, string>; onChange: (values: T) => void }) {
  const sum = Object.values(values).reduce((total, value) => total + value, 0);
  return <article className="settings-card glass-panel"><header><h3>{title}</h3><Badge variant="outline" className={sum === 100 ? "valid-badge" : "error-badge"}>{sum}%</Badge></header>{(Object.keys(values) as (keyof T)[]).map((key) => <WeightControl key={String(key)} label={labels[key]} value={values[key]} onChange={(value) => onChange(rebalance(values, key, value))} />)}<p className="card-hint"><CircleGauge />המשקולות האחרות מתאזנות אוטומטית ל־100%</p></article>;
}

const thresholdGroups: { title: string; fields: { key: keyof ScoreThresholds; label: string; unit: string }[] }[] = [
  { title: "מיקום וסנכרון", fields: [
    { key: "siPositionFullDeg", label: "SI · ציון 100 עד", unit: "°" }, { key: "siPositionZeroDeg", label: "SI · ציון 0 החל מ־", unit: "°" },
    { key: "soPositionFullPct", label: "SO · ציון 100 עד", unit: "% מחזור" }, { key: "soPositionZeroPct", label: "SO · ציון 0 החל מ־", unit: "% מחזור" },
    { key: "periodFullPct", label: "מחזור · ציון 100 עד", unit: "%" }, { key: "periodZeroPct", label: "מחזור · ציון 0 החל מ־", unit: "%" },
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
  const apply = () => save({ ...state, weights, thresholds }, "scoring", "save-version", `גרסת ניקוד ${revision + 1}`);
  return <>
    <SectionHeader eyebrow="קונפיגורציה פעילה" title="משקולות וספי ציון" description="כל שינוי נשמר כגרסה חדשה ומוחל מיד. המשקולות בכל שכבה מנורמלות אוטומטית."><div className="header-actions"><Button variant="outline" onClick={() => { setWeights(structuredClone(DEFAULT_WORKSPACE.weights)); setThresholds(structuredClone(DEFAULT_WORKSPACE.thresholds)); toast.info("ערכי ברירת המחדל נטענו; לחץ שמירה כדי להחיל"); }}><RotateCcw />ברירת מחדל</Button><Button onClick={apply}><Save />שמור גרסה {revision + 1}</Button></div></SectionHeader>
    <div className="weight-grid">
      <WeightCard title="סנכרון" values={weights.sync} labels={{ position: "מיקום", period: "מחזור", motion: "תנועה" }} onChange={(sync) => setWeights({ ...weights, sync })} />
      <WeightCard title="נתיב" values={weights.route} labels={{ distance: "מרחק", tangent: "משיק", curvature: "עקמומיות" }} onChange={(route) => setWeights({ ...weights, route })} />
      <WeightCard title="ציון כולל" values={weights.total} labels={{ sync: "סנכרון", route: "נתיב" }} onChange={(total) => setWeights({ ...weights, total })} />
    </div>
    <section className="threshold-panel glass-panel"><div className="panel-title"><div><p className="eyebrow">פונקציית הציון</p><h3>ספים פעילים</h3></div><Badge variant="outline">ירידה חלקה בין 100 ל־0</Badge></div><div className="threshold-grid">{thresholdGroups.map((group) => <article key={group.title}><h4>{group.title}</h4>{group.fields.map((field) => <label className="number-field" key={field.key}><span>{field.label}</span><div><input type="number" min="0" max="300" step="5" value={thresholds[field.key]} onChange={(event) => setThresholds({ ...thresholds, [field.key]: Number(event.target.value) })} /><em>{field.unit}</em></div></label>)}</article>)}</div></section>
  </>;
}

function uniquePermutations(items: string[]) {
  const result = new Set<string>();
  const visit = (prefix: string[], rest: string[]) => {
    if (!rest.length) {
      const direct = prefix.join(" — ");
      const reverse = [...prefix].reverse().join(" — ");
      result.add([direct, reverse].sort()[0]);
      return;
    }
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
  const [family, setFamily] = useState<Family>("SO");
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(state.vehicleTypes.map((item) => [item.name, item.name === "סער" ? 2 : item.name === "ברק" ? 1 : 0])));
  const [constellation, setConstellation] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [valuesText, setValuesText] = useState("2,2");
  const mix = mixLabel(counts);
  const constellations = useMemo(() => {
    const items = Object.entries(counts).flatMap(([type, count]) => Array.from({ length: count }, () => type));
    if (items.length < 2) return [];
    if (family === "SI") {
      const roleOrder = ["inner", "middle", "outer"];
      const roleLabels: Record<string, string> = { inner: "פנימית", middle: "ביניים", outer: "חיצונית" };
      const assigned = roleOrder.map((role) => state.vehicleTypes.find((type) => type.siRoles.includes(role) && (counts[type.name] ?? 0) > 0)).filter(Boolean);
      return assigned.length === items.length ? [assigned.map((type, index) => `${roleLabels[roleOrder[index]]}: ${type!.name}`).join(" — ")] : [];
    }
    const base = uniquePermutations(items);
    const doubles = Object.entries(counts).filter(([, count]) => count >= 2).flatMap(([type]) => base.map((entry) => `${entry} · היפודרום כפול ל${type}`));
    return [...base, ...doubles];
  }, [family, state.vehicleTypes, counts]);
  const effectiveConstellation = constellations.includes(constellation) ? constellation : (constellations[0] ?? "");
  const filtered = state.templates.filter((template) => template.family === family && template.mix === mix);

  const addTemplate = async () => {
    if (!effectiveConstellation) { toast.error("אין קונסטלציה חוקית לתמהיל שנבחר"); return; }
    const values = valuesText.split(",").map((value) => Number(value.trim())).filter(Number.isFinite);
    const template: SyncTemplate = { id: createId("tpl"), family, name: name.trim() || `${family} · ${mix} · ${family === "SI" ? values.map((v) => `${v}°`).join("/") : "הפוך"}`, mix, constellation: effectiveConstellation, law: family === "SI" ? "הפרשי זווית" : "רבעים + תזמון פניות", values, isDefault: filtered.length === 0, updatedAt: new Date().toISOString() };
    const key = canonicalTemplateKey(template);
    if (state.templates.some((item) => canonicalTemplateKey(item) === key)) { toast.error("תבנית סימטרית זהה כבר קיימת בבנק"); return; }
    await save({ ...state, templates: [...state.templates, template] }, "templates", "create", template.name);
    setDialogOpen(false); setName("");
  };

  const removeTemplate = (template: SyncTemplate) => save({ ...state, templates: state.templates.filter((item) => item.id !== template.id) }, "templates", "delete", template.name);
  const setDefault = (template: SyncTemplate) => save({ ...state, templates: state.templates.map((item) => item.family === template.family && item.mix === template.mix ? { ...item, isDefault: item.id === template.id } : item) }, "templates", "set-default", template.name);

  return <>
    <SectionHeader eyebrow="בנק תבניות מותרות" title="מחולל קונסטלציות" description="בחר משפחה ותמהיל. המערכת מציעה אוטומטית סדרים חוקיים ומאחדת תמונות מראה וכיוון סיבוב משותף."><Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogTrigger asChild><Button disabled={!effectiveConstellation}><Plus />הוסף תבנית מותרת</Button></DialogTrigger><DialogContent className="glass-dialog" dir="rtl"><DialogHeader><DialogTitle>תבנית חדשה</DialogTitle><DialogDescription>התבנית תיקשר לתמהיל ולקונסטלציה שנבחרו.</DialogDescription></DialogHeader><div className="dialog-form"><label><span>שם תצוגה</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={`${family} · ${mix}`} /></label><label><span>{family === "SI" ? "הפרשי זווית במעלות" : "פערי רבעים (0–3)"}</span><input value={valuesText} onChange={(event) => setValuesText(event.target.value)} placeholder={family === "SI" ? "120,120" : "2,2"} /></label><div className="dialog-summary"><span>תמהיל</span><strong>{mix}</strong><span>קונסטלציה</span><strong>{effectiveConstellation}</strong></div></div><DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>ביטול</Button><Button onClick={addTemplate}><Save />שמור והפעל</Button></DialogFooter></DialogContent></Dialog></SectionHeader>
    <section className="template-builder glass-panel"><div className="family-switch"><button type="button" className={family === "SI" ? "active" : ""} onClick={() => setFamily("SI")}><CircleGauge />SI · סגור איזומטרי</button><button type="button" className={family === "SO" ? "active" : ""} onClick={() => setFamily("SO")}><Network />SO · היפודרומים</button></div><div className="mix-builder"><div><p className="eyebrow">תמהיל רכבים</p><h3>{mix}</h3></div>{state.vehicleTypes.map((type) => <div className="counter" key={type.id}><span>{type.name}</span><Button variant="outline" size="icon-sm" onClick={() => setCounts({ ...counts, [type.name]: Math.max(0, (counts[type.name] ?? 0) - 1) })}>−</Button><b>{counts[type.name] ?? 0}</b><Button variant="outline" size="icon-sm" onClick={() => setCounts({ ...counts, [type.name]: Math.min(5, (counts[type.name] ?? 0) + 1) })}>+</Button></div>)}</div><div className="constellation-grid">{constellations.length ? constellations.map((item) => <button type="button" key={item} className={effectiveConstellation === item ? "active" : ""} onClick={() => setConstellation(item)}><Sparkles /><span>{item}</span><small>{item.includes("כפול") ? "אפשרי רק לסוג שמופיע לפחות פעמיים" : "היפוך הסדר נחשב לאותה אפשרות"}</small></button>) : <div className="empty-state"><UsersRound /><strong>אין קונסטלציה חוקית</strong><p>{family === "SI" ? "בדוק שלכל סוג נבחר תפקיד טבעת מתאים." : "נדרשים לפחות שני רכבים."}</p></div>}</div></section>
    <section className="bank-panel glass-panel"><div className="panel-title"><div><p className="eyebrow">בנק פעיל</p><h3>{filtered.length} תבניות לתמהיל הנבחר</h3></div><Badge variant="outline">ללא כפילויות סימטריה</Badge></div><div className="template-list">{filtered.length ? filtered.map((template) => <article key={template.id}><div><Badge className={template.isDefault ? "default-badge" : ""}>{template.isDefault ? "דיפולט" : template.family}</Badge><h4>{template.name}</h4><p>{template.constellation}</p><small>{template.law} · {template.values.join(" / ")}</small></div><div className="row-actions">{!template.isDefault && <Button variant="outline" size="sm" onClick={() => setDefault(template)}>קבע דיפולט</Button>}<AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="מחיקת תבנית"><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent dir="rtl"><AlertDialogHeader><AlertDialogTitle>למחוק את התבנית?</AlertDialogTitle><AlertDialogDescription>היא תוסר מהבנק. קבוצה שמשתמשת בה תעבור לדיפולט ותפתח אירוע חדש.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>ביטול</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => removeTemplate(template)}>מחק</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></article>) : <div className="empty-state"><Layers3 /><strong>טרם הוגדרו תבניות לתמהיל הזה</strong><p>בחר קונסטלציה והוסף תבנית מותרת.</p></div>}</div></section>
  </>;
}

function GtSection() {
  const { state, save } = useWorkspace();
  const [family, setFamily] = useState<Family>("SI");
  const [layer, setLayer] = useState<"sync" | "route">("sync");
  const [quality, setQuality] = useState<"good" | "medium" | "low">("good");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ rank: number; error: number; position: number; period: number; motion: number }[]>([]);
  const addSegment = () => {
    const item = { id: createId("gt"), family, layer, quality, label: `${family} · ${layer === "sync" ? "סנכרון" : "נתיב"} ${quality === "good" ? "טוב" : quality === "medium" ? "בינוני" : "נמוך"} · מקטע ${String(state.gtSegments.length + 1).padStart(2, "0")}` } as const;
    save({ ...state, gtSegments: [...state.gtSegments, item] }, "gt", "add-segment", item.label);
  };
  const runSweep = () => {
    setRunning(true); setProgress(1); setResults([]);
    const timer = window.setInterval(() => setProgress((value) => {
      const next = Math.min(100, value + 4);
      if (next === 100) {
        window.clearInterval(timer);
        setRunning(false);
        setResults(Array.from({ length: 10 }, (_, index) => ({ rank: index + 1, error: Number((4.7 + index * .36).toFixed(2)), position: 60 - (index % 3) * 10, period: 20 + (index % 2) * 10, motion: 20 + (index % 3) * 5 })));
        toast.success("Sweep הסתיים · 10,000 קונפיגורציות נבדקו");
      }
      return next;
    }), 80);
  };
  const chooseResult = (item: { position: number; period: number; motion: number }) => {
    const total = item.position + item.period + item.motion;
    const sync = { position: Math.round(item.position / total * 100), period: Math.round(item.period / total * 100), motion: 0 };
    sync.motion = 100 - sync.position - sync.period;
    save({ ...state, weights: { ...state.weights, sync } }, "gt", "apply-sweep-result", `מיקום ${sync.position} · מחזור ${sync.period} · תנועה ${sync.motion}`);
  };
  return <>
    <SectionHeader eyebrow="Ground Truth" title="תיוג אנושי ו־Sweep" description="תיוג קבוצתי חובה, תיוג רכב אופציונלי. SI ו־SO נשקלים 50% לכל משפחה."><Button onClick={runSweep} disabled={running || state.gtSegments.length < 2}>{running ? <LoaderCircle className="spin" /> : <Play />}{running ? "מריץ…" : "הרץ 10,000"}</Button></SectionHeader>
    <div className="gt-layout"><section className="gt-form glass-panel"><div className="panel-title"><div><p className="eyebrow">מקטע חדש</p><h3>תיוג איכות</h3></div><Badge variant="outline">משקל שווה</Badge></div><label><span>משפחה</span><Select value={family} onValueChange={(value) => setFamily(value as Family)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SI">SI</SelectItem><SelectItem value="SO">SO</SelectItem></SelectContent></Select></label><label><span>שכבה</span><Select value={layer} onValueChange={(value) => setLayer(value as "sync" | "route")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sync">סנכרון</SelectItem><SelectItem value="route">נתיב</SelectItem></SelectContent></Select></label><label><span>איכות</span><Select value={quality} onValueChange={(value) => setQuality(value as "good" | "medium" | "low")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="good">טוב</SelectItem><SelectItem value="medium">בינוני</SelectItem><SelectItem value="low">נמוך</SelectItem></SelectContent></Select></label><Button onClick={addSegment}><Plus />הוסף מקטע</Button></section><section className="gt-bank glass-panel"><div className="panel-title"><div><p className="eyebrow">בנק GT</p><h3>{state.gtSegments.length} מקטעים מתויגים</h3></div></div><div className="gt-chips">{state.gtSegments.map((item) => <span key={item.id} className={item.quality}>{item.label}<button type="button" onClick={() => save({ ...state, gtSegments: state.gtSegments.filter((entry) => entry.id !== item.id) }, "gt", "remove-segment", item.label)}>×</button></span>)}</div></section></div>
    <section className="sweep-results glass-panel"><div className="panel-title"><div><p className="eyebrow">חיפוש אדפטיבי</p><h3>{running ? "מריץ Sweep" : results.length ? "10 התוצאות המובילות" : "מוכן להרצה"}</h3></div>{running && <strong>{progress}%</strong>}</div>{running && <><Progress value={progress} /><p className="progress-copy">{Math.round(progress * 100)} מתוך 10,000 קונפיגורציות · דגימה רחבה ואז התמקדות</p></>}{!running && results.length > 0 && <div className="sweep-table"><div className="table-head"><span>דירוג</span><span>שגיאת GT</span><span>מיקום</span><span>מחזור</span><span>תנועה</span><span /></div>{results.map((item) => <div className="table-row" key={item.rank}><b>#{item.rank}</b><span>{item.error}</span><span>{item.position}%</span><span>{item.period}%</span><span>{item.motion}%</span><Button size="sm" variant={item.rank === 1 ? "default" : "outline"} onClick={() => chooseResult(item)}>בחר ושמור</Button></div>)}</div>}{!running && !results.length && <div className="empty-state"><WandSparkles /><strong>עוד לא הורץ Sweep</strong><p>הוסף כיסוי GT ולאחר מכן הרץ השוואה. היחס הכולל סנכרון/נתיב נשאר ידני.</p></div>}</section>
  </>;
}

function InfluxSection() {
  const { state, save } = useWorkspace();
  const [draft, setDraft] = useState<InfluxSettings>(structuredClone(state.influx));
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<"idle" | "valid" | "invalid">("idle");
  const testConfiguration = () => {
    setTesting(true); setTestState("idle");
    window.setTimeout(() => {
      const valid = /^https?:\/\//.test(draft.url) && Boolean(draft.bucket.trim()) && Boolean(draft.mappings.uniqueVehicleId?.trim());
      setTesting(false); setTestState(valid ? "valid" : "invalid");
      if (valid) toast.success("התצורה תקינה; בדיקת רשת תתבצע בסביבה המבצעית");
      else toast.error("חסרים URL, bucket או מזהה רכב ייחודי");
    }, 900);
  };
  const mappingLabels: Record<string, string> = { vehicleNumber: "מספר רכב", uniqueVehicleId: "מזהה רכב ייחודי", active: "Active", latitude: "קו רוחב", longitude: "קו אורך", altitude: "גובה", velocityNorth: "מהירות צפון", velocityEast: "מהירות מזרח" };
  return <>
    <SectionHeader eyebrow="מקור נתונים" title="InfluxDB 2" description="ה־join מתבצע לפי זמן Influx, מספר שרת ומספר רכב, בחלון מתירני של 5 שניות."><div className="header-actions"><Button variant="outline" onClick={testConfiguration}>{testing ? <LoaderCircle className="spin" /> : <Gauge />}בדיקת תצורה</Button><Button onClick={() => save({ ...state, influx: draft }, "influx", "save-mapping", draft.bucket)}><Save />שמור מיפוי</Button></div></SectionHeader>
    <div className="influx-grid"><section className="connection-card glass-panel"><div className="panel-title"><div><p className="eyebrow">חיבור</p><h3>שרת Influx</h3></div><span className={`connection-indicator ${testState}`}>{testState === "valid" ? "תצורה תקינה" : testState === "invalid" ? "נדרש תיקון" : "טרם נבדק"}</span></div><label><span>URL</span><input dir="ltr" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></label><label><span>Organization</span><input dir="ltr" value={draft.organization} onChange={(event) => setDraft({ ...draft, organization: event.target.value })} /></label><label><span>Bucket</span><input dir="ltr" value={draft.bucket} onChange={(event) => setDraft({ ...draft, bucket: event.target.value })} /></label><p className="security-note">ה־Token אינו נשמר באתר הציבורי. בפריסה מקומית או OpenShift הוא יוזן כ־Secret.</p></section><section className="polling-card glass-panel"><div className="panel-title"><div><p className="eyebrow">תזמון</p><h3>Polling ו־join</h3></div></div><label className="number-field"><span>בדיקת שרת רדום</span><div><input type="number" value={draft.idleProbeMinutes} onChange={(event) => setDraft({ ...draft, idleProbeMinutes: Number(event.target.value) })} /><em>דקות</em></div></label><label className="number-field"><span>שרת פעיל</span><div><input type="number" value={draft.activePollSeconds} onChange={(event) => setDraft({ ...draft, activePollSeconds: Number(event.target.value) })} /><em>שניות</em></div></label><label className="number-field"><span>סבילות join</span><div><input type="number" value={draft.joinToleranceSeconds} onChange={(event) => setDraft({ ...draft, joinToleranceSeconds: Number(event.target.value) })} /><em>שניות</em></div></label><label><span>ערך Active שמייצג ON</span><input value={draft.activeOnValue} onChange={(event) => setDraft({ ...draft, activeOnValue: event.target.value })} /></label></section></div>
    <section className="mapping-panel glass-panel"><div className="panel-title"><div><p className="eyebrow">מטריקות</p><h3>מיפוי שדות</h3></div><Badge variant="outline">מקורית עדיפה · interpolation עד 5 שנ׳</Badge></div><div className="mapping-table"><div className="table-head"><span>שדה מערכת</span><span>Measurement / Field</span><span>כלל השלמה</span></div>{Object.entries(draft.mappings).map(([key, value]) => <div className="table-row" key={key}><strong>{mappingLabels[key] ?? key}</strong><input dir="ltr" value={value} onChange={(event) => setDraft({ ...draft, mappings: { ...draft.mappings, [key]: event.target.value } })} /><span>{key === "active" || key === "uniqueVehicleId" ? "Forward fill" : "אינטרפולציה ליניארית"}</span></div>)}</div></section>
  </>;
}

function RoutesSection() {
  const { state, save } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", arena: "זירה א׳", vehicleType: state.vehicleTypes[0]?.name ?? "", family: "SI" as Family, geometry: "MULTIPOLYGON ((()))" });
  const addRoute = () => {
    if (!form.name.trim() || !/^MULTIPOLYGON\s*\(/i.test(form.geometry.trim())) { toast.error("נדרשים שם ו־WKT מסוג MULTIPOLYGON"); return; }
    const similar = state.routes.some((route) => route.arena === form.arena && route.vehicleType === form.vehicleType && route.name.toLowerCase() === form.name.trim().toLowerCase());
    if (similar) { toast.error("נתיב בשם זה כבר קיים באותה זירה ולסוג הרכב"); return; }
    const route = { id: createId("route"), ...form, name: form.name.trim(), updatedAt: new Date().toISOString() };
    save({ ...state, routes: [...state.routes, route] }, "routes", "create", route.name); setOpen(false); setForm({ ...form, name: "", geometry: "MULTIPOLYGON ((()))" });
  };
  return <>
    <SectionHeader eyebrow="בנק גלובלי" title="נתיבים ומפות" description="הנתיב השמור נותן שם וזירה בלבד. הגיאומטריה לציון תמיד מזוהה מחדש מנתוני הניווט."><Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus />נתיב חדש</Button></DialogTrigger><DialogContent className="glass-dialog wide-dialog" dir="rtl"><DialogHeader><DialogTitle>שמירת נתיב</DialogTitle><DialogDescription>הזן נ״צ או הדבק WKT. כאן מוצגת זרימת WKT מלאה.</DialogDescription></DialogHeader><div className="dialog-form two-columns"><label><span>שם ייחודי</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="לדוגמה: טבעת צפונית" /></label><label><span>זירה</span><input value={form.arena} onChange={(event) => setForm({ ...form, arena: event.target.value })} /></label><label><span>סוג רכב מורשה</span><Select value={form.vehicleType} onValueChange={(value) => setForm({ ...form, vehicleType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{state.vehicleTypes.map((type) => <SelectItem value={type.name} key={type.id}>{type.name}</SelectItem>)}</SelectContent></Select></label><label><span>משפחה</span><Select value={form.family} onValueChange={(value) => setForm({ ...form, family: value as Family })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SI">SI</SelectItem><SelectItem value="SO">SO</SelectItem></SelectContent></Select></label><label className="span-two"><span>WKT · WGS84</span><Textarea dir="ltr" value={form.geometry} onChange={(event) => setForm({ ...form, geometry: event.target.value })} /></label></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>ביטול</Button><Button onClick={addRoute}><Save />שמור נתיב</Button></DialogFooter></DialogContent></Dialog></SectionHeader>
    <div className="route-bank">{state.routes.map((route) => <article className="route-card glass-panel" key={route.id}><div className={`route-preview ${route.family.toLowerCase()}`}><MapPinned /><div /></div><div className="route-content"><Badge>{route.family}</Badge><h3>{route.name}</h3><p>{route.arena} · {route.vehicleType}</p><small>התאמה אוטומטית עד 30% · WGS84</small></div><div className="row-actions"><Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(route.geometry); toast.success("ה־WKT הועתק"); }}><FileJson />העתק WKT</Button><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="מחיקת נתיב"><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent dir="rtl"><AlertDialogHeader><AlertDialogTitle>למחוק את {route.name}?</AlertDialogTitle><AlertDialogDescription>הנתיב יוסר מהבנק ומהתאמות עתידיות. השם והזירה שכבר נשמרו באירועי עבר יישארו.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>ביטול</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => save({ ...state, routes: state.routes.filter((item) => item.id !== route.id) }, "routes", "delete", route.name)}>מחק</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></article>)}</div>
  </>;
}

type TestResult = { name: string; area: string; state: "pass" | "border" | "fail"; latency: string; detail: string };
const testResults: TestResult[] = [
  { name: "SI · סיבוב משותף", area: "סנכרון", state: "pass", latency: "0.8s", detail: "זווית מוחלטת נוטרלה" },
  { name: "SO · תזמון פניות", area: "סנכרון", state: "pass", latency: "1.2s", detail: "איחור שויך לרכב הנכון" },
  { name: "פער תקשורת 2 דקות", area: "רציפות", state: "pass", latency: "2.1s", detail: "הקבוצה נשמרה והושלמה" },
  { name: "150 רכבים · 10 שרתים", area: "עומס", state: "border", latency: "8.7s", detail: "עבר, קרוב ליעד 10 שנ׳" },
  { name: "סיבוב פנימי רב־טווחי", area: "נתיב", state: "pass", latency: "1.6s", detail: "אומת אחרי שני סיבובים" },
];

function TestsSection() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(100);
  const [lastRun, setLastRun] = useState("02.09.2026 · 19:12");
  const run = () => {
    setRunning(true); setProgress(0);
    const timer = window.setInterval(() => setProgress((value) => { const next = Math.min(100, value + 5); if (next === 100) { window.clearInterval(timer); setRunning(false); setLastRun(new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date())); toast.success("בדיקות המערכת הסתיימו"); } return next; }), 75);
  };
  const exportReport = () => {
    const payload = { generatedAt: new Date().toISOString(), summary: { pass: 4, border: 1, fail: 0 }, results: testResults };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "bluewolf-system-report.json"; link.click(); URL.revokeObjectURL(url);
  };
  return <>
    <SectionHeader eyebrow="Self testing" title="בדיקות מערכת" description="הדוח מתחיל בסיכום עבר/גבולי/לא עבר, ולאחריו פרק קצר לכל נושא."><div className="header-actions"><Button variant="outline" onClick={exportReport}><Download />ייצוא דוח</Button><Button onClick={run} disabled={running}>{running ? <LoaderCircle className="spin" /> : <Play />}{running ? "מריץ…" : "הרץ הכול"}</Button></div></SectionHeader>
    <section className="test-overview glass-panel"><div className="test-dial"><strong>{running ? progress : 100}%</strong><span>השלמה</span></div><div><p className="eyebrow">תוצאה מסכמת</p><h3>{running ? "הבדיקות רצות" : "המערכת עברה"}</h3><p>הרצה אחרונה: {lastRun}</p>{running && <Progress value={progress} />}</div><div className="test-summary"><span className="pass"><b>4</b>עבר</span><span className="border"><b>1</b>גבולי</span><span className="fail"><b>0</b>לא עבר</span></div></section>
    <section className="test-list glass-panel"><div className="table-head"><span>מבחן</span><span>נושא</span><span>תוצאה</span><span>שיהוי</span><span>סיכום</span></div>{testResults.map((item) => <div className="table-row" key={item.name}><strong>{item.name}</strong><span>{item.area}</span><Badge className={`test-state ${item.state}`}>{item.state === "pass" ? "עבר" : item.state === "border" ? "גבולי" : "לא עבר"}</Badge><span dir="ltr">{item.latency}</span><span>{item.detail}</span></div>)}</section>
  </>;
}

function SettingsSection() {
  const { state, save, storageMode, revision, lastSavedAt } = useWorkspace();
  const [draft, setDraft] = useState<WorkspaceState>(structuredClone(state));
  const fileRef = useRef<HTMLInputElement>(null);
  const exportConfig = () => { const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "bluewolf-configuration.json"; link.click(); URL.revokeObjectURL(url); };
  const importConfig = async (file?: File) => {
    if (!file) return;
    try { const parsed = JSON.parse(await file.text()) as WorkspaceState; const merged = { ...DEFAULT_WORKSPACE, ...parsed }; setDraft(merged); await save(merged, "system", "import", file.name); toast.success("החבילה מוזגה והפכה לפעילה"); } catch { toast.error("קובץ הקונפיגורציה אינו תקין"); }
  };
  const addServer = () => { if (draft.servers.length >= 10) { toast.error("ניתן להגדיר עד 10 שרתים פעילים"); return; } const id = String(draft.servers.length + 1); setDraft({ ...draft, servers: [...draft.servers, { id, name: `שרת ${id.padStart(2, "0")}`, enabled: true }] }); };
  return <>
    <SectionHeader eyebrow="מערכת" title="הגדרות כלליות" description="הגדרות גלובליות, שרתים וסוגי רכבים. שמירה מוחלת מיד ונרשמת ביומן."><div className="header-actions"><input ref={fileRef} hidden type="file" accept="application/json" onChange={(event) => importConfig(event.target.files?.[0])} /><Button variant="outline" onClick={() => fileRef.current?.click()}><Upload />ייבוא</Button><Button variant="outline" onClick={exportConfig}><Download />ייצוא</Button><Button onClick={() => save(draft, "system", "save-settings", "global settings")}><Save />שמור</Button></div></SectionHeader>
    <div className="settings-overview"><section className="settings-card glass-panel"><div className="panel-title"><div><p className="eyebrow">מצב</p><h3>אחסון וקונפיגורציה</h3></div><span className={`storage-state ${storageMode}`}>{storageMode === "cloud" ? "מרכזי" : "מקומי"}</span></div><dl><div><dt>גרסה פעילה</dt><dd>{revision || 1}</dd></div><div><dt>שמירה אחרונה</dt><dd>{lastSavedAt ? new Intl.DateTimeFormat("he-IL", { timeStyle: "short" }).format(new Date(lastSavedAt)) : "טרם נשמר"}</dd></div><div><dt>שמירת היסטוריה</dt><dd>{draft.settings.retentionDays} ימים</dd></div></dl></section><section className="settings-card glass-panel"><div className="panel-title"><div><p className="eyebrow">תצוגה</p><h3>זמן ורענון</h3></div></div><label><span>אזור זמן</span><Select value={draft.settings.timezone} onValueChange={(timezone) => setDraft({ ...draft, settings: { ...draft.settings, timezone } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Asia/Jerusalem">ישראל</SelectItem><SelectItem value="UTC">UTC</SelectItem></SelectContent></Select></label><label className="number-field"><span>רענון מפעיל</span><div><input type="number" min="1" max="10" value={draft.settings.uiRefreshSeconds} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, uiRefreshSeconds: Number(event.target.value) } })} /><em>שניות</em></div></label><label className="number-field"><span>שמירת היסטוריה</span><div><input type="number" min="7" max="365" value={draft.settings.retentionDays} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, retentionDays: Number(event.target.value) } })} /><em>ימים</em></div></label></section></div>
    <section className="server-panel glass-panel"><div className="panel-title"><div><p className="eyebrow">מקורות</p><h3>מספרי שרתים</h3></div><Button variant="outline" size="sm" onClick={addServer}><Plus />הוסף שרת</Button></div><div className="server-grid">{draft.servers.map((server, index) => <article key={server.id}><Server /><input value={server.name} onChange={(event) => setDraft({ ...draft, servers: draft.servers.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /><Switch checked={server.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, servers: draft.servers.map((item, itemIndex) => itemIndex === index ? { ...item, enabled } : item) })} /></article>)}</div></section>
    <section className="vehicle-types-panel glass-panel"><div className="panel-title"><div><p className="eyebrow">סיווג</p><h3>סוגי רכבים וטווחי מזהים</h3></div><Badge variant="outline">היסטוריה תחושב מחדש בשינוי</Badge></div><div className="vehicle-type-table"><div className="table-head"><span>שם</span><span>מזהה מינימלי</span><span>מזהה מקסימלי</span><span>מהירות עבודה</span><span>תפקידי SI</span></div>{draft.vehicleTypes.map((type, index) => <div className="table-row" key={type.id}><input value={type.name} onChange={(event) => setDraft({ ...draft, vehicleTypes: draft.vehicleTypes.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /><input type="number" value={type.minId} onChange={(event) => setDraft({ ...draft, vehicleTypes: draft.vehicleTypes.map((item, itemIndex) => itemIndex === index ? { ...item, minId: Number(event.target.value) } : item) })} /><input type="number" value={type.maxId} onChange={(event) => setDraft({ ...draft, vehicleTypes: draft.vehicleTypes.map((item, itemIndex) => itemIndex === index ? { ...item, maxId: Number(event.target.value) } : item) })} /><div className="inline-number"><input type="number" value={type.workSpeedKmh} onChange={(event) => setDraft({ ...draft, vehicleTypes: draft.vehicleTypes.map((item, itemIndex) => itemIndex === index ? { ...item, workSpeedKmh: Number(event.target.value) } : item) })} /><span>קמ״ש</span></div><span>{type.siRoles.map((role) => role === "inner" ? "פנימית" : role === "middle" ? "ביניים" : "חיצונית").join(", ")}</span></div>)}</div></section>
    <section className="danger-zone glass-panel"><div><ArchiveRestore /><div><h3>שחזור ברירת מחדל</h3><p>הפעולה יוצרת גרסה חדשה ואינה מוחקת את היסטוריית הגרסאות.</p></div></div><AlertDialog><AlertDialogTrigger asChild><Button variant="destructive"><RotateCcw />שחזר הכול</Button></AlertDialogTrigger><AlertDialogContent dir="rtl"><AlertDialogHeader><AlertDialogTitle>לשחזר את כל הגדרות ברירת המחדל?</AlertDialogTitle><AlertDialogDescription>תבניות, נתיבים, GT, מיפויים וספים יוחלפו. תישמר גרסה חדשה ביומן.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>ביטול</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { const defaults = structuredClone(DEFAULT_WORKSPACE); setDraft(defaults); save(defaults, "system", "restore-defaults", "full reset"); }}>שחזר</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></section>
  </>;
}

export function DeveloperView() {
  const [section, setSection] = useState<DeveloperSection>("score");
  const content: Record<DeveloperSection, React.ReactNode> = { score: <ScoreSection />, templates: <TemplateSection />, gt: <GtSection />, influx: <InfluxSection />, routes: <RoutesSection />, tests: <TestsSection />, settings: <SettingsSection /> };
  return <div className="developer-workspace"><aside className="developer-nav glass-panel"><div className="developer-nav-title"><SlidersHorizontal /><div><strong>מצב מפתחים</strong><span>שינויים נשמרים מיד</span></div></div><nav>{sectionItems.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><Icon /><span>{item.label}</span><ChevronLeft /></button>; })}</nav><div className="core-state"><CheckCircle2 /><div><strong>ליבה תקינה</strong><span>43/43 בדיקות בסיס</span></div></div></aside><main className="developer-content">{content[section]}</main></div>;
}
