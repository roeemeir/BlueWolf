"use client";

import { QaTruthWorkbench } from "./qa-truth-workbench";
import { RouteBankWktWorkbench } from "./route-bank-wkt-workbench";
import { VehicleRangeWorkbench } from "./vehicle-range-workbench";

export function DeveloperGovernanceWorkbench() {
  return <>
    <RouteBankWktWorkbench />
    <VehicleRangeWorkbench />
    <QaTruthWorkbench />
  </>;
}
