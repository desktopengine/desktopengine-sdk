// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// A widget's sizes on the web are the app's: its own sizes beside the presets, the range and ratio `widget.resize`
// gives, a window kept inside its display (scaled down when it's bigger, no half-display cap), resizing by the edges,
// and the content told the frame it gets. The rules (web/widget-sizes.ts) are plain functions; the frame runtime runs
// here in a node process of its own, as in web-frame.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

import type { HostMessage, LaunchMessage } from '../web/protocol.ts';
import {
  declaredSizes, edgesAt, fitted, hitMargins, inRange, measureCorner, resizeCursor, resizedFrame, resizeHintShape, sanitizeCorner, widgetFrame,
  widgetSizing, type WidgetSizing,
} from '../web/widget-sizes.ts';

const wide = { id: 'wide', width: 440, height: 196, name: { en: 'Wide', 'zh-Hans': '宽' } };
const visible = { x: 0, y: 25, width: 1440, height: 875 };

test('a widget\'s sizes are its presets and its own, each once, small without any', () => {
  assert.deepEqual(declaredSizes({ widget: { sizes: ['medium', wide, 'medium', { id: 'Bad', width: 100, height: 100 }, { id: 'tiny', width: 10, height: 10 }] } }), [
    { id: 'medium', width: 344, height: 164 },
    { id: 'wide', width: 440, height: 196 },
  ]);
  assert.deepEqual(declaredSizes({}), [{ id: 'small', width: 164, height: 164 }]);
});

test('widget.resize gives the range, the ratio of the size picked, and who resizes', () => {
  const fixed = widgetSizing({ widget: { sizes: [wide] } }, wide, { width: 900, height: 900 });
  assert.deepEqual(fixed.size, { width: 440, height: 196 });
  assert.equal(fixed.byUser || fixed.byContent, false);

  const manifest = { widget: { sizes: [wide], resize: { by: ['user', 'content'], minWidth: 220, maxWidth: 880, aspectRatio: 'fixed' } } };
  const sizing = widgetSizing(manifest, wide);
  assert.deepEqual(sizing, {
    size: { width: 440, height: 196 },
    minimum: { width: 220, height: 32 },
    maximum: { width: 880, height: 0 },
    byUser: true,
    byContent: true,
    aspectRatio: { width: 440, height: 196 },
  });
  // where it was left, in the range and the ratio
  assert.deepEqual(widgetSizing(manifest, wide, { width: 660, height: 294 }).size, { width: 660, height: 294 });
  assert.deepEqual(widgetSizing(manifest, wide, { width: 2000, height: 2000 }).size, { width: 880, height: 392 });
  assert.deepEqual(inRange({ width: 100, height: 100 }, sizing), { width: 220, height: 98 });
  // without a ratio, each dimension on its own
  const free = widgetSizing({ widget: { resize: { by: ['content'], minHeight: 100, maxHeight: 800 } } }, { width: 300, height: 200 });
  assert.deepEqual(inRange({ width: 10, height: 5000 }, free), { width: 32, height: 800 });
});

test('a widget\'s window stays inside its display, scaled down in its shape when it\'s bigger', () => {
  assert.deepEqual(fitted({ width: 2880, height: 400 }, visible), { width: 1440, height: 200 });
  const sizing = widgetSizing({ widget: { sizes: [wide] } }, wide);
  // the size picked whatever the style says, moved in from the edges, below the menu bar
  assert.deepEqual(widgetFrame({ x: 1300, y: 0, width: 999, height: 999 }, sizing, sizing.size, visible), { x: 1000, y: 25, width: 440, height: 196 });
  const huge = widgetSizing({ widget: { sizes: [{ id: 'huge', width: 2880, height: 1800, name: 'Huge' }] } }, { width: 2880, height: 1800 });
  assert.deepEqual(widgetFrame({ x: 0, y: 25, width: 2880, height: 1800 }, huge, huge.size, visible), { x: 0, y: 25, width: 1400, height: 875 });
  // the content's own size, in its range
  const content = widgetSizing({ widget: { resize: { by: ['content'], maxHeight: 600 } } }, { width: 300, height: 200 });
  assert.deepEqual(widgetFrame({ x: 100, y: 100, width: 300, height: 1000 }, content, content.size, visible), { x: 100, y: 100, width: 300, height: 600 });
  // free to change shape: each edge kept to the display on its own, then to the smallest size it may have
  const free = widgetSizing({ widget: { resize: { by: ['user'], minHeight: 1000 } } }, { width: 300, height: 200 });
  assert.deepEqual(fitted({ width: 2880, height: 400 }, visible, free), { width: 1440, height: 1000 });
  assert.deepEqual(widgetFrame({ x: 0, y: 25, width: 300, height: 200 }, free, { width: 2000, height: 300 }, visible), { x: 0, y: 25, width: 1440, height: 1000 });
});

