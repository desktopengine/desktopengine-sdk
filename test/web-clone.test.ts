// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// structuredClone, MessageChannel and MessagePort in the web runtime (web/frame/clone.ts) are the app's, not the
// browser's: run through the same corpus of values, transfers, arguments and deliveries (structured-clone-corpus.js),
// they give the report the app gives (structured-clone-app.json). The frame gives them to the content in place of the
// browser's.
//
// structured-clone-app.json is what the app reports for the corpus. When the app's structuredClone or MessageChannel
// changes, record it again: run the corpus as a content's code in the app, followed by
// `runCorpus((report) => console.log(JSON.stringify(report)), { throwingListeners: true })`, and save the report with
// one case a line. Cases the place doesn't have are "unavailable" (node has no ImageBitmap, the app no
// SharedArrayBuffer) and aren't compared.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

type Section = Record<string, unknown>;
interface Report {
  clone: Section;
  transfer: Section;
  ports: Section;
  later: Section;
  delivery: string[];
}
type RunCorpus = (done: (report: Report) => void, options?: { throwingListeners?: boolean; timeScale?: number }) => void;

/** An ImageData of the browser's shape, which node doesn't have; the runtime takes the global's before content runs */
class ImageData {
  #data: Uint8ClampedArray;
  #width: number;
  #height: number;

  constructor(data: Uint8ClampedArray | number, width: number, height?: number) {
    if (typeof data === 'number') {
      height = width;
      width = data;
      data = new Uint8ClampedArray(width * height * 4);
    }
    this.#data = data;
    this.#width = width;
    this.#height = height ?? data.length / 4 / width;
  }

  get data(): Uint8ClampedArray {
    return this.#data;
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  get [Symbol.toStringTag](): string {
    return 'ImageData';
  }
}
(globalThis as Record<string, unknown>).ImageData = ImageData;
const { createMessaging } = await import('../web/frame/clone.ts');
const { installMessageEvent } = await import('../web/frame/message-event.ts');

/** The corpus' report with the runtime's structuredClone, MessageChannel, MessagePort and MessageEvent as the globals, as in a frame */
async function webReport(): Promise<Report> {
  const { structuredClone, MessageChannel, MessagePort } = createMessaging({ setTimeout });
  for (const [name, value] of Object.entries({ structuredClone, MessageChannel, MessagePort })) {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
  }
  installMessageEvent(globalThis as unknown as Record<string, unknown>);
  const corpus = fs.readFileSync(path.join(import.meta.dirname, 'structured-clone-corpus.js'), 'utf8');
  // node's navigator, crypto and storages aren't the runtime's: left out, as node has no DesktopEngine
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const runCorpus = new Function('navigator', 'localStorage', 'sessionStorage', 'crypto', `${corpus}\nreturn runCorpus;`)() as RunCorpus;
  // the corpus waits a while between its deliveries: longer here, for a busy machine
  return new Promise((resolve) => runCorpus(resolve, { timeScale: 3 }));
}

const app = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'structured-clone-app.json'), 'utf8')) as Report;
const web = await webReport();

/** Each case of a section both have, `minimum` of them at least */
function compareSection(name: 'clone' | 'transfer' | 'ports' | 'later', minimum: number): void {
  assert.deepEqual(Object.keys(web[name]), Object.keys(app[name]), `the corpus' ${name} cases changed: record structured-clone-app.json again`);
  let compared = 0;
  for (const [label, value] of Object.entries(web[name])) {
    if (value === 'unavailable' || app[name][label] === 'unavailable') continue;
    assert.deepEqual(value, app[name][label], `${name}: ${label}`);
    compared += 1;
  }
  assert.ok(compared >= minimum, `${compared} ${name} cases compared`);
}

test('structuredClone on the web copies what the app copies, as the app copies it', () => {
  compareSection('clone', 120);
  compareSection('later', 1);
});

test('structuredClone on the web transfers as the app does and takes its arguments as the app does', () => {
  compareSection('transfer', 35);
});

test('MessageChannel and MessagePort on the web are the app\'s, and take its arguments', () => {
  compareSection('ports', 25);
});

test('a MessagePort on the web delivers as the app does: once started, one message a task', () => {
  // node takes an exception in a listener for an uncaught one: the app's report ends with the scenario that throws
  const end = app.delivery.indexOf('- a listener that throws');
  assert.deepEqual(web.delivery, end >= 0 ? app.delivery.slice(0, end) : app.delivery);
});

// MARK: - In a frame

/** The frame runtime, bundled as the SDK bundles it (web/build.mjs) */
const { frameOptions } = await import(pathToFileURL(path.join(import.meta.dirname, '..', 'web', 'build.mjs')).href) as { frameOptions: esbuild.BuildOptions };
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

/**
 * Runs `code` as a content, then gives it new parameters: what it posts to the host, and its exceptions. `browser` runs
 * before the frame runtime, as the browser's own.
 */
