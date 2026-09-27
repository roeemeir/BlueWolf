"use client";

import { Database, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { InfluxFieldMapping } from "@/lib/bluewolf";
import { validateInfluxSettings } from "@/lib/influx-runtime-config";
import { useWorkspace } from "./app-context";

function mappingPreview(mapping: InfluxFieldMapping) {
  if (mapping.valueMode === "as-is") return "as-is";
  return `${mapping.sourceValue || "?"} → ${mapping.mappedValue || "?"}`;
}

export function InfluxGovernanceWorkbench() {
  const { state, save } = useWorkspace();
  const [url, setUrl] = useState(state.influx.url);
  const [organization, setOrganization] = useState(state.influx.organization);
  const [token, setToken] = useState(state.influx.token);
  const [stream, setStream] = useState(state.influx.stream);
  const [mappings, setMappings] = useState<InfluxFieldMapping[]>(structuredClone(state.influx.mappings));

  const update = (index: number, patch: Partial<InfluxFieldMapping>) => {
    setMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const saveInflux = async () => {
    const influx = { ...state.influx, url, organization, token, stream, mappings };
    try {
      validateInfluxSettings(influx);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Influx configuration is invalid");
      return;
    }
    await save({ ...state, influx }, "influx", "save-runtime-mapping", `${stream.serverColumn}/${stream.timeColumn}/${stream.vehicleNumberColumn}`);
  };

  return <section className="glass-panel" data-requirements="IN-01" data-testid="influx-governance-workbench" style={{ margin: "0 0 16px", padding: 18 }}>
    <header className="developer-section-header" style={{ marginBottom: 16 }}>
      <div>
        <p className="eyebrow">IN-01 · InfluxDB 2</p>
        <h2>מיפוי Join והתמרת ערכים</h2>
        <p>השמות נשמרים כקונפיגורציית runtime אמיתית: שרת, זמן ומספר רכב נפרדים. במצב offline השמירה מסנכרנת את המיפוי לקובץ operational config; שירות ה־Core קורא אותו בהפעלה מחדש.</p>
      </div>
      <Button onClick={saveInflux}><Save />שמור מיפוי Runtime</Button>
    </header>

    <div className="v04-connection-grid">
      <label><span>URL</span><input dir="ltr" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
      <label><span>Organization</span><input dir="ltr" value={organization} onChange={(event) => setOrganization(event.target.value)} /></label>
      <label><span>Token</span><input dir="ltr" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} /><small>ה־token נשמר ב־Workspace בלבד ואינו נכתב לקובץ runtime; ה־Core משתמש ב־tokenEnv.</small></label>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginBottom: 18 }}>
      {([
        ["serverColumn", "שדה שרת"],
        ["timeColumn", "שדה זמן"],
        ["vehicleNumberColumn", "שדה מספר רכב"],
      ] as const).map(([key, label]) => <label key={key} style={{ display: "grid", gap: 5 }}>
        <span>{label}</span>
        <input dir="ltr" value={stream[key]} onChange={(event) => setStream({ ...stream, [key]: event.target.value })} />
      </label>)}
    </div>

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      <Badge variant="outline"><Database />server: {stream.serverColumn}</Badge>
      <Badge variant="outline">time: {stream.timeColumn}</Badge>
      <Badge variant="outline">vehicle: {stream.vehicleNumberColumn}</Badge>
    </div>

    <div style={{ display: "grid", gap: 10 }}>
      {mappings.map((item, index) => <article key={item.systemKey} className="glass-panel" style={{ padding: 12 }} data-testid={`influx-mapping-${item.systemKey}`}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}>
          <div><strong>{item.label}</strong><div style={{ fontSize: 11, opacity: .72 }}>{item.systemKey}</div></div>
          <Badge variant="outline">{mappingPreview(item)}</Badge>
        </header>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 150px 150px", gap: 8, alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4 }}><span>Bucket</span><input value={item.bucket} onChange={(event) => update(index, { bucket: event.target.value })} /></label>
          <label style={{ display: "grid", gap: 4 }}><span>Measurement</span><input value={item.measurement} onChange={(event) => update(index, { measurement: event.target.value })} /></label>
          <label style={{ display: "grid", gap: 4 }}><span>Field / Key</span><input value={item.key} onChange={(event) => update(index, { key: event.target.value })} /></label>
          <label style={{ display: "grid", gap: 4 }}><span>Value</span><Select value={item.valueMode} onValueChange={(value) => update(index, { valueMode: value as InfluxFieldMapping["valueMode"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="as-is">as-is</SelectItem><SelectItem value="special">special map</SelectItem></SelectContent></Select></label>
          <label style={{ display: "grid", gap: 4 }}><span>Fill</span><Select value={item.fillMode} onValueChange={(value) => update(index, { fillMode: value as InfluxFieldMapping["fillMode"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="linear">linear</SelectItem><SelectItem value="forward-fill">forward-fill</SelectItem></SelectContent></Select></label>
        </div>
        {item.valueMode === "special" && <div data-testid={`influx-transform-${item.systemKey}`} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "end", marginTop: 10 }}>
          <label style={{ display: "grid", gap: 4 }}><span>ערך מקור</span><input dir="ltr" value={item.sourceValue} onChange={(event) => update(index, { sourceValue: event.target.value })} /></label>
          <strong style={{ paddingBottom: 10 }}>→</strong>
          <label style={{ display: "grid", gap: 4 }}><span>ערך אחרי התמרה</span><input dir="ltr" value={item.mappedValue} onChange={(event) => update(index, { mappedValue: event.target.value })} /></label>
        </div>}
      </article>)}
    </div>
  </section>;
}
