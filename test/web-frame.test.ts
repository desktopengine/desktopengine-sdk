// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The web runtime gives content the app's globals as the app makes them: DesktopEngine.systemAudio and
// DesktopEngine.windows are the one object of their class, which content may construct first; a BroadcastChannel
// refuses the runtime's stand-ins for the engine's objects (a screen, localStorage) as the app refuses the engine's;
// launchOptions.permissions lists only what the content gets; a canvas reads getContext's options as the app does. The
// frame runtime runs here in a node process of its own with stand-ins for the few browser globals it needs, the
// desktop's code without a DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

import type { LaunchMessage } from '../web/protocol.ts';

const web = path.join(import.meta.dirname, '..', 'web');

/** The frame runtime, bundled as the SDK bundles it (web/build.mjs) */
const { frameOptions } = await import(pathToFileURL(path.join(web, 'build.mjs')).href) as { frameOptions: esbuild.BuildOptions };
const frameRuntime = (await esbuild.build({ ...frameOptions, logLevel: 'silent' })).outputFiles![0].text;

/** What a frame needs of a browser that node doesn't have; the page is a stand-in that notes what the frame sends */
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
`;

/** Runs `code` as a content launched with `launch`: what it posts to the host, and its exceptions */
async function runContent(launch: Partial<LaunchMessage>, code: string, browser = ''): Promise<unknown[]> {
  const message: LaunchMessage = {
    type: 'launch',
    name: 'test',
    code,
    files: {},
    options: { permissions: launch.permissions ?? [] },
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
  const script = `${BROWSER}\n${browser}\n${frameRuntime}\n`
    + `for (const listener of listeners) listener({ source: globalThis.parent, data: ${JSON.stringify(message)} });\n`
    + `process.stdout.write(JSON.stringify(sent.filter((m) => m.type === 'host-message' || m.type === 'exception')), () => process.exit(0));\n`;
  // on stdin, not with -e: Linux takes no single argument over 128 KB, and the bundled runtime is more
  const run = promisify(execFile)(process.execPath, ['--input-type=module'], { timeout: 20000 });
  run.child.stdin!.end(script);
  const { stdout } = await run;
  return (JSON.parse(stdout) as { type: string; message: unknown }[]).map((sent) => (sent.type === 'host-message' ? sent.message : sent));
}

test('content may construct DesktopEngine.systemAudio and .windows first, as in the app, and only once', async () => {
  const [result] = await runContent({ permissions: ['system-audio', 'window-positions'], systemAudio: 'restricted' }, `
    const name = (action) => { try { action(); return 'made'; } catch (error) { return error.name + ': ' + error.message; } };
    const audio = new DesktopEngineRuntime.SystemAudio();
    const descriptor = Object.getOwnPropertyDescriptor(DesktopEngine, 'systemAudio');
    const windows = DesktopEngine.windows;
    postMessage('host', {
      audio: DesktopEngine.systemAudio === audio && descriptor.value === audio,
      descriptor: [descriptor.writable, descriptor.enumerable, descriptor.configurable],
      secondAudio: name(() => new DesktopEngineRuntime.SystemAudio()),
      windows: windows instanceof DesktopEngineRuntime.Windows && DesktopEngine.windows === windows,
      secondWindows: name(() => new DesktopEngineRuntime.Windows()),
    });
  `);
  assert.deepEqual(result, {
    audio: true,
    descriptor: [false, true, true],
    secondAudio: 'TypeError: Illegal constructor',
    windows: true,
    secondWindows: 'TypeError: Illegal constructor',
  });
});

test('without the permissions, DesktopEngine.systemAudio and .windows are null and their constructors throw', async () => {
  const [result] = await runContent({ permissions: ['network', 'system-audio'] }, `
    const name = (action) => { try { action(); return 'made'; } catch (error) { return error.name; } };
    postMessage('host', {
      constructors: [DesktopEngineRuntime.SystemAudio !== undefined, DesktopEngineRuntime.Windows !== undefined],
      before: [name(() => new DesktopEngineRuntime.SystemAudio()), name(() => new DesktopEngineRuntime.Windows())],
      values: [DesktopEngine.systemAudio, DesktopEngine.windows],
      after: [name(() => new DesktopEngineRuntime.SystemAudio()), name(() => new DesktopEngineRuntime.Windows())],
      keys: Object.keys(DesktopEngine).filter((key) => key === 'systemAudio' || key === 'windows'),
    });
  `);
  assert.deepEqual(result, {
    constructors: [true, true],
    before: ['Error', 'Error'],
    values: [null, null],
    after: ['Error', 'Error'],
    keys: ['systemAudio', 'windows'],
  });
});

test('a BroadcastChannel refuses screens and storages as the app refuses the engine\'s', async () => {
  const [result] = await runContent({}, `
    const channel = new BroadcastChannel('settings');
    localStorage.setItem('volume', '0.5');
    const screen = DesktopEngine.ScreenManager.mainScreen;
    const posted = {};
    for (const [label, value] of Object.entries({
      screens: { screens: DesktopEngine.ScreenManager.screens }, screen, localStorage, sessionStorage,
      made: Object.create(localStorage), madeScreen: Object.create(screen), copy: { ...screen }, items: { ...localStorage },
      proxy: new Proxy({ a: 1 }, {}),
    })) {
      try { channel.postMessage(value); posted[label] = 'sent'; } catch (error) { posted[label] = error.name + ': ' + error.message; }
    }
    postMessage('host', { posted, tag: Object.prototype.toString.call(screen), keys: Object.keys(screen).length, storage: localStorage.constructor.name });
  `);
  assert.deepEqual(result, {
    posted: {
      screens: 'DataCloneError: A Object can\'t be cloned',
      screen: 'DataCloneError: A Object can\'t be cloned',
      localStorage: 'DataCloneError: A Storage can\'t be cloned',
      sessionStorage: 'DataCloneError: A Storage can\'t be cloned',
      made: 'DataCloneError: A Storage can\'t be cloned',
      madeScreen: 'sent',
      copy: 'sent',
      items: 'sent',
      proxy: 'sent',
    },
    tag: '[object Screen]',
    keys: 11,
    storage: 'Storage',
  });
});

// MARK: - The desktop

interface Host {
  WebContent: { prototype: object };
}

/** The desktop's code, bundled as the SDK bundles it (node can't run the TypeScript of its classes as it is) */
const host = await (async (): Promise<Host> => {
  const result = await esbuild.build({
    entryPoints: [path.join(web, 'host', 'desktop.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    define: { __FRAME_RUNTIME__: '""' },
    logLevel: 'silent',
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)) as Host;
})();

/** What a content of the spec is told it runs with (launchOptions.permissions, and the frame's) */
function givenPermissions(spec: Record<string, unknown>, keyActivity = false): string[] {
  const desktop = { options: { keyActivity: () => keyActivity } };
  const content = Object.assign(Object.create(host.WebContent.prototype) as { givenPermissions: string[] }, { desktop, spec });
  return content.givenPermissions;
}

/** A document whose elements take anything; a canvas's getContext posts the attributes it's asked for, and makes none */
const RECORDING_CANVAS = `
const anything = () => new Proxy(function () {}, {
  get: (target, key) => key === Symbol.toPrimitive ? () => 0
    : key === 'getContext' ? (kind, attributes) => { sent.push({ type: 'host-message', message: [kind, attributes] }); return null; }
    : anything(),
  set: () => true,
  apply: () => anything(),
  construct: () => anything(),
});
globalThis.document = anything();
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
`;

test('DesktopEngine.syncStorage has the app\'s limits and errors (recorded in the app)', async () => {
  const [result] = await runContent({}, `
    const s = DesktopEngine.syncStorage;
    const error = (action) => { try { action(); return 'none'; } catch (e) { return e.name + ': ' + e.message; } };
    const results = {
      tag: Object.prototype.toString.call(s), eventTarget: s instanceof EventTarget, same: s === DesktopEngine.syncStorage,
      order: Object.keys(DesktopEngine).slice(16, 19), onchange: s.onchange,
      constructor: error(() => new s.constructor()),
      invocation: error(() => Object.getPrototypeOf(s).getItem.call({}, 'a')),
      arguments: error(() => s.getItem()),
      clone: error(() => structuredClone(s)),
    };
    s.setItem('a', 1);
    results.number = s.getItem('a');
    s.setItem('lone', '\\uD800x');
    results.lone = escape(s.getItem('lone'));
    s.setItem('\\uDC00k', 'v');
    results.loneKey = [s.getItem('\\uFFFDk'), s.getItem('\\uDBFFk')];
    s.removeItem('\\uFFFDk');
    s.setItem('caf\\u00e9', 'composed');
    s.setItem('cafe\\u0301', 'decomposed');
    results.nfc = [s.getItem('caf\\u00e9'), s.length, escape(s.key(s.length - 1))];
    s.removeItem('cafe\\u0301');
    results.big = error(() => s.setItem('b', 'x'.repeat(61439)));
    results.tooBig = error(() => s.setItem('b', 'x'.repeat(61440)));
    results.quotes = error(() => s.setItem('q', '"'.repeat(30720)));
    s.removeItem('b');
    let n = 0;
    results.keys = error(() => { for (; n < 2000; n++) s.setItem('k' + n, 'v'); });
    results.keyCount = s.length;
    for (let i = 0; i < n; i++) s.removeItem('k' + i);
    let m = 0;
    results.quota = error(() => { for (; m < 100; m++) s.setItem('big' + m, 'y'.repeat(60000)); });
    results.quotaCount = m;
    for (let i = 0; i < m; i++) s.removeItem('big' + i);
    results.items = Array.from({ length: s.length }, (_, i) => [s.key(i), s.getItem(s.key(i))]);
    postMessage('host', results);
  `);
  assert.deepEqual(result, {
    tag: '[object SyncStorage]',
    eventTarget: true,
    same: true,
    order: ['ScreenManager', 'syncStorage', 'system'],
    onchange: null,
    constructor: 'TypeError: Illegal constructor',
    invocation: 'TypeError: Illegal invocation',
    arguments: 'TypeError: Failed to execute \'getItem\' on \'SyncStorage\': 1 argument required, but only 0 present.',
    clone: 'DataCloneError: A SyncStorage can\'t be cloned',
    number: '1',
    lone: '%uFFFDx',
    loneKey: ['v', 'v'],
    nfc: ['decomposed', 3, 'caf%E9'],
    big: 'none',
    tooBig: 'QuotaExceededError: Failed to execute \'setItem\' on \'SyncStorage\': The key and value of \'b\' are too long.',
    quotes: 'QuotaExceededError: Failed to execute \'setItem\' on \'SyncStorage\': The key and value of \'q\' are too long.',
    keys: 'QuotaExceededError: Failed to execute \'setItem\' on \'SyncStorage\': Setting \'k1022\' exceeded the maximum number of items.',
    keyCount: 1024,
    quota: 'QuotaExceededError: Failed to execute \'setItem\' on \'SyncStorage\': Setting the value of \'big17\' exceeded the quota.',
    quotaCount: 17,
    items: [['a', '1'], ['lone', '\uFFFDx']],
  });
});

test('getContext reads alpha and antialias as the app does: undefined is the default, anything else converts to a boolean', async () => {
  const options = `[
    undefined, null, 5, 'x', true,
    {}, { alpha: undefined, antialias: undefined }, { alpha: null, antialias: null }, { alpha: {}, antialias: [] },
    { alpha: [], antialias: {} }, { alpha: 0, antialias: 1 }, { alpha: 'x', antialias: 'x' }, { alpha: '', antialias: '' },
    { alpha: false, antialias: true }, { alpha: Object.create(null), antialias: Object.create(null) },
  ]`;
  const sent = await runContent({}, `
    for (const option of ${options}) new DesktopEngine.Canvas().getContext('webgl', option);
    let order = [];
    const recorded = { get antialias() { order.push('antialias'); return true; }, get alpha() { order.push('alpha'); return false; } };
    new DesktopEngine.Canvas().getContext('2d', recorded);
    postMessage('host', order);
    let thrown;
    try { new DesktopEngine.Canvas().getContext('2d', { get alpha() { throw new RangeError('no'); } }); } catch (error) { thrown = error.name; }
    postMessage('host', thrown);
  `, RECORDING_CANVAS);
  const attributes = (alpha: boolean, antialias: boolean) => ['webgl', { alpha, antialias, premultipliedAlpha: true, preserveDrawingBuffer: false }];
  assert.deepEqual(sent, [
    // not an object: the defaults
    attributes(true, false), attributes(true, false), attributes(true, false), attributes(true, false), attributes(true, false),
    attributes(true, false), attributes(true, false), attributes(false, false), attributes(true, true),
    attributes(true, true), attributes(false, true), attributes(true, true), attributes(false, false),
    attributes(false, true), attributes(true, true),
    ['2d', { alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false }],
    ['alpha', 'antialias'],
    'RangeError',
  ]);
});

test('launchOptions.permissions lists only what the content gets, as in the app', () => {
  const manifest = (id: string, permissions: string[]) => ({ name: id, code: '', manifest: { id, type: 'widget', permissions } });
  const official = manifest('app.desktopengine.official.meter', ['network', 'system-audio', 'key-activity', 'mouse']);
  // the store's item with a reserved id: system audio with the network; key presses only when the page gives them
  assert.deepEqual(givenPermissions(official), ['network', 'system-audio', 'mouse']);
  assert.deepEqual(givenPermissions(official, true), ['network', 'system-audio', 'key-activity', 'mouse']);
  // a developer's copy (dev --web turns officialId off): no system audio with the network
  assert.deepEqual(givenPermissions({ ...official, officialId: false }, true), ['network', 'key-activity', 'mouse']);
  // anyone else's: system audio without the network only
  assert.deepEqual(givenPermissions(manifest('app.desktopengine.acme.meter', ['network', 'system-audio'])), ['network']);
  assert.deepEqual(givenPermissions(manifest('app.desktopengine.acme.meter', ['system-audio', 'system-audio'])), ['system-audio']);
  // what the page says it may use, over the manifest
  assert.deepEqual(givenPermissions({ ...manifest('app.desktopengine.acme.meter', ['mouse', 'audio']), permissions: ['audio'] }), ['audio']);
});
