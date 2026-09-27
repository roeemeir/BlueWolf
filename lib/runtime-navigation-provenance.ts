// Python Core emits these two fields together for synthetic raw-navigation input.
// The Web may not turn a TEST Core result into an apparently real Influx result
// by dropping a marker during latest/history normalization or checkpoint replay.
export type TestNavigationProvenance = {
  navigationOrigin: "simulation";
  syntheticNavigation: true;
};

export function normalizeTestNavigationProvenance(value: unknown): TestNavigationProvenance | undefined {
  if (!value || typeof value !== "object") {
    throw new Error("runtime navigation source must be an object");
  }
  const source = value as Record<string, unknown>;
  const hasOrigin = source.navigationOrigin !== undefined;
  const hasSynthetic = source.syntheticNavigation !== undefined;
  if (!hasOrigin && !hasSynthetic) return undefined;
  if (source.kind !== "python-core") {
    throw new Error("TEST navigation provenance requires a real python-core result");
  }
  if (source.navigationOrigin !== "simulation" || source.syntheticNavigation !== true) {
    throw new Error("runtime TEST navigation provenance must contain both valid markers");
  }
  return { navigationOrigin: "simulation", syntheticNavigation: true };
}
