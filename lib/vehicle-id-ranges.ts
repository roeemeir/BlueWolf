import type { VehicleIdRange, VehicleType } from "./bluewolf";

export type VehicleProfile = {
  typeId: string;
  typeName: string;
  workSpeedKmh: number;
};

export function vehicleTypeRanges(type: Pick<VehicleType, "minId" | "maxId" | "idRanges">): VehicleIdRange[] {
  const configured = Array.isArray(type.idRanges) && type.idRanges.length ? type.idRanges : [{ minId: type.minId, maxId: type.maxId }];
  return configured.map((range) => ({ minId: Number(range.minId), maxId: Number(range.maxId) }));
}

export function withVehicleTypeRanges(type: VehicleType, ranges: VehicleIdRange[]): VehicleType {
  const normalized = ranges.length ? ranges.map((range) => ({ minId: Number(range.minId), maxId: Number(range.maxId) })) : [{ minId: type.minId, maxId: type.maxId }];
  return { ...type, minId: normalized[0].minId, maxId: normalized[0].maxId, idRanges: normalized };
}

export function validateVehicleIdRanges(vehicleTypes: Pick<VehicleType, "id" | "name" | "minId" | "maxId" | "idRanges" | "workSpeedKmh">[]) {
  const ranges = vehicleTypes.flatMap((type) => {
    if (!Number.isFinite(type.workSpeedKmh) || type.workSpeedKmh <= 0) {
      throw new Error(`מהירות העבודה של ${type.name} חייבת להיות חיובית`);
    }
    // The single-range legacy aliases remain persisted alongside idRanges.
    // Reject malformed aliases as well: a valid new range must not conceal
    // a corrupt legacy interval that another consumer could still read.
    if (!Number.isInteger(type.minId) || !Number.isInteger(type.maxId) || type.minId < 0 || type.maxId < type.minId) {
      throw new Error(`טווח המזהים של ${type.name} אינו חוקי`);
    }
    const configured = vehicleTypeRanges(type);
    if (!configured.length) throw new Error(`ל-${type.name} חייב להיות לפחות טווח מזהים אחד`);
    return configured.map((range, rangeIndex) => {
      if (!Number.isInteger(range.minId) || !Number.isInteger(range.maxId) || range.minId < 0 || range.maxId < range.minId) {
        throw new Error(`טווח המזהים ${rangeIndex + 1} של ${type.name} אינו חוקי`);
      }
      return { ...range, typeId: type.id, typeName: type.name, rangeIndex };
    });
  }).sort((a, b) => a.minId - b.minId || a.maxId - b.maxId || a.typeId.localeCompare(b.typeId));

  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1];
    const current = ranges[index];
    if (current.minId <= previous.maxId) {
      throw new Error(`טווחי מזהים חופפים: ${previous.typeName} [${previous.minId}–${previous.maxId}] ו-${current.typeName} [${current.minId}–${current.maxId}]`);
    }
  }
  return ranges;
}

export function vehicleTypeMatchesId(vehicleNumber: number, type: VehicleType) {
  if (!Number.isInteger(vehicleNumber) || vehicleNumber < 0) return false;
  return vehicleTypeRanges(type).some((range) => vehicleNumber >= range.minId && vehicleNumber <= range.maxId);
}

export function resolveVehicleProfile(vehicleNumber: number, vehicleTypes: VehicleType[]): VehicleProfile | null {
  if (!Number.isInteger(vehicleNumber) || vehicleNumber < 0) return null;
  validateVehicleIdRanges(vehicleTypes);
  const type = vehicleTypes.find((candidate) => vehicleTypeMatchesId(vehicleNumber, candidate));
  return type ? { typeId: type.id, typeName: type.name, workSpeedKmh: type.workSpeedKmh } : null;
}
