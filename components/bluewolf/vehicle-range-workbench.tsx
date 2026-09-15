"use client";

import { Save, UsersRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VehicleType } from "@/lib/bluewolf";
import { resolveVehicleProfile, validateVehicleIdRanges } from "@/lib/vehicle-id-ranges";
import { useWorkspace } from "./app-context";

export function VehicleRangeWorkbench() {
  const { state, save } = useWorkspace();
  const [types, setTypes] = useState<VehicleType[]>(() => structuredClone(state.vehicleTypes));
  const [probe, setProbe] = useState("");

  const patch = (index: number, changes: Partial<VehicleType>) => {
    setTypes((current) => current.map((type, itemIndex) => itemIndex === index ? { ...type, ...changes } : type));
  };

  const saveRanges = async () => {
    try {
      validateVehicleIdRanges(types);
      await save({ ...state, vehicleTypes: types }, "vehicle-ranges", "save", `${types.length} ranges`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "טווחי המזהים אינם תקינים");
    }
  };

  let profile = null;
  if (/^\d+$/.test(probe)) {
    try { profile = resolveVehicleProfile(Number(probe), types); } catch { profile = null; }
  }

  return <section className="glass-panel" style={{ margin: "0 0 16px", padding: 18 }} data-requirements="BW-DEV-004 BW-DEV-005">
    <header className="developer-section-header" style={{ marginBottom: 14 }}><div><p className="eyebrow">Vehicle ID registry</p><h2>טווחי מזהים ומהירות עבודה</h2><p>כל מספר רכב ממופה לטווח יחיד, לסוג רכב ולמהירות עבודה. חפיפה או ערך בלתי חוקי נחסמים גם בדפדפן וגם בשרת.</p></div><Button onClick={saveRanges}><Save />שמור טווחים</Button></header>
    <div style={{ display: "grid", gap: 10 }}>
      {types.map((type, index) => <div key={type.id} className="glass-panel" style={{ padding: 12, display: "grid", gridTemplateColumns: "minmax(120px,1.2fr) repeat(3,minmax(90px,1fr))", gap: 10, alignItems: "end" }}>
        <label><span>סוג רכב</span><input value={type.name} onChange={(event) => patch(index, { name: event.target.value })} /></label>
        <label><span>מזהה מינימלי</span><input type="number" min={0} step={1} value={type.minId} onChange={(event) => patch(index, { minId: Number(event.target.value) })} /></label>
        <label><span>מזהה מקסימלי</span><input type="number" min={0} step={1} value={type.maxId} onChange={(event) => patch(index, { maxId: Number(event.target.value) })} /></label>
        <label><span>מהירות עבודה km/h</span><input type="number" min={0.1} step={0.1} value={type.workSpeedKmh} onChange={(event) => patch(index, { workSpeedKmh: Number(event.target.value) })} /></label>
      </div>)}
    </div>
    <div style={{ display: "flex", gap: 10, alignItems: "end", marginTop: 14, flexWrap: "wrap" }}><label><span>בדיקת מספר רכב</span><input inputMode="numeric" value={probe} onChange={(event) => setProbe(event.target.value)} placeholder="לדוגמה 120" /></label>{probe && <Badge variant="outline"><UsersRound />{profile ? `${profile.typeName} · ${profile.workSpeedKmh} km/h` : "אין טווח תואם"}</Badge>}</div>
  </section>;
}
