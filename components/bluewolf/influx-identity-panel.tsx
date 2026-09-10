"use client";

import { useState } from "react";
import { Database, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { WorkspaceState } from "@/lib/bluewolf";
import { useWorkspace } from "./app-context";

export type InfluxPhysicalIdentity = {
  serverColumn: string;
  timeColumn: string;
  vehicleNumberColumn: string;
};

type ExtendedInflux = WorkspaceState["influx"] & Partial<InfluxPhysicalIdentity>;

export const DEFAULT_INFLUX_IDENTITY: InfluxPhysicalIdentity = {
  serverColumn: "server",
  timeColumn: "_time",
  vehicleNumberColumn: "vehicle_number",
};

function currentIdentity(state: WorkspaceState): InfluxPhysicalIdentity {
  const influx = state.influx as ExtendedInflux;
  return {
    serverColumn: influx.serverColumn?.trim() || DEFAULT_INFLUX_IDENTITY.serverColumn,
    timeColumn: influx.timeColumn?.trim() || DEFAULT_INFLUX_IDENTITY.timeColumn,
    vehicleNumberColumn: influx.vehicleNumberColumn?.trim() || DEFAULT_INFLUX_IDENTITY.vehicleNumberColumn,
  };
}

export function InfluxIdentityPanel() {
  const { state, save } = useWorkspace();
  const initial = currentIdentity(state);
  const [serverColumn, setServerColumn] = useState(initial.serverColumn);
  const [timeColumn, setTimeColumn] = useState(initial.timeColumn);
  const [vehicleNumberColumn, setVehicleNumberColumn] = useState(initial.vehicleNumberColumn);

  const persist = async () => {
    if (!serverColumn.trim() || !timeColumn.trim() || !vehicleNumberColumn.trim()) {
      toast.error("נדרשים שמות השדות של השרת, הזמן ומספר הרכב");
      return;
    }
    const influx = {
      ...state.influx,
      serverColumn: serverColumn.trim(),
      timeColumn: timeColumn.trim(),
      vehicleNumberColumn: vehicleNumberColumn.trim(),
    } as ExtendedInflux;
    await save(
      { ...state, influx } as WorkspaceState,
      "influx",
      "physical-identity",
      `${serverColumn.trim()} / ${timeColumn.trim()} / ${vehicleNumberColumn.trim()}`,
    );
    toast.success("שדות ה־Join של Influx נשמרו");
  };

  return <section className="influx-identity-panel glass-panel">
    <div><Database /><div><p className="eyebrow">Influx physical schema</p><h3>שדות ה־Join: שרת, זמן ומספר רכב</h3><p>השמות הפיזיים ניתנים להגדרה. ברירת המחדל לזמן היא `_time`; אם מוגדר שדה אחר, הוא חייב להופיע בכל הרשומות ולהכיל זמן ISO/RFC3339 עם אזור זמן.</p></div></div>
    <div className="influx-identity-fields">
      <label><span>שדה / תג שרת</span><input value={serverColumn} onChange={(event) => setServerColumn(event.target.value)} placeholder="למשל server" /></label>
      <label><span>שדה זמן</span><input value={timeColumn} onChange={(event) => setTimeColumn(event.target.value)} placeholder="למשל _time" /></label>
      <label><span>שדה / תג מספר רכב</span><input value={vehicleNumberColumn} onChange={(event) => setVehicleNumberColumn(event.target.value)} placeholder="למשל vehicle_number" /></label>
      <Button onClick={persist}><Save />שמור Schema</Button>
    </div>
  </section>;
}

export function getInfluxPhysicalIdentity(state: WorkspaceState) {
  return currentIdentity(state);
}
