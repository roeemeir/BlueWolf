export const CORE_API_VERSION = "1.0.0" as const;

export type CoreFamily = "SI" | "SO";
export type SoRelation = "same" | "opposite" | "mixed";
export type GroupKey = "si" | "so";
export type RouteKind = "circle" | "single" | "double";

export type ScoreWeights = {
  sync: { position: number; period: number; motion: number };
  route: { distance: number; tangent: number; curvature: number };
  total: { sync: number; route: number };
};

export type ScoreThresholds = {
  siPositionFullDeg: number;
  siPositionZeroDeg: number;
  soPositionFullPct: number;
  soPositionZeroPct: number;
  periodFullPct: number;
  periodZeroPct: number;
  motionFullPct: number;
  motionZeroPct: number;
  routeDistanceFullPct: number;
  routeDistanceZeroPct: number;
  tangentFullDeg: number;
  tangentZeroDeg: number;
  curvatureFullPct: number;
  curvatureZeroPct: number;
  lowSpeedPct: number;
  smoothingSeconds: number;
  greenScore: number;
  redScore: number;
};

export type CoreTemplate = {
  id?: string;
  family: CoreFamily;
  values: number[];
  soSpec?: { relations?: SoRelation[] };
};

export type SoGroupingSettings = {
  maxParallelLegs: number;
  maxLateralLegs: number;
  maxAngleDeg: number;
};

export const DEFAULT_SO_GROUPING: SoGroupingSettings = {
  maxParallelLegs: 1.5,
  maxLateralLegs: 0.35,
  maxAngleDeg: 20,
};

export type SoGeometryDescriptor = {
  kind: "single" | "double";
  center: { x: number; y: number };
  radius: number;
  legLength: number;
  rotationDeg: number;
  secondLegLength?: number;
  bendDeg?: number;
};

export type RawNavigationSample = {
  source: "simulation" | "influx";
  serverId: string;
  timestamp: string;
  vehicleId: number;
  active: boolean;
  latitude: number;
  longitude: number;
  altitude: number;
  velocityNorth: number;
  velocityEast: number;
  x: number;
  y: number;
};

export type NavigationProvenance = {
  source: "simulation" | "influx";
  serverId: string;
  from: string;
  to: string;
  latestSampleAt: string | null;
  sampleCount: number;
  vehicleCount: number;
  samplingMedianSeconds: number | null;
  completenessPct: number | null;
  freshnessSeconds: number | null;
  warnings: string[];
};

export type NavigationDataset = {
  samples: RawNavigationSample[];
  provenance: NavigationProvenance;
};

export type ScoreBreakdown = {
  total: number;
  sync: number;
  route: number;
  position: number;
  period: number;
  motion: number;
  distance: number;
  tangent: number;
  curvature: number;
};

export type DerivedWindEstimate = {
  speedKnots: number;
  bearingDeg: number;
  confidencePct: number;
  residualNorth: number;
  residualEast: number;
};

export type DerivedVehicleEvidence = {
  id: number;
  kind: RouteKind;
  routeScore: number;
  sync: number;
  total: number;
  routeDeviation: number;
  routeDeviationPct: number;
  tangentErrorDeg: number;
  periodSec: number | null;
  periodErrorPct: number;
  motionErrorPct: number;
  phase: number;
  direction: 1 | -1;
  wind: DerivedWindEstimate;
};

export type DerivedRoute = {
  key: string;
  vehicleId: number;
  kind: RouteKind;
  points: { x: number; y: number }[];
  geometry?: SoGeometryDescriptor;
  centerMetric: { x: number; y: number };
  rotationDeg: number;
  radius: number;
  legLength: number;
  periodSec: number | null;
};

export type DerivedGroup = {
  key: GroupKey;
  id: string;
  name: string;
  family: CoreFamily;
  members: number[];
  score: ScoreBreakdown;
  routeScore: number;
  observedAngles: number[];
  observedRelations: SoRelation[];
  periodErrorPct: number;
  motionErrorPct: number;
  vehicles: Record<number, DerivedVehicleEvidence>;
};

export type DerivedAlert = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  vehicleIds: number[];
  evidence: string[];
};

export type CoreAnalysis = {
  coreApiVersion: typeof CORE_API_VERSION;
  available: boolean;
  provenance: NavigationProvenance;
  routes: DerivedRoute[];
  groups: { si: DerivedGroup; so: DerivedGroup };
  ungroupedVehicles: number[];
  current: Record<number, { x: number; y: number; headingDeg: number; latitude: number; longitude: number; timestamp: string }>;
  alerts: DerivedAlert[];
  groupingNotes: string[];
};

export type CoreConfig = {
  thresholds: ScoreThresholds;
  weights: ScoreWeights;
  siTemplate?: CoreTemplate;
  soTemplate?: CoreTemplate;
  groupingSettings?: SoGroupingSettings;
};

export type AnalysisFrame = { timestamp: string; analysis: CoreAnalysis };
export type DerivedEvent = {
  id: string;
  index: number;
  start: string;
  end: string;
  family: CoreFamily;
  groupKey: GroupKey;
  members: number[];
  startReason: string;
  endReason: string;
  startEvidence: string[];
  endEvidence: string[];
  frames: AnalysisFrame[];
  representative: CoreAnalysis;
};
