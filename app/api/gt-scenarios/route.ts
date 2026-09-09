import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { auditEntries, groundTruthLabels, gtScenarioGroups, gtScenarios } from "@/db/schema";

const workspacePattern = /^[a-zA-Z0-9_-]{8,80}$/;
const MAX_JSON_BYTES = 500_000;

function workspaceId(request: Request) {
  const value = request.headers.get("x-bluewolf-workspace") ?? "";
  return workspacePattern.test(value) ? value : null;
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function jsonText(value: unknown, fallback: unknown) {
  const serialized = JSON.stringify(value ?? fallback);
  if (new TextEncoder().encode(serialized).byteLength > MAX_JSON_BYTES) throw new Error("GT payload field is too large");
  return serialized;
}

function dbError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return message.includes("no such table") || message.includes("D1 binding")
    ? "מסד נתוני ה־GT עדיין אינו זמין בפריסה זו."
    : message;
}

export async function GET(request: Request) {
  const id = workspaceId(request);
  if (!id) return Response.json({ error: "workspace id is required" }, { status: 400 });
  try {
    const db = getDb();
    const scenarios = await db.select().from(gtScenarios).where(eq(gtScenarios.workspaceId, id)).orderBy(desc(gtScenarios.createdAt)).limit(100);
    const groups = await db.select().from(gtScenarioGroups);
    const labels = await db.select().from(groundTruthLabels).where(eq(groundTruthLabels.workspaceId, id));
    return Response.json({
      scenarios: scenarios.map((scenario) => ({
        ...scenario,
        groups: groups.filter((group) => group.scenarioId === scenario.id).map((group) => ({
          ...group,
          members: JSON.parse(group.membersJson),
          vehicleTypes: JSON.parse(group.vehicleTypesJson),
          routeGeometry: JSON.parse(group.routeGeometryJson),
          syncRules: JSON.parse(group.syncRulesJson),
          scoreProfile: JSON.parse(group.scoreProfileJson),
          labels: labels.filter((label) => label.scenarioId === scenario.id && label.groupId === group.groupId),
        })),
      })),
    });
  } catch (error) {
    return Response.json({ error: dbError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const id = workspaceId(request);
  if (!id) return Response.json({ error: "workspace id is required" }, { status: 400 });
  try {
    const body = await request.json() as {
      id?: string;
      name?: string;
      serverId?: string;
      arena?: string;
      startUtc?: string;
      endUtc?: string;
      status?: "draft" | "approved";
      manualScore?: number;
      notes?: string;
      configVersion?: number;
      algorithmVersion?: string;
      groups?: Array<{
        id?: string;
        groupId?: string;
        family?: "SI" | "SO" | "FREE";
        members?: unknown[];
        vehicleTypes?: unknown;
        routeGeometry?: unknown;
        syncRules?: unknown;
        scoreProfile?: unknown;
        labels?: Array<{ layer: "sync" | "route" | "total"; score: number; quality?: "good" | "medium" | "low" }>;
      }>;
    };
    if (!body.serverId || !validIso(body.startUtc) || !validIso(body.endUtc) || Date.parse(body.startUtc) >= Date.parse(body.endUtc)) {
      return Response.json({ error: "valid serverId/startUtc/endUtc are required" }, { status: 400 });
    }
    if (!Array.isArray(body.groups) || body.groups.length === 0) return Response.json({ error: "GT scenario requires at least one group" }, { status: 400 });
    const normalizedGroups = body.groups.map((group, index) => {
      if (!group.groupId || (group.family !== "SI" && group.family !== "SO" && group.family !== "FREE")) throw new Error(`GT group ${index} is invalid`);
      if (!Array.isArray(group.members) || group.members.length === 0) throw new Error(`GT group ${group.groupId} requires members`);
      for (const label of group.labels ?? []) {
        if (!Number.isFinite(label.score) || label.score < 0 || label.score > 100) throw new Error(`GT label score for ${group.groupId} must be in [0,100]`);
      }
      return group;
    });

    const scenarioId = body.id?.slice(0, 120) || `gt-${crypto.randomUUID()}`;
    const db = getDb();
    const statements = [
      db.insert(gtScenarios).values({
        id: scenarioId,
        workspaceId: id,
        name: (body.name ?? "").slice(0, 180),
        serverId: body.serverId.slice(0, 80),
        arena: body.arena?.slice(0, 120),
        startUtc: body.startUtc,
        endUtc: body.endUtc,
        status: body.status ?? "draft",
        manualScore: Number.isFinite(body.manualScore) ? Math.round(body.manualScore!) : undefined,
        notes: (body.notes ?? "").slice(0, 4000),
        configVersion: Number.isInteger(body.configVersion) ? body.configVersion : undefined,
        algorithmVersion: body.algorithmVersion?.slice(0, 100),
      }),
      ...normalizedGroups.map((group) => db.insert(gtScenarioGroups).values({
        id: group.id?.slice(0, 120) || `gtg-${crypto.randomUUID()}`,
        scenarioId,
        groupId: group.groupId!,
        family: group.family!,
        membersJson: jsonText(group.members, []),
        vehicleTypesJson: jsonText(group.vehicleTypes, {}),
        routeGeometryJson: jsonText(group.routeGeometry, {}),
        syncRulesJson: jsonText(group.syncRules, {}),
        scoreProfileJson: jsonText(group.scoreProfile, {}),
      })),
      ...normalizedGroups.flatMap((group) => (group.labels ?? []).map((label) => db.insert(groundTruthLabels).values({
        workspaceId: id,
        scenarioId,
        groupId: group.groupId!,
        layer: label.layer,
        score: Math.round(label.score),
        quality: label.quality,
        startUtc: body.startUtc,
        endUtc: body.endUtc,
      }))),
      db.insert(auditEntries).values({ workspaceId: id, category: "gt", action: body.status === "approved" ? "approve-scenario" : "create-scenario", detail: `${scenarioId} · ${normalizedGroups.length} groups`, entityType: "gt_scenario", entityId: scenarioId, configVersion: body.configVersion, algorithmVersion: body.algorithmVersion?.slice(0, 100) }),
    ];
    await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
    return Response.json({ ok: true, scenarioId, groupCount: normalizedGroups.length });
  } catch (error) {
    return Response.json({ error: dbError(error) }, { status: 400 });
  }
}
