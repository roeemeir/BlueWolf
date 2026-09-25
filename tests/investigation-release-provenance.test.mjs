import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { buildInvestigationReleasePdf } = await vite.ssrLoadModule('/lib/investigation-pdf-release.ts');
const { extractCanvasJpegPages } = await vite.ssrLoadModule('/lib/investigation-pdf-lifecycle.ts');

function result(source) {
  return {
    schemaVersion: 'bluewolf.event-recompute.v1', family: 'SO',
    runId: 'run-1', scenarioId: 'scenario-1', eventId: 'event-1', serverId: 7, groupId: 'g1',
    templateId: 'tpl-a', templateVersion: 'v1', codeVersion: 'sha-1', configVersion: 'cfg-1',
    ...(source ? { source, evidenceVersion: `evidence-${'d'.repeat(64)}` } : {}),
    startAt: '2026-09-25T04:00:00Z', endAt: '2026-09-25T04:00:01Z',
    frameCount: 2, scoredFrameCount: 2, missingFrameCount: 0, routes: [],
    lifecycle: { status: 'unknown', openedAt: null, openingReason: null, endedAt: null, endingReason: null, finalizeAt: null, closedAt: null, changes: [] },
    summary: { sync: 70, route: 90, total: 75 }, rootCauses: [],
    points: [
      { observedAt: '2026-09-25T04:00:00Z', pendingReason: null, group: { valid: true, sync: 60, route: 90, total: 70, rawTotal: 70 }, members: [], navigation: [] },
      { observedAt: '2026-09-25T04:00:01Z', pendingReason: null, group: { valid: true, sync: 80, route: 90, total: 80, rawTotal: 80 }, members: [], navigation: [] },
    ],
  };
}

function fakeBrowser() {
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  const previousWindow = globalThis.window;
  class Context {
    labels = [];
    save() {} restore() {} fillRect() {} beginPath() {} roundRect() {} fill() {} stroke() {}
    strokeRect() {} moveTo() {} lineTo() {} arc() {} drawImage() {} clip() {} rect() {}
    createLinearGradient() { return { addColorStop() {} }; }
    measureText(value) { return { width: String(value).length * 8 }; }
    fillText(value) { this.labels.push(String(value)); }
  }
  class Canvas {
    constructor() { this.width=0; this.height=0; this.context=new Context(); }
    getContext(kind) { assert.equal(kind,'2d'); return this.context; }
    toDataURL() {
      const payload=Buffer.from(this.context.labels.join(' | '),'utf8');
      const jpeg=Buffer.concat([Buffer.from([0xff,0xd8]),payload,Buffer.from([0xff,0xd9])]);
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    }
  }
  globalThis.document={ fonts:{ready:Promise.resolve()}, createElement(kind){assert.equal(kind,'canvas');return new Canvas();} };
  delete globalThis.window;
  globalThis.Image=class { set src(_value){ queueMicrotask(()=>this.onload?.()); } };
  return { restore(){
    if(previousDocument===undefined) delete globalThis.document; else globalThis.document=previousDocument;
    if(previousImage===undefined) delete globalThis.Image; else globalThis.Image=previousImage;
    if(previousWindow===undefined) delete globalThis.window; else globalThis.window=previousWindow;
  }};
}

test('release PDF carries TEST navigation provenance across its actual browser chapters', async () => {
  const browser=fakeBrowser();
  try {
    const report={
      source:'core-event-archive', serverId:7, generatedAt:'2026-09-25T05:00:00Z',
      events:[{result:result({kind:'python-core',navigationOrigin:'simulation',syntheticNavigation:true}),arena:null,note:null}],
    };
    const bytes=await buildInvestigationReleasePdf(report);
    const pages=extractCanvasJpegPages(bytes).map(({jpeg})=>Buffer.from(jpeg).toString('utf8'));
    const joined=pages.join('\n');
    assert.match(joined,/Core event archive · includes TEST NAVIGATION/);
    assert.match(joined,/TEST NAVIGATION · synthetic raw navigation scored by Python Core/);
    assert.match(joined,new RegExp(`evidence-${'d'.repeat(64)}`));
    assert.ok(pages.filter(page=>page.includes('TEST NAVIGATION')).length >= 4, 'TEST provenance must survive multiple release chapters');
  } finally { browser.restore(); }
});

test('release PDF labels simulator evidence without any Python Core claim', async () => {
  const browser=fakeBrowser();
  try {
    const report={
      source:'simulator-archive', serverId:7, generatedAt:'2026-09-25T05:00:00Z',
      events:[{result:result(undefined),arena:null,note:null}],
    };
    const bytes=await buildInvestigationReleasePdf(report);
    const pages=extractCanvasJpegPages(bytes).map(({jpeg})=>Buffer.from(jpeg).toString('utf8'));
    const joined=pages.join('\n');
    assert.match(joined,/SIMULATOR ARCHIVE · synthetic QA evidence · no Python Core claim/);
    assert.match(joined,/LEGACY · unversioned event evidence/);
    assert.doesNotMatch(joined,/synthetic raw navigation scored by Python Core/);
  } finally { browser.restore(); }
});
