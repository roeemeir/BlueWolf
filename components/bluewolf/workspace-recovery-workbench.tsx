"use client";

import { History, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "./app-context";

type VersionRow = {
  revision: number;
  category: string;
  action: string;
  detail: string;
  createdAt: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "unavailable"; detail: string }
  | { kind: "ready"; versions: VersionRow[] };

export function WorkspaceRecoveryWorkbench() {
  const { revision } = useWorkspace();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspace/versions", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { versions?: VersionRow[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "version history unavailable");
        if (!cancelled) setState({ kind: "ready", versions: payload.versions ?? [] });
      })
      .catch((error) => {
        if (!cancelled) setState({ kind: "unavailable", detail: error instanceof Error ? error.message : "version history unavailable" });
      });
    return () => { cancelled = true; };
  }, [revision]);

  const restore = async (sourceRevision: number) => {
    setRestoring(sourceRevision);
    try {
      const response = await fetch("/api/workspace/versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: sourceRevision, expectedRevision: revision }),
      });
      const payload = await response.json() as { revision?: number; restoredFrom?: number; error?: string };
      if (response.status === 409) throw new Error("הקונפיגורציה השתנתה במקביל; רענן לפני שחזור");
      if (!response.ok) throw new Error(payload.error || "restore failed");
      toast.success(`revision ${sourceRevision} שוחזר כגרסה חדשה ${payload.revision}`);
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השחזור נכשל");
      setRestoring(null);
    }
  };

  return <section className="glass-panel" data-requirements="ARCH-01" data-testid="workspace-recovery-workbench" style={{ margin: "0 0 16px", padding: 18 }}>
    <header className="developer-section-header" style={{ marginBottom: 14 }}>
      <div><p className="eyebrow">ARCH-01 · SQLite Recovery</p><h2>גרסאות ושחזור קונפיגורציה</h2><p>כל שמירה מקומית נשמרת כ־snapshot בלתי־משתנה. שחזור יוצר revision חדש ואינו מוחק את ההיסטוריה.</p></div>
      <Badge variant="outline"><History /> current v{revision}</Badge>
    </header>
    {state.kind === "loading" && <p>טוען היסטוריית גרסאות…</p>}
    {state.kind === "unavailable" && <p>היסטוריית גרסאות זמינה רק בחבילת האופליין עם SQLite: {state.detail}</p>}
    {state.kind === "ready" && state.versions.length === 0 && <p>אין עדיין גרסאות שמורות.</p>}
    {state.kind === "ready" && state.versions.length > 0 && <div style={{ display: "grid", gap: 8 }}>
      {state.versions.slice(0, 20).map((item) => <article key={item.revision} className="glass-panel" style={{ padding: 10, display: "grid", gridTemplateColumns: "90px 1fr auto", gap: 12, alignItems: "center" }}>
        <strong>v{item.revision}</strong>
        <div><b>{item.category} · {item.action}</b><div style={{ fontSize: 11, opacity: .72 }}>{item.detail || "—"} · {new Date(item.createdAt).toLocaleString("he-IL")}</div></div>
        <Button variant="outline" disabled={item.revision === revision || restoring !== null} onClick={() => restore(item.revision)}><RotateCcw />{restoring === item.revision ? "משחזר…" : "שחזר"}</Button>
      </article>)}
    </div>}
  </section>;
}
