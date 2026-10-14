// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The web runtime converts component styles as the app does. A style property holds a string or a number, read back
// as it was set; anything else (null, undefined, a boolean, an object, an array, a function) unsets it, in a whole
// style as on its own. A whole style is read once, before it replaces the old one: the style properties among the
// names for…in lists, what can't be read left out; anything but an object, and an array or typed array, leaves the
// style as it is. Nothing content passes makes setting a style throw. A string or number a property can't use is kept
// and laid out as unset, and numbers are read as the app reads them. The expected values were checked against the
// app. The contents run in the frame runtime in a node process of its own, with stand-ins for the elements.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

import { applyStyle, cssLength, readStyle, type InlineStyle, type StyleValue } from '../web/frame/style.ts';
import type { LaunchMessage } from '../web/protocol.ts';

const web = path.join(import.meta.dirname, '..', 'web');

/** The frame runtime, bundled as the SDK bundles it (web/build.mjs) */
const { frameOptions } = await import(pathToFileURL(path.join(web, 'build.mjs')).href) as { frameOptions: esbuild.BuildOptions };
const frameRuntime = (await esbuild.build({ ...frameOptions, logLevel: 'silent' })).outputFiles![0].text;

/** What a frame needs of a browser that node doesn't have: elements that take any style and lay nothing out */
const BROWSER = `
const sent = [];
const listeners = [];
globalThis.parent = { postMessage: (message) => sent.push(message) };
globalThis.addEventListener = (type, listener) => { if (type === 'message') listeners.push(listener); };
globalThis.requestAnimationFrame = () => 0;
globalThis.HTMLMediaElement = class { get muted() { return false; } set muted(value) {} play() {} pause() {} };
globalThis.XMLHttpRequest = class {};
globalThis.Path2D = class {};
globalThis.createImageBitmap = async () => ({});
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const element = () => ({
  style: { cssText: '', setProperty() {}, removeProperty() {} },
  hidden: false, isConnected: false, width: 300, height: 150,
  remove() {}, insertBefore() {}, appendChild() {}, addEventListener() {}, getContext() { return null; },
  getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
});
globalThis.document = { createElement: element, body: element(), addEventListener() {} };
`;

/** Runs `code` as a widget's content: what it posts to the host (JSON text, parsed), and its exceptions */
async function runContent(code: string): Promise<unknown[]> {
  const message: LaunchMessage = {
    type: 'launch',
    name: 'test',
    code,
    files: {},
    options: { permissions: [] },
    screens: [{ id: 1, name: 'Main', bounds: { x: 0, y: 0, width: 1440, height: 900 }, visibleFrame: { x: 0, y: 25, width: 1440, height: 875 }, scale: 2 }],
    permissions: [],
    networkDomains: [],
    appearance: 'dark',
    apiVersion: 6,
    maxFramesPerSecond: 0,
    muted: true,
    keyActivity: false,
    namespaceChannels: false,
    systemAudio: 'none',
    appWindows: [],
  };
  const script = `${BROWSER}\n${frameRuntime}\n`
    + `for (const listener of listeners) listener({ source: globalThis.parent, data: ${JSON.stringify(message)} });\n`
    + `process.stdout.write(JSON.stringify(sent.filter((m) => m.type === 'host-message' || m.type === 'exception')), () => process.exit(0));\n`;
  const run = promisify(execFile)(process.execPath, ['--input-type=module'], { timeout: 20000 });
  run.child.stdin!.end(script);
  const { stdout } = await run;
  return (JSON.parse(stdout) as { type: string; message: unknown }[]).map((sent) => (sent.type === 'host-message' ? JSON.parse(sent.message as string) : sent));
}

