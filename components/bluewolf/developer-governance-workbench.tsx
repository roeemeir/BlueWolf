"use client";

import { useWorkspace } from "./app-context";
import { DeveloperView } from "./developer-view";
import { GtScenarioWorkbench } from "./gt-scenario-workbench";
import { InfluxGovernanceWorkbench } from "./influx-governance-workbench";
import { MapSourceGovernanceWorkbench } from "./map-source-governance-workbench";
import { QaTruthWorkbench } from "./qa-truth-workbench";
import { RouteBankWktWorkbench } from "./route-bank-wkt-workbench";
import { SoTemplateGovernanceWorkbench } from "./so-template-governance-workbench";
import { TemplateGovernanceWorkbench } from "./template-governance-workbench";
import { VehicleRangeWorkbench } from "./vehicle-range-workbench";
import { WorkspaceRecoveryWorkbench } from "./workspace-recovery-workbench";

export function DeveloperGovernanceWorkbench() {
  const { revision } = useWorkspace();
  return <>
    <style>{`
      /* SI-01: desktop hover previews a legal empty placement without changing state.
         Touch/click remains the source of placement; forbidden and occupied slots are untouched. */
      [data-testid="si-direct-ring-board"] g[data-testid^="si-slot-"]:hover > circle[fill="transparent"][opacity="0.65"] {
        fill: currentColor !important;
        opacity: 0.22 !important;
        stroke-width: 2.5 !important;
      }
      [data-testid="si-direct-ring-board"] g[data-testid^="si-slot-"]:focus-visible > circle[fill="transparent"][opacity="0.65"] {
        fill: currentColor !important;
        opacity: 0.22 !important;
        stroke-width: 2.5 !important;
      }
      /* SO-01/SO-02: the temporary selector-based SO editor is not an active editing path.
         The dedicated direct SO workbench below is the only SO authoring surface. */
      [data-testid="template-governance-workbench"] .v04-family-switch > button:nth-child(2) {
        display: none !important;
      }
    `}</style>
    <TemplateGovernanceWorkbench />
    <SoTemplateGovernanceWorkbench />
    <RouteBankWktWorkbench key={`route-bank-${revision}`} />
    <GtScenarioWorkbench />
    <VehicleRangeWorkbench />
    <InfluxGovernanceWorkbench />
    <MapSourceGovernanceWorkbench />
    <WorkspaceRecoveryWorkbench />
    <QaTruthWorkbench />
    <div className="protected-legacy-developer">
      <style>{`
        .protected-legacy-developer .developer-nav nav > button:nth-child(2),
        .protected-legacy-developer .developer-nav nav > button:nth-child(3),
        .protected-legacy-developer .developer-nav nav > button:nth-child(4),
        .protected-legacy-developer .developer-nav nav > button:nth-child(6),
        .protected-legacy-developer .developer-nav .core-state {
          display: none !important;
        }
      `}</style>
      <DeveloperView />
    </div>
  </>;
}