async function runContent(code: string, browser = ''): Promise<unknown[]> {
  const launch = {
    type: 'launch', name: 'test', code, files: {}, options: { permissions: [], parameters: { size: 1 } },
    screens: [{ id: 1, name: 'Main', bounds: { x: 0, y: 0, width: 1440, height: 900 }, visibleFrame: { x: 0, y: 25, width: 1440, height: 875 }, scale: 2 }],
    permissions: [], networkDomains: [], appearance: 'dark', apiVersion: 6, maxFramesPerSecond: 0, muted: true, keyActivity: false,
    namespaceChannels: false, systemAudio: 'none', appWindows: [],
  };
  const parameters = { type: 'parameters', parameters: { size: 2 }, changed: ['size'] };
  const script = `${BROWSER}\n${browser}\n${frameRuntime}\n`
    + `for (const listener of listeners) listener({ source: globalThis.parent, data: ${JSON.stringify(launch)} });\n`
    + `setTimeout(() => { for (const listener of listeners) listener({ source: globalThis.parent, data: ${JSON.stringify(parameters)} }); }, 20);\n`
    + `setTimeout(() => process.stdout.write(JSON.stringify(sent.filter((m) => m.type === 'host-message' || m.type === 'exception')), () => process.exit(0)), 100);\n`;
  // on stdin, not with -e: Linux takes no single argument over 128 KB, and the bundled runtime is more
  const run = promisify(execFile)(process.execPath, ['--input-type=module'], { timeout: 20000 });
  run.child.stdin!.end(script);
  const { stdout } = await run;
  return (JSON.parse(stdout) as { type: string; message: unknown }[]).map((sent) => (sent.type === 'host-message' ? sent.message : sent));
}

test('the frame gives content the runtime\'s structuredClone, MessageChannel and MessagePort, not the browser\'s', async () => {
  const results = await runContent(`
    const name = (action) => { try { return action(); } catch (error) { return error.name + ': ' + error.message; } };
    const { port1, port2 } = new MessageChannel();
    const carried = new MessageChannel().port1;
    const got = [];
    port2.onmessage = (event) => {
      got.push([event.data, event.ports[0] === carried]);
      setTimeout(() => postMessage('host', { got }), 0);
    };
    port1.postMessage('hello', [carried]);
    postMessage('host', {
      // the browser's refuses a Proxy, and makes a new port of a transferred one
      proxy: name(() => structuredClone(new Proxy({ a: 1 }, {}))),
      port: name(() => structuredClone(carried, { transfer: [carried] }) === carried),
      refused: name(() => structuredClone(port1)),
      names: [structuredClone.name, MessageChannel.name, MessagePort.name, port1 instanceof MessagePort, port1 instanceof EventTarget],
      globals: ['structuredClone', 'MessageChannel', 'MessagePort', 'BroadcastChannel'].map((key) => Object.keys(globalThis).includes(key)),
      storage: [localStorage instanceof Storage, name(() => structuredClone(sessionStorage)), name(() => new Storage())],
      crypto: [name(() => structuredClone(crypto)), crypto.constructor.name, Object.prototype.toString.call(crypto)],
      engine: [name(() => structuredClone(DesktopEngine.system)), name(() => structuredClone(DesktopEngine.ScreenManager.mainScreen))],
      // the engine's MessageEvent, which takes the runtime's ports
      event: [Object.keys(globalThis).includes('MessageEvent'), new MessageEvent('message', { ports: [carried] }).ports[0] === carried,
        new MessageEvent('message', { source: port1 }).source, new MessageEvent('m').constructor === MessageEvent],
      runtime: [Object.keys(DesktopEngineRuntime), Object.keys(DesktopEngineCore), name(() => structuredClone({ window: DesktopEngine.Window }))],
      functions: [setTimeout.name, clearTimeout.name, clearInterval.name, clearTimeout === clearInterval, atob.name, fetch.name, localStorage.getItem.name,
        localStorage.getItem === localStorage.getItem],
    });
    const options = DesktopEngine.launchOptions;
    DesktopEngine.system.onparameterschange = () => {
      const updated = DesktopEngine.launchOptions;
      postMessage('host', { launchOptions: [updated !== options, Object.isFrozen(updated), updated.parameters.size, options.parameters.size,
        Object.keys(updated).includes('parameters'), structuredClone(updated).parameters.size] });
    };
    postMessage('host', { launchOptions: [Object.isFrozen(options), Object.keys(options), JSON.stringify(options), structuredClone(options).parameters.size] });
  `);
  assert.deepEqual(results, [
    {
      proxy: { a: 1 },
      port: true,
      refused: 'DataCloneError: A MessagePort can\'t be cloned',
      names: ['structuredClone', 'MessageChannel', 'MessagePort', true, true],
      globals: [false, false, false, false],
      storage: [true, 'DataCloneError: A Storage can\'t be cloned', 'TypeError: Illegal constructor'],
      crypto: ['DataCloneError: A Crypto can\'t be cloned', 'Crypto', '[object Crypto]'],
      engine: ['DataCloneError: A Object can\'t be cloned', 'DataCloneError: A Object can\'t be cloned'],
      event: [false, true, null, true],
      runtime: [[], [], { window: {} }],
      functions: ['bound setTimeout', 'bound clearTimeout', 'bound clearInterval', false, 'atob', 'fetch', 'getItem', true],
    },
    { launchOptions: [true, ['permissions', 'parameters'], '{"permissions":[],"parameters":{"size":1}}', 1] },
    { got: [['hello', true]] },
    { launchOptions: [true, true, 2, 1, true, 2] },
  ]);
});