test('a value that isn\'t a string or a number unsets the property, in a whole style as on its own', async () => {
  const [result] = await runContent(`
    const values = [
      ['null', null], ['undefined', undefined], ['true', true], ['{}', {}], ['[100]', [100]],
      ['toString', { toString() { return '100'; } }], ['Object.create(null)', Object.create(null)],
      ['function', function () {}], ['new Number', new Number(100)], ['symbol', Symbol('s')], ['bigint', 10n],
    ];
    const result = {};
    for (const [name, value] of values) {
      const whole = new DesktopEngine.Component({ style: { width: value, flexShrink: value, display: value, height: 40 } });
      const single = new DesktopEngine.Component({ style: { width: 30, flexShrink: 0, display: 'none', height: 40 } });
      single.style.width = value;
      single.style.flexShrink = value;
      single.style.display = value;
      result[name] = [whole.style.width, whole.style.flexShrink, whole.style.display, whole.style.height,
        single.style.width, single.style.flexShrink, single.style.display, single.style.height];
    }
    postMessage('host', JSON.stringify(result));
  `);
  for (const [name, values] of Object.entries(result as Record<string, unknown[]>)) {
    assert.deepEqual(values, [null, null, null, 40, null, null, null, 40], name);
  }
});

test('setting a style never throws: what can\'t be read is left out and the rest applies', async () => {
  const [result] = await runContent(`
    const throwing = { toString() { throw new Error('toString'); }, valueOf() { throw new Error('valueOf'); } };
    const unlisted = new Proxy({ width: 10 }, { ownKeys() { throw new Error('ownKeys'); } });
    const result = {};
    const attempt = (name, action) => {
      try {
        result[name] = action();
      } catch (error) {
        result[name] = 'threw ' + error.message;
      }
    };
    attempt('one property', () => {
      const c = new DesktopEngine.Component({ style: { display: 'none', opacity: 0.5 } });
      c.style.display = throwing;
      c.style.opacity = Object.create(null);
      return [c.style.display, c.style.opacity];
    });
    attempt('Object.assign', () => {
      const c = new DesktopEngine.Component();
      Object.assign(c.style, { width: 11, display: throwing, height: 6 });
      return [c.style.width, c.style.display, c.style.height];
    });
    attempt('cssText', () => {
      const c = new DesktopEngine.Component({ style: { width: 30 } });
      c.style.cssText = throwing;
      return [c.style.width];
    });
    attempt('getter', () => new DesktopEngine.Component({ style: { get width() { throw new Error('getter'); }, height: 5 } }).style.height);
    attempt('Proxy that can\\'t list its names', () => {
      const c = new DesktopEngine.Component({ style: { width: 30, height: 5 } });
      c.style = unlisted;
      return [c.style.width, c.style.height, new DesktopEngine.Component({ style: unlisted }).style.width];
    });
    attempt('inside a style', () => {
      const c = new DesktopEngine.Component();
      c.style = { a: unlisted, width: unlisted, height: 5 };
      return [c.style.width, c.style.height];
    });
    attempt('window', () => {
      const w = new DesktopEngine.Window({ type: 'widget', style: unlisted });
      w.style.left = throwing;
      w.style.width = Object.create(null);
      return [w.style.left, w.style.width];
    });
    postMessage('host', JSON.stringify(result));
  `);
  assert.deepEqual(result, {
    'one property': [null, null],
    'Object.assign': [11, null, 6],
    cssText: [null],
    getter: 5,
    // the names can't be listed: a style of none, which replaces the one before
    'Proxy that can\'t list its names': [null, null, null],
    'inside a style': [null, 5],
    window: [null, null],
  });
});

