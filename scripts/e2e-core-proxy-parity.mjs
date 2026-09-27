import assert from 'node:assert/strict';

/**
 * Core /v1/live-runtime adds source.ageSeconds on each GET, even for a frozen
 * observation. The Web API is otherwise a direct JSON proxy. Comparing just
 * timestamps previously let a different Core feed, group, score or event pass
 * the private E2E preflight. Discard only the request-time age, never evidence.
 */
export function assertCoreProxyEvidenceParity(core, web, serverId) {
  assert.equal(String(core?.serverId), String(serverId), 'Core server identity mismatch');
  assert.equal(String(web?.serverId), String(serverId), 'Web proxy server identity mismatch');
  assert.equal(core?.observedAt, web?.observedAt, 'Web/Core evidence is from different observations');
  assert.equal(core?.source?.kind, 'python-core', 'Core response is not operational evidence');
  assert.equal(web?.source?.kind, 'python-core', 'Web response is not operational evidence');
  assert.ok(Array.isArray(core?.groupList) || core?.groups, 'Core did not return group evidence');
  assert.ok(Array.isArray(web?.groupList) || web?.groups, 'Web did not return group evidence');
  const stable = (payload) => {
    const copy = structuredClone(payload);
    if (copy.source && typeof copy.source === 'object') delete copy.source.ageSeconds;
    return copy;
  };
  assert.deepEqual(stable(web), stable(core), 'Web proxy altered Core vehicles, groups, routes, scores, events or provenance');
}

/**
 * A Core poll can land between the first direct read and the Web read.
 * Compare with both bracketing Core observations; retry a bounded number of
 * times on a genuine time race. Never accept a newer timestamp as proof of
 * parity and never retry away a same-timestamp evidence mismatch.
 */
export async function verifyCoreProxyParity({ serverId, readCore, readWeb, attempts = 3 }) {
  assert.ok(Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= 10, 'parity attempts must be bounded');
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const before = await readCore();
    const web = await readWeb();
    const after = await readCore();
    const matching = [before, after].find((candidate) => candidate?.observedAt === web?.observedAt);
    if (!matching) continue;
    assertCoreProxyEvidenceParity(matching, web, serverId);
    return web;
  }
  throw new Error(`Web/Core evidence for server ${serverId} never matched a directly sampled Core observation`);
}
