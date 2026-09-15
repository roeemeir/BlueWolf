import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  docker: new URL("../deploy/runtime/Dockerfile", import.meta.url),
  windowsInstall: new URL("../deploy/windows/install-runtime.ps1", import.meta.url),
  windowsRun: new URL("../deploy/windows/run-runtime.ps1", import.meta.url),
  qaUi: new URL("../components/bluewolf/qa-truth-workbench.tsx", import.meta.url),
};

async function source(url) {
  return readFile(url, "utf8");
}

test("BW-QA-008 release surfaces retain code provenance and fail closed", async () => {
  const [docker, install, run, qaUi] = await Promise.all([
    source(files.docker),
    source(files.windowsInstall),
    source(files.windowsRun),
    source(files.qaUi),
  ]);

  assert.match(docker, /ARG BLUEWOLF_CODE_SHA=unknown/);
  assert.match(docker, /org\.opencontainers\.image\.revision=\$\{BLUEWOLF_CODE_SHA\}/);
  assert.match(docker, /BLUEWOLF_CODE_SHA=\$\{BLUEWOLF_CODE_SHA\}/);

  assert.match(install, /bluewolf-build-provenance\.json/);
  assert.match(install, /bluewolf\.runtime-build-provenance\.v1/);
  assert.match(install, /codeSha = \$ResolvedCodeSha\.ToLowerInvariant\(\)/);
  assert.match(install, /A real code SHA is required/);

  assert.match(run, /bluewolf-build-provenance\.json/);
  assert.match(run, /\$env:BLUEWOLF_CODE_SHA = \$InstalledCodeSha/);
  assert.match(run, /build provenance is missing/);
  assert.match(run, /Runtime config provenance will be the fingerprint of this exact file/);

  assert.doesNotMatch(qaUi, /configVersion\s*[,}]/);
  assert.match(qaUi, /scenarioId:\s*"full-regression"/);
  assert.match(qaUi, /code \{completed\.codeSha\.slice\(0, 10\)\}/);
  assert.match(qaUi, /config \{completed\.configVersion\}/);
});
