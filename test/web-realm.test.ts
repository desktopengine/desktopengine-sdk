// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The web runtime runs content in the frame's own realm, so content may replace the language's builtins the runtime
// uses (Set.prototype.has, Array.prototype.filter, the Array iterator, Function.prototype.call…). In the app, looking
// up a global, calling the listeners of an engine object and handling what the app sends are native: they keep
// working whatever the content did, and so do the web runtime's. The frame runtime runs here in a node process of its
// own, with stand-ins for the few browser globals it needs. The content replaces the builtins with functions that note
// the call and throw, so the runtime calling one shows as a call, an exception or a missing result; the harness puts
// them back before it writes what it saw.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

import type { LaunchMessage } from '../web/protocol.ts';

/** The frame runtime, bundled as the SDK bundles it (web/build.mjs) */
const { frameOptions } = await import(pathToFileURL(path.join(import.meta.dirname, '..', 'web', 'build.mjs')).href) as { frameOptions: esbuild.BuildOptions };
const frameRuntime = (await esbuild.build({ ...frameOptions, logLevel: 'silent' })).outputFiles![0].text;

/**
 * What a frame needs of a browser that node doesn't have, and a page that notes what the frame sends. The DOM is a
 * stand-in just big enough for windows: elements with a style, put in the body, and elementFromPoint giving the last
 * one put there; the console writes nothing. Everything in it runs while the content's replacements are in place, so
 * it goes by index and uses none of them. On Math, which the content sees as it is: Math.replaced(object, key, label)
 * replaces a builtin (noting it for the harness to put back), Math.calls are the replaced ones called.
 */
const BROWSER = `
const sent = [];
const listeners = [];
const harnessTimer = globalThis.setTimeout;
const define = Object.defineProperty;
const hasOwn = Object.hasOwn;
globalThis.console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
globalThis.parent = { postMessage: (message) => { sent[sent.length] = message; } };
globalThis.addEventListener = (type, listener) => { if (type === 'message') listeners[listeners.length] = listener; };
globalThis.requestAnimationFrame = () => 0;
globalThis.HTMLMediaElement = class { get muted() { return false; } set muted(value) {} play() {} pause() {} };
globalThis.XMLHttpRequest = class {};
globalThis.Path2D = class {};
globalThis.createImageBitmap = async () => ({});
const makeElement = () => ({
  style: { cssText: '', setProperty() {}, removeProperty() {} },
  hidden: false,
  isConnected: false,
  parentElement: null,
  remove() { this.isConnected = false; this.parentElement = null; },
  insertBefore(child) { child.parentElement = this; return child; },
  appendChild(child) { child.parentElement = this; child.isConnected = true; lastAppended = child; return child; },
  getBoundingClientRect() { return { left: 100, top: 50, width: 200, height: 100 }; },
  addEventListener() {},
});
let lastAppended = null;
globalThis.document = Object.assign(new EventTarget(), {
  visibilityState: 'visible',
  createElement: makeElement,
  body: makeElement(),
  documentElement: makeElement(),
  elementFromPoint: () => lastAppended,
});

const restore = [];
Math.calls = [];
Math.replaced = (object, key, label) => {
  restore[restore.length] = { object, key, had: hasOwn(object, key), value: object[key] };
  define(object, key, {
    __proto__: null,
    value: function () {
      Math.calls[Math.calls.length] = label;
      throw new Error(label + ' was replaced');
    },
    writable: true,
    configurable: true,
  });
};
const putBack = () => {
  for (let index = restore.length - 1; index >= 0; index--) {
    const { object, key, had, value } = restore[index];
    if (had) define(object, key, { __proto__: null, value, writable: true, configurable: true });
    else delete object[key];
  }
  restore.length = 0;
};
const deliver = (data) => {
  for (let index = 0; index < listeners.length; index++) listeners[index]({ source: globalThis.parent, data });
};
/** The id of the first window in the frame's last report of them */
const lastWindowId = () => {
  for (let index = sent.length - 1; index >= 0; index--) if (sent[index].type === 'windows') return sent[index].windows[0].id;
  return undefined;
};
`;