test('with a hit region, only where a widget takes the mouse stays inside its display, but the window\'s top', () => {
  const sizing = widgetSizing({ widget: { sizes: [wide] } }, wide);
  const body = [{ x: 8, y: 2, width: 200, height: 180 }, { x: 208, y: 2, width: 224, height: 100 }, { x: 0, y: 500, width: 50, height: 50 }];
  // the bounds of the rects inside the window
  assert.deepEqual(hitMargins(body, wide), { left: 8, right: 8, bottom: 14 });
  assert.deepEqual(hitMargins(null, wide), { left: 0, right: 0, bottom: 0 });
  assert.deepEqual(hitMargins([{ x: 500, y: 0, width: 10, height: 10 }], wide), { left: 0, right: 0, bottom: 0 });
  // against the left, the right and the bottom: what's round it off the display
  assert.deepEqual(widgetFrame({ x: -50, y: 2000, width: 440, height: 196 }, sizing, sizing.size, visible, body), { x: -8, y: 718, width: 440, height: 196 });
  assert.deepEqual(widgetFrame({ x: 3000, y: 300, width: 440, height: 196 }, sizing, sizing.size, visible, body), { x: 1008, y: 300, width: 440, height: 196 });
  // the window's top below the menu bar
  assert.deepEqual(widgetFrame({ x: 100, y: 0, width: 440, height: 196 }, sizing, sizing.size, visible, body), { x: 100, y: 25, width: 440, height: 196 });
  // without one, the whole window
  assert.deepEqual(widgetFrame({ x: -50, y: 2000, width: 440, height: 196 }, sizing, sizing.size, visible), { x: 0, y: 704, width: 440, height: 196 });
});

test('the edges resize as a window\'s do, within the range, the ratio and the display', () => {
  const size = { width: 300, height: 200 };
  assert.equal(edgesAt(150, 100, size), null);
  assert.deepEqual(edgesAt(299, 199, size), { left: false, right: true, top: false, bottom: true });
  assert.equal(resizeCursor(edgesAt(299, 199, size)!), 'nwse-resize');
  assert.equal(resizeCursor(edgesAt(0, 199, size)!), 'nesw-resize');
  assert.equal(resizeCursor(edgesAt(2, 100, size)!), 'ew-resize');
  assert.equal(resizeCursor(edgesAt(150, 1, size)!), 'ns-resize');

  const free = widgetSizing({ widget: { resize: { by: ['user'], minWidth: 100, maxWidth: 400 } } }, size);
  const origin = { x: 500, y: 300, ...size };
  // the right edge, the left edge (the right one stays), past the range
  assert.deepEqual(resizedFrame(origin, { left: false, right: true, top: false, bottom: false }, 50, 30, free, visible), { x: 500, y: 300, width: 350, height: 200 });
  assert.deepEqual(resizedFrame(origin, { left: true, right: false, top: false, bottom: false }, 50, 0, free, visible), { x: 550, y: 300, width: 250, height: 200 });
  assert.deepEqual(resizedFrame(origin, { left: false, right: true, top: false, bottom: false }, 500, 0, free, visible), { x: 500, y: 300, width: 400, height: 200 });
  // not past the display: the top edge stops below the menu bar
  assert.deepEqual(resizedFrame(origin, { left: false, right: false, top: true, bottom: false }, 0, -600, free, visible), { x: 500, y: 25, width: 300, height: 475 });

  const locked: WidgetSizing = widgetSizing({ widget: { resize: { by: ['user'], aspectRatio: 'fixed' } } }, size);
  assert.deepEqual(resizedFrame(origin, { left: false, right: true, top: false, bottom: true }, 150, 10, locked, visible), { x: 500, y: 300, width: 450, height: 300 });
  assert.deepEqual(resizedFrame(origin, { left: false, right: false, top: false, bottom: true }, 0, 100, locked, visible), { x: 500, y: 300, width: 450, height: 300 });
  // the display's bottom stops it, in its shape
  assert.deepEqual(resizedFrame(origin, { left: false, right: true, top: false, bottom: false }, 2000, 0, locked, visible), { x: 500, y: 300, width: 900, height: 600 });
});

