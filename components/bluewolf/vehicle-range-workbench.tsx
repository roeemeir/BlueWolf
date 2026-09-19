"use client";

import { Plus, Save, Trash2, UsersRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VehicleIdRange, VehicleType } from "@/lib/bluewolf";
import { resolveVehicleProfile, validateVehicleIdRanges, vehicleTypeRanges, withVehicleTypeRanges } from "@/lib/vehicle-id-ranges";
import { useWorkspace } from "./app-context";

export function VehicleRangeWorkbench() {
  const { state, save } = useWorkspace();
  const [types, setTypes] = useState<VehicleType[]>(() => structuredClone(state.vehicleTypes).map((type) => withVehicleTypeRanges(type, vehicleTypeRanges(type))));
  const [probe, setProbe] = useState("");

  const patch = (index: number, changes: Partial<VehicleType>) => {
    setTypes((current) => current.map((type, itemIndex) => itemIndex === index ? { ...type, ...changes } : type));
  };
  const patchRange = (typeIndex: number, rangeIndex: number, changes: Partial<VehicleIdRange>) => {
    setTypes((current) => current.map((type, itemIndex) => {
      if (itemIndex !== typeIndex) return type;
      const ranges = vehicleTypeRanges(type).map((range, index) => index === rangeIndex ? { ...range, ...changes } : range);
      return withVehicleTypeRanges(type, ranges);
    }));
  };
  const addRange = (typeIndex: number) => {
    setTypes((current) => current.map((type, itemIndex) => {
      if (itemIndex !== typeIndex) return type;
      const ranges = vehicleTypeRanges(type);
      const last = ranges.at(-1) ?? { minId: 0, maxId: 0 };
      return withVehicleTypeRanges(type, [...ranges, { minId: last.maxId + 1, maxId: last.maxId + 10 }]);
    }));
  };
  const removeRange = (typeIndex: number, rangeIndex: number) => {
    setTypes((current) => current.map((type, itemIndex) => {
      if (itemIndex !== typeIndex) return type;
      const ranges = vehicleTypeRanges(type);
      if (ranges.length <= 1) return type;
      return withVehicleTypeRanges(type, ranges.filter((_, index) => index !== rangeIndex));
    }));
  };

  const saveRanges = async () => {
    try {
      validateVehicleIdRanges(types);
      await save({ ...state, vehicleTypes: types }, "vehicle-ranges", "save", `${types.reduce((sum, type) => sum + vehicleTypeRanges(type).length, 0)} ranges / ${types.length} vehicle types`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "טווחי המזהים אינם תקינים");
    }
  };

  let profile = null;
  if (/^\d+$/.test(probe)) {
    try { profile = resolveVehicleProfile(Number(probe), types); } catch { profile = null; }
  }

  return <section className="glass-panel vehicle-range-workbench" data-requirements="BW-DEV-004 BW-DEV-005">
    <style>{`
      .vehicle-range-workbench{margin:0 0 16px;padding:18px;border-radius:18px}.vehicle-type-card{padding:13px;display:grid;gap:10px}.vehicle-type-head{display:grid;grid-template-columns:minmax(150px,1.3fr) minmax(130px,.7fr);gap:10px;align-items:end}.vehicle-type-head label,.vehicle-range-row label{display:grid;gap:5px}.vehicle-range-row{display:grid;grid-template-columns:auto minmax(110px,1fr) minmax(110px,1fr) auto;gap:8px;align-items:end;padding:9px;border:1px solid var(--line);border-radius:12px;background:var(--surface-soft)}.vehicle-range-row>strong{align-self:center;white-space:nowrap}.vehicle-range-actions{display:flex;justify-content:flex-start}.vehicle-range-probe{display:flex;gap:10px;align-items:end;margin-top:14px;flex-wrap:wrap}.vehicle-range-probe label{display:grid;gap:5px}
      @media(max-width:760px){.vehicle-range-workbench{padding:13px}.vehicle-type-head{grid-template-columns:1fr}.vehicle-range-row{grid-template-columns:1fr 1fr}.vehicle-range-row>strong,.vehicle-range-row>button{grid-column:auto}.vehicle-range-actions button{width:100%}.vehicle-range-probe{display:grid;grid-template-columns:1fr}.vehicle-range-probe input{width:100%}}
    `}</style>
    <header className="developer-section-header" style={{ marginBottom: 14 }}><div><p className="eyebrow">Vehicle registry</p><h2>סוגי רכב, טווחי מזהים ומהירות עבודה</h2><p>זהו המקום היחיד להגדרת רכבים. לכל סוג ניתן להגדיר כמה טווחי מזהים לא חופפים ומהירות עבודה אחת; המיפוי משותף ל־SI, למפה ול־Core.</p></div><Button onClick={saveRanges}><Save />שמור רכבים</Button></header>
    <div style={{ display: "grid", gap: 10 }}>
      {types.map((type, typeIndex) => <article key={type.id} className="glass-panel vehicle-type-card">
        <div className="vehicle-type-head">
          <label><span>סוג רכב</span><input value={type.name} onChange={(event) => patch(typeIndex, { name: event.target.value })} /></label>
          <label><span>מהירות עבודה km/h</span><input type="number" min={0.1} step={0.1} value={type.workSpeedKmh} onChange={(event) => patch(typeIndex, { workSpeedKmh: Number(event.target.value) })} /></label>
        </div>
        <div style={{ display: "grid", gap: 7 }}>
          {vehicleTypeRanges(type).map((range, rangeIndex) => <div className="vehicle-range-row" key={rangeIndex}>
            <strong>טווח {rangeIndex + 1}</strong>
            <label><span>מזהה מינימלי</span><input type="number" min={0} step={1} value={range.minId} onChange={(event) => patchRange(typeIndex, rangeIndex, { minId: Number(event.target.value) })} /></label>
            <label><span>מזהה מקסימלי</span><input type="number" min={0} step={1} value={range.maxId} onChange={(event) => patchRange(typeIndex, rangeIndex, { maxId: Number(event.target.value) })} /></label>
            <Button type="button" variant="ghost" size="icon-sm" disabled={vehicleTypeRanges(type).length <= 1} onClick={() => removeRange(typeIndex, rangeIndex)} aria-label={`הסר טווח ${rangeIndex + 1}`}><Trash2 /></Button>
          </div>)}
        </div>
        <div className="vehicle-range-actions"><Button type="button" variant="outline" size="sm" onClick={() => addRange(typeIndex)}><Plus />הוסף טווח</Button></div>
      </article>)}
    </div>
    <div className="vehicle-range-probe"><label><span>בדיקת מספר רכב</span><input inputMode="numeric" value={probe} onChange={(event) => setProbe(event.target.value)} placeholder="לדוגמה 120" /></label>{probe && <Badge variant="outline"><UsersRound />{profile ? `${profile.typeName} · ${profile.workSpeedKmh} km/h` : "אין טווח תואם"}</Badge>}</div>
  </section>;
}
