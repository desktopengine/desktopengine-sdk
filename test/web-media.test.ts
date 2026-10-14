// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The web runtime's Image, Video and Audio take srcs as the app does. An Image loads its src whether it's in a window,
// in a component or in none, keeps the picture it shows until a new src has loaded, and calls back only for the last
// src set. Only a CanvasImage reads a data: URL: an Image fails, a Video warns as the app does and plays nothing, an
// Audio element fails with the app's error, as for a blob: URL. An Audio element plays a package's file and an http(s)
// URL through the network rules, and reads back the src as it was set. The frame runtime runs here in a node process
// of its own, with a stand-in document whose image and media elements note what the browser would load, which the
// content then lets load or fail.

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
 * What a frame needs of a browser that node doesn't have: elements that keep their attributes and children, and image
 * and media elements that note what they'd load in Math.loads ({ kind, url, load(), fail() }, on Math, which the
 * content sees as it is). As in browsers, setting an image's src starts loading it, and so does setting a media
 * element's src property or attribute (`new Audio(src)` sets the attribute) or calling its load().
 */
const BROWSER = `
const sent = [];
const listeners = [];
const loads = [];
Math.loads = loads;
globalThis.parent = { postMessage: (message) => sent.push(message) };
globalThis.addEventListener = (type, listener) => { if (type === 'message') listeners.push(listener); };
globalThis.requestAnimationFrame = () => 0;
globalThis.XMLHttpRequest = class {};
globalThis.Path2D = class {};
globalThis.createImageBitmap = async () => ({});
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const styleMethods = {
  setProperty(name, value) { this[name] = String(value); },
  removeProperty(name) { delete this[name]; },
  getPropertyValue(name) { return this[name] ?? ''; },
};
class Element extends EventTarget {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.style = Object.assign(Object.create(styleMethods), { cssText: '' });
    this.attributeMap = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.hidden = false;
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === document.documentElement;
  }
  setAttribute(name, value) { this.attributeMap.set(String(name).toLowerCase(), String(value)); }
  getAttribute(name) { return this.attributeMap.get(String(name).toLowerCase()) ?? null; }
  hasAttribute(name) { return this.attributeMap.has(String(name).toLowerCase()); }
  removeAttribute(name) { this.attributeMap.delete(String(name).toLowerCase()); }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, before) {
    child.remove();
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) { child.remove(); return child; }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.childNodes;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
  contains(other) {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}
globalThis.Element = Element;
globalThis.HTMLElement = Element;

class HTMLImageElement extends Element {
  constructor() {
    super('img');
    this.onload = null;
    this.onerror = null;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
  }
  get src() { return this.getAttribute('src') ?? ''; }
  set src(value) {
    this.setAttribute('src', value);
    const element = this;
    loads.push({
      kind: 'img',
      url: String(value),
      load() { element.naturalWidth = 4; element.naturalHeight = 3; element.onload?.(new Event('load')); },
      fail() { element.onerror?.(new Event('error')); },
    });
  }
}

class MediaError {
  #code;
  #message;
  constructor(code, message) { this.#code = code; this.#message = message; }
  get code() { return this.#code; }
  get message() { return this.#message; }
}
for (const [name, value] of Object.entries({ MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 })) {
  Object.defineProperty(MediaError, name, { value, enumerable: true });
  Object.defineProperty(MediaError.prototype, name, { value, enumerable: true });
}
globalThis.MediaError = MediaError;

class HTMLMediaElement extends Element {
  #error = null;
  #networkState = 0;
  #muted = false;
  constructor(tagName) {
    super(tagName);
    this.paused = true;
    this.volume = 1;
    this.loop = false;
    this.playbackRate = 1;
    this.defaultPlaybackRate = 1;
    this.currentTime = 0;
    this.duration = NaN;
    this.buffered = { length: 0 };
  }
  // as in browsers, the src attribute itself loads, not through the element's own (replaceable) methods
  get src() { return this.getAttribute('src') ?? ''; }
  set src(value) { Element.prototype.setAttribute.call(this, 'src', value); this.#load(); }
  setAttribute(name, value) {
    Element.prototype.setAttribute.call(this, name, value);
    if (String(name).toLowerCase() === 'src') this.#load();
  }
  get muted() { return this.#muted; }
  set muted(value) { this.#muted = Boolean(value); }
  get error() { return this.#error; }
  get networkState() { return this.#networkState; }
  load() { this.#load(); }
  #load() {
    this.#error = null;
    const url = this.getAttribute('src');
    this.#networkState = url ? 2 : 0;
    if (!url) return;
    const element = this;
    loads.push({
      kind: this.tagName.toLowerCase(),
      url,
      load() { element.dispatchEvent(new Event('loadedmetadata')); },
      fail() { element.#error = new MediaError(4, 'the browser can\\'t play it'); element.dispatchEvent(new Event('error')); },
    });
  }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
// the event handler attributes: one listener each, as in browsers
const handlers = new WeakMap();
for (const type of ['error', 'loadstart', 'loadedmetadata', 'canplay', 'emptied', 'play', 'pause', 'ended']) {
  Object.defineProperty(HTMLMediaElement.prototype, 'on' + type, {
    get() { return handlers.get(this)?.[type]?.handler ?? null; },
    set(handler) {
      const own = handlers.get(this) ?? {};
      handlers.set(this, own);
      if (own[type]) this.removeEventListener(type, own[type].listener);
      own[type] = typeof handler === 'function' ? { handler, listener: (event) => handler.call(this, event) } : null;
      if (own[type]) this.addEventListener(type, own[type].listener);
    },
  });
}
for (const [name, value] of Object.entries({ NETWORK_EMPTY: 0, NETWORK_IDLE: 1, NETWORK_LOADING: 2, NETWORK_NO_SOURCE: 3 })) {
  Object.defineProperty(HTMLMediaElement, name, { value, enumerable: true });
  Object.defineProperty(HTMLMediaElement.prototype, name, { value, enumerable: true });
}
class HTMLAudioElement extends HTMLMediaElement { constructor() { super('audio'); } }
class HTMLVideoElement extends HTMLMediaElement { constructor() { super('video'); this.playsInline = false; } }
globalThis.HTMLMediaElement = HTMLMediaElement;
globalThis.HTMLAudioElement = HTMLAudioElement;
globalThis.HTMLVideoElement = HTMLVideoElement;
// the browser's sets the src attribute
globalThis.Audio = function Audio(src) {
  const element = new HTMLAudioElement();
  if (src !== undefined) HTMLMediaElement.prototype.setAttribute.call(element, 'src', src);
  return element;
};
globalThis.Audio.prototype = HTMLAudioElement.prototype;

globalThis.document = Object.assign(new EventTarget(), {
  visibilityState: 'visible',
  documentElement: new Element('html'),
  createElement: (tag) => (tag === 'img' ? new HTMLImageElement() : tag === 'video' ? new HTMLVideoElement() : tag === 'audio' ? new HTMLAudioElement() : new Element(tag)),
  elementFromPoint: () => null,
});
document.body = document.documentElement.appendChild(new Element('body'));
`;