// MARK: - The frame

const web = path.join(import.meta.dirname, '..', 'web');
const { frameOptions } = await import(pathToFileURL(path.join(web, 'build.mjs')).href) as { frameOptions: esbuild.BuildOptions };
const frameRuntime = (await esbuild.build({ ...frameOptions, logLevel: 'silent' })).outputFiles![0].text;

/** What a frame needs of a browser, with a document whose elements take anything */
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
const anything = () => new Proxy(function () {}, {
  get: (target, key) => key === Symbol.toPrimitive ? () => 0 : anything(),
  set: () => true,
  apply: () => anything(),
  construct: () => anything(),
});
globalThis.document = anything();
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
`;

const MAIN_SCREEN: LaunchMessage['screens'] = [{ id: 1, name: 'Main', bounds: { x: 0, y: 0, width: 1440, height: 900 }, visibleFrame: visible, scale: 2 }];

/**
 * Runs `code` as a widget with `sizing`, then sends the host's `messages` one task after the other: what it posts to
 * the host, its exceptions, and the frames it reports for its windows
 */
async function runWidget(sizing: WidgetSizing, code: string, messages: HostMessage[] = [], screens: LaunchMessage['screens'] = MAIN_SCREEN): Promise<unknown[]> {
  const launch: LaunchMessage = {
    type: 'launch',
    name: 'test',
    code,
    files: {},
    options: { permissions: [], windowType: 'widget', width: sizing.size.width, height: sizing.size.height },
    screens,
    contentType: 'widget',
    allowedWindowType: 'widget',
    permissions: [],
    networkDomains: [],
    appearance: 'dark',
    apiVersion: 8,
    maxFramesPerSecond: 0,
    muted: true,
    keyActivity: false,
    namespaceChannels: false,
    systemAudio: 'none',
    appWindows: [],
    widgetSizing: sizing,
  };
  const script = `${BROWSER}\n${frameRuntime}\n`
    + `const deliver = (data) => { for (const listener of listeners) listener({ source: globalThis.parent, data }); };\n`
    + `deliver(${JSON.stringify(launch)});\n`
    + `const later = ${JSON.stringify(messages)};\n`
    + `for (const message of later) { await new Promise((resolve) => setTimeout(resolve, 20)); deliver(message); }\n`
    + `await new Promise((resolve) => setTimeout(resolve, 50));\n`
    + `process.stdout.write(JSON.stringify(sent.filter((m) => m.type === 'host-message' || m.type === 'exception')), () => process.exit(0));\n`;
  const run = promisify(execFile)(process.execPath, ['--input-type=module'], { timeout: 20000 });
  run.child.stdin!.end(script);
  const { stdout } = await run;
  return (JSON.parse(stdout) as { type: string; message: unknown }[]).map((sent) => (sent.type === 'host-message' ? sent.message : sent));
}

/** The id of the first component the content makes */
const FIRST_WINDOW = '0x600000000040';

/** A widget that reports its window's events and style */
const REPORTING = `
  const report = (event) => postMessage('host', { event, left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height });
  win.onresize = () => report('resize');
  win.onmove = () => report('move');
  win.show();
  setTimeout(() => report('shown'), 0);
