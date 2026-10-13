// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The web runtime gives content the app's globals as the app makes them: DesktopEngine.systemAudio and
// DesktopEngine.windows are the one object of their class, which content may construct first; a BroadcastChannel
// refuses the runtime's stand-ins for the engine's objects (a screen, localStorage) as the app refuses the engine's;
// launchOptions.permissions lists only what the content gets. The frame runtime runs here in a node process of its own
// with stand-ins for the few browser globals it needs, the desktop's code without a DOM.

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
async function runContent(launch: Partial<LaunchMessage>, code: string): Promise<unknown[]> {
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
  const script = `${BROWSER}\n${frameRuntime}\n`
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