interface Result {
  /** What the content called Math.finish with */
  report: unknown;
  /** The frame's console messages and exceptions, as the host gets them */
  messages: { type: string; level?: string; message: string }[];
}

/**
 * Runs `code` as a content launched with `launch` and the package files `files` (path to text), until it calls
 * Math.finish(report); the code is an async function's body
 */
async function runContent(code: string, launch: Partial<LaunchMessage> = {}, files: Record<string, string> = {}): Promise<Result> {
  const message = {
    type: 'launch', name: 'test', code: `(async () => {${code}\n})().catch((error) => Math.finish('threw ' + error.stack));`,
    files: {}, options: { permissions: launch.permissions ?? [] },
    screens: [{ id: 1, name: 'Main', bounds: { x: 0, y: 0, width: 1440, height: 900 }, visibleFrame: { x: 0, y: 25, width: 1440, height: 875 }, scale: 2 }],
    permissions: [], networkDomains: [], appearance: 'dark', apiVersion: 6, maxFramesPerSecond: 0, muted: true, keyActivity: false,
    namespaceChannels: false, systemAudio: 'none', appWindows: [],
    ...launch,
  };
  const packageFiles = `Object.fromEntries(Object.entries(${JSON.stringify(files)}).map(([name, text]) => [name, new TextEncoder().encode(text).buffer]))`;
  const script = `const harnessTimer = globalThis.setTimeout;\n${BROWSER}\n${frameRuntime}\n`
    + 'const messages = () => sent.filter((m) => m.type === \'console\' || m.type === \'exception\').map(({ type, level, message }) => ({ type, level, message }));\n'
    + 'Math.finish = (report) => process.stdout.write(JSON.stringify({ report, messages: messages() }), () => process.exit(0));\n'
    + 'harnessTimer(() => Math.finish(\'timed out: \' + JSON.stringify(messages())), 15000);\n'
    + `const launch = ${JSON.stringify(message)};\nlaunch.files = ${packageFiles};\n`
    + 'for (const listener of listeners) listener({ source: globalThis.parent, data: launch });\n';
  // on stdin, not with -e: Linux takes no single argument over 128 KB, and the bundled runtime is more
  const run = promisify(execFile)(process.execPath, ['--input-type=module'], { timeout: 20000 });
  run.child.stdin!.end(script);
  return JSON.parse((await run).stdout) as Result;
}

