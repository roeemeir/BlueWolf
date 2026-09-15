"use client";

import { useWorkspace } from "./app-context";
import { DeveloperView } from "./developer-view";
import { QaTruthWorkbench } from "./qa-truth-workbench";
import { RouteBankWktWorkbench } from "./route-bank-wkt-workbench";
import { TemplateGovernanceWorkbench } from "./template-governance-workbench";
import { VehicleRangeWorkbench } from "./vehicle-range-workbench";

export function DeveloperGovernanceWorkbench() {
  const { revision } = useWorkspace();
  return <>
    <TemplateGovernanceWorkbench />
    <RouteBankWktWorkbench key={`route-bank-${revision}`} />
    <VehicleRangeWorkbench />
    <QaTruthWorkbench />
    <div className="protected-legacy-developer">
      <style>{`
        .protected-legacy-developer .developer-nav nav > button:nth-child(2),
        .protected-legacy-developer .developer-nav nav > button:nth-child(3),
        .protected-legacy-developer .developer-nav nav > button:nth-child(6),
        .protected-legacy-developer .developer-nav .core-state {
          display: none !important;
        }
      `}</style>
      <DeveloperView />
    </div>
  </>;
}
