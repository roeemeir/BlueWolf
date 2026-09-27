import { scoreLayerDasharray } from "@/lib/operator-timeline";
import type { ScoreLayer } from "./visuals";

const SCORE_ZONES = [
  { id: "good", label: "טוב", range: "80–100" },
  { id: "medium", label: "בינוני", range: "50–79" },
  { id: "low", label: "נמוך", range: "<50" },
] as const;

const LAYER_LABELS: Record<ScoreLayer, string> = {
  total: "כולל",
  sync: "סנכרון",
  route: "נתיב",
};

export function ScoreLegend({ layers, showEvents = false }: { layers: ScoreLayer[]; showEvents?: boolean }) {
  const visibleLayers = (["total", "sync", "route"] as ScoreLayer[]).filter((layer) => layers.includes(layer));
  return <div className="score-legend" data-requirement="BW-UI-013" aria-label="מקרא ציונים">
    <div className="score-legend-section" aria-label="אזורי ציון">
      {SCORE_ZONES.map((zone) => <span key={zone.id} className="score-legend-item"><i className={`score-legend-zone ${zone.id}`} /><b>{zone.label}</b><small>{zone.range}</small></span>)}
    </div>
    <span className="score-legend-separator" aria-hidden="true" />
    <div className="score-legend-section" aria-label="סגנונות קו">
      {visibleLayers.map((layer) => <span key={layer} className="score-legend-item"><svg width="30" height="8" viewBox="0 0 30 8" aria-hidden="true"><line x1="1" x2="29" y1="4" y2="4" className="score-legend-line" strokeDasharray={scoreLayerDasharray(layer)} /></svg><b>{LAYER_LABELS[layer]}</b></span>)}
    </div>
    {showEvents && <><span className="score-legend-separator" aria-hidden="true" /><span className="score-legend-item"><i className="score-legend-event" /><b>אירוע</b><small>פס תחתון</small></span></>}
  </div>;
}
