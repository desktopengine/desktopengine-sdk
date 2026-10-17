// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The web desktop (web/host/desktop.ts) gives a wheel turned over a widget or a companion to its window as the app
// does: over the part of it that takes the mouse (its hit region, the whole window without one), never to a
// wallpaper, with the deltas of the app (about lines, positive toward the top and the left). The page doesn't scroll
// where such a window takes the wheel. The desktop's own code runs here without a DOM, its contents stand-ins.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as esbuild from 'esbuild';

import type { HostMessage, Rect, WindowState } from '../web/protocol.ts';

interface Host {
  WebContent: { prototype: object };
  WebDesktop: { prototype: object };
}

/** The desktop's code, bundled as the SDK bundles it (node can't run the TypeScript of its classes as it is) */
async function loadHost(): Promise<Host> {
  const result = await esbuild.build({
    entryPoints: [path.join(import.meta.dirname, '..', 'web', 'host', 'desktop.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    define: { __FRAME_RUNTIME__: '""' },
    logLevel: 'silent',
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)) as Host;
}

const host = await loadHost();

interface Modifiers {
  buttons: number;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

interface Board {
  windowWheel(point: { x: number; y: number }, event: Modifiers, deltaX: number, deltaY: number, deltaMode: number): boolean;
}

const NO_KEYS: Modifiers = { buttons: 0, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };

function windowState(id: string, type: string, frame: Rect, extra: Partial<WindowState> = {}): WindowState {
  return { id, type, frame, visible: true, z: 0, hitRegion: null, dragRegion: null, movable: type !== 'desktop', ...extra };
}

/** A desktop of one content with `windows`, and what the desktop posted its frame */
function desktop(windows: WindowState[], { userResizes = false } = {}) {
  const posted: HostMessage[] = [];
  const content = Object.assign(Object.create(host.WebContent.prototype) as object, {
    windows,
    iframe: { style: { zIndex: '1' } },
    post: (message: HostMessage) => posted.push(message),
  });
  // only whether the user resizes it matters here
  Object.defineProperty(content, 'widgetSizing', { value: userResizes ? { byUser: true, byContent: false } : null });
  const board = Object.assign(Object.create(host.WebDesktop.prototype) as Board, {
    contents: new Set([content]),
    appWindowAt: () => undefined,
  });
  return { board, posted };
}

test('a wheel over a widget goes to its window with the app\'s deltas, and the page doesn\'t scroll', () => {
  const { board, posted } = desktop([windowState('w1', 'widget', { x: 100, y: 100, width: 200, height: 100 })]);
  // pixels: about ten to a line, positive toward the top
  assert.equal(board.windowWheel({ x: 150, y: 150 }, { ...NO_KEYS, shiftKey: true }, 0, 100, 0), true);
  // lines, toward the left
  assert.equal(board.windowWheel({ x: 150, y: 150 }, NO_KEYS, 3, 0, 1), true);
  assert.deepEqual(posted, [
    { type: 'pointer', kind: 'wheel', window: 'w1', x: 150, y: 150, ctrlKey: false, altKey: false, metaKey: false, shiftKey: true, button: 0, buttons: 0, deltaX: 0, deltaY: -10 },
    { type: 'pointer', kind: 'wheel', window: 'w1', x: 150, y: 150, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, button: 0, buttons: 0, deltaX: -3, deltaY: 0 },
  ]);
  // no -0 for the way it didn't turn
  assert.ok(!Object.is((posted[0] as { deltaX: number }).deltaX, -0));
});

test('a companion\'s window takes the wheel over its hit region only; elsewhere it passes to the page', () => {
  const { board, posted } = desktop([windowState('pet', 'overlay', { x: 0, y: 0, width: 300, height: 300 }, { hitRegion: [{ x: 100, y: 100, width: 50, height: 50 }] })]);
  assert.equal(board.windowWheel({ x: 120, y: 120 }, NO_KEYS, 0, -1, 1), true);
  assert.equal(board.windowWheel({ x: 20, y: 20 }, NO_KEYS, 0, -1, 1), false);
  assert.deepEqual(posted.map((message) => message.type === 'pointer' && [message.window, message.deltaY]), [['pet', 1]]);
});

test('the edges a widget is resized by take the wheel from the page, without giving it to the content', () => {
  const { board, posted } = desktop([windowState('w1', 'widget', { x: 100, y: 100, width: 200, height: 100 }, { widget: true, hitRegion: [{ x: 20, y: 20, width: 160, height: 60 }] })], { userResizes: true });
  assert.equal(board.windowWheel({ x: 102, y: 150 }, NO_KEYS, 0, 1, 1), true);
  assert.deepEqual(posted, []);
  assert.equal(board.windowWheel({ x: 200, y: 150 }, NO_KEYS, 0, 1, 1), true);
  assert.equal(posted.length, 1);
});

test('a wallpaper never gets the wheel, as in the app', () => {
  const { board, posted } = desktop([windowState('wall', 'desktop', { x: 0, y: 0, width: 1440, height: 900 })]);
  assert.equal(board.windowWheel({ x: 500, y: 500 }, NO_KEYS, 0, 5, 1), false);
  assert.deepEqual(posted, []);
});