interface Result {
  /** What the content posted with postMessage('host', …) */
  posted: unknown[];
  /** The exceptions reported to the host */
  exceptions: string[];
  /** The console messages */
  console: string[];
  /** The other messages to the host, by type, in order */
  messages: { type: string; [key: string]: unknown }[];
  /** The replaced builtins that were called */
  calls: string[];
  /** Math.events, as the content left it */
  events: unknown;
}

/**
 * Runs `code` as a content with the package's `files` (their text), then sends it the host's `messages` (expressions
 * that may call lastWindowId()), a few milliseconds apart, and reports what came back once they're all handled
 */
async function runContent(code: string, { launch = {}, files = {}, messages = [] }: { launch?: Partial<LaunchMessage>; files?: Record<string, string>; messages?: string[] } = {}): Promise<Result> {
  const message: LaunchMessage = {
    type: 'launch',
    name: 'test',
    code,
    files: {},
    options: { permissions: launch.permissions ?? [], parameters: { size: 1 } },
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
    ...launch,
  };
  const steps = messages.map((step, index) => `harnessTimer(() => deliver(${step}), ${20 + index * 10});`).join('\n');
  const packageFiles = Object.entries(files).map(([name, text]) => `${JSON.stringify(name)}: new TextEncoder().encode(${JSON.stringify(text)}).buffer`).join(', ');
  const script = `${BROWSER}\n${frameRuntime}\n`
    + `deliver({ ...${JSON.stringify(message)}, files: { ${packageFiles} } });\n`
    + `${steps}\n`
    + `harnessTimer(() => {
        putBack();
        const of = (type) => sent.filter((m) => m.type === type);
        const report = {
          posted: of('host-message').map((m) => m.message),
          exceptions: of('exception').map((m) => m.message),
          console: of('console').map((m) => m.message),
          messages: sent.filter((m) => !['host-message', 'exception', 'console', 'ready', 'launched'].includes(m.type)),
          calls: Math.calls,
          events: Math.events,
        };
        process.stdout.write(JSON.stringify(report), () => process.exit(0));
      }, ${40 + messages.length * 10});\n`;
  // on stdin, not with -e: Linux takes no single argument over 128 KB, and the bundled runtime is more
  const run = promisify(execFile)(process.execPath, ['--input-type=module'], { timeout: 20000 });
  run.child.stdin!.end(script);
  return JSON.parse((await run).stdout) as Result;
}

