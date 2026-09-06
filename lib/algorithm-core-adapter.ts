import type { ScoreThresholds, ScoreWeights, SyncTemplate } from "@/lib/bluewolf";
import {
  CORE_API_VERSION,
  analyzeNavigationDataset as runCore,
  buildAnalysisHistory as buildCoreHistory,
  compareMembership,
  deriveEvents as deriveCoreEvents,
  type AnalysisFrame,
  type CoreAnalysis,
  type CoreConfig,
  type DerivedEvent,
  type NavigationDataset as CoreNavigationDataset,
  type SoGroupingSettings,
} from "@/packages/bluewolf-core/src/index";

export { CORE_API_VERSION, compareMembership };
export type { AnalysisFrame, CoreAnalysis as NavigationDerivedAnalysis, DerivedEvent };

export type AppCoreOptions = {
  thresholds: ScoreThresholds;
  weights: ScoreWeights;
  siTemplate?: SyncTemplate;
  soTemplate?: SyncTemplate;
  groupingSettings: SoGroupingSettings;
};

function coreConfig(options: AppCoreOptions): CoreConfig {
  return {
    thresholds: options.thresholds,
    weights: options.weights,
    siTemplate: options.siTemplate,
    soTemplate: options.soTemplate,
    groupingSettings: options.groupingSettings,
  };
}

/**
 * The only production boundary between application state/data adapters and the
 * replaceable algorithm core. No persistence, React or network behavior belongs
 * behind this function.
 */
export function analyzeNavigationDataset(dataset: CoreNavigationDataset, options: AppCoreOptions): CoreAnalysis {
  return runCore(dataset, coreConfig(options));
}

export function buildAnalysisHistory(dataset: CoreNavigationDataset, options: AppCoreOptions, maxFrames = 61, lookbackMinutes = 12): AnalysisFrame[] {
  return buildCoreHistory(dataset, coreConfig(options), maxFrames, lookbackMinutes);
}

export function deriveEvents(history: AnalysisFrame[], thresholds: ScoreThresholds): DerivedEvent[] {
  return deriveCoreEvents(history, thresholds);
}