test('the frame\'s 0 ms timers and port messages don\'t wait for the browser\'s timers, which it slows when they nest', async () => {
  // the browser's setTimeout, counting the calls without a delay (on Math, which the content sees as it is)
  const browser = `
    Math.zeroDelayTimers = 0;
    const browserSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (!(Number(delay) > 0)) Math.zeroDelayTimers += 1;
      return browserSetTimeout(callback, delay, ...args);
    };
  `;
  const [result] = await runContent(`
    const order = [];
    const { port1, port2 } = new MessageChannel();
    let hops = 0;
    port2.onmessage = (event) => {
      order.push('message ' + event.data);
      if (++hops < 20) port1.postMessage(hops);
    };
    port1.postMessage(0);
    let ticks = 0;
    const tick = () => {
      order.push('timer ' + ticks);
      if (++ticks < 20) setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    setTimeout(() => postMessage('host', { order: order.slice(0, 6), messages: hops, ticks, browserTimers: Math.zeroDelayTimers }), 30);
  `, browser);
  assert.deepEqual(result, {
    // in turn, one a task, as in the app
    order: ['message 0', 'timer 0', 'message 1', 'timer 1', 'message 2', 'timer 2'],
    messages: 20,
    ticks: 20,
    browserTimers: 0,
  });
});

test('the frame\'s MessageChannel, MessagePort and BroadcastChannel work with WeakMap\'s and WeakSet\'s methods replaced', async () => {
  const [result] = await runContent(`
    const calls = [];
    for (const prototype of [WeakMap.prototype, WeakSet.prototype]) {
      for (const name of ['get', 'set', 'has', 'add', 'delete']) {
        if (name in prototype) prototype[name] = function () { calls.push(name); throw new Error('replaced'); };
      }
    }
    const got = [];
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = (event) => {
      got.push(event.data);
      const channel = new BroadcastChannel('state');
      channel.onmessage = () => {};
      channel.postMessage({ seen: got.length });
      channel.close();
      postMessage('host', { got, port: port1.onmessage, calls });
    };
    port1.postMessage({ list: [1] });
  `);
  assert.deepEqual(result, { got: [{ list: [1] }], port: null, calls: [] });
});

test('while the frame\'s content is suspended, its timers and port messages run at most once a second, as in the app', async () => {
  const launch = {
    type: 'launch', name: 'test', files: {}, options: { permissions: [] }, permissions: [], networkDomains: [], appearance: 'dark', apiVersion: 6,
    screens: [{ id: 1, name: 'Main', bounds: { x: 0, y: 0, width: 1440, height: 900 }, visibleFrame: { x: 0, y: 25, width: 1440, height: 875 }, scale: 2 }],
    maxFramesPerSecond: 0, muted: true, keyActivity: false, namespaceChannels: false, systemAudio: 'none', appWindows: [],
    // what ran, on Math, which the content sees as it is
    code: `
      Math.runs = [];
      setInterval(() => Math.runs.push('timer'), 10);
      const { port1, port2 } = new MessageChannel();
      port2.onmessage = () => {
        Math.runs.push('message');
        port1.postMessage(0);
      };
      port1.postMessage(0);
    `,
  };
  const playback = (suspended: boolean) => ({ type: 'playback', suspended, renderingPaused: suspended, muted: true, maxFramesPerSecond: 0 });
  const send = (message: unknown) => `for (const listener of listeners) listener({ source: globalThis.parent, data: ${JSON.stringify(message)} });`;
  // the browser's timers, which the frame's own can't replace (the content's are the runtime's once it runs)
  const script = `const timer = globalThis.setTimeout;\n${BROWSER}\n${frameRuntime}\n${send(launch)}\n`
    + `timer(() => { Math.before = Math.runs.length; ${send(playback(true))} }, 100);\n`
    + `timer(() => { Math.during = Math.runs.length - Math.before; ${send(playback(false))} }, 1600);\n`
    + `timer(() => process.stdout.write(JSON.stringify([Math.before, Math.during, Math.runs.length - Math.before - Math.during]), () => process.exit(0)), 3000);\n`;
  const run = promisify(execFile)(process.execPath, ['--input-type=module'], { timeout: 20000 });
  run.child.stdin!.end(script);
  const [before, during, after] = JSON.parse((await run).stdout) as number[];
  assert.ok(before > 20, `${before} ran before`);
  // what was due when it was suspended waits a second, then one a second
  assert.ok(during >= 1 && during <= 3, `${during} ran in 1.5 s suspended`);
  assert.ok(after > 10, `${after} ran after`);
});