test('content\'s globals resolve whatever it did to Set.prototype.has, Array.prototype.filter and the Array iterator', async () => {
  const { posted, exceptions, console, calls } = await runContent(`
    const replace = Math.replaced;
    replace(Set.prototype, 'has', 'Set.prototype.has');
    replace(Array.prototype, 'filter', 'Array.prototype.filter');
    replace(Array.prototype, Symbol.iterator, 'Array.prototype[Symbol.iterator]');
    replace(Function.prototype, 'call', 'Function.prototype.call');
    replace(Function.prototype, 'bind', 'Function.prototype.bind');
    replace(Reflect, 'ownKeys', 'Reflect.ownKeys');
    replace(Reflect, 'apply', 'Reflect.apply');
    replace(Reflect, 'getOwnPropertyDescriptor', 'Reflect.getOwnPropertyDescriptor');
    replace(Reflect, 'get', 'Reflect.get');
    replace(Reflect, 'set', 'Reflect.set');
    replace(Reflect, 'deleteProperty', 'Reflect.deleteProperty');
    replace(Object, 'create', 'Object.create');

    created = 1;
    removed = 1;
    globalThis.assigned = 2;
    const names = Object.keys(globalThis);
    let listed = 0;
    for (let index = 0; index < names.length; index++) {
      if (names[index] === 'created' || names[index] === 'assigned' || names[index] === 'DesktopEngine') listed += 1;
    }
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'DesktopEngine');
    const report = {
      language: [typeof Object, typeof Array, Math.max(1, 2), JSON.stringify({ a: [1] }), typeof Promise, typeof Proxy],
      engine: [typeof DesktopEngine, typeof DesktopEngine.system, typeof setTimeout, typeof console.log, typeof fetch, typeof structuredClone,
        typeof BroadcastChannel, typeof localStorage],
      // bound to the real global object when read
      bound: [atob('YQ=='), btoa('a'), typeof queueMicrotask, atob.name],
      hidden: [typeof window, typeof document, typeof HTMLCanvasElement, typeof globalThis.document, 'document' in globalThis],
      own: [created, globalThis.created, assigned, typeof created, 'created' in globalThis, self === globalThis, this === globalThis],
      keys: listed,
      descriptor: [typeof descriptor.value, descriptor.configurable],
      deleted: [delete globalThis.assigned, typeof assigned, delete removed, typeof removed, typeof toString],
    };
    // a replaced builtin the content calls is still its own
    let own;
    try {
      [].filter(() => true);
    } catch (error) {
      own = error.message;
    }
    report.calledByContent = own;
    Math.calls.length = 0;
    console.log('logged', { a: 1 }, [1, 2]);
    setTimeout(() => postMessage('host', { timer: typeof DesktopEngine }), 0);
    postMessage('host', report);
  `);
  assert.deepEqual(posted, [
    {
      language: ['function', 'function', 2, '{"a":[1]}', 'function', 'function'],
      engine: ['object', 'object', 'function', 'function', 'function', 'function', 'function', 'object'],
      bound: ['a', 'YQ==', 'function', 'atob'],
      hidden: ['undefined', 'undefined', 'undefined', 'undefined', false],
      own: [1, 1, 2, 'number', true, true, true],
      keys: 3,
      descriptor: ['object', true],
      deleted: [true, 'undefined', true, 'undefined', 'function'],
      calledByContent: 'Array.prototype.filter was replaced',
    },
    { timer: 'object' },
  ]);
  assert.deepEqual(console, ['logged {"a":1} [1,2]']);
  assert.deepEqual(calls, []);
  assert.deepEqual(exceptions, []);
});

test('content\'s global object takes descriptors whatever the content put on Object.prototype', async () => {
  const { posted, exceptions } = await runContent(`
    const describe = (action) => {
      try {
        return action();
      } catch (error) {
        return error.name + ': ' + error.message;
      }
    };
    // a descriptor with a prototype has a getter now, which can't go with a value
    Object.defineProperty(Object.prototype, 'get', { value: function () { return 'inherited'; }, writable: true, configurable: true });
    created = 1;
    const report = {
      keys: describe(() => Object.keys(globalThis).length > 0),
      descriptor: describe(() => typeof Object.getOwnPropertyDescriptor(globalThis, 'DesktopEngine').value),
      ownDescriptor: describe(() => Object.getOwnPropertyDescriptor(globalThis, 'created').value),
      defined: describe(() => {
        Object.defineProperty(globalThis, 'defined', Object.setPrototypeOf({ value: 3, configurable: true }, null));
        return defined;
      }),
      deleted: describe(() => delete globalThis.created && typeof created),
    };
    delete Object.prototype.get;
    postMessage('host', report);
  `);
  assert.deepEqual(posted, [{ keys: true, descriptor: 'object', ownDescriptor: 1, defined: 3, deleted: 'undefined' }]);
  assert.deepEqual(exceptions, []);
});

test('a module content requires runs with the content\'s globals and `this` whatever it did to Function.prototype.call', async () => {
  const { posted, exceptions } = await runContent(`
    Math.replaced(Function.prototype, 'call', 'Function.prototype.call');
    Math.replaced(Function.prototype, 'apply', 'Function.prototype.apply');
    const lib = require('./lib.js');
    postMessage('host', { lib: lib.report(), calls: Math.calls.length });
  `, {
    files: {
      'lib.js': `
        const top = this;
        exports.report = () => [top === globalThis, typeof DesktopEngine, typeof document, typeof module, typeof require];
      `,
    },
  });
  assert.deepEqual(posted, [{ lib: [true, 'object', 'undefined', 'object', 'function'], calls: 0 }]);
  assert.deepEqual(exceptions, []);
});

