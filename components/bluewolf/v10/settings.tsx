"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "../app-context";
import { V09Settings } from "../v09/infra-settings";

export function V10Settings() {
  const { state, save } = useWorkspace();
  const currentSettings = state.settings as typeof state.settings & { trailHistoryMinutes?: number };
  const [trailHistoryMinutes, setTrailHistoryMinutes] = useState(currentSettings.trailHistoryMinutes ?? 30);

  const saveLiveDisplay = async () => {
    const nextSettings = { ...state.settings, trailHistoryMinutes: Math.max(5, Math.min(240, Math.round(trailHistoryMinutes))) };
    await save({ ...state, settings: nextSettings }, "settings", "live-display-v10", `trail=${nextSettings.trailHistoryMinutes}`);
    toast.success(`עקבה חיה נשמרה: ${nextSettings.trailHistoryMinutes} דקות`);
  };

  return <div className="v10-settings"><section className="v09-panel v10-live-settings"><div className="v09-panel-head"><div><p className="eyebrow">LIVE DISPLAY · SRS v1.2</p><h3>היסטוריית עקבה</h3><p>ברירת המחדל היא 30 דקות. הערך נשמר ב־Workspace ומשמש את המפה החיה.</p></div><button className="primary" onClick={saveLiveDisplay}><Save />שמור תצוגה</button></div><label>דקות עקבה<input type="number" min="5" max="240" value={trailHistoryMinutes} onChange={(event) => setTrailHistoryMinutes(Number(event.target.value))} /></label><div className="v10-trail-presets">{[15, 30, 60, 120].map((value) => <button key={value} className={trailHistoryMinutes === value ? "active" : ""} onClick={() => setTrailHistoryMinutes(value)}>{value} דק׳</button>)}</div></section><V09Settings /></div>;
}
