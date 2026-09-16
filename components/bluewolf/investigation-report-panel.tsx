"use client";

import { useState } from "react";
import { Download, FileChartColumn, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { buildInvestigationPdfWithLifecycle } from "@/lib/investigation-pdf-lifecycle";
import { normalizeInvestigationReportData } from "@/lib/investigation-report-data";
import { useWorkspace } from "./app-context";
import { InvestigationLifecyclePanel } from "./investigation-lifecycle-panel";
import { InvestigationRetroactivePanel } from "./investigation-retroactive-panel";

type InvestigationEdit = {
  note: string;
  templateId: string;
  arena?: string;
  recomputeRunId?: string;
  requiredCodeVersion?: string;
  requiredConfigVersion?: string;
  requiredTemplateVersion?: string;
};

type ReportState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; detail: string }
  | { kind: "complete"; codeVersion: string; configVersion: string };

function inputTimeToIso(value: string, name: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} אינו זמן תקין`);
  return date.toISOString();
}

function downloadPdf(bytes: Uint8Array, generatedAt: string) {
  const body = new Uint8Array(bytes.byteLength); body.set(bytes);
  const blob = new Blob([body.buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = `bluewolf-investigation-${generatedAt.slice(0, 10).replaceAll("-", "")}.pdf`; anchor.click(); }
  finally { window.setTimeout(() => URL.revokeObjectURL(url), 1_000); }
}

export function InvestigationReportPanel({ server }: { server: string }) {
  const { state } = useWorkspace();
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [report, setReport] = useState<ReportState>({ kind: "idle" });
  const edits = state.investigationEdits as Record<string, InvestigationEdit>;

  const generate = async () => {
    if ((from && !to) || (!from && to)) { toast.error("כדי להפיק דוח לטווח יש להזין גם התחלה וגם סוף"); return; }
    let fromIso: string | undefined; let toIso: string | undefined;
    try { fromIso = inputTimeToIso(from, "זמן התחלה"); toIso = inputTimeToIso(to, "זמן סוף"); if (fromIso && toIso && fromIso > toIso) throw new Error("זמן ההתחלה חייב להיות מוקדם מזמן הסיום"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "טווח הזמן אינו תקין"); return; }

    setReport({ kind: "running" });
    try {
      const response = await fetch("/api/investigation/report", {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, cache: "no-store",
        body: JSON.stringify({
          serverId: Number(server), from: fromIso, to: toIso, format: "data",
          overrides: Object.entries(edits).map(([eventId, edit]) => ({
            eventId, templateId: edit.templateId || null, arena: edit.arena || null, note: edit.note || null,
            recomputeRunId: edit.recomputeRunId || null,
            requiredCodeVersion: edit.requiredCodeVersion || null,
            requiredConfigVersion: edit.requiredConfigVersion || null,
            requiredTemplateVersion: edit.requiredTemplateVersion || null,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorPayload = payload as { error?: unknown; missingTemplateEvents?: unknown };
        const missing = Array.isArray(errorPayload.missingTemplateEvents) ? ` · חסרה תבנית מקורית ל-${errorPayload.missingTemplateEvents.length} אירועים` : "";
        throw new Error(`${errorPayload.error ? String(errorPayload.error) : `report data returned ${response.status}`}${missing}`);
      }
      if (response.headers.get("x-bluewolf-report-source") !== "core-event-archive") throw new Error("מקור הדוח לא אומת כ-Core event archive");
      const envelope = normalizeInvestigationReportData(payload);
      const pdf = await buildInvestigationPdfWithLifecycle(envelope.report);
      if (pdf.byteLength < 64) throw new Error("PDF report is unexpectedly empty");
      downloadPdf(pdf, envelope.report.generatedAt);
      setReport({ kind: "complete", codeVersion: envelope.codeVersion, configVersion: envelope.configVersion });
      toast.success("דוח PDF בעברית הופק מנתוני Core ובאותה גרסת תוצאה שננעלה בהחלפה רטרואקטיבית");
    } catch (error) { setReport({ kind: "error", detail: error instanceof Error ? error.message : "PDF report failed" }); }
  };

  return <>
    <InvestigationLifecyclePanel server={server} />
    <InvestigationRetroactivePanel server={server} />
    <section className="glass-panel" dir="rtl" data-requirements="REP-01 REP-03 REP-04 OP-04 BW-REP-008 BW-REP-009 BW-REP-011" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 16, flexWrap: "wrap" }}><div><p className="eyebrow">Engineering PDF</p><h3>דוח תחקור לטווח</h3><p className="card-hint">הדוח נטען מארכיון ה-Core ומבצע recomputation אמיתי. override רטרואקטיבי כולל code/config/template provenance מחייב; mismatch עוצר את הדוח ולא מערבב גרסאות.</p></div><FileChartColumn /></div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(190px,1fr) minmax(190px,1fr) auto", gap: 10, alignItems: "end", marginTop: 12 }}>
        <label style={{ display: "grid", gap: 5 }}><span>מתאריך ושעה</span><input type="datetime-local" value={from} onChange={(event) => { setFrom(event.target.value); setReport({ kind: "idle" }); }} /></label>
        <label style={{ display: "grid", gap: 5 }}><span>עד תאריך ושעה</span><input type="datetime-local" value={to} onChange={(event) => { setTo(event.target.value); setReport({ kind: "idle" }); }} /></label>
        <Button onClick={generate} disabled={report.kind === "running"}><Download />{report.kind === "running" ? "מפיק PDF…" : "הפק PDF לטווח"}</Button>
      </div>
      <p className="card-hint">טווח ריק = כל האירועים השמורים. אין `window.print()`, CDN או fallback ל-demo; אירוע ללא provenance עוצר את הדוח.</p>
      {report.kind === "running" && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}><ShieldCheck /><span>מבצע recomputation ומרנדר PDF מקומי. אין אחוז התקדמות ללא telemetry אמיתי.</span></div>}
      {report.kind === "error" && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}><TriangleAlert /><span>{report.detail}</span></div>}
      {report.kind === "complete" && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}><ShieldCheck /><span>PDF RTL + lifecycle אומת · code {report.codeVersion.slice(0, 12)} · config {report.configVersion.slice(0, 12)}</span></div>}
    </section>
  </>;
}
