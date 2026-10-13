// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// DesktopEngine.windows in the web runtime keeps to the app's rules: the windows of the page's messages as the app
// lists them, and visibleTopEdges() as the app finds the edges.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readAppWindows, visibleTopEdges, type AppWindowInfo, type Rect } from '../web/protocol.ts';

/** A window, front to back as they're listed */
const win = (id: number, frame: Rect, more: Partial<AppWindowInfo> = {}): AppWindowInfo => ({
  id, frame, isActiveApp: false, isFullScreen: false, isFloating: false, ...more,
});

test('a window\'s top edge is all there when nothing in front covers it', () => {
  // the front window is below the back one's top, so it covers none of it
  const windows = [win(4182, { x: 120, y: 64, width: 900, height: 600 }), win(391, { x: 0, y: 33, width: 1728, height: 1000 })];
  assert.deepEqual(visibleTopEdges(windows), [
    { id: 4182, x: 120, y: 64, width: 900 },
    { id: 391, x: 0, y: 33, width: 1728 },
  ]);
});

test('a window in front that spans an edge cuts it in two, the left part first', () => {
  const windows = [win(1, { x: 400, y: 100, width: 300, height: 400 }), win(2, { x: 0, y: 200, width: 1000, height: 300 })];
  assert.deepEqual(visibleTopEdges(windows), [
    { id: 1, x: 400, y: 100, width: 300 },
    { id: 2, x: 0, y: 200, width: 400 },
    { id: 2, x: 700, y: 200, width: 300 },
  ]);
});

test('a window covers an edge from its top down to just above its bottom', () => {
  const back = win(9, { x: 0, y: 200, width: 1000, height: 300 });
  // its top at the edge covers it
  assert.deepEqual(visibleTopEdges([win(1, { x: 0, y: 200, width: 500, height: 50 }), back]).filter((edge) => edge.id === 9), [{ id: 9, x: 500, y: 200, width: 500 }]);
  // its bottom at the edge doesn't
  assert.deepEqual(visibleTopEdges([win(1, { x: 0, y: 100, width: 500, height: 100 }), back]).filter((edge) => edge.id === 9), [{ id: 9, x: 0, y: 200, width: 1000 }]);
  // nor does one beside the edge
  assert.deepEqual(visibleTopEdges([win(1, { x: 1000, y: 100, width: 500, height: 400 }), back]).filter((edge) => edge.id === 9), [{ id: 9, x: 0, y: 200, width: 1000 }]);
});

test('a full screen window has no edge but covers the windows behind it', () => {
  const windows = [
    win(1, { x: 0, y: 0, width: 800, height: 900 }, { isFullScreen: true }),
    win(2, { x: 600, y: 100, width: 600, height: 400 }),
  ];
  assert.deepEqual(visibleTopEdges(windows), [{ id: 2, x: 800, y: 100, width: 400 }]);
});

test('what a cut leaves of 1 point or less is dropped', () => {
  const back = win(2, { x: 0, y: 100, width: 600, height: 400 });
  // 1 point on the left, 1.5 on the right
  assert.deepEqual(visibleTopEdges([win(1, { x: 1, y: 50, width: 597.5, height: 400 }), back]).filter((edge) => edge.id === 2), [{ id: 2, x: 598.5, y: 100, width: 1.5 }]);
  // all of it covered: no edge
  assert.deepEqual(visibleTopEdges([win(1, { x: -10, y: 50, width: 700, height: 400 }), back]).filter((edge) => edge.id === 2), []);
});

test('edges come front to back, each window cut by every window in front', () => {
  const windows = [
    win(1, { x: 100, y: 0, width: 100, height: 300 }),
    win(2, { x: 500, y: 50, width: 100, height: 300 }),
    win(3, { x: 0, y: 100, width: 800, height: 300 }),
  ];
  assert.deepEqual(visibleTopEdges(windows), [
    { id: 1, x: 100, y: 0, width: 100 },
    { id: 2, x: 500, y: 50, width: 100 },
    { id: 3, x: 0, y: 100, width: 100 },
    { id: 3, x: 200, y: 100, width: 300 },
    { id: 3, x: 600, y: 100, width: 200 },
  ]);
});

test('the windows of the page\'s messages are read as the app lists them', () => {
  assert.deepEqual(readAppWindows(null), []);
  assert.deepEqual(readAppWindows({ length: 1 }), []);
  assert.deepEqual(readAppWindows([
    { id: 7, frame: { x: 10, y: Number.NaN, width: '300', height: Infinity }, isActiveApp: 1, isFullScreen: true, isFloating: 'yes' },
    null,
  ]), [
    { id: 7, frame: { x: 10, y: 0, width: 0, height: 0 }, isActiveApp: false, isFullScreen: true, isFloating: false },
    { id: 0, frame: { x: 0, y: 0, width: 0, height: 0 }, isActiveApp: false, isFullScreen: false, isFloating: false },
  ]);
});