/** Every builtin the runtime's own work could use, as [object, key, label] */
const REPLACED = `[
  ...['filter', 'map', 'forEach', 'some', 'every', 'find', 'includes', 'indexOf', 'push', 'join', 'slice',
    'splice', 'concat', 'values', 'keys', 'entries', Symbol.iterator].map((key) => [Array.prototype, key, 'Array.prototype.' + String(key)]),
  ...['has', 'add', 'delete', 'clear', 'forEach', 'values', 'keys', 'entries', Symbol.iterator].map((key) => [Set.prototype, key, 'Set.prototype.' + String(key)]),
  ...['get', 'set', 'has', 'delete', 'clear', 'forEach', 'values', 'keys', 'entries', Symbol.iterator].map((key) => [Map.prototype, key, 'Map.prototype.' + String(key)]),
  ...['get', 'set', 'has', 'delete'].map((key) => [WeakMap.prototype, key, 'WeakMap.prototype.' + key]),
  ...['has', 'add', 'delete'].map((key) => [WeakSet.prototype, key, 'WeakSet.prototype.' + key]),
  ...['call', 'apply', 'bind'].map((key) => [Function.prototype, key, 'Function.prototype.' + key]),
  ...['startsWith', 'slice', 'indexOf', 'trim'].map((key) => [String.prototype, key, 'String.prototype.' + key]),
  ...['apply', 'construct', 'ownKeys', 'defineProperty', 'deleteProperty', 'getOwnPropertyDescriptor'].map((key) => [Reflect, key, 'Reflect.' + key]),
  ...['keys', 'values', 'assign', 'freeze', 'defineProperty', 'setPrototypeOf', 'getOwnPropertyDescriptor', 'create'].map((key) => [Object, key, 'Object.' + key]),
  ...['stringify', 'parse'].map((key) => [JSON, key, 'JSON.' + key]),
  ...['max', 'min', 'floor', 'hypot', 'sqrt'].map((key) => [Math, key, 'Math.' + key]),
  [Number, 'isFinite', 'Number.isFinite'],
  [performance, 'now', 'performance.now'],
  [globalThis, 'queueMicrotask', 'queueMicrotask'],
]`;