/** Content helpers: `tick()` waits for the runtime's timers queued before it, `picture(img)` is what the Image shows */
const HELPERS = `
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const picture = (img) => {
  const url = /url\\("(.*)"\\)/.exec(img.element.style.backgroundImage ?? '')?.[1];
  return url ? Math.loads.find((load) => load.url === url)?.name ?? url : null;
};
const named = (name) => { const load = Math.loads.at(-1); load.name = name; return load; };
`;

test('an Image keeps the picture it shows until a new src has loaded', async () => {
  const { report } = await runContent(`${HELPERS}
    const img = new DesktopEngine.Image({ src: 'a.png' });
    const events = [];
    img.addEventListener('load', () => events.push('load ' + img.src));
    img.addEventListener('error', (error) => events.push('error ' + img.src + ': ' + error.errMsg));
    const a = named('a.png');
    a.load();
    const shown = [picture(img)];
    img.src = 'b.png';
    const b = named('b.png');
    shown.push(picture(img));
    b.load();
    shown.push(picture(img));
    img.src = 'missing.png';
    await tick();
    shown.push(picture(img));
    Math.finish({ shown, events });
  `, {}, { 'a.png': 'A', 'b.png': 'B' });
  assert.deepEqual(report, {
    shown: ['a.png', 'a.png', 'b.png', null],
    events: ['load a.png', 'load b.png', 'error missing.png: the image can\'t be read'],
  });
});

test('an Image calls back only for the last src set, and shows no picture of a src replaced before it loaded', async () => {
  const { report } = await runContent(`${HELPERS}
    const img = new DesktopEngine.Image({});
    const events = [];
    img.onload = () => events.push('load ' + img.src);
    img.onerror = () => events.push('error ' + img.src);
    img.src = 'a.png';
    const a = named('a.png');
    img.src = 'b.png';
    const b = named('b.png');
    // in the same turn, then after the next src was set: neither calls back
    a.load();
    const shown = [picture(img)];
    b.load();
    shown.push(picture(img));
    img.src = 'c.png';
    const c = named('c.png');
    img.src = 'd.png';
    const d = named('d.png');
    c.fail();
    shown.push(picture(img));
    d.fail();
    shown.push(picture(img));
    // the same src again counts as another
    img.src = 'a.png';
    const first = named('a.png');
    img.src = 'a.png';
    const second = named('a.png');
    first.load();
    second.load();
    await tick();
    Math.finish({ shown, events, loads: Math.loads.length });
  `, {}, { 'a.png': 'A', 'b.png': 'B', 'c.png': 'C', 'd.png': 'D' });
  assert.deepEqual(report, {
    shown: [null, 'b.png', 'b.png', null],
    events: ['load b.png', 'error d.png', 'load a.png'],
    loads: 6,
  });
});

test('an Image loads its src while it\'s in no window or component, so its load can be waited for before it\'s added', async () => {
  const { report } = await runContent(`${HELPERS}
    const img = new DesktopEngine.Image({ src: 'a.png', style: { width: 10, height: 10 } });
    const loaded = new Promise((resolve) => { img.onload = resolve; });
    const asked = Math.loads.map((load) => load.kind);
    named('a.png').load();
    await loaded;
    const box = new DesktopEngine.Component({});
    box.appendChild(img);
    const win = new DesktopEngine.Window({ style: { width: 100, height: 100 } });
    win.appendChild(box);
    win.show();
    Math.finish({ asked, shown: picture(img), inWindow: win.element.contains(img.element) });
  `, {}, { 'a.png': 'A' });
  assert.deepEqual(report, { asked: ['img'], shown: 'a.png', inWindow: true });
});

