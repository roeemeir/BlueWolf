"use client";

import { useEffect, useState } from "react";
import { GitCommitHorizontal, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { normalizeCapturedRuntimeProvenance, type CapturedRuntimeProvenance } from "@/lib/runtime-provenance";

type State =
  | { kind: "loading" }
  | { kind: "ready"; provenance: CapturedRuntimeProvenance }
  | { kind: "unavailable"; error: string };

export function GtProvenanceBanner() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/runtime-provenance", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as unknown;
        if (!response.ok) {
          const error = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error ?? "") : "";
          throw new Error(error || "provenance unavailable");
        }
        const provenance = normalizeCapturedRuntimeProvenance(payload);
        if (!cancelled) setState({ kind: "ready", provenance });
      })
      .catch((error) => { if (!cancelled) setState({ kind: "unavailable", error: error instanceof Error ? error.message : "provenance unavailable" }); });
    return () => { cancelled = true; };
  }, []);

  return <section className="glass-panel" dir="rtl" data-requirements="BW-QA-008" data-testid="gt-provenance" style={{ padding: 14, marginBottom: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div><p className="eyebrow">Build / config provenance</p><strong>חותמת גרסה לתרחישי GT</strong><p className="card-hint">בכל שמירת תרחיש השרת מטביע את גרסת הקוד והקונפיגורציה; הערכים אינם מתקבלים מהדפדפן.</p></div>
      {state.kind === "loading" && <Badge variant="outline">טוען provenance…</Badge>}
      {state.kind === "unavailable" && <Badge variant="destructive">לא זמין · {state.error}</Badge>}
      {state.kind === "ready" && <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <Badge variant="outline"><GitCommitHorizontal />code {state.provenance.codeSha.slice(0, 12)}</Badge>
        <Badge variant="outline"><ShieldCheck />config {state.provenance.configVersion.slice(0, 12)}</Badge>
        <Badge variant="outline">{state.provenance.source === "python-core" ? "Python Core" : "Web workspace"}</Badge>
      </div>}
    </div>
  </section>;
}
