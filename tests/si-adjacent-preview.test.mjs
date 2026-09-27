import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { SiAdjacentTemplatePreview } = await vite.ssrLoadModule('/components/bluewolf/si-adjacent-template-preview.tsx');
const slot = (angleDeg, ring, typeId = '') => ({ angleDeg, ring, typeId });
const render = (props) => renderToStaticMarkup(React.createElement(SiAdjacentTemplatePreview, props));

test('SI direct 120-degree formation renders two adjacent labels and three correctly placed vehicles', () => {
  const html = render({ values: [120, 120, 120], siPositions: [slot(0, 'inner'), slot(120, 'middle'), slot(240, 'outer')] });
  assert.equal((html.match(/data-testid="si-adjacent-angle"/g) ?? []).length, 2);
  assert.equal((html.match(/data-testid="si-preview-vehicle-/g) ?? []).length, 3);
  assert.match(html, /120° · 120°/);
  assert.doesNotMatch(html, /0° · 120° · 240°/);
});

test('SI successive 90-degree formation across rings renders 90,90 instead of invented all-pairs 90', () => {
  const html = render({ values: [90, 180, 90], siPositions: [slot(0, 'inner'), slot(90, 'middle'), slot(180, 'outer')] });
  assert.match(html, /90° · 90°/);
  assert.equal((html.match(/data-testid="si-adjacent-angle"/g) ?? []).length, 2);
});

test('same bearing on two different SI rings visibly yields a zero-degree adjacent gap', () => {
  const html = render({ values: [90, 90, 0], siPositions: [slot(0, 'inner'), slot(90, 'middle'), slot(90, 'outer')] });
  assert.match(html, /90° · 0°/);
  assert.doesNotMatch(html, /90° · 90°/);
});

test('legacy 120-degree pair-only template reconstructs a valid display without inventing absolute angle labels', () => {
  const html = render({ values: [120, 120, 120] });
  assert.match(html, /120° · 120°/);
  assert.doesNotMatch(html, /data-testid="si-template-invalid-geometry"/);
});

test('geometrically impossible legacy all-pairs 90-degree template is not drawn as false coordinates', () => {
  const html = render({ values: [90, 90, 90] });
  assert.match(html, /data-testid="si-template-invalid-geometry"/);
  assert.doesNotMatch(html, /data-testid="si-preview-vehicle-/);
});