test('an Image doesn\'t load a data: URL, as in the app: it fails and its picture goes; a CanvasImage reads one', async () => {
  const { report } = await runContent(`${HELPERS}
    const img = new DesktopEngine.Image({ src: 'a.png' });
    const events = [];
    img.onload = () => events.push('load');
    img.onerror = (error) => events.push('error ' + error.errMsg);
    named('a.png').load();
    const before = Math.loads.length;
    img.src = 'data:image/png;base64,iVBORw0KGgo=';
    const shownMeanwhile = picture(img);
    await tick();
    const shown = picture(img);
    img.src = 'DATA:image/png;base64,iVBORw0KGgo=';
    await tick();
    const asked = Math.loads.slice(before).map((load) => load.url);
    const canvasImage = new DesktopEngine.CanvasImage();
    canvasImage.src = 'data:image/png;base64,iVBORw0KGgo=';
    Math.finish({ events, shownMeanwhile, shown, asked, canvasImage: Math.loads.slice(before).map((load) => load.url) });
  `, {}, { 'a.png': 'A' });
  assert.deepEqual(report, {
    events: ['load', 'error the image can\'t be read', 'error the image can\'t be read'],
    shownMeanwhile: 'a.png',
    shown: null,
    asked: [],
    canvasImage: ['data:image/png;base64,iVBORw0KGgo='],
  });
});

test('an Image fails for a file that isn\'t there and for a remote src without the network permission', async () => {
  const { report } = await runContent(`${HELPERS}
    const errors = [];
    for (const src of ['missing.png', 'https://example.com/a.png', 'HTTPS://example.com/a.png']) {
      const img = new DesktopEngine.Image({ src });
      img.onerror = (error) => errors.push(src + ': ' + error.errMsg);
    }
    await tick();
    Math.finish({ errors, loads: Math.loads.length });
  `);
  assert.deepEqual(report, {
    errors: [
      'missing.png: the image can\'t be read',
      'https://example.com/a.png: the "network" permission is needed',
      'HTTPS://example.com/a.png: the "network" permission is needed',
    ],
    loads: 0,
  });
});

test('a Video doesn\'t play a data: URL: as in the app, it warns and sends no error event', async () => {
  const dataURL = 'data:video/mp4;base64,AAAAIGZ0eXBpc29t';
  const { report, messages } = await runContent(`${HELPERS}
    const win = new DesktopEngine.Window({ style: { width: 100, height: 100 } });
    const events = [];
    const video = new DesktopEngine.Video({ src: '${dataURL}', autoplay: true });
    video.onerror = (error) => events.push('error ' + error.errMsg);
    win.appendChild(video);
    win.show();
    const missing = new DesktopEngine.Video({ src: 'missing.mp4' });
    missing.onerror = (error) => events.push('missing: ' + error.errMsg);
    await tick();
    Math.finish({ events, src: video.src, playing: video.video.getAttribute('src'), loads: Math.loads.map((load) => load.url) });
  `);
  assert.deepEqual(report, { events: ['missing: the video can\'t be read'], src: dataURL, playing: null, loads: [] });
  assert.deepEqual(messages, [{ type: 'console', level: 'warn', message: `Can't load ${dataURL}: Unsupported scheme: ${dataURL}` }]);
});

test('an Audio element plays a package file and reads back its src as it was set', async () => {
  const { report } = await runContent(`${HELPERS}
    const audio = new Audio('sounds/tone.wav');
    const asked = Math.loads.map((load) => [load.kind, load.url.startsWith('blob:')]);
    const later = new Audio();
    later.src = 'defile://usr/missing.wav';
    let error = null;
    later.onerror = () => { error = later.error.message; };
    await tick();
    Math.finish({ asked, src: audio.src, error: audio.error, networkState: audio.networkState, emptySrc: new Audio().src, laterError: error });
  `, {}, { 'sounds/tone.wav': 'RIFF' });
  assert.deepEqual(report, {
    asked: [['audio', true]],
    src: 'sounds/tone.wav',
    error: null,
    networkState: 2,
    emptySrc: '',
    laterError: 'Can\'t load defile://usr/missing.wav: the file doesn\'t exist',
  });
});

