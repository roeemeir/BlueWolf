"use client";

import { AlertTriangle, CheckCircle2, Play, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { WorkspaceState } from "@/lib/bluewolf";
import { normalizeQaRun, type QaRunResult } from "@/lib/qa-contract";
import { useWorkspace } from "./app-context";

type WorkspaceWithQaRuns = WorkspaceState & { qaRuns?: QaRunResult[] };
type RunState =
  | { kind: "not-run" }
  | { kind: "running" }
  | { kind: "unavailable"; detail: string }
  | { kind: "error"; detail: string }
  | { kind: "complete"; result: QaRunResult; persisted: boolean };

export function QaTruthWorkbench() {
  const { state: workspace, save, revision } = useWorkspace();
  const [runState, setRunState] = useState<RunState>({ kind: "not-run" });
  const persistedRuns = (workspace as WorkspaceWithQaRuns).qaRuns ?? [];

  const runQa = async () => {
    setRunState({ kind: "running" });
    try {
      const configVersion = String(revision);
      const response = await fetch("/api/qa/run", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({ scenarioId: "full-regression", configVersion }),
      });
      const payload = await response.json() as unknown;
      if (response.status === 503) {
        const detail = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : "QA runner unavailable";
        setRunState({ kind: "unavailable", detail });
        return;
      }
      if (!response.ok) {
        const detail = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `QA request failed (${response.status})`;
        setRunState({ kind: "error", detail });
        return;
      }
      const result = normalizeQaRun(payload);
      const nextRuns = [result, ...persistedRuns.filter((item) => item.runId !== result.runId)].slice(0, 100);
      const nextWorkspace = { ...workspace, qaRuns: nextRuns } as WorkspaceState;
      const persisted = await save(nextWorkspace, "qa", "core-run", `${result.runId} · ${result.codeSha} · config ${result.configVersion}`);
      setRunState({ kind: "complete", result, persisted });
    } catch (error) {
      setRunState({ kind: "unavailable", detail: error instanceof Error ? error.message : "QA runner unavailable" });
    }
  };

  const completed = runState.kind === "complete" ? runState.result : null;
  const total = completed?.categories.reduce((sum, category) => sum + category.scenarios, 0) ?? null;
  const passed = completed?.categories.reduce((sum, category) => sum + category.passed, 0) ?? null;

  return <section className="glass-panel" style={{ margin: "0 0 16px", padding: 18 }} data-requirements="BW-DEV-010 BW-DEV-011 BW-DEV-012 BW-DEV-013 BW-DEV-014 BW-QA-004">
    <header className="developer-section-header" style={{ marginBottom: 14 }}><div><p className="eyebrow">Truth-backed QA</p><h2>GT / QA מול Python Core</h2><p>אין מספרים קבועים ואין progress מומצא. עד שה-Core מחזיר חוזה ריצה תקף, הסטטוס הוא missing/not run או unavailable. ריצה תקפה נשמרת עם scenario, SHA וגרסת קונפיגורציה.</p></div><Button onClick={runQa} disabled={runState.kind === "running"}><Play />{runState.kind === "running" ? "מריץ…" : "הרץ QA אמיתי"}</Button></header>

    {runState.kind === "not-run" && <div className="empty-state"><ShieldCheck /><strong>missing / not run</strong><span>לא קיימת עדיין תוצאת QA אמיתית לסשן הזה.</span></div>}
    {runState.kind === "running" && <div className="empty-state"><ShieldCheck /><strong>running</strong><span>ממתין לתוצאה מה-Python Core. לא מוצג אחוז התקדמות ללא telemetry אמיתי.</span></div>}
    {runState.kind === "unavailable" && <div className="empty-state"><AlertTriangle /><strong>QA runner unavailable</strong><span>{runState.detail}</span></div>}
    {runState.kind === "error" && <div className="empty-state"><XCircle /><strong>QA run failed</strong><span>{runState.detail}</span></div>}
    {runState.kind === "complete" && !runState.persisted && <div className="empty-state"><AlertTriangle /><strong>הריצה הסתיימה אך לא נשמרה</strong><span>התוצאה מוצגת כרגע, אך אינה מסומנת כריצת QA שמורה.</span></div>}
    {completed && <><div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}><Badge variant="outline">run {completed.runId}</Badge><Badge variant="outline">scenario {completed.scenarioId}</Badge><Badge variant="outline">code {completed.codeSha.slice(0, 10)}</Badge><Badge variant="outline">config {completed.configVersion}</Badge><Badge variant={completed.passed ? "default" : "destructive"}>{completed.passed ? <CheckCircle2 /> : <XCircle />}{passed}/{total}</Badge></div><div style={{ display: "grid", gap: 10 }}>{completed.categories.map((category) => <article key={category.id} className="glass-panel" style={{ padding: 12 }}><header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><div><strong>{category.title}</strong><div>{category.passed} passed · {category.failed} failed · {category.scenarios} scenarios</div></div><div>{category.p50Ms === undefined ? "p50 missing" : `p50 ${category.p50Ms}ms`} · {category.p95Ms === undefined ? "p95 missing" : `p95 ${category.p95Ms}ms`}</div></header><Progress value={category.scenarios ? category.passed / category.scenarios * 100 : 0} /></article>)}</div></>}

    <div style={{ marginTop: 16 }}><div className="panel-title"><div><p className="eyebrow">QA history</p><h3>ריצות שמורות</h3></div><Badge variant="outline">{persistedRuns.length}/100</Badge></div>{persistedRuns.length === 0 ? <p>אין עדיין ריצות QA שמורות.</p> : <div style={{ display: "grid", gap: 8 }}>{persistedRuns.slice(0, 10).map((run) => <div key={run.runId} className="glass-panel" style={{ padding: 10, display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}><strong>{run.scenarioId}</strong><span>{run.codeSha.slice(0, 10)} · config {run.configVersion}</span><span>{new Date(run.startedAt).toLocaleString("he-IL")}</span><Badge variant={run.passed ? "default" : "destructive"}>{run.passed ? "pass" : "fail"}</Badge></div>)}</div>}</div>
  </section>;
}