`;

/** Pixels of a rounded rectangle's bottom right corner, `margin` points from the edges, as a canvas antialiases it (by pixel centers) */
function roundedCorner(radius: number, margin: number, scale: number) {
  return (left: number, up: number) => {
    // the pixel's center, in points from the corner
    const x = (left + 0.5) / scale - margin;
    const y = (up + 0.5) / scale - margin;
    if (x < 0 || y < 0) return false;
    if (x >= radius || y >= radius) return true;
    return Math.hypot(radius - x, radius - y) <= radius;
  };
}

test('the resize hint follows the corner the widget draws, measured as the app does', () => {
  const scale = 2;
  const count = 96 * scale;
  for (const [radius, margin] of [[14, 0], [32, 8], [22, 3], [0, 0], [0, 5]]) {
    const shape = measureCorner(roundedCorner(radius, margin, scale), count, scale)!;
    assert.ok(Math.abs(shape.right - margin) <= 0.5 && Math.abs(shape.bottom - margin) <= 0.5, `margin ${margin}: ${shape.right}, ${shape.bottom}`);
    assert.ok(Math.abs(shape.radius - radius) <= 2, `radius ${radius}: ${shape.radius}`);
  }
  // nothing drawn there
  assert.equal(measureCorner(() => false, count, scale), null);
});

test('the resize hint is a stroke around the corner, outside it, or inside it at the screen\'s edge', () => {
  // the arc's center is the corner's: the stroke's center line runs the gap and half its width from the body's edges
  const along = (shape: ReturnType<typeof resizeHintShape>, radius: number) => {
    const center = { x: shape.corner.x - radius, y: shape.corner.y - radius };
    const [, x0, y0] = shape.path.match(/^M([\d.]+) ([\d.]+)/)!.map(Number);
    return Math.hypot(x0 - center.x, y0 - center.y);
  };
  // a square corner: the quarter of a small arc, and arms along the edges
  const square = resizeHintShape(0, true);
  assert.match(square.path, /^M[\d.]+ [\d.]+V[\d.]+A6\.5 6\.5 0 0 1 [\d.]+ [\d.]+H[\d.]+$/);
  assert.equal(square.width, square.height);
  // a rounded one: a stretch of the arc around it, no arms
  const rounded = resizeHintShape(14, true);
  assert.match(rounded.path, /^M[\d.]+ [\d.]+A20\.5 20\.5 0 0 1 [\d.]+ [\d.]+$/);
  assert.ok(Math.abs(along(rounded, 14) - 20.5) < 0.01);
  // capped, and inside
  assert.equal(resizeHintShape(200, true).path, resizeHintShape(40, true).path);
  const inside = resizeHintShape(14, false);
  assert.ok(inside.corner.x > inside.width - 6 && inside.corner.y > inside.height - 6);
  // a frame can't put it anywhere but at the corner
  assert.deepEqual(sanitizeCorner({ right: 1e9, bottom: -5, radius: 1e9 }), { right: 96, bottom: 0, radius: 40 });
  assert.equal(sanitizeCorner({ right: 1, bottom: NaN, radius: 3 }), null);
  assert.equal(sanitizeCorner('x'), null);
});

test('a widget\'s window keeps the size picked, whatever its style says, and the content is told', async () => {
  const sizing = widgetSizing({ widget: { sizes: [wide] } }, wide);
  const results = await runWidget(sizing, `
    const win = new DesktopEngine.Window({ type: 'widget', style: { left: 100, top: 100, width: 600, height: 600 } });
    ${REPORTING}
    setTimeout(() => { win.style.width = 800; }, 5);
  `);
  assert.deepEqual(results.filter((result) => (result as { event: string }).event !== 'move'), [
    { event: 'resize', left: 100, top: 100, width: 440, height: 196 },
    { event: 'shown', left: 100, top: 100, width: 440, height: 196 },
    { event: 'resize', left: 100, top: 100, width: 440, height: 196 },
  ]);
});

test('a widget the content resizes takes its size within the range, and no half-display cap', async () => {
  const sizing = widgetSizing({ widget: { resize: { by: ['content'], minHeight: 100, maxHeight: 700 } } }, { width: 300, height: 200 });
  const results = await runWidget(sizing, `
    const win = new DesktopEngine.Window({ type: 'widget', style: { left: 40, top: 40, width: 300, height: 200 } });
    ${REPORTING}
    // within the range: no event, the size it asked for; then past it
    // one step after another: two timers due together may fire either way round on a busy machine
    setTimeout(() => {
      win.style.height = 650;
      win.style.width = 1300;
      setTimeout(() => {
        report('grown');
        win.style.height = 5000;
      }, 0);
    }, 5);
  `);
  assert.deepEqual(results, [
    { event: 'shown', left: 40, top: 40, width: 300, height: 200 },
    { event: 'grown', left: 40, top: 40, width: 1300, height: 650 },
    { event: 'resize', left: 40, top: 40, width: 1300, height: 700 },
  ]);
});

test('the user resizes the widget\'s window by its edges: the content gets resize and its style the frame', async () => {
  const sizing = widgetSizing({ widget: { resize: { by: ['user'], minWidth: 100 } } }, { width: 300, height: 200 });
  const results = await runWidget(sizing, `
    const win = new DesktopEngine.Window({ type: 'widget', style: { left: 40, top: 40, width: 300, height: 200 } });
    ${REPORTING}
  `, [
    { type: 'resize-window', window: FIRST_WINDOW, x: 40, y: 40, width: 360, height: 240 },
    { type: 'resize-window', window: FIRST_WINDOW, x: 20, y: 40, width: 380, height: 240 },
  ]);
  assert.deepEqual(results, [
    { event: 'shown', left: 40, top: 40, width: 300, height: 200 },
    { event: 'resize', left: 40, top: 40, width: 360, height: 240 },
    { event: 'resize', left: 20, top: 40, width: 380, height: 240 },
    { event: 'move', left: 20, top: 40, width: 380, height: 240 },
  ]);
});

test('the user drags the widget\'s window past its display\'s edge: one move, where it was kept', async () => {
  const sizing = widgetSizing({ widget: { sizes: [wide] } }, wide);
  const results = await runWidget(sizing, `
    const win = new DesktopEngine.Window({ type: 'widget', style: { left: 40, top: 40, width: 440, height: 196 } });
    ${REPORTING}
  `, [{ type: 'move-window', window: FIRST_WINDOW, x: 1300, y: 40 }]);
  assert.deepEqual(results, [
    { event: 'shown', left: 40, top: 40, width: 440, height: 196 },
    { event: 'move', left: 1000, top: 40, width: 440, height: 196 },
  ]);
});

test('the widget\'s window follows the pointer past its display\'s edge while dragged, and is put back where it\'s dropped', async () => {
  const sizing = widgetSizing({ widget: { sizes: [wide] } }, wide);
  const results = await runWidget(sizing, `
    const win = new DesktopEngine.Window({ type: 'widget', style: { left: 40, top: 40, width: 440, height: 196 } });
    win.hitRegion = [{ x: 8, y: 2, width: 424, height: 180 }];
    ${REPORTING}
  `, [
    { type: 'move-window', window: FIRST_WINDOW, x: 1300, y: 40, dragging: true },
    { type: 'move-window', window: FIRST_WINDOW, x: 1300, y: 900, dragging: true },
    // dropped: where it takes the mouse against the right and bottom edges
    { type: 'move-window', window: FIRST_WINDOW, x: 1008, y: 718 },
  ]);
  assert.deepEqual(results, [
    { event: 'shown', left: 40, top: 40, width: 440, height: 196 },
    { event: 'move', left: 1300, top: 40, width: 440, height: 196 },
    { event: 'move', left: 1300, top: 900, width: 440, height: 196 },
    { event: 'move', left: 1008, top: 718, width: 440, height: 196 },
  ]);
});

test('a hit region set after the widget\'s window was placed puts it where it was put, against the edge', async () => {
  const sizing = widgetSizing({ widget: { sizes: [wide] } }, wide);
  const results = await runWidget(sizing, `
    const win = new DesktopEngine.Window({ type: 'widget', style: { left: -20, top: 2000, width: 440, height: 196 } });
    ${REPORTING}
    setTimeout(() => {
      win.hitRegion = [{ x: 8, y: 2, width: 424, height: 180 }];
      setTimeout(() => report('hit'), 0);
    }, 5);
  `, [{ type: 'move-window', window: FIRST_WINDOW, x: 1300, y: 40 }]);
  assert.deepEqual(results.filter((result) => (result as { event: string }).event !== 'move'), [
    { event: 'shown', left: 0, top: 704, width: 440, height: 196 },
    { event: 'hit', left: -8, top: 718, width: 440, height: 196 },
  ]);
  // dragged past the right edge: where it takes the mouse is against it
  assert.deepEqual(results.at(-1), { event: 'move', left: 1008, top: 40, width: 440, height: 196 });
});

test('a widget pushed in from an edge as it grew goes back to its place once it shrinks; a move of its own is a new place', async () => {
  const sizing = widgetSizing({ widget: { resize: { by: ['content'], minWidth: 40, minHeight: 40 } } }, { width: 200, height: 140 });
  const grow = (start: string, anchor: string, moveTo = 'null') => `
    let L = ${start}, W = 200, H = 140;
    const win = new DesktopEngine.Window({ type: 'widget', style: { left: L.x, top: L.y, width: W, height: H } });
    let P = { x: L.x, y: L.y };
    // like content that keeps a corner where it is: the place it's told is where it is
    win.onmove = (e) => { P = { x: e.x, y: e.y }; };
    const size = (w, h) => {
      if ('${anchor}' === 'bottom') P.y = P.y + H - h;
      W = w; H = h;
      win.style.left = P.x; win.style.top = P.y; win.style.width = W; win.style.height = H;
    };
    const report = (event) => postMessage('host', { event, left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height });
    win.show();
    setTimeout(() => {
      size(340, 240);
      setTimeout(() => {
        report('grown');
        if (${moveTo} !== null) { P = { x: ${moveTo}, y: P.y }; win.style.left = P.x; }
        setTimeout(() => {
          size(200, 140);
          setTimeout(() => report('shrunk'), 5);
        }, 5);
      }, 5);
    }, 5);
  `;
  // the right edge
  assert.deepEqual(await runWidget(sizing, grow('{ x: 1200, y: 300 }', 'top')), [
    { event: 'grown', left: 1100, top: 300, width: 340, height: 240 },
    { event: 'shrunk', left: 1200, top: 300, width: 200, height: 140 },
  ]);
  // the bottom edge
  assert.deepEqual(await runWidget(sizing, grow('{ x: 600, y: 700 }', 'top')), [
    { event: 'grown', left: 600, top: 660, width: 340, height: 240 },
    { event: 'shrunk', left: 600, top: 700, width: 200, height: 140 },
  ]);
  // growing up into the menu bar, its bottom kept where it is
  assert.deepEqual(await runWidget(sizing, grow('{ x: 600, y: 60 }', 'bottom')), [
    { event: 'grown', left: 600, top: 25, width: 340, height: 240 },
    { event: 'shrunk', left: 600, top: 60, width: 200, height: 140 },
  ]);
  // moved by the content while pushed in: that's its place
  assert.deepEqual(await runWidget(sizing, grow('{ x: 1200, y: 300 }', 'top', '700')), [
    { event: 'grown', left: 1100, top: 300, width: 340, height: 240 },
    { event: 'shrunk', left: 700, top: 300, width: 200, height: 140 },
  ]);
});

test('a widget the content resizes stays on its display, however far down it reaches; a move of its own takes it to another', async () => {
  const sizing = widgetSizing({ widget: { resize: { by: ['content'], minWidth: 40, minHeight: 40 } } }, { width: 200, height: 140 });
  // a display above the main one
  const screens: LaunchMessage['screens'] = [
    ...MAIN_SCREEN,
    { id: 2, name: 'Above', bounds: { x: 0, y: -1080, width: 1920, height: 1080 }, visibleFrame: { x: 0, y: -1080, width: 1920, height: 1080 }, scale: 2 },
  ];
  const content = (then: string) => `
    const win = new DesktopEngine.Window({ type: 'widget', style: { left: 1500, top: -200, width: 200, height: 140 } });
    const report = (event) => postMessage('host', { event, left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height });
    win.show();
    setTimeout(() => {
      // keeping its top where it is: most of it would be on the main display
      win.style.height = 600;
      setTimeout(() => {
        report('grown');
        ${then}
      }, 5);
    }, 5);
  `;
  assert.deepEqual(await runWidget(sizing, content(''), [], screens), [
    { event: 'grown', left: 1500, top: -600, width: 200, height: 600 },
  ]);
  // moved there at the same size, it goes
  assert.deepEqual(await runWidget(sizing, content(`win.style.top = 300; setTimeout(() => report('moved'), 5);`), [], screens), [
    { event: 'grown', left: 1500, top: -600, width: 200, height: 600 },
    { event: 'moved', left: 1240, top: 300, width: 200, height: 600 },
  ]);
  // moved there with another size too (from where it was told it is, 400 above its place: kept inside at the bottom)
  assert.deepEqual(await runWidget(sizing, content(`win.style.top = 300; win.style.height = 300; setTimeout(() => report('moved'), 5);`), [], screens), [
    { event: 'grown', left: 1500, top: -600, width: 200, height: 600 },
    { event: 'moved', left: 1240, top: 600, width: 200, height: 300 },
  ]);
  // its window reaching mostly onto the main display, transparent below its body: it stays where its body is
  const hanging = `
    const win = new DesktopEngine.Window({ type: 'widget', style: { left: 1500, top: -300, width: 200, height: 140 } });
    const report = (event) => postMessage('host', { event, left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height });
    win.hitRegion = [{ x: 0, y: 0, width: 200, height: 100 }];
    win.show();
    setTimeout(() => {
      // a body 100 high at the top of a window 800 high: most of the window below the display's bottom edge
      win.style.height = 800;
      win.hitRegion = [{ x: 0, y: 0, width: 200, height: 100 }];
      setTimeout(() => report('grown'), 5);
    }, 5);
  `;
  assert.deepEqual(await runWidget(sizing, hanging, [], screens), [
    { event: 'grown', left: 1500, top: -300, width: 200, height: 800 },
  ]);
});

test('the user drops a widget pushed in from an edge: where it\'s dropped is its place, also once it shrinks', async () => {
  const sizing = widgetSizing({ widget: { resize: { by: ['content'], minWidth: 40, minHeight: 40 } } }, { width: 200, height: 140 });
  const content = `
    let P = { x: 1200, y: 300 };
    const win = new DesktopEngine.Window({ type: 'widget', style: { left: P.x, top: P.y, width: 200, height: 140 } });
    win.onmove = (e) => { P = { x: e.x, y: e.y }; };
    const report = (event) => postMessage('host', { event, left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height });
    win.show();
    setTimeout(() => {
      win.style.width = 340; win.style.height = 240;
      setTimeout(() => report('grown'), 0);
    }, 5);
    // after the drop: shrinks, its top-left corner where it's told it is
    setTimeout(() => {
      win.style.left = P.x; win.style.top = P.y; win.style.width = 200; win.style.height = 140;
      setTimeout(() => report('shrunk'), 5);
    }, 70);
  `;
  // the content's timers run after the messages; nothing changes on the page meanwhile
  const wait: HostMessage[] = [{ type: 'appearance', appearance: 'dark' }, { type: 'appearance', appearance: 'dark' }];
  const report = (results: unknown[]) => results.filter((result) => (result as { event?: string }).event !== undefined);
  // dragged to the middle of the display and dropped there
  assert.deepEqual(report(await runWidget(sizing, content, [
    { type: 'move-window', window: FIRST_WINDOW, x: 800, y: 320, dragging: true },
    { type: 'move-window', window: FIRST_WINDOW, x: 600, y: 300 },
    ...wait,
  ])), [
    { event: 'grown', left: 1100, top: 300, width: 340, height: 240 },
    { event: 'shrunk', left: 600, top: 300, width: 200, height: 140 },
  ]);
  // dragged past the right edge, dropped where it's kept on the display (as the host slides it there): that's its
  // place, it doesn't go back to where it was before the drag
  assert.deepEqual(report(await runWidget(sizing, content, [
    { type: 'move-window', window: FIRST_WINDOW, x: 1300, y: 500, dragging: true },
    { type: 'move-window', window: FIRST_WINDOW, x: 1100, y: 500 },
    ...wait,
  ])), [
    { event: 'grown', left: 1100, top: 300, width: 340, height: 240 },
    { event: 'shrunk', left: 1100, top: 500, width: 200, height: 140 },
  ]);
});

test('the user resizes a widget pushed in from an edge: by its left edge it\'s put there, by its right edge it keeps its place', async () => {
  const sizing = widgetSizing({ widget: { resize: { by: ['user', 'content'], minWidth: 40, minHeight: 40 } } }, { width: 200, height: 140 });
  const content = `
    const win = new DesktopEngine.Window({ type: 'widget', style: { left: 1200, top: 300, width: 200, height: 140 } });
    const report = (event) => postMessage('host', { event, left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height });
    win.show();
    setTimeout(() => { win.style.width = 340; win.style.height = 240; }, 5);
    setTimeout(() => {
      report('resized');
      // then the content makes it smaller, its top-left corner where it is
      win.style.width = 200; win.style.height = 140;
      setTimeout(() => report('shrunk'), 5);
    }, 50);
  `;
  const report = (results: unknown[]) => results.filter((result) => ['resized', 'shrunk'].includes((result as { event?: string }).event ?? ''));
  // pushed in to 1100; narrower by the right edge: back toward its place, as far as it fits
  assert.deepEqual(report(await runWidget(sizing, content, [
    { type: 'resize-window', window: FIRST_WINDOW, x: 1100, y: 300, width: 300, height: 240 },
    { type: 'appearance', appearance: 'dark' },
  ])), [
    { event: 'resized', left: 1140, top: 300, width: 300, height: 240 },
    { event: 'shrunk', left: 1200, top: 300, width: 200, height: 140 },
  ]);
  // narrower by the left edge: where the user put it
  assert.deepEqual(report(await runWidget(sizing, content, [
    { type: 'resize-window', window: FIRST_WINDOW, x: 1120, y: 300, width: 320, height: 240 },
    { type: 'appearance', appearance: 'dark' },
  ])), [
    { event: 'resized', left: 1120, top: 300, width: 320, height: 240 },
    { event: 'shrunk', left: 1120, top: 300, width: 200, height: 140 },
  ]);
});

test('only the first window shown is the widget\'s: the others keep the window rules', async () => {
  const sizing = widgetSizing({ widget: { sizes: [wide] } }, wide);
  const [result] = await runWidget(sizing, `
    const win = new DesktopEngine.Window({ type: 'widget', style: { left: 0, top: 100, width: 440, height: 196 } });
    win.show();
    const other = new DesktopEngine.Window({ type: 'widget', style: { left: 0, top: 100, width: 50, height: 40 } });
    other.show();
    setTimeout(() => postMessage('host', { width: other.style.width, height: other.style.height }), 0);
  `);
  assert.deepEqual(result, { width: 50, height: 40 });
});