test('assigning anything but an object leaves the style; an object is read in full before it replaces it', async () => {
  const [result] = await runContent(`
    const make = () => new DesktopEngine.Component({ style: { width: 30, display: 'none' } });
    const read = (c) => [c.style.width, c.style.display, c.style.opacity];
    const kept = {};
    const values = [['null', null], ['undefined', undefined], ['5', 5], ['string', 'width: 10'], ['[1]', [1]],
      ['Uint8Array', new Uint8Array(2)], ['ArrayBuffer', new ArrayBuffer(2)]];
    for (const [name, value] of values) {
      const c = make();
      c.style = value;
      kept[name] = read(c);
    }
    const itself = make();
    itself.style = itself.style;
    const copy = new DesktopEngine.Component({ style: { opacity: 0.5 } });
    copy.style = make().style;
    const empty = make();
    empty.style = {};
    const inherited = new DesktopEngine.Component();
    inherited.style = Object.assign(Object.create({ width: 77 }), { opacity: 0.5 });
    const unknown = new DesktopEngine.Component();
    unknown.style = { width: 30, foo: 'bar', 'background-color': 'red' };
    postMessage('host', JSON.stringify({
      kept, itself: read(itself), copy: read(copy), empty: read(empty), inherited: read(inherited),
      unknown: [unknown.style.width, unknown.style.backgroundColor, String(unknown.style.foo), /foo|background/.test(unknown.style.cssText)],
    }));
  `);
  const { kept, ...rest } = result as Record<string, unknown>;
  for (const [name, values] of Object.entries(kept as Record<string, unknown[]>)) assert.deepEqual(values, [30, 'none', null], name);
  assert.deepEqual(rest, {
    itself: [30, 'none', null],
    copy: [30, 'none', null],
    empty: [null, null, null],
    inherited: [77, null, 0.5],
    unknown: [30, null, 'undefined', false],
  });
});

test('a value the property can\'t use is kept as it was set', async () => {
  const [result] = await runContent(`
    const c = new DesktopEngine.Component({ style: { display: 'none', width: 30, opacity: 0.5 } });
    c.style.display = 'grid';
    c.style.width = 'wide';
    c.style.opacity = NaN;
    const w = new DesktopEngine.Window({ type: 'widget', style: { left: 'abc', width: '50%' } });
    postMessage('host', JSON.stringify([c.style.display, c.style.width, String(c.style.opacity), w.style.left, w.style.width]));
  `);
  assert.deepEqual(result, ['grid', 'wide', 'NaN', 'abc', '50%']);
});

test('cssText takes CSS names or the style\'s, values as strings, and anything but a string clears the style', async () => {
  const [result] = await runContent(`
    const c = new DesktopEngine.Component({ style: { width: 30, display: 'none' } });
    c.style.cssText = 'background-color: red; flexGrow: 2; foo: 1; width: 40px';
    const set = [c.style.backgroundColor, c.style.flexGrow, c.style.width, c.style.display];
    c.style.cssText = 5;
    postMessage('host', JSON.stringify({ set, cleared: [c.style.backgroundColor, c.style.width] }));
  `);
  assert.deepEqual(result, { set: ['red', '2', '40px', null], cleared: [null, null] });
});

test('a canvas given no style is 300 × 150, one given a style has only its size', async () => {
  const [result] = await runContent(`
    const size = (canvas) => [canvas.style.width, canvas.style.height];
    postMessage('host', JSON.stringify([
      size(new DesktopEngine.Canvas()),
      size(new DesktopEngine.Canvas({ style: {} })),
      size(new DesktopEngine.Canvas({ style: { foo: 1, width: null } })),
      size(new DesktopEngine.Canvas({ style: { height: 50 } })),
    ]));
  `);
  assert.deepEqual(result, [[300, 150], [300, 150], [300, 150], [null, 50]]);
});

test('a whole style is read once: the style properties among the names for…in lists', () => {
  const reads: PropertyKey[] = [];
  const style = new Proxy({ width: 10, height: '20px', display: null, opacity: true, foo: 'bar' }, {
    get(target, key, receiver) {
      reads.push(key);
      return Reflect.get(target, key, receiver);
    },
  });
  assert.deepEqual(readStyle(style), [['width', 10], ['height', '20px'], ['display', null], ['opacity', null]]);
  // once each, and not the names that aren't style properties
  assert.deepEqual(reads, ['width', 'height', 'display', 'opacity']);
  // inherited enumerable properties too, after its own
  assert.deepEqual(readStyle(Object.assign(Object.create({ width: 77 }), { height: 5 })), [['height', 5], ['width', 77]]);
});

test('a whole style that can\'t be listed has no properties; anything but an object isn\'t a style', () => {
  for (const trap of ['ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf'] as const) {
    assert.deepEqual(readStyle(new Proxy({ width: 1 }, { [trap]() { throw new Error(trap); } })), [], trap);
  }
  for (const value of [null, undefined, 5, 'width: 10', true, Symbol('s'), 10n, [1], new Uint8Array(2), new ArrayBuffer(2)]) {
    assert.equal(readStyle(value), null, String(value));
  }
  // other objects are styles of what they have
  assert.deepEqual(readStyle(new DataView(new ArrayBuffer(2))), []);
  assert.deepEqual(readStyle(function () {}), []);
});

