// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The web runtime gives content the engine's canvas API and no more (web/frame/canvas-api.ts): its lists have to be
// the ones the type declarations give, or a preview runs what the app can't.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  COMPOSITE_OPERATIONS, CONTEXT_2D_METHODS, CONTEXT_2D_PROPERTIES, CONTEXT_2D_READONLY, TEXT_METRICS, WEBGL_EXTENSIONS,
  WEBGL_EXTENSION_ALIASES, formatColor, parseColor, parseFont,
} from '../web/frame/canvas-api.ts';

const declarations = fs.readFileSync(path.join(import.meta.dirname, '..', 'types', 'desktop-engine.d.ts'), 'utf8');

/** The members an interface of the declarations has (overloads once) */
function members(name: string): { properties: Set<string>; readonly: Set<string>; methods: Set<string> } {
  const start = declarations.indexOf(`\n  interface ${name} {\n`);
  assert.ok(start >= 0, `${name} is declared`);
  const body = declarations.slice(start, declarations.indexOf('\n  }\n', start));
  const result = { properties: new Set<string>(), readonly: new Set<string>(), methods: new Set<string>() };
  for (const match of body.matchAll(/^ {4}(readonly )?(\w+)(\??)([(<:])/gm)) {
    if (match[4] === ':') (match[1] ? result.readonly : result.properties).add(match[2]);
    else result.methods.add(match[2]);
  }
  return result;
}

const sorted = (values: Iterable<string>) => [...values].sort();

test('the web runtime\'s 2D context has the members the declarations give it', () => {
  const declared = members('CanvasRenderingContext2D');
  assert.deepEqual(sorted(CONTEXT_2D_PROPERTIES), sorted(declared.properties));
  assert.deepEqual(sorted(CONTEXT_2D_READONLY), sorted(declared.readonly));
  assert.deepEqual(sorted(CONTEXT_2D_METHODS), sorted(declared.methods));
  assert.deepEqual(sorted(TEXT_METRICS), sorted(members('TextMetrics').readonly));
  const union = /\n {2}type GlobalCompositeOperation =([^;]*);/.exec(declarations)?.[1] ?? '';
  assert.deepEqual(sorted(COMPOSITE_OPERATIONS), sorted([...union.matchAll(/'([^']+)'/g)].map((match) => match[1])));
});

test('the web runtime offers the WebGL extensions the declarations give', () => {
  for (const [version, name] of [[1, 'WebGLExtensionMap'], [2, 'WebGL2ExtensionMap']] as const) {
    const declared = members(name).properties;
    assert.deepEqual(sorted([...WEBGL_EXTENSIONS[version], ...Object.keys(WEBGL_EXTENSION_ALIASES[version])]), sorted(declared), name);
    for (const target of Object.values(WEBGL_EXTENSION_ALIASES[version])) assert.ok(WEBGL_EXTENSIONS[version].includes(target));
  }
});

test('colors are read as the engine reads them', () => {
  const cases: [string, [number, number, number, number] | null][] = [
    ['#f00', [255, 0, 0, 255]],
    ['#f008', [255, 0, 0, 136]],
    ['#FF000080', [255, 0, 0, 128]],
    [' Red ', [255, 0, 0, 255]],
    ['transparent', [0, 0, 0, 0]],
    ['rebeccapurple', [102, 51, 153, 255]],
    ['rgb(255, 0, 0)', [255, 0, 0, 255]],
    ['rgba(255,0,0,0.5)', [255, 0, 0, 128]],
    ['rgb(255 0 0 / 50%)', [255, 0, 0, 128]],
    ['rgb(100%, 0%, 0%)', [255, 0, 0, 255]],
    ['rgb(300, -5, 0)', [255, 0, 0, 255]],
    ['rgba(0, 0, 0)', [0, 0, 0, 255]],
    ['hsl(120, 100%, 50%)', [0, 255, 0, 255]],
    ['hsl(0.5turn 100% 50% / 0.25)', [0, 255, 255, 64]],
    ['hsla(-120deg, 100%, 50%, 1)', [0, 0, 255, 255]],
    // what browsers take and the engine doesn't
    ['oklch(0.7 0.1 200)', null],
    ['color(srgb 1 0 0)', null],
    ['hwb(0 0% 0%)', null],
    ['currentcolor', null],
    ['Canvas', null],
    ['rgb(255 0 0 0.5)', null],
    ['rgb(1px, 0, 0)', null],
    ['rgb (1, 2, 3)', null],
    ['#ff00', [255, 255, 0, 0]],
    ['#ff000', null],
    ['', null],
  ];
  for (const [value, expected] of cases) assert.deepEqual(parseColor(value), expected, value);
  assert.equal(parseColor(0xff0000), null);
  assert.equal(formatColor([255, 0, 0, 128]), 'rgba(255,0,0,0.502)');
  assert.equal(formatColor([0, 0, 0, 255]), 'rgba(0,0,0,1.000)');
});

test('fonts are read as the engine reads them', () => {
  assert.deepEqual(parseFont('600 14px system-ui'), { italic: false, weight: 600, size: 14, families: 'system-ui' });
  assert.deepEqual(parseFont('italic bold 16px/1.2 "Avenir Next", Helvetica, sans-serif'), { italic: true, weight: 700, size: 16, families: 'Avenir Next, Helvetica, sans-serif' });
  assert.deepEqual(parseFont('small-caps semi-condensed lighter 12pt Menlo'), { italic: false, weight: 300, size: 16, families: 'Menlo' });
  assert.deepEqual(parseFont('12px'), { italic: false, weight: 400, size: 12, families: '' });
  // what browsers take and the engine doesn't, and what neither takes
  for (const value of ['1.5em serif', 'large sans-serif', 'caption', '0px Arial', '700', 'bold16px Arial', '100% Arial', 12]) {
    assert.equal(parseFont(value), null, String(value));
  }
});
