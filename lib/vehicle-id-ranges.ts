import type { VehicleType } from "./bluewolf";

export type VehicleProfile = {
  typeId: string;
  typeName: string;
  workSpeedKmh: number;
};

export function validateVehicleIdRanges(vehicleTypes: Pick<VehicleType, "id" | "name" | "minId" | "maxId" | "workSpeedKmh">[]) {
  const ranges = vehicleTypes.map((type) => {
    if (!Number.isInteger(type.minId) || !Number.isInteger(type.maxId) || type.minId < 0 || type.maxId < type.minId) {
      throw new Error(`טווח המזהים של ${type.name} אינו חוקי`);
    }
    if (!Number.isFinite(type.workSpeedKmh) || type.workSpeedKmh <= 0) {
      throw new Error(`מהירות העבודה של ${type.name} חייבת להיות חיובית`);
    }
    return type;
  }).sort((a, b) => a.minId - b.minId || a.maxId - b.maxId);

  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1];
    const current = ranges[index];
    if (current.minId <= previous.maxId) {
      throw new Error(`טווחי מזהים חופפים: ${previous.name} ו-${current.name}`);
    }
  }
  return ranges;
}

export function resolveVehicleProfile(vehicleNumber: number, vehicleTypes: VehicleType[]): VehicleProfile | null {
  if (!Number.isInteger(vehicleNumber) || vehicleNumber < 0) return null;
  validateVehicleIdRanges(vehicleTypes);
  const type = vehicleTypes.find((candidate) => vehicleNumber >= candidate.minId && vehicleNumber <= candidate.maxId);
  return type ? { typeId: type.id, typeName: type.name, workSpeedKmh: type.workSpeedKmh } : null;
}