test('an Audio element doesn\'t play a data: or blob: URL: as in the app, an error of code 4 and play() fails', async () => {
  const long = `data:audio/wav;base64,${'A'.repeat(100)}`;
  const { report } = await runContent(`${HELPERS}
    const results = {};
    const blobURL = URL.createObjectURL(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }));
    const cases = { data: 'data:audio/wav;base64,UklGRg==', upper: 'DATA:audio/wav;base64,UklGRg==', long: '${long}', blob: blobURL, attribute: 'data:,' };
    await Promise.all(Object.entries(cases).map(async ([name, src]) => {
      let audio;
      if (name === 'attribute') {
        audio = new Audio();
        audio.setAttribute('src', src);
      } else {
        audio = new Audio(src);
      }
      const events = [];
      audio.addEventListener('error', () => events.push('error'));
      const played = await audio.play().then(() => 'played', (error) => error.name + ': ' + error.message);
      await tick();
      results[name] = {
        events,
        code: audio.error?.code,
        message: audio.error?.message,
        isMediaError: audio.error instanceof MediaError,
        networkState: audio.networkState,
        src: audio.src === src,
        played: played === 'NotSupportedError: ' + audio.error?.message,
      };
    }));
    Math.finish({ results, blobURL, loads: Math.loads.length });
  `);
  const failed = (message: string) => ({ events: ['error'], code: 4, message, isMediaError: true, networkState: 3, src: true, played: true });
  const { results, blobURL, loads } = report as { results: Record<string, unknown>; blobURL: string; loads: number };
  assert.deepEqual(results.data, failed('Can\'t load data:audio/wav;base64,UklGRg==: only package files and http(s) URLs are supported'));
  assert.deepEqual(results.upper, failed('Can\'t load DATA:audio/wav;base64,UklGRg==: only package files and http(s) URLs are supported'));
  assert.deepEqual(results.long, failed(`Can't load ${long.slice(0, 64)}…: only package files and http(s) URLs are supported`));
  assert.match(blobURL, /^blob:/);
  assert.deepEqual(results.blob, failed(`Can't load ${blobURL}: only package files and http(s) URLs are supported`));
  assert.deepEqual(results.attribute, failed('Can\'t load data:,: only package files and http(s) URLs are supported'));
  assert.equal(loads, 0);
});

test('an Audio element plays a remote file through the network rules, as in the app', async () => {
  const code = `${HELPERS}
    const messages = [];
    for (const src of ['https://sounds.example.com/a.mp3', 'https://elsewhere.example.org/a.mp3', 'ftp://sounds.example.com/a.mp3', 'missing.mp3']) {
      const audio = new Audio(src);
      audio.onerror = () => messages.push(audio.error.message);
    }
    await tick();
    Math.finish({ messages, loads: Math.loads.map((load) => load.url) });
  `;
  const allowed = await runContent(code, { permissions: ['network'], networkDomains: ['sounds.example.com'], proxy: 'https://proxy.example.net/preview' });
  assert.deepEqual(allowed.report, {
    messages: [
      'Can\'t load https://elsewhere.example.org/a.mp3: "elsewhere.example.org" isn\'t one of the domains in network.domains of manifest.json',
      'Can\'t load ftp://sounds.example.com/a.mp3: the file doesn\'t exist',
      'Can\'t load missing.mp3: the file doesn\'t exist',
    ],
    loads: [`https://proxy.example.net/preview?url=${encodeURIComponent('https://sounds.example.com/a.mp3')}`],
  });
  const denied = await runContent(code);
  assert.deepEqual((denied.report as { messages: string[] }).messages.slice(0, 2), [
    'Can\'t load https://sounds.example.com/a.mp3: network access needs the "network" permission in manifest.json',
    'Can\'t load https://elsewhere.example.org/a.mp3: network access needs the "network" permission in manifest.json',
  ]);
});

test('an Audio element\'s src replaced before its error is sent sends none, and new Audio() is made as the app makes it', async () => {
  const { report } = await runContent(`${HELPERS}
    const audio = new Audio('data:,');
    const events = [];
    audio.onerror = () => events.push('error');
    audio.src = 'tone.wav';
    await tick();
    let called;
    try { Audio(); } catch (error) { called = error.name + ': ' + error.message; }
    Math.finish({
      events, error: audio.error, src: audio.src, called,
      name: Audio.name, length: Audio.length, prototype: Audio.prototype === HTMLAudioElement.prototype,
      instance: new Audio() instanceof HTMLAudioElement,
    });
  `, {}, { 'tone.wav': 'RIFF' });
  assert.deepEqual(report, {
    events: [], error: null, src: 'tone.wav', called: 'TypeError: Constructor Audio requires \'new\'',
    name: 'Audio', length: 1, prototype: true, instance: true,
  });
});