test('what the host sends, the listeners, the console and the windows work whatever the content did to the language\'s builtins', async () => {
  const { posted, exceptions, console, messages, calls, events } = await runContent(`
    // made before: the components' own methods aren't what's checked here
    const win = new DesktopEngine.Window({ style: { left: 10, top: 40, width: 200, height: 100 } });
    win.show();
    const replaced = ${REPLACED};
    for (let index = 0; index < replaced.length; index++) Math.replaced(replaced[index][0], replaced[index][1], replaced[index][2]);

    const events = [];
    const note = (text) => {
      events[events.length] = text;
    };
    Math.events = events;
    DesktopEngine.system.addEventListener('appearancechange', (event) => note('appearancechange ' + event.appearance));
    DesktopEngine.system.onparameterschange = (event) => note('parameterschange ' + event.changed[0] + ' ' + event.parameters.size + ' '
      + DesktopEngine.launchOptions.parameters.size);
    DesktopEngine.input.addEventListener('onmousemove', (event) => note('input mousemove ' + event.x + ',' + event.y));
    DesktopEngine.ScreenManager.onchange = () => note('screens change');
    const windows = DesktopEngine.windows;
    windows.onchange = () => note('windows change');
    win.onmousedown = (event) => note('mousedown ' + event.x + ',' + event.y + ' ' + event.button);
    win.addEventListener('mouseup', () => note('mouseup'));
    win.addEventListener('click', () => note('click'));
    win.addEventListener('mouseenter', () => note('mouseenter'));
    win.onmove = (event) => note('move ' + event.x + ',' + event.y);
    win.addEventListener('hide', () => note('hide'));
    win.addEventListener('show', () => note('show'));
    const removed = () => note('removed listener');
    win.addEventListener('move', removed);
    win.removeEventListener('move', removed);
    // thrown in a listener: reported, the next ones still run
    DesktopEngine.system.addEventListener('appearancechange', () => {
      throw new TypeError('thrown in a listener');
    });
    DesktopEngine.system.addEventListener('appearancechange', () => note('after the throw'));

    console.log('patched', { a: 1 }, [1, 2], undefined);
    postMessage('host', { listens: [typeof win.onmove, DesktopEngine.system.onappearancechange, windows === DesktopEngine.windows] });
  `, {
    launch: { permissions: ['mouse', 'window-positions'] },
    messages: [
      '{ type: \'appearance\', appearance: \'light\' }',
      '{ type: \'parameters\', parameters: { size: 2 }, changed: [\'size\'] }',
      '{ type: \'global-mouse\', kind: \'move\', x: 10, y: 20 }',
      '{ type: \'screens\', screens: [{ id: 1, name: \'Main\', bounds: { x: 0, y: 0, width: 1280, height: 800 }, visibleFrame: { x: 0, y: 25, width: 1280, height: 775 }, scale: 2 }] }',
      '{ type: \'pointer\', kind: \'move\', window: lastWindowId(), x: 110, y: 60, buttons: 0 }',
      '{ type: \'pointer\', kind: \'down\', window: lastWindowId(), x: 120, y: 70, button: 0, buttons: 1 }',
      '{ type: \'pointer\', kind: \'up\', window: lastWindowId(), x: 120, y: 70, button: 0, buttons: 0 }',
      '{ type: \'move-window\', window: lastWindowId(), x: 300, y: 200 }',
      '{ type: \'app-windows\', windows: [{ id: 7, frame: { x: 0, y: 30, width: 500, height: 400 }, isActiveApp: true, isFullScreen: false, isFloating: false }] }',
      '{ type: \'playback\', suspended: true, renderingPaused: true, muted: true, maxFramesPerSecond: 0 }',
      '{ type: \'playback\', suspended: false, renderingPaused: false, muted: true, maxFramesPerSecond: 0 }',
      '{ type: \'stop\' }',
    ],
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(exceptions, ['TypeError: thrown in a listener']);
  assert.deepEqual(posted, [{ listens: ['function', null, true] }]);
  assert.deepEqual(console, ['patched {"a":1} [1,2] undefined']);
  assert.deepEqual(events, [
    'appearancechange light',
    'after the throw',
    'parameterschange size 2 2',
    'input mousemove 10,20',
    'screens change',
    'mouseenter',
    'mousedown 20,20 0',
    'mouseup',
    'click',
    'move 300,200',
    'windows change',
    'hide',
    'show',
  ]);
  // the runtime tells the host what the content wants and where its windows are, also after it replaced the builtins
  const types = messages.map((message) => message.type);
  assert.ok(types.includes('input-wanted'), types.join(', '));
  const windows = messages.filter((message) => message.type === 'windows') as unknown as { windows: { frame: { x: number; y: number } }[] }[];
  assert.deepEqual(windows.at(-2)?.windows.map((win) => win.frame), [{ x: 300, y: 200, width: 200, height: 100 }]);
  // destroyed when the content stops
  assert.deepEqual(windows.at(-1)?.windows, []);
});

// The content's global object is like the app's, where it inherits Object.prototype and keeps it: what's expected
// below is what the app gave. Unlike the app, a function called by a global name gets the scope as `this`
// (`toString()` gives "[object Object]", the app's "[object Undefined]"), which isn't checked.
test('content\'s global object inherits Object.prototype', async () => {
  const { posted, exceptions } = await runContent(`
    const report = {};
    const check = (label, action) => {
      try {
        report[label] = action();
      } catch (error) {
        report[label] = 'throws ' + error.name;
      }
    };
    check('inherited', () => [typeof globalThis.hasOwnProperty, typeof globalThis.toString, typeof toString, typeof hasOwnProperty,
      constructor === Object, 'toString' in globalThis, globalThis.__proto__ === Object.prototype, Object.prototype.isPrototypeOf(globalThis),
      globalThis instanceof Object]);
    check('own', () => [globalThis.hasOwnProperty('DesktopEngine'), globalThis.hasOwnProperty('toString'), Object.keys(globalThis).indexOf('toString')]);
    check('tag', () => [String(globalThis), globalThis.toString(), Object.prototype.toString.call(globalThis), typeof globalThis[Symbol.toStringTag]]);
    check('hidden', () => [typeof window, typeof document, typeof addEventListener, typeof HTMLCanvasElement, typeof undeclared,
      'addEventListener' in globalThis, typeof globalThis.dispatchEvent]);
    check('added', () => {
      Object.prototype.added = 'yes';
      let listed = false;
      for (const name in globalThis) if (name === 'added') listed = true;
      const found = [added, globalThis.added, 'added' in globalThis, listed, Object.keys(globalThis).indexOf('added')];
      delete Object.prototype.added;
      return [...found, typeof added];
    });
    check('assigned', () => {
      toString = 5;
      const assigned = [toString, globalThis.toString, globalThis.hasOwnProperty('toString'), typeof ({}).toString];
      return [...assigned, delete toString, typeof toString, delete valueOf, typeof valueOf];
    });
    check('accessors', () => {
      const seen = [];
      Object.defineProperty(Object.prototype, 'accessed', {
        get() { return this === globalThis; },
        set(value) { seen.push(value, this === globalThis); },
        configurable: true,
      });
      accessed = 1;
      globalThis.accessed = 2;
      const found = [accessed, globalThis.accessed, seen, globalThis.hasOwnProperty('accessed')];
      delete Object.prototype.accessed;
      return found;
    });
    check('read only', () => {
      Object.defineProperty(Object.prototype, 'readOnly', { value: 1, writable: false, configurable: true });
      let strict;
      try {
        (function () {
          'use strict';
          readOnly = 2;
        })();
      } catch (error) {
        strict = error.name;
      }
      readOnly = 3;
      const found = [strict, readOnly, globalThis.hasOwnProperty('readOnly')];
      delete Object.prototype.readOnly;
      return found;
    });
    check('prototype', () => [Reflect.setPrototypeOf(globalThis, {}), Object.setPrototypeOf(globalThis, Object.prototype) === globalThis,
      Object.getPrototypeOf(globalThis) === Object.prototype]);
    check('setPrototypeOf', () => Object.setPrototypeOf(globalThis, {}));
    check('assigned __proto__', () => {
      globalThis.__proto__ = {};
    });
    check('bare __proto__', () => {
      __proto__ = {};
    });
    check('deleted', () => {
      created = 1;
      const deleted = [delete created, typeof created, 'created' in globalThis];
      globalThis.created = 2;
      return [...deleted, delete globalThis.created, typeof created];
    });
    postMessage('host', report);
  `);
  assert.deepEqual(posted, [{
    inherited: ['function', 'function', 'function', 'function', true, true, true, true, true],
    own: [true, false, -1],
    tag: ['[object Object]', '[object Object]', '[object Object]', 'undefined'],
    hidden: ['undefined', 'undefined', 'undefined', 'undefined', 'undefined', false, 'undefined'],
    added: ['yes', 'yes', true, true, -1, 'undefined'],
    assigned: [5, 5, true, 'function', true, 'function', true, 'function'],
    accessors: [true, true, [1, true, 2, true], false],
    'read only': ['TypeError', 1, false],
    prototype: [false, true, true],
    setPrototypeOf: 'throws TypeError',
    'assigned __proto__': 'throws TypeError',
    'bare __proto__': 'throws TypeError',
    deleted: [true, 'undefined', false, true, 'undefined'],
  }]);
  assert.deepEqual(exceptions, []);
});
