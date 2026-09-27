import type { EventRecomputeResult } from "@/lib/investigation-contract";

export type RetroactiveEventCandidate = {
  eventId: string;
  serverId: number;
};

export type RetroactiveTemplateApplyResult = {
  results: EventRecomputeResult[];
  persisted: boolean;
};

type RecomputeEvent = (eventId: string, templateId: string) => Promise<EventRecomputeResult>;
type PersistBatch = (results: EventRecomputeResult[]) => Promise<boolean>;

export async function applyRetroactiveTemplateBatch({
  candidates,
  templateId,
  recompute,
  persist,
}: {
  candidates: RetroactiveEventCandidate[];
  templateId: string;
  recompute: RecomputeEvent;
  persist: PersistBatch;
}): Promise<RetroactiveTemplateApplyResult> {
  const resolvedTemplateId = templateId.trim();
  if (!resolvedTemplateId) throw new Error("retroactive templateId is required");
  if (!candidates.length) throw new Error("at least one investigation event must be selected");

  const eventIds = candidates.map((item) => item.eventId.trim());
  if (eventIds.some((eventId) => !eventId)) throw new Error("retroactive eventId is required");
  if (new Set(eventIds).size !== eventIds.length) throw new Error("retroactive event ids must be unique");
  const serverIds = new Set(candidates.map((item) => item.serverId));
  if (serverIds.size !== 1) throw new Error("retroactive batch must belong to one server");

  const results: EventRecomputeResult[] = [];
  for (const candidate of candidates) {
    const result = await recompute(candidate.eventId, resolvedTemplateId);
    if (result.eventId !== candidate.eventId) {
      throw new Error(`Core returned a different event for ${candidate.eventId}`);
    }
    if (result.serverId !== candidate.serverId) {
      throw new Error(`Core returned a different server for ${candidate.eventId}`);
    }
    if (result.templateId !== resolvedTemplateId) {
      throw new Error(`Core returned a different template for ${candidate.eventId}`);
    }
    results.push(result);
  }

  const persisted = await persist(results);
  return { results, persisted };
}
