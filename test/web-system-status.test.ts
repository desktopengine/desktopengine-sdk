// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// DesktopEngine.systemStatus in the web runtime keeps to the app's rules: null without the system-info permission, one
// object of its class; each reading frozen objects, the same until the next one; `change` and then the discrete events
// for what differs from the last reading the content got; nothing while it's suspended, then `resume` with how long and
// why, and a new reading. The frame runtime runs here in a node process of its own, sent readings the page's
// simulation made; the page's simulation and its overrides are checked on their own, and the desktop's suspension
// with a stand-in for its page.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

import type { LaunchMessage, SystemStatusOverrides, SystemStatusReading } from '../web/protocol.ts';
import { SystemStatusSimulation, readSystemStatus, systemStatusChanges } from '../web/system-status.ts';

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
globalThis.requestAnimationFrame = () => 0;
globalThis.HTMLMediaElement = class { get muted() { return false; } set muted(value) {} play() {} pause() {} };
globalThis.XMLHttpRequest = class {};
globalThis.Path2D = class {};
globalThis.createImageBitmap = async () => ({});
const deliver = (data) => { for (const listener of listeners) listener({ source: globalThis.parent, data }); };
`;

/** Readings of a simulation, the first as it is and each next one under more overrides */
function readings(...overrides: SystemStatusOverrides[]): SystemStatusReading[] {
  const simulation = new SystemStatusSimulation();
  const made = [simulation.sample(0)];
  for (let index = 0; index < overrides.length; index++) {
    simulation.overrides = { ...simulation.overrides, ...overrides[index] };
    made.push(simulation.sample((index + 1) * 1000));
  }
  return made;
}

interface Result {
  report: unknown;
  exceptions: string[];
}

/**
 * Runs `code` as a content launched with `launch` (the system-info permission and the first of `sent` by default)
 * until it calls Math.finish(report). Math.reading(index) sends it the reading of `sent` at that index, as the page
 * does; Math.playback(suspended, reason) suspends or resumes it; Math.later(callback, ms) calls back on the harness's
 * own timer.
 */
async function runContent(code: string, sent: SystemStatusReading[], launch: Partial<LaunchMessage> = {}): Promise<Result> {
  const permissions = launch.permissions ?? ['system-info'];
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
    apiVersion: 8,
    maxFramesPerSecond: 0,
    muted: true,
    keyActivity: false,
    namespaceChannels: false,
    systemAudio: 'none',
    appWindows: [],
    systemStatus: permissions.includes('system-info') ? sent[0] : undefined,
    ...launch,
  };
  const script = `${BROWSER}\n${frameRuntime}\n`
    + `const readings = ${JSON.stringify(sent)};\n`
    + 'Math.reading = (index) => deliver({ type: \'system-status\', reading: readings[index] });\n'
    + 'Math.playback = (suspended, reason) => deliver({ type: \'playback\', suspended, renderingPaused: false, muted: true, maxFramesPerSecond: 0, ...(reason ? { suspendReason: reason } : {}) });\n'
    + 'Math.later = (callback, delay) => harnessTimer(callback, delay);\n'
    + 'Math.finish = (report) => process.stdout.write(JSON.stringify({ report, exceptions: sent.filter((m) => m.type === \'exception\').map((m) => m.message) }), () => process.exit(0));\n'
    + 'harnessTimer(() => Math.finish(\'timed out\'), 15000);\n'
    + `deliver(${JSON.stringify(message)});\n`;
  // on stdin, not with -e: Linux takes no single argument over 128 KB, and the bundled runtime is more
  const run = promisify(execFile)(process.execPath, ['--input-type=module'], { timeout: 20000 });
  run.child.stdin!.end(script);
  return JSON.parse((await run).stdout) as Result;
}

test('without system-info, DesktopEngine.systemStatus is null and its constructor throws', async () => {
  const { report, exceptions } = await runContent(`
    const name = (action) => { try { action(); return 'made'; } catch (error) { return error.name + ': ' + error.message; } };
    Math.finish({
      before: name(() => new DesktopEngineRuntime.SystemStatus()),
      value: DesktopEngine.systemStatus,
      after: name(() => new DesktopEngineRuntime.SystemStatus()),
      listed: Object.keys(DesktopEngine).includes('systemStatus'),
    });
  `, readings(), { permissions: ['network'] });
  const refusal = 'Error: DesktopEngine.systemStatus needs the "system-info" permission in manifest.json, and the user\'s consent';
  assert.deepEqual(report, { before: refusal, value: null, after: refusal, listed: true });
  assert.deepEqual(exceptions, []);
});

test('DesktopEngine.systemStatus is the one SystemStatus, which content may construct first', async () => {
  const { report, exceptions } = await runContent(`
    const name = (action) => { try { action(); return 'made'; } catch (error) { return error.name + ': ' + error.message; } };
    // in the order of the app's (constructing it first defines it again, at the end)
    const keys = Object.keys(DesktopEngine);
    const made = new DesktopEngineRuntime.SystemStatus();
    const descriptor = Object.getOwnPropertyDescriptor(DesktopEngine, 'systemStatus');
    Math.finish({
      same: DesktopEngine.systemStatus === made && descriptor.value === made,
      descriptor: [descriptor.writable, descriptor.enumerable, descriptor.configurable],
      instance: made instanceof DesktopEngineRuntime.SystemStatus,
      constructorName: DesktopEngineRuntime.SystemStatus.name,
      second: name(() => new DesktopEngineRuntime.SystemStatus()),
      order: keys.slice(keys.indexOf('system'), keys.indexOf('system') + 4),
      events: ['change', 'powerchange', 'thermalchange', 'networkchange', 'memorypressurechange', 'resume']
        .map((type) => [made['on' + type], typeof made['off' + type]]),
    });
  `, readings());
  assert.deepEqual(report, {
    same: true,
    descriptor: [false, true, true],
    instance: true,
    constructorName: 'SystemStatus',
    second: 'TypeError: Illegal constructor',
    order: ['system', 'systemAudio', 'systemStatus', 'Video'],
    events: Array(6).fill([null, 'function']),
  });
  assert.deepEqual(exceptions, []);
});

test('a reading is frozen objects, the same ones until the next reading; a read with no readings coming takes one at once', async () => {
  const sent = readings({}, {}, {});
  const { report, exceptions } = await runContent(`
    const s = DesktopEngine.systemStatus;
    const first = { cpu: s.cpu, memory: s.memory, network: s.network, power: s.power, disk: s.disk };
    const frozen = (value) => Object.isFrozen(value) && Object.values(value).every((inner) => typeof inner !== 'object' || inner === null || frozen(inner));
    const report = {
      same: s.cpu === first.cpu && s.memory === first.memory && s.network === first.network && s.power === first.power && s.disk === first.disk,
      frozen: Object.values(first).every(frozen) && Object.isFrozen(first.cpu.cores) && Array.isArray(first.cpu.cores),
      types: [typeof s.thermal, typeof s.temperature, typeof s.bootTime, s.bootTime === s.bootTime],
      firstRates: [first.network.receivedPerSecond, first.network.sentPerSecond],
      firstUsage: first.cpu.usage,
      firstCores: first.cpu.cores.map((core) => core.usage),
      keys: [Object.keys(first.cpu), Object.keys(first.cpu.cores[0]), Object.keys(first.memory), Object.keys(first.network),
        Object.keys(first.power), Object.keys(first.power.battery), Object.keys(first.disk)],
      // a plain object of its own, unlike the reading's SystemStatus
      cloned: structuredClone(first.memory).total === first.memory.total,
    };
    // the next reading of the page, within 2 seconds of a read: new objects
    Math.reading(1);
    const second = s.cpu;
    report.next = [second !== first.cpu, s.memory !== first.memory, s.network.receivedPerSecond === ${sent[1].network.receivedPerSecond}, second.usage === ${sent[1].cpu.usage}];
    // no reads or listeners for more than 2 seconds: the readings stop, a read takes a fresh one and starts them again
    Math.later(() => {
      Math.reading(2);
      const fresh = s.cpu;
      report.stopped = [fresh !== second, fresh.usage === ${sent[2].cpu.usage}, s.network.receivedPerSecond === ${sent[2].network.receivedPerSecond}, s.cpu === fresh];
      // readings come again
      Math.reading(3);
      report.restarted = [s.cpu !== fresh, s.cpu.cores[0].usage, s.network.receivedPerSecond === ${sent[3].network.receivedPerSecond}, s.network.received === ${sent[3].network.received}];
      Math.finish(report);
    }, 2200);
  `, sent);
  assert.deepEqual(report, {
    same: true,
    frozen: true,
    types: ['string', 'number', 'number', true],
    firstRates: [sent[0].network.receivedPerSecond, sent[0].network.sentPerSecond],
    firstUsage: sent[0].cpu.usage,
    firstCores: sent[0].cpu.cores.map((core) => core.usage),
    keys: [
      ['usage', 'cores'],
      ['usage', 'efficiency'],
      ['total', 'used', 'app', 'wired', 'compressed', 'cached', 'swapUsed', 'pressure', 'swapping'],
      ['online', 'interface', 'expensive', 'receivedPerSecond', 'sentPerSecond', 'received', 'sent'],
      ['source', 'battery', 'adapterWatts', 'systemWatts', 'lowPowerMode'],
      ['level', 'charging', 'full', 'timeToEmpty', 'timeToFull'],
      ['total', 'available'],
    ],
    cloned: true,
    next: [true, true, true, true],
    stopped: [true, true, true, true],
    restarted: [true, sent[3].cpu.cores[0].usage, true, true],
  });
  assert.deepEqual(exceptions, []);
});

test('the made-up temperature follows the work and the thermal state, and the page may make it unknown', () => {
  const simulation = new SystemStatusSimulation();
  const first = simulation.sample(0).temperature!;
  assert.ok(first > 30 && first < 100, String(first));
  // slowed down by the heat: it heats up to it over a few seconds, not at once
  simulation.overrides = { thermal: 'critical' };
  const soon = simulation.sample(1000).temperature!;
  const later = simulation.sample(60_000).temperature!;
  assert.ok(soon < 102 && later >= 101.5, `${soon} ${later}`);
  simulation.overrides = { temperature: null };
  assert.equal(simulation.sample(61_000).temperature, null);
  simulation.overrides = { temperature: 71.5 };
  assert.equal(simulation.sample(62_000).temperature, 71.5);
  // what the frame takes from the page's messages: a finite number or null
  const reading = simulation.sample(63_000);
  for (const [value, read] of [[68.2, 68.2], [null, null], ['hot', null], [Infinity, null], [undefined, null]] as const) {
    assert.equal(readSystemStatus({ ...reading, temperature: value })!.temperature, read);
  }
});

test('the content reads the temperature of the reading it has, null when the Mac doesn\'t tell', async () => {
  const sent = readings({ temperature: 64.3 }, { temperature: null });
  const { report, exceptions } = await runContent(`
    const s = DesktopEngine.systemStatus;
    const seen = [];
    s.onchange = () => {
      seen.push(s.temperature);
      if (seen.length === 2) Math.finish(seen);
    };
    Math.reading(1);
    Math.reading(2);
  `, sent);
  assert.deepEqual(report, [64.3, null]);
  assert.deepEqual(exceptions, []);
});

test('the cores are the reading\'s own, whatever the content put on Array.prototype', async () => {
  const { report, exceptions } = await runContent(`
    const seen = [];
    Object.defineProperty(Array.prototype, '0', { get() { return 'inherited'; }, set(value) { seen.push(value); }, configurable: true });
    const cores = DesktopEngine.systemStatus.cpu.cores;
    const report = { first: typeof cores[0].usage, own: Object.getOwnPropertyDescriptor(cores, '0') !== undefined, length: cores.length, seen: seen.length };
    delete Array.prototype[0];
    Math.finish(report);
  `, readings());
  assert.deepEqual(report, { first: 'number', own: true, length: 10, seen: 0 });
  assert.deepEqual(exceptions, []);
});

test('change comes first, then the discrete events for what changed, in the app\'s order, with the new reading in place', async () => {
  const sent = readings(
    {},
    { thermal: 'serious', online: false, memoryPressure: 'warning', power: 'ac' },
    { systemWatts: null, swapping: true },
    { lowPowerMode: true },
    { networkInterface: 'ethernet', online: true },
    { power: 'none' },
    { power: 'full' },
    { expensive: true },
  );
  const { report, exceptions } = await runContent(`
    const s = DesktopEngine.systemStatus;
    const events = [];
    s.onchange = () => events.push('change');
    for (const type of ['powerchange', 'thermalchange', 'networkchange', 'memorypressurechange']) {
      s.addEventListener(type, (payload) => events.push(type + ' ' + payload + ' ' + (this === undefined)));
    }
    s.onthermalchange = function () { events.push('onthermalchange ' + s.thermal + ' ' + (this === s)); };
    s.onnetworkchange = () => events.push('onnetworkchange ' + s.network.online + ' ' + s.network.interface);
    const steps = [];
    for (let index = 1; index < ${sent.length}; index++) {
      events.length = 0;
      Math.reading(index);
      steps.push(events.slice());
    }
    Math.finish({ steps, power: s.power.source, battery: s.power.battery, expensive: s.network.expensive });
  `, sent);
  assert.deepEqual(report, {
    steps: [
      ['change'],
      [
        // the on<type> callback before the listeners, as the engine calls them
        'change', 'powerchange undefined false', 'onthermalchange serious true', 'thermalchange undefined false',
        'onnetworkchange false null', 'networkchange undefined false', 'memorypressurechange undefined false',
      ],
      // what isn't discrete only changes
      ['change'],
      ['change', 'powerchange undefined false'],
      ['change', 'onnetworkchange true ethernet', 'networkchange undefined false'],
      // the battery gone
      ['change', 'powerchange undefined false'],
      ['change', 'powerchange undefined false'],
      ['change', 'onnetworkchange true ethernet', 'networkchange undefined false'],
    ],
    power: 'ac',
    battery: { level: 1, charging: false, full: true, timeToEmpty: null, timeToFull: null },
    expensive: true,
  });
  assert.deepEqual(exceptions, []);
});

test('while suspended nothing comes; then resume with how long and why, and a new reading with what changed meanwhile', async () => {
  const sent = readings({ thermal: 'fair', memoryPressure: 'critical' }, { thermal: 'serious' }, { thermal: 'nominal', memoryPressure: 'normal', lowPowerMode: true });
  const { report, exceptions } = await runContent(`
    const s = DesktopEngine.systemStatus;
    const events = [];
    s.onchange = () => events.push('change ' + s.thermal);
    s.onthermalchange = () => events.push('thermalchange');
    s.onpowerchange = () => events.push('powerchange');
    s.onmemorypressurechange = () => events.push('memorypressurechange');
    let resumed;
    s.onresume = (payload) => {
      resumed = payload;
      events.push('resume ' + payload.reason + ' ' + s.thermal);
    };
    Math.reading(1);
    const before = s.cpu;
    const report = {};
    Math.playback(true, 'displaysleep');
    const suspendedAt = Date.now();
    Math.reading(2);
    Math.reading(3);
    report.suspended = [events.slice(), s.cpu === before, s.thermal];
    // the Mac slept while the content was suspended
    Math.playback(true, 'sleep');
    Math.later(() => {
      Math.playback(false);
      report.events = events.slice();
      report.resume = [Object.isFrozen(resumed), Object.keys(resumed), resumed.reason, resumed.suspendedAt <= resumed.resumedAt,
        Math.abs(resumed.suspendedAt - suspendedAt) < 50, resumed.resumedAt - resumed.suspendedAt >= 90];
      report.after = s.cpu !== before && s.thermal;
      // a pause alone, without a reason given
      events.length = 0;
      Math.playback(true);
      Math.playback(false);
      report.paused = events;
      Math.finish(report);
    }, 100);
  `, sent);
  assert.deepEqual(report, {
    suspended: [['change fair'], true, 'fair'],
    // compared with the reading before the suspension: thermal and memory pressure went back, Low Power Mode came on
    events: [
      // the first reading compares with none: the content hadn't read
      'change fair',
      'resume sleep fair', 'change nominal', 'powerchange', 'thermalchange', 'memorypressurechange',
    ],
    resume: [true, ['suspendedAt', 'resumedAt', 'reason'], 'sleep', true, true, true],
    after: 'nominal',
    paused: ['resume paused nominal', 'change nominal'],
  });
  assert.deepEqual(exceptions, []);
});

test('the first change after the content starts listening compares with what it read before', async () => {
  const sent = readings({ thermal: 'serious' }, {}, {});
  const { report, exceptions } = await runContent(`
    const s = DesktopEngine.systemStatus;
    const events = [];
    const read = s.thermal;
    // taken while the read keeps the readings coming, but not read
    Math.reading(1);
    s.onchange = () => events.push('change ' + s.thermal);
    s.onthermalchange = () => events.push('thermalchange');
    Math.reading(2);
    Math.reading(3);
    Math.finish({ read, events });
  `, sent);
  assert.deepEqual(report, { read: 'nominal', events: ['change serious', 'thermalchange', 'change serious'] });
  assert.deepEqual(exceptions, []);
});

test('listening again, the events compare with the last reading `change` told about', async () => {
  const sent = readings({ thermal: 'critical' }, { thermal: 'critical' });
  const { report, exceptions } = await runContent(`
    const s = DesktopEngine.systemStatus;
    const events = [];
    s.thermal;
    // reads nothing: what it was told about is the baseline, not what it read before
    const listener = () => events.push('change');
    s.addEventListener('change', listener);
    s.onthermalchange = () => events.push('thermalchange');
    Math.reading(1);
    s.removeEventListener('change', listener);
    s.onthermalchange = null;
    // listening again with no read in between: the same thermal state as the last change, nothing changed
    s.addEventListener('change', listener);
    s.onthermalchange = () => events.push('thermalchange');
    Math.reading(2);
    Math.finish({ events });
  `, sent);
  assert.deepEqual(report, { events: ['change', 'thermalchange', 'change'] });
  assert.deepEqual(exceptions, []);
});

test('resume alone doesn\'t keep the readings coming', async () => {
  const sent = readings({ thermal: 'critical' }, { thermal: 'fair' });
  const { report, exceptions } = await runContent(`
    const s = DesktopEngine.systemStatus;
    const before = s.thermal;
    const events = [];
    s.onresume = (payload) => events.push('resume ' + payload.reason);
    Math.later(() => {
      Math.playback(true, 'paused');
      Math.reading(1);
      Math.playback(false);
      // no readings coming after resume: the read takes a fresh one, and starts them again
      const after = s.thermal;
      Math.reading(2);
      Math.finish({ thermal: [before, after, s.thermal], events });
    }, 2200);
  `, sent);
  assert.deepEqual(report, { thermal: ['nominal', 'critical', 'fair'], events: ['resume paused'] });
  assert.deepEqual(exceptions, []);
});

test('resume comes to content that listens to nothing else, then a new reading while a read in the last 2 seconds keeps them coming', async () => {
  const sent = readings({ thermal: 'critical' });
  const { report, exceptions } = await runContent(`
    const s = DesktopEngine.systemStatus;
    const thermal = s.thermal;
    const reasons = [];
    s.addEventListener('resume', (payload) => reasons.push(payload.reason));
    Math.playback(true, 'displaysleep');
    Math.reading(1);
    Math.playback(false);
    Math.finish({ reasons, thermal: [thermal, s.thermal] });
  `, sent);
  assert.deepEqual(report, { reasons: ['displaysleep'], thermal: ['nominal', 'critical'] });
  assert.deepEqual(exceptions, []);
});

test('structuredClone and BroadcastChannel refuse DesktopEngine.systemStatus as the app refuses its objects', async () => {
  const { report, exceptions } = await runContent(`
    const channel = new BroadcastChannel('status');
    const s = DesktopEngine.systemStatus;
    const result = {};
    for (const [label, value] of Object.entries({ status: s, inside: { s }, made: Object.create(s) })) {
      try { structuredClone(value); result['clone ' + label] = 'copied'; } catch (error) { result['clone ' + label] = error.name + ': ' + error.message; }
      try { channel.postMessage(value); result['post ' + label] = 'sent'; } catch (error) { result['post ' + label] = error.name + ': ' + error.message; }
    }
    // the readings are plain objects
    channel.postMessage({ cpu: s.cpu, power: s.power });
    result.reading = 'sent';
    Math.finish(result);
  `, readings());
  assert.deepEqual(report, {
    'clone status': 'DataCloneError: A Object can\'t be cloned',
    'post status': 'DataCloneError: A Object can\'t be cloned',
    'clone inside': 'DataCloneError: A Object can\'t be cloned',
    'post inside': 'DataCloneError: A Object can\'t be cloned',
    'clone made': 'copied',
    'post made': 'sent',
    reading: 'sent',
  });
  assert.deepEqual(exceptions, []);
});

// MARK: - The page's simulation

test('the simulation moves as a Mac does: 10 cores, 16 GB, a battery running down, traffic adding up', () => {
  const simulation = new SystemStatusSimulation();
  const first = simulation.sample(0);
  let reading = first;
  // an hour, a reading every 30 seconds
  for (let step = 1; step <= 120; step++) reading = simulation.sample(step * 30_000);
  assert.deepEqual(first.cpu.cores.map((core) => core.efficiency), [true, true, false, false, false, false, false, false, false, false]);
  for (const core of reading.cpu.cores) assert.ok(core.usage >= 0 && core.usage <= 1);
  assert.equal(reading.memory.total, 16 * 1024 ** 3);
  assert.equal(reading.memory.used, reading.memory.app + reading.memory.wired + reading.memory.compressed);
  assert.ok(reading.memory.used + reading.memory.cached <= reading.memory.total);
  assert.equal(reading.power.source, 'battery');
  assert.equal(reading.power.adapterWatts, null);
  assert.ok(reading.power.battery!.level < first.power.battery!.level);
  assert.ok(typeof reading.power.battery!.timeToEmpty === 'number' && reading.power.battery!.timeToEmpty > 60);
  assert.ok(reading.power.systemWatts! >= 5 && reading.power.systemWatts! <= 30);
  assert.ok(reading.network.received > first.network.received && reading.network.sent > first.network.sent);
  assert.equal(reading.network.interface, 'wifi');
  assert.equal(reading.thermal, 'nominal');
  assert.ok(reading.disk.available > 0 && reading.disk.available < reading.disk.total);
  assert.equal(reading.bootTime, first.bootTime);
  assert.ok(Date.now() - first.bootTime > 3 * 86_400_000);
});

test('the page\'s overrides set the simulation\'s values', () => {
  const simulation = new SystemStatusSimulation();
  const at = (overrides: SystemStatusOverrides, time: number) => {
    simulation.overrides = overrides;
    return simulation.sample(time);
  };
  const offline = at({ online: false, networkInterface: 'cellular', expensive: true }, 1000);
  assert.deepEqual([offline.network.online, offline.network.interface, offline.network.expensive, offline.network.receivedPerSecond], [false, null, false, 0]);
  const hotspot = at({ networkInterface: 'cellular', expensive: true }, 2000);
  assert.deepEqual([hotspot.network.online, hotspot.network.interface, hotspot.network.expensive], [true, 'cellular', true]);
  const pressure = at({ memoryPressure: 'critical', swapping: true }, 3000);
  assert.deepEqual([pressure.memory.pressure, pressure.memory.swapping], ['critical', true]);
  // plugged in: charging, the estimate a moment later
  const plugged = at({ power: 'ac', batteryLevel: 0.08 }, 4000);
  assert.deepEqual(plugged.power, { source: 'ac', battery: { level: 0.08, charging: true, full: false, timeToEmpty: null, timeToFull: null }, adapterWatts: 96, systemWatts: plugged.power.systemWatts, lowPowerMode: false });
  assert.equal(typeof at({ power: 'ac', batteryLevel: 0.08 }, 30_000).power.battery!.timeToFull, 'number');
  assert.deepEqual(at({ power: 'full', batteryLevel: 0.8 }, 31_000).power.battery, { level: 0.8, charging: false, full: true, timeToEmpty: null, timeToFull: null });
  const desktop = at({ power: 'none', lowPowerMode: true, systemWatts: null }, 32_000);
  assert.deepEqual(desktop.power, { source: 'ac', battery: null, adapterWatts: null, systemWatts: null, lowPowerMode: true });
  // unplugged: estimating, then minutes to empty
  const unplugged = at({ batteryLevel: 0.08 }, 33_000);
  assert.deepEqual([unplugged.power.source, unplugged.power.battery!.timeToEmpty], ['battery', null]);
  assert.ok(at({ batteryLevel: 0.08 }, 60_000).power.battery!.timeToEmpty! <= 60);
  assert.equal(at({ thermal: 'critical' }, 61_000).thermal, 'critical');
});

test('the frame reads the page\'s readings as the app\'s, and tells what changed in the app\'s order', () => {
  const [reading] = readings();
  // its lists have no prototype (the content may have changed Array.prototype's): compared as JSON
  assert.deepEqual(JSON.parse(JSON.stringify(readSystemStatus(JSON.parse(JSON.stringify(reading))))), reading);
  assert.equal(readSystemStatus(null), null);
  const odd = readSystemStatus({ cpu: { usage: 7, cores: [{ usage: -1, efficiency: 1 }] }, network: { online: true, interface: 'modem' }, power: { source: 'battery', battery: null }, thermal: 'hot' })!;
  assert.deepEqual([odd.cpu.usage, odd.cpu.cores[0].usage, odd.cpu.cores[0].efficiency], [1, 0, false]);
  assert.deepEqual([odd.network.interface, odd.power.source, odd.thermal, odd.memory.pressure], ['other', 'ac', 'nominal', 'normal']);
  const changed = structuredClone(reading);
  changed.memory.pressure = 'warning';
  changed.thermal = 'fair';
  changed.power.lowPowerMode = true;
  changed.network.expensive = true;
  changed.cpu.usage = 0.9;
  assert.deepEqual(Array.from(systemStatusChanges(reading, changed)), ['powerchange', 'thermalchange', 'networkchange', 'memorypressurechange']);
  assert.deepEqual(Array.from(systemStatusChanges(reading, { ...reading, cpu: changed.cpu })), []);
});

// MARK: - The desktop

interface Desktop {
  setSystemStatus(overrides: SystemStatusOverrides): void;
  resetSystemStatus(): void;
  systemStatusOverrides: SystemStatusOverrides;
  simulateSuspension(reason?: string, ms?: number): Promise<void>;
  endSuspension(): void;
  setPaused(paused: boolean): void;
}

/** The desktop's code, bundled as the SDK bundles it (node can't run the TypeScript of its classes as it is) */
const host = await (async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(web, 'host', 'desktop.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    define: { __FRAME_RUNTIME__: '""' },
    logLevel: 'silent',
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)) as { WebDesktop: { prototype: object } };
})();

/**
 * A desktop without a page: its system status and playback as they are, with contents that note what they're sent
 * (two with system-info, one without)
 */
function pagelessDesktop(): { desktop: Desktop; posted: { type: string; [key: string]: unknown }[][] } {
  const posted: { type: string }[][] = [[], [], []];
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.document ??= { visibilityState: 'visible' };
  g.requestAnimationFrame ??= () => 1;
  const contents = new Set(posted.map((messages, index) => ({
    seesSystemStatus: index < 2,
    suspendedPlayback: false,
    wantsFrames: false,
    post: (message: { type: string }) => messages.push(message),
  })));
  const desktop = Object.assign(Object.create(host.WebDesktop.prototype) as Desktop, {
    contents,
    options: {},
    visible: true,
    paused: false,
    frameRequest: 0,
    statusSimulation: new SystemStatusSimulation(),
    statusTimer: 0,
    simulatedSuspension: null,
  });
  return { desktop, posted: posted as { type: string; [key: string]: unknown }[][] };
}

test('the desktop\'s overrides merge, and what the app hears of at once comes at once to contents with system-info', () => {
  const { desktop, posted } = pagelessDesktop();
  desktop.setSystemStatus({ thermal: 'serious', batteryLevel: 0.5 });
  desktop.setSystemStatus({ online: false });
  assert.deepEqual(desktop.systemStatusOverrides, { thermal: 'serious', batteryLevel: 0.5, online: false });
  // not discrete: with the next reading
  desktop.setSystemStatus({ batteryLevel: undefined, systemWatts: null });
  assert.deepEqual(desktop.systemStatusOverrides, { thermal: 'serious', online: false, systemWatts: null });
  const readingsSent = (messages: { type: string; [key: string]: unknown }[]) => messages.map((message) => {
    const reading = message.reading as SystemStatusReading;
    return [message.type, reading.thermal, reading.network.online];
  });
  assert.deepEqual(readingsSent(posted[0]), [['system-status', 'serious', true], ['system-status', 'serious', false]]);
  assert.deepEqual(posted[1].length, 2);
  assert.deepEqual(posted[2], []);
  desktop.resetSystemStatus();
  assert.deepEqual(desktop.systemStatusOverrides, {});
  assert.deepEqual(readingsSent(posted[0]).at(-1), ['system-status', 'nominal', true]);
});

test('the desktop suspends its contents with the reason, then sends a fresh reading before they run again', async () => {
  const { desktop, posted } = pagelessDesktop();
  const resumed = desktop.simulateSuspension('displaysleep', 30);
  // the Mac sleeping too: the stronger reason
  void desktop.simulateSuspension('sleep', 60);
  desktop.setPaused(true);
  await resumed;
  desktop.setPaused(false);
  const summary = (messages: { type: string; [key: string]: unknown }[]) => messages.map((message) => (message.type === 'playback' ? `playback ${message.suspended} ${message.suspendReason ?? '-'}` : message.type));
  assert.deepEqual(summary(posted[0]), [
    'playback true displaysleep',
    'playback true sleep',
    'playback true sleep',
    // paused still: no reading yet
    'playback true paused',
    'system-status',
    'playback false -',
  ]);
  // without system-info, only the playback
  assert.deepEqual(summary(posted[2]), ['playback true displaysleep', 'playback true sleep', 'playback true sleep', 'playback true paused', 'playback false -']);
});