test('lengths are read as the app reads them; anything else is the property\'s default', () => {
  const lengths: [StyleValue, string][] = [
    [10, '10px'], [-5, '-5px'], [0.5, '0.5px'], ['10', '10px'], [' 10 ', '10px'], ['10px', '10px'], ['10 px', '10px'],
    ['+1e2', '100px'], ['1E2', '100px'], ['10.', '10px'], ['.5', '0.5px'], ['-.5', '-0.5px'], ['50%', '50%'],
    [' 50 %', '50%'], ['-10%', '-10%'],
  ];
  for (const [value, css] of lengths) assert.equal(cssLength(value), css, String(value));
  const unset: StyleValue[] = [
    NaN, Infinity, -Infinity, 1e39, '', ' ', 'auto', 'abc', '10abc', '10PX', ' 10px ', '0x10', '1e', '1,5', 'inf', 'NaN',
    'Infinity', 'abc%', '50%%', '%', '1e400', null,
  ];
  for (const value of unset) assert.equal(cssLength(value), null, String(value));
});

/** An element's inline style as applyStyle sets it, by CSS name */
function element(): { element: { style: InlineStyle }; css: Map<string, string> } {
  const css = new Map<string, string>();
  const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const style = new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (key === 'setProperty') return (name: string, value: string) => css.set(name, value);
      if (key === 'removeProperty') return (name: string) => css.delete(name);
      return typeof key === 'string' ? css.get(kebab(key)) ?? '' : undefined;
    },
    set(_target, key, value) {
      if (typeof key === 'string') {
        if (value === '') css.delete(kebab(key));
        else css.set(kebab(key), String(value));
      }
      return true;
    },
  });
  return { element: { style: style as unknown as InlineStyle }, css };
}

test('flex factors and opacity are read as the app reads them', () => {
  const cases: [string, StyleValue, string | undefined][] = [
    ['flexShrink', '100px', '100'], ['flexShrink', ' 2 ', '2'], ['flexShrink', '50%', '1'], ['flexShrink', Infinity, '1'],
    ['flexGrow', '1e1', '10'], ['flexGrow', 'abc', undefined], ['aspectRatio', '1.5', '1.5'], ['aspectRatio', NaN, undefined],
    ['opacity', '50%', '0.5'], ['opacity', ' 25 %', '0.25'], ['opacity', '0.5px', undefined], ['opacity', 2, '1'],
    ['opacity', -1, '0'], ['opacity', -Infinity, undefined],
  ];
  for (const [key, value, expected] of cases) {
    const { element: target, css } = element();
    applyStyle(target, key, value);
    // flex-shrink comes back as Yoga's default, 1
    assert.equal(css.get(key === 'flexShrink' ? 'flex-shrink' : key === 'flexGrow' ? 'flex-grow' : key === 'aspectRatio' ? 'aspect-ratio' : 'opacity'), expected, `${key} ${String(value)}`);
  }
});

test('a value the property can\'t use lays it out as unset, not as the value before', () => {
  const { element: target, css } = element();
  applyStyle(target, 'display', 'none');
  applyStyle(target, 'display', 'grid');
  assert.equal(css.get('display'), 'flex');
  applyStyle(target, 'width', 30);
  applyStyle(target, 'width', 'wide');
  assert.equal(css.get('width'), undefined);
  applyStyle(target, 'flexShrink', 0);
  applyStyle(target, 'flexShrink', 'abc');
  assert.equal(css.get('flex-shrink'), '1');
  // Yoga has no minimum size from the content
  applyStyle(target, 'minWidth', 10);
  applyStyle(target, 'minWidth', null);
  assert.equal(css.get('min-width'), '0');
  applyStyle(target, 'backgroundColor', 'red');
  applyStyle(target, 'backgroundColor', NaN);
  assert.equal(css.get('background-color'), undefined);
});
