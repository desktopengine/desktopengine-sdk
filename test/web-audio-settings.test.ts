// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// DesktopEngine.audioSettings in the web runtime is the app's: undefined without the audio permission, one object
// from the first line, `muted` the page's sound switch (the user's mute on the web), `volume` the item's, and `change`
// when the visitor turns the sound on or off, to onchange and the listeners. The frame runtime runs here in a node
// process of its own, sent the page's messages.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

import { itemVolume, type LaunchMessage } from '../web/protocol.ts';

const web = path.join(import.meta.dirname, '..', 'web');

/** The frame runtime, bundled as the SDK bundles it (web/build.mjs) */
const { frameOptions } = await import(pathToFileURL(path.join(web, 'build.mjs')).href) as { frameOptions: esbuild.BuildOptions };
const frameRuntime = (await esbuild.build({ ...frameOptions, logLevel: 'silent' })).outputFiles![0].text;

/** What a frame needs of a browser that node doesn't have; the page is a stand-in that notes what the frame sends */
const BROWSER = `
const sent = [];
const listeners = [];
const harnessTimer = globalThis.setTimeout;
globalThis.parent = { postMessage: (message) => sent.push(message) };
globalThis.addEventListener = (type, listener) => { if (type === 'message') listeners.push(listener); };
globalThis.document = { hidden: false, visibilityState: 'visible', addEventListener() {}, documentElement: { addEventListener() {} } };
globalThis.requestAnimationFrame = () => 0;
globalThis.HTMLMediaElement = class { get muted() { return false; } set muted(value) {} play() {} pause() {} };
globalThis.XMLHttpRequest = class {};
globalThis.Path2D = class {};
globalThis.createImageBitmap = async () => ({});
const deliver = (data) => { for (const listener of listeners) listener({ source: globalThis.parent, data }); };
`;

/**
 * Runs `code` as a content launched with `launch` (the audio permission by default) until it calls Math.finish(report);
 * Math.sound(on) turns the page's sound on or off, Math.later(callback, ms) calls back on the harness's own timer
 */
async function runContent(code: string, launch: Partial<LaunchMessage> = {}): Promise<{ report: unknown; exceptions: string[] }> {
  const permissions = launch.permissions ?? ['audio'];
  const message: LaunchMessage = {
    type: 'launch',
    name: 'test',
    code,
    files: {},
    options: { permissions },
    screens: [{ id: 1, name: 'Main', bounds: { x: 0, y: 0, width: 1440, height: 900 }, visibleFrame: { x: 0, y: 25, width: 1440, height: 875 }, scale: 2 }],
    permissions,
    networkDomains: [],
    appearance: 'dark',
    apiVersion: 9,
    maxFramesPerSecond: 0,
    muted: true,
    keyActivity: false,
    namespaceChannels: false,
    systemAudio: 'none',
    appWindows: [],
    ...launch,
  };
  const script = `${BROWSER}\n${frameRuntime}\n`
    + 'Math.sound = (on) => deliver({ type: \'playback\', suspended: false, renderingPaused: false, muted: !on, maxFramesPerSecond: 0 });\n'
    + 'Math.later = (callback, delay) => harnessTimer(callback, delay);\n'
    + 'Math.finish = (report) => process.stdout.write(JSON.stringify({ report, exceptions: sent.filter((m) => m.type === \'exception\').map((m) => m.message) }), () => process.exit(0));\n'
    + 'harnessTimer(() => Math.finish(\'timed out\'), 15000);\n'
    + `deliver(${JSON.stringify(message)});\n`;
  // on stdin, not with -e: Linux takes no single argument over 128 KB, and the bundled runtime is more
  const run = promisify(execFile)(process.execPath, ['--input-type=module'], { timeout: 20000 });
  run.child.stdin!.end(script);
  return JSON.parse((await run).stdout) as { report: unknown; exceptions: string[] };
}

test('without the audio permission, DesktopEngine.audioSettings is undefined', async () => {
  const { report, exceptions } = await runContent(`
    Math.finish({ value: String(DesktopEngine.audioSettings), listed: Object.keys(DesktopEngine).includes('audioSettings') });
  `, { permissions: ['network'] });
  assert.deepEqual(report, { value: 'undefined', listed: true });
  assert.deepEqual(exceptions, []);
});

test('DesktopEngine.audioSettings tells the page\'s sound switch and the item\'s volume from the first line', async () => {
  const { report, exceptions } = await runContent(`
    const settings = DesktopEngine.audioSettings;
    const error = (action) => { try { action(); return 'none'; } catch (e) { return e.name + ': ' + e.message; } };
    const first = [settings.muted, settings.volume];
    const events = [];
    settings.onchange = (event) => events.push(['onchange', event.type, event.target === settings, settings.muted]);
    settings.addEventListener('change', () => events.push(['listener', settings.muted]));
    Math.sound(true);
    Math.sound(true);
    Math.sound(false);
    Math.later(() => Math.finish({
      first,
      same: settings === DesktopEngine.audioSettings,
      tag: Object.prototype.toString.call(settings),
      eventTarget: settings instanceof EventTarget,
      // in the order of the app's
      order: Object.keys(DesktopEngine).slice(7, 10),
      readOnly: error(() => { 'use strict'; settings.muted = false; }).split(':')[0],
      constructor: error(() => new settings.constructor()),
      events,
    }), 50);
  `, { volume: 0.4 });
  assert.deepEqual(report, {
    first: [true, 0.4],
    same: true,
    tag: '[object AudioSettings]',
    eventTarget: true,
    order: ['preferredFramesPerSecond', 'audioSettings', 'Canvas'],
    readOnly: 'TypeError',
    constructor: 'TypeError: Illegal constructor',
    // once for each turn of the switch, onchange first
    events: [['onchange', 'change', true, false], ['listener', false], ['onchange', 'change', true, true], ['listener', true]],
  });
  assert.deepEqual(exceptions, []);
});

test('without a volume of its own, the item\'s is the manifest\'s audio.volume, or 1', () => {
  assert.equal(itemVolume(undefined, undefined), 1);
  assert.equal(itemVolume(undefined, 0.25), 0.25);
  assert.equal(itemVolume(0.75, 0.25), 0.75);
  assert.equal(itemVolume(undefined, 0), 0);
  // what the app wouldn't take is full volume
  assert.equal(itemVolume(undefined, 2), 1);
  assert.equal(itemVolume(undefined, '0.5'), 1);
  assert.equal(itemVolume(-1, undefined), 1);
  assert.equal(itemVolume(Number.NaN, 0.5), 0.5);
});
