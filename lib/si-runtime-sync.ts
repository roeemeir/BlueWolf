import type { SyncTemplate, VehicleType } from "./bluewolf";
import { buildOperationalSiConfig } from "./si-runtime-config";

export type SITemplateRuntimeSyncResult = {
  synced: boolean;
  configPath: string | null;
  restartRequired: boolean;
  templateCount: number;
  reason?: string;
};

export async function syncSiTemplatesToOperationalConfig(
  templates: readonly SyncTemplate[],
  vehicleTypes: readonly VehicleType[],
): Promise<SITemplateRuntimeSyncResult> {
  const configuredPath = process.env.BLUEWOLF_OPERATIONAL_CONFIG?.trim();
  if (!configuredPath) {
    return {
      synced: false,
      configPath: null,
      restartRequired: false,
      templateCount: 0,
      reason: "BLUEWOLF_OPERATIONAL_CONFIG is not configured",
    };
  }

  const fsModule = "node:fs/promises";
  const pathModule = "node:path";
  const fs = await import(/* webpackIgnore: true */ /* @vite-ignore */ fsModule);
  const path = await import(/* webpackIgnore: true */ /* @vite-ignore */ pathModule);
  const configPath = path.resolve(configuredPath);
  const raw = await fs.readFile(configPath, "utf8");
  const existing = JSON.parse(raw) as unknown;
  const next = buildOperationalSiConfig(existing, templates, vehicleTypes);
  const templateCount = Array.isArray((next as { siTemplates?: unknown }).siTemplates)
    ? ((next as { siTemplates: unknown[] }).siTemplates.length)
    : 0;
  const temp = `${configPath}.si-templates-${process.pid}-${Date.now()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, configPath);
  } catch (error) {
    try { await fs.unlink(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
  return { synced: true, configPath, restartRequired: true, templateCount };
}
