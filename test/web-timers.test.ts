// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The web runtime's timers and frames (web/frame/scheduler.ts). While the page is hidden the timers are the browser's
// again, port messages too, so the browser slows them down in a background tab as it does a page's own; while the page
// can be seen they run from the runtime's queue, not on the browser's timers. As in the app: in the order they're due
// (one that's late before the 0 ms ones set since), each in a task of its own, with their arguments taken as the engine
// takes them (a delay it doesn't take is 0), an interval keeps its period, a suspended content's timers wait for a
// tick once a second that runs them all, and an exception is reported whatever the content did. The frame runtime runs
// here in a node process of its own, with a stand-in document whose visibility the content changes, and the browser's
// setTimeout noting when it runs a callback.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

/** The frame runtime, bundled as the SDK bundles it (web/build.mjs) */
const { frameOptions } = await import(pathToFileURL(path.join(import.meta.dirname, '..', 'web', 'build.mjs')).href) as { frameOptions: esbuild.BuildOptions };
const frameRuntime = (await esbuild.build({ ...frameOptions, logLevel: 'silent' })).outputFiles![0].text;

/**
 * What a frame needs of a browser that node doesn't have; the page is a stand-in that notes what the frame sends (an
 * exception copied as postMessage copies it, the transfer list read as WebKit reads it). On Math, which the content
 * sees as it is: setVisibility(state) hides or shows the page, browserTimer is true while the browser's setTimeout runs
 * a callback, browserDelays are the delays it was given, while alignTimers is more than 0 the browser's timers fire on
 * a grid of that many milliseconds as a hidden page's do, by turns 70 and 5 ms after it, and while dropMessages is
 * more than 0 a message posted to a browser MessagePort (only the runtime's own, to wake its queue) is lost.
 */
const browser = (visibility: 'visible' | 'hidden') => `
const sent = [];
const listeners = [];
// node's own, kept before the frame runtime's replace them
const harnessNow = performance.now.bind(performance);
const harnessClone = structuredClone;
const harnessApply = Reflect.apply;
const { ceil } = Math;
globalThis.parent = {
  postMessage: (message, origin, transfer) => {
    if (transfer !== undefined) for (const item of transfer) void item;
    sent.push(message?.type === 'exception' ? harnessClone(message) : message);
  },
};
globalThis.addEventListener = (type, listener) => { if (type === 'message') listeners.push(listener); };
globalThis.requestAnimationFrame = () => 0;
globalThis.HTMLMediaElement = class { get muted() { return false; } set muted(value) {} play() {} pause() {} };
globalThis.XMLHttpRequest = class {};
globalThis.Path2D = class {};
globalThis.createImageBitmap = async () => ({});
globalThis.document = Object.assign(new EventTarget(), { visibilityState: '${visibility}' });
Math.setVisibility = (value) => {
  document.visibilityState = value;
  document.dispatchEvent(new Event('visibilitychange'));
};
Math.browserTimer = false;
Math.browserDelays = [];
Math.alignTimers = 0;
globalThis.setTimeout = (callback, delay, ...args) => {
  Math.browserDelays.push(Number(delay) || 0);
  let wait = Number(delay) || 0;
  if (Math.alignTimers > 0) {
    const slot = ceil((harnessNow() + wait) / Math.alignTimers);
    wait = slot * Math.alignTimers + (slot % 2 ? 70 : 5) - harnessNow();
  }
  return harnessTimer(() => {
    Math.browserTimer = true;
    try {
      harnessApply(callback, undefined, args);
    } finally {
      Math.browserTimer = false;
    }
  }, wait);
};
Math.dropMessages = 0;
const portPostMessage = MessagePort.prototype.postMessage;
MessagePort.prototype.postMessage = function (...args) {
  if (Math.dropMessages > 0) {
    Math.dropMessages -= 1;
    return;
  }
  return portPostMessage.apply(this, args);
};
`;

interface Result {
  /** What the content called Math.finish with */
  report: unknown;
  exceptions: string[];
  /** The exceptions' stacks (null without one) */
  stacks: (string | null)[];
}

/**
 * Runs `code` as a content in a page that's `visibility` at first, until it calls Math.finish(report). Math.playback
 * suspends or resumes it as the host does, Math.hostFrame() sends it one of the host's display frames,
 * Math.later(callback, delay) calls back on the harness' own timer. With `wholeMilliseconds`, performance.now() counts
 * whole milliseconds, as WebKit's does, and Math.fineNow() is the clock it rounds down: Math.holdClock(time) stops that
 * at `time` (never back) until Math.releaseClock() lets it go on from there.
 */
async function runContent(code: string, visibility: 'visible' | 'hidden' = 'visible', { wholeMilliseconds = false } = {}): Promise<Result> {
  const launch = {
    type: 'launch', name: 'test', code, files: {}, options: { permissions: [] },
    screens: [{ id: 1, name: 'Main', bounds: { x: 0, y: 0, width: 1440, height: 900 }, visibleFrame: { x: 0, y: 25, width: 1440, height: 875 }, scale: 2 }],
    permissions: [], networkDomains: [], appearance: 'dark', apiVersion: 6, maxFramesPerSecond: 0, muted: true, keyActivity: false,
    namespaceChannels: false, systemAudio: 'none', appWindows: [],
  };
  const send = (message: string) => `for (const listener of listeners) listener({ source: globalThis.parent, data: ${message} });`;
  // the harness's own timers are node's, kept before the stand-in replaces them
  const clock = wholeMilliseconds ? `
const realNow = performance.now.bind(performance);
let heldAt = null;
let clockOffset = 0;
Math.fineNow = () => heldAt ?? realNow() + clockOffset;
Math.holdClock = (time) => { heldAt = Math.max(time, Math.fineNow()); };
Math.releaseClock = () => {
  if (heldAt === null) return;
  clockOffset = heldAt - realNow();
  heldAt = null;
};
performance.now = () => Math.floor(Math.fineNow());
` : '';
  const script = `const harnessTimer = globalThis.setTimeout;\n${browser(visibility)}\n${clock}${frameRuntime}\n`
    + 'const exceptions = () => sent.filter((m) => m.type === \'exception\');\n'
    + 'Math.finish = (report) => process.stdout.write(JSON.stringify({ report, exceptions: exceptions().map((m) => m.message), stacks: exceptions().map((m) => m.stack ?? null) }), () => process.exit(0));\n'
    + `Math.playback = (suspended) => { ${send('{ type: \'playback\', suspended, renderingPaused: suspended, muted: true, maxFramesPerSecond: 0 }')} };\n`
    + `Math.hostFrame = () => { ${send('{ type: \'frame\' }')} };\n`
    + 'Math.later = (callback, delay) => harnessTimer(callback, delay);\n'
    + 'harnessTimer(() => Math.finish(\'timed out\'), 15000);\n'
    + `${send(JSON.stringify(launch))}\n`;
  // on stdin, not with -e: Linux takes no single argument over 128 KB, and the bundled runtime is more
  const run = promisify(execFile)(process.execPath, ['--input-type=module'], { timeout: 20000 });
  run.child.stdin!.end(script);
  return JSON.parse((await run).stdout) as Result;
}

test('while the page is hidden, the frame\'s timers and port messages run on the browser\'s timers, with their own delays', async () => {
  const { report, exceptions } = await runContent(`
    const runs = [];
    let ticks = 0;
    const tick = () => {
      runs.push('timer ' + Math.browserTimer);
      if (++ticks < 10) setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    const { port1, port2 } = new MessageChannel();
    let hops = 0;
    port2.onmessage = (event) => {
      runs.push('message ' + event.data + ' ' + Math.browserTimer);
      if (++hops < 10) port1.postMessage(hops);
    };
    port1.postMessage(0);
    const before = Math.browserDelays.length;
    setTimeout(() => runs.push('later ' + Math.browserTimer), 40);
    const later = Math.browserDelays[before];
    setTimeout(() => {
      throw new Error('thrown while hidden');
    }, 0);
    setTimeout(() => Math.finish({ runs, ticks, hops, later, zeroDelays: Math.browserDelays.filter((delay) => delay <= 0).length }), 80);
  `, 'hidden');
  const { runs, ticks, hops, later, zeroDelays } = report as { runs: string[]; ticks: number; hops: number; later: number; zeroDelays: number };
  assert.deepEqual(runs.slice(0, 4), ['timer true', 'message 0 true', 'timer true', 'message 1 true']);
  assert.ok(runs.every((run) => run.endsWith(' true')), runs.join(', '));
  assert.equal(runs.at(-1), 'later true');
  assert.deepEqual([ticks, hops], [10, 10]);
  // the delay itself: one computed again from the clock may come out a little less, and the browser cuts it to 39 ms
  assert.equal(later, 40, `the browser's timer was set for ${later} ms`);
  assert.ok(zeroDelays >= 20, `${zeroDelays} browser timers without a delay`);
  assert.deepEqual(exceptions, ['Error: thrown while hidden']);
});

test('while the page can be seen, the frame\'s 0 ms timers and port messages are queued, not left to the browser\'s timers', async () => {
  const { report } = await runContent(`
    const runs = [];
    const before = Math.browserDelays.length;
    let ticks = 0;
    const tick = () => {
      runs.push(Math.browserTimer);
      if (++ticks < 10) setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    const { port1, port2 } = new MessageChannel();
    let hops = 0;
    port2.onmessage = () => {
      runs.push(Math.browserTimer);
      if (++hops < 10) port1.postMessage(hops);
    };
    port1.postMessage(0);
    setTimeout(() => runs.push(Math.browserTimer), 20);
    setTimeout(() => Math.finish({ runs, delays: Math.browserDelays.slice(before) }), 50);
  `);
  const { runs, delays } = report as { runs: boolean[]; delays: number[] };
  // 10 timers, 10 messages and the later one, from the queue; only the later ones wait for the browser's timer
  assert.deepEqual(runs, Array(21).fill(false));
  // one browser timer at a time, for the first of the queue: given its own delay when it was set (the browser would
  // cut one computed again to whole milliseconds), the next one's computed when it fires
  assert.equal(delays.length, 2, delays.join(', '));
  assert.equal(delays[0], 20);
  // about 30: a browser timer may fire a millisecond or two before its delay is up, whole milliseconds being rounded
  assert.ok(delays[1] > 0 && delays[1] <= 32, delays.join(', '));
});

test('when the page hides, what\'s queued goes to the browser\'s timers in its order; when it shows, timers are queued again', async () => {
  const { report } = await runContent(`
    const runs = [];
    const note = (label) => () => runs.push(label + (Math.browserTimer ? ' (browser)' : ''));
    setTimeout(note('a'), 0);
    setTimeout(note('b'), 0);
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = (event) => note('message ' + event.data)();
    port1.postMessage(1);
    setTimeout(note('c'), 0);
    Math.setVisibility('hidden');
    setTimeout(note('d'), 0);
    port1.postMessage(2);
    setTimeout(() => {
      note('hidden')();
      // on the browser's timers: f, due, is queued when the page shows, e once its browser timer fires
      setTimeout(note('e'), 30);
      setTimeout(note('f'), 0);
      Math.setVisibility('visible');
      setTimeout(note('g'), 0);
      port1.postMessage(3);
      setTimeout(() => Math.finish(runs), 80);
    }, 20);
  `);
  const runs = report as string[];
  assert.deepEqual(runs.slice(0, 7), ['a (browser)', 'b (browser)', 'message 1 (browser)', 'c (browser)', 'd (browser)', 'message 2 (browser)', 'hidden (browser)']);
  // from the queue, in the order they were set
  assert.deepEqual(runs.slice(7), ['f', 'g', 'message 3', 'e']);
});

test('clearTimeout and clearInterval stop the frame\'s timers whether they\'re queued or on the browser\'s timers, and the page hidden or not', async () => {
  const { report } = await runContent(`
    const ran = [];
    const note = (label) => () => ran.push(label);
    // the page can be seen: queued, or waiting for the browser's timer
    clearTimeout(setTimeout(note('queued'), 0));
    clearTimeout(setTimeout(note('waiting'), 10));
    clearInterval(setInterval(note('interval'), 5));
    // cleared once the page is hidden: queued (then on the browser's timers) or waiting
    const queued = setTimeout(note('queued, then hidden'), 0);
    const waiting = setTimeout(note('waiting, then hidden'), 10);
    const interval = setInterval(note('interval, then hidden'), 5);
    const across = setTimeout(note('waiting, then hidden and shown'), 50);
    Math.setVisibility('hidden');
    clearTimeout(queued);
    clearTimeout(waiting);
    clearInterval(interval);
    // the page is hidden
    clearTimeout(setTimeout(note('hidden'), 0));
    clearTimeout(setTimeout(note('hidden, waiting'), 10));
    clearInterval(setInterval(note('hidden interval'), 5));
    const once = setInterval(() => {
      ran.push('cleared in its callback');
      clearInterval(once);
    }, 5);
    setTimeout(() => {
      // cleared once the page shows again
      const hidden = setTimeout(note('hidden, then shown'), 0);
      const hiddenWaiting = setTimeout(note('hidden and waiting, then shown'), 10);
      Math.setVisibility('visible');
      clearTimeout(hidden);
      clearTimeout(hiddenWaiting);
      clearTimeout(across);
      setTimeout(note('kept'), 0);
      setTimeout(() => Math.finish(ran), 80);
    }, 30);
  `);
  assert.deepEqual(report, ['cleared in its callback', 'kept']);
});

test('a setInterval of the frame goes on while the page hides and shows, on the browser\'s timers while it\'s hidden', async () => {
  const { report } = await runContent(`
    const ticks = { visible: [], hidden: [], 'visible again': [], cleared: [] };
    let phase = 'visible';
    const interval = setInterval(() => ticks[phase].push(Math.browserTimer), 5);
    setTimeout(() => {
      phase = 'hidden';
      Math.setVisibility('hidden');
    }, 60);
    setTimeout(() => {
      phase = 'visible again';
      Math.setVisibility('visible');
    }, 120);
    setTimeout(() => {
      clearInterval(interval);
      phase = 'cleared';
    }, 180);
    setTimeout(() => Math.finish(ticks), 230);
  `);
  const ticks = report as Record<string, boolean[]>;
  for (const phase of ['visible', 'hidden', 'visible again']) {
    assert.ok(ticks[phase].length >= 3, `${ticks[phase].length} ticks ${phase}`);
  }
  assert.ok(ticks.visible.every((browserTimer) => !browserTimer));
  assert.ok(ticks.hidden.every((browserTimer) => browserTimer));
  assert.ok(ticks['visible again'].every((browserTimer) => !browserTimer));
  assert.deepEqual(ticks.cleared, []);
});

test('while the page is hidden and the content suspended, its timers and port messages each run at most once a second', async () => {
  const { report } = await runContent(`
    const runs = { loop: 0, port: 0 };
    const loop = () => {
      runs.loop += 1;
      setTimeout(loop, 0);
    };
    loop();
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = () => {
      runs.port += 1;
      port1.postMessage(0);
    };
    port1.postMessage(0);
    const since = (counts) => ({ loop: runs.loop - counts.loop, port: runs.port - counts.port });
    setTimeout(() => {
      const before = { ...runs };
      Math.playback(true);
      Math.setVisibility('hidden');
      Math.later(() => {
        const during = since(before);
        Math.playback(false);
        Math.setVisibility('visible');
        const resumed = { ...runs };
        // what waits for its tick runs then, and the loop and the port go on from the queue
        Math.later(() => Math.finish({ before, during, after: since(resumed) }), 1400);
      }, 1500);
    }, 50);
  `);
  const { before, during, after } = report as Record<string, { loop: number; port: number }>;
  assert.ok(before.loop > 10 && before.port > 10, `${JSON.stringify(before)} ran before`);
  // the first one due runs at once, the tick a second later runs both
  for (const kind of ['loop', 'port'] as const) {
    assert.ok(during[kind] >= 1 && during[kind] <= 2, `${JSON.stringify(during)} ran in 1.5 s suspended`);
  }
  assert.ok(after.loop > 10 && after.port > 10, `${JSON.stringify(after)} ran after`);
});

test('when the page shows again, the 0 ms timers and port messages set while it was hidden run before the ones set since', async () => {
  const { report } = await runContent(`
    const runs = [];
    const note = (label) => () => runs.push(label);
    // queued, then on the browser's timers: the page hides and shows in the same task
    setTimeout(note('a'), 0);
    setTimeout(note('b'), 0);
    Math.setVisibility('hidden');
    Math.setVisibility('visible');
    setTimeout(note('c'), 0);
    setTimeout(() => {
      // set while the page is hidden
      Math.setVisibility('hidden');
      setTimeout(note('x'), 0);
      const { port1, port2 } = new MessageChannel();
      port2.onmessage = (event) => runs.push('message ' + event.data);
      port1.postMessage('y');
      Math.setVisibility('visible');
      setTimeout(note('z'), 0);
      port1.postMessage('w');
      setTimeout(() => Math.finish(runs), 30);
    }, 20);
  `);
  assert.deepEqual(report, ['a', 'b', 'c', 'x', 'message y', 'z', 'message w']);
});

test('the frame\'s timers don\'t go through what the content may replace in Array: Symbol.species, a setter at an index', async () => {
  const { report, exceptions } = await runContent(`
    const runs = [];
    let species = 0;
    let threw = null;
    Object.defineProperty(Array, Symbol.species, { configurable: true, get() {
      species += 1;
      throw new Error('species');
    } });
    try {
      setTimeout(() => runs.push('0 ms'), 0);
      // queued from its browser timer
      setTimeout(() => runs.push('5 ms'), 5);
    } catch (error) {
      threw = String(error);
    }
    setTimeout(() => {
      // the queue is empty: the next one queued is its first
      let setter = 0;
      Object.defineProperty(Array.prototype, '0', { configurable: true, set() {
        setter += 1;
      } });
      setTimeout(() => runs.push('first of the queue'), 0);
      delete Array.prototype[0];
      Math.later(() => {
        delete Array[Symbol.species];
        Math.finish({ runs, species, setter, threw });
      }, 30);
    }, 20);
  `);
  assert.deepEqual(report, { runs: ['0 ms', '5 ms', 'first of the queue'], species: 0, setter: 0, threw: null });
  assert.deepEqual(exceptions, []);
});

test('many 0 ms timers of the frame run in the order they were set, without the queue slowing down', async () => {
  const { report } = await runContent(`
    const count = 100000;
    let ran = 0;
    let outOfOrder = 0;
    const start = performance.now();
    for (let index = 0; index < count; index++) {
      setTimeout(() => {
        if (index !== ran) outOfOrder += 1;
        ran += 1;
        if (ran === count) Math.finish({ milliseconds: performance.now() - start, outOfOrder });
      }, 0);
    }
  `);
  const { milliseconds, outOfOrder } = report as { milliseconds: number; outOfOrder: number };
  assert.equal(outOfOrder, 0);
  // each in a task of its own: a fifth of a second here, seconds if taking the first one moved all the others
  assert.ok(milliseconds < 1500, `100000 timers took ${Math.round(milliseconds)} ms`);
});

test('a delay the engine doesn\'t take (NaN, negative, past 2^31 - 1 ms, Infinity) is 0, as in the app', async () => {
  const { report } = await runContent(`
    const runs = [];
    const note = (label) => () => runs.push(label);
    const before = Math.browserDelays.length;
    let loops = 0;
    const loop = () => {
      loops += 1;
      if (loops <= 2) runs.push('loop');
      if (loops < 100) setTimeout(loop, 0);
    };
    setTimeout(loop, 0);
    setTimeout(note('2^31'), 2 ** 31);
    setTimeout(note('NaN'), NaN);
    setTimeout(note('-1'), -1);
    setTimeout(note('Infinity'), Infinity);
    setTimeout(note('0'), 0);
    const longest = setTimeout(note('2^31 - 1'), 2 ** 31 - 1);
    let ticks = 0;
    const interval = setInterval(() => ticks++, 2 ** 31);
    setTimeout(() => {
      clearTimeout(longest);
      clearInterval(interval);
      Math.finish({ runs, ticks, delays: Math.browserDelays.slice(before) });
    }, 40);
  `);
  const { runs, ticks, delays } = report as { runs: string[]; ticks: number; delays: number[] };
  // in the order they were set, as 0 ms ones: not after the 0 ms loop
  assert.deepEqual(runs, ['loop', '2^31', 'NaN', '-1', 'Infinity', '0', 'loop']);
  // an interval of 4 ms
  assert.ok(ticks >= 4, `${ticks} ticks of the interval in 40 ms`);
  assert.ok(delays.every((delay) => delay >= 0 && delay <= 2 ** 31 - 1), delays.join(', '));
});

test('a setInterval of the frame keeps its period as NSTimer does: from when it was due, skipping the runs a slow callback missed', async () => {
  const { report } = await runContent(`
    const busy = (milliseconds) => {
      const until = performance.now() + milliseconds;
      while (performance.now() < until);
    };
    const before = Math.browserDelays.length;
    const steady = [];
    const first = setInterval(() => {
      steady.push(performance.now());
      busy(10);
    }, 16);
    Math.later(() => {
      clearInterval(first);
      const slow = [];
      const second = setInterval(() => {
        slow.push(performance.now());
        busy(slow.length === 5 ? 50 : 3);
      }, 20);
      Math.later(() => {
        clearInterval(second);
        Math.finish({ steady, slow, delays: Math.browserDelays.slice(before) });
      }, 400);
    }, 400);
  `);
  const { steady, slow, delays } = report as { steady: number[]; slow: number[]; delays: number[] };
  // a 10 ms callback doesn't make it 26 ms
  const period = (steady.at(-1)! - steady[0]) / (steady.length - 1);
  assert.ok(steady.length >= 15 && period >= 15 && period <= 18, `${steady.length} ticks, ${period.toFixed(2)} ms apart`);
  // the 50 ms callback missed two runs, which are skipped: the next is on the period's grid, not at once
  const gaps = slow.slice(1).map((time, index) => time - slow[index]);
  assert.ok(gaps[4] >= 55, `${gaps[4].toFixed(2)} ms after the slow one`);
  assert.ok(gaps.every((gap) => gap >= 12), gaps.map((gap) => gap.toFixed(1)).join(', '));
  assert.ok(delays.every((delay) => delay >= 0), delays.join(', '));
});

test('while the content is suspended, a tick once a second runs all its timers that are due, and resuming runs them at once', async () => {
  const { report } = await runContent(`
    const runs = { zero: 0, a: 0, b: 0, port: 0 };
    const loop = () => {
      runs.zero += 1;
      setTimeout(loop, 0);
    };
    setTimeout(loop, 0);
    setInterval(() => runs.a++, 100);
    setInterval(() => runs.b++, 100);
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      runs.port += 1;
      port2.postMessage(0);
    };
    port2.postMessage(0);
    const since = (counts) => Object.fromEntries(Object.keys(runs).map((key) => [key, runs[key] - counts[key]]));
    Math.later(() => {
      Math.playback(true);
      const suspended = { ...runs };
      Math.later(() => {
        const during = since(suspended);
        Math.playback(false);
        const resumed = { ...runs };
        Math.later(() => {
          const soon = since(resumed);
          Math.later(() => Math.finish({ during, soon, after: since(resumed) }), 450);
        }, 50);
      }, 1600);
    }, 150);
  `);
  const { during, soon, after } = report as Record<string, Record<string, number>>;
  // the first one due ran at once, the tick a second later ran them all (not one timer a second for the content)
  for (const key of ['zero', 'a', 'b', 'port']) {
    assert.ok(during[key] >= 1 && during[key] <= 2, `in 1.6 s suspended: ${JSON.stringify(during)}`);
    assert.ok(soon[key] >= 1, `in 50 ms after resuming: ${JSON.stringify(soon)}`);
  }
  // the intervals have their own period again, the loop and the port go on from the queue
  assert.ok(after.a >= 4 && after.b >= 4 && after.zero > 50 && after.port > 50, `in 500 ms after resuming: ${JSON.stringify(after)}`);
});

test('an exception the runtime can\'t describe is reported with a fixed message, and an interval that threw it goes on', async () => {
  const { report, exceptions } = await runContent(`
    let ticks = 0;
    const id = setInterval(() => {
      ticks += 1;
      if (ticks === 2) throw Object.create(null);
      if (ticks === 3) throw { toString() { throw new Error('no string'); } };
      if (ticks === 4) {
        const error = new Error('no message');
        Object.defineProperty(error, 'message', { get() { throw new Error('no message'); } });
        throw error;
      }
      if (ticks === 5) {
        const error = new Error('no stack');
        Object.defineProperty(error, 'stack', { get() { throw new Error('no stack'); } });
        throw error;
      }
    }, 5);
    setTimeout(() => {
      throw Object.create(null);
    }, 0);
    setTimeout(() => {
      clearInterval(id);
      Math.finish({ ticks });
    }, 100);
  `);
  const { ticks } = report as { ticks: number };
  assert.ok(ticks >= 8, `${ticks} ticks`);
  assert.deepEqual(exceptions, ['Error: unknown error', 'Error: unknown error', 'Error: unknown error', 'Error: unknown error', 'Error: no stack']);
});

test('the frame\'s queue goes on if the message that wakes it is lost', async () => {
  const { report } = await runContent(`
    const start = performance.now();
    const runs = [];
    Math.dropMessages = 1;
    setTimeout(() => runs.push(Math.round(performance.now() - start)), 0);
    Math.later(() => Math.finish({ runs, dropped: Math.dropMessages === 0 }), 2500);
  `);
  const { runs, dropped } = report as { runs: number[]; dropped: boolean };
  assert.ok(dropped);
  // asked for again once it's been a second (checked each second)
  assert.equal(runs.length, 1, 'the timer didn\'t run');
  assert.ok(runs[0] >= 1000, `ran after ${runs[0]} ms`);
});

test('the timers a tick runs each run in a task of their own, while the page is hidden too: the microtasks of one before the next', async () => {
  const code = `
    const runs = [];
    Math.playback(true);
    setTimeout(() => runs.push('first'), 0);
    setTimeout(() => {
      runs.push('A');
      Promise.resolve().then(() => runs.push('A promise'));
      queueMicrotask(() => runs.push('A queueMicrotask'));
    }, 10);
    setTimeout(() => runs.push('B'), 20);
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = async (event) => {
      runs.push('message ' + event.data);
      await null;
      runs.push('after await ' + event.data);
    };
    Math.later(() => port1.postMessage(1), 30);
    Math.later(() => Math.finish(runs), 1500);
  `;
  for (const visibility of ['visible', 'hidden'] as const) {
    const { report } = await runContent(code, visibility);
    // the first one due ran at once, the others at the tick
    assert.deepEqual(report, ['first', 'A', 'A promise', 'A queueMicrotask', 'B', 'message 1', 'after await 1'], visibility);
  }
});

test('a timer that came due while the thread was busy runs before the 0 ms timers and port messages set since, as in the app', async () => {
  const { report } = await runContent(`
    const busy = (milliseconds) => {
      const until = performance.now() + milliseconds;
      while (performance.now() < until);
    };
    const rounds = [];
    const round = () => {
      const runs = [];
      setTimeout(() => runs.push('5 ms'), 5);
      busy(20);
      setTimeout(() => runs.push('0 ms'), 0);
      const { port1, port2 } = new MessageChannel();
      port2.onmessage = () => runs.push('message');
      port1.postMessage(0);
      setTimeout(() => {
        rounds.push(runs.join(', '));
        if (rounds.length < 3) round();
        else Math.finish(rounds);
      }, 50);
    };
    setTimeout(round, 0);
  `);
  assert.deepEqual(report, Array(3).fill('5 ms, 0 ms, message'));
});

test('an exception is reported whatever the content did to its stack, Array\'s methods or Array\'s iterator, and the interval goes on', async () => {
  const { report, exceptions, stacks } = await runContent(`
    let ticks = 0;
    const { join } = Array.prototype;
    const iterator = Array.prototype[Symbol.iterator];
    const id = setInterval(() => {
      ticks += 1;
      if (ticks === 2) {
        const error = new Error('a stack that is an object');
        error.stack = { split: () => ({ filter: () => ({ length: 1, map: () => ({ join: () => () => 0 }) }) }) };
        throw error;
      }
      if (ticks === 3) {
        Array.prototype.join = () => ({ joined: () => 0 });
        queueMicrotask(() => {
          Array.prototype.join = join;
        });
        throw new Error('join replaced');
      }
      if (ticks === 4) {
        Array.prototype[Symbol.iterator] = () => {
          throw new Error('iterator replaced');
        };
        queueMicrotask(() => {
          Array.prototype[Symbol.iterator] = iterator;
        });
        throw new Error('iterator replaced');
      }
    }, 5);
    setTimeout(() => {
      clearInterval(id);
      Math.finish({ ticks });
    }, 100);
  `);
  const { ticks } = report as { ticks: number };
  assert.ok(ticks >= 8, `${ticks} ticks`);
  assert.deepEqual(exceptions, ['Error: a stack that is an object', 'Error: join replaced', 'Error: iterator replaced']);
  // the content's own frames
  assert.equal(stacks[0], null);
  assert.ok(stacks.slice(1).every((stack) => stack?.startsWith('at ') && stack.includes('desktopengine:///')), JSON.stringify(stacks));
});

test('while the page is hidden and the content suspended, a callback of a tick that throws doesn\'t keep the others from running', async () => {
  const { report, exceptions } = await runContent(`
    const runs = [];
    Math.playback(true);
    setTimeout(() => runs.push('first'), 0);
    setTimeout(() => {
      runs.push('thrower');
      const error = new Error('a stack that is an object');
      error.stack = { split: () => ({ filter: () => ({ length: 1, map: () => ({ join: () => Symbol('stack') }) }) }) };
      throw error;
    }, 10);
    setTimeout(() => runs.push('a'), 10);
    setTimeout(() => runs.push('b'), 20);
    let ticks = 0;
    setInterval(() => ticks++, 50);
    Math.later(() => {
      Math.playback(false);
      Math.later(() => Math.finish({ runs, ticks }), 300);
    }, 1300);
  `, 'hidden');
  const { runs, ticks } = report as { runs: string[]; ticks: number };
  assert.deepEqual(runs, ['first', 'thrower', 'a', 'b']);
  // once at the tick, then every 50 ms once resumed
  assert.ok(ticks >= 4, `${ticks} ticks`);
  assert.deepEqual(exceptions, ['Error: a stack that is an object']);
});

test('while the page is hidden and the content suspended, its timers run once a second though the browser wakes a little early or late', async () => {
  const { report } = await runContent(`
    Math.alignTimers = 1000;
    Math.playback(true);
    const runs = [];
    const start = performance.now();
    const loop = () => {
      runs.push(Math.round(performance.now() - start));
      setTimeout(loop, 0);
    };
    setTimeout(loop, 0);
    Math.later(() => Math.finish(runs), 3500);
  `, 'hidden');
  const runs = report as number[];
  // on the grid, by turns 70 and 5 ms after it: a run 935 ms after the last one doesn't wait for the next second
  const gaps = runs.slice(1).map((time, index) => time - runs[index]);
  assert.ok(runs.length >= 3 && gaps.every((gap) => gap > 900 && gap < 1100), `ran at ${runs.join(', ')} ms`);
});

test('the frame\'s requestAnimationFrame doesn\'t go through what the content may replace: Symbol.species, Map, performance.now', async () => {
  const { report, exceptions } = await runContent(`
    DesktopEngine.preferredFramesPerSecond = 30;
    const times = [];
    const errors = [];
    const frame = (time) => {
      times.push(time);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const NativeMap = Map;
    const nativeNow = performance.now;
    Object.defineProperty(Array, Symbol.species, { configurable: true, get() {
      throw new Error('species');
    } });
    globalThis.Map = class {
      set() {
        throw new Error('Map replaced');
      }
    };
    performance.now = () => 1000;
    let sent = 0;
    const hostFrame = () => {
      try {
        Math.hostFrame();
      } catch (error) {
        errors.push(String(error));
      }
      sent += 1;
      if (sent === 8) {
        delete Array[Symbol.species];
        globalThis.Map = NativeMap;
        performance.now = nativeNow;
      }
      if (sent < 12) Math.later(hostFrame, 40);
      else Math.finish({ frames: times.length, early: times.slice(0, 8).filter((time) => time === 1000).length, errors });
    };
    hostFrame();
  `);
  const { frames, early, errors } = report as { frames: number; early: number; errors: string[] };
  // a frame for each of the host's, 40 ms apart, with the runtime's own time
  assert.deepEqual({ frames, early, errors }, { frames: 12, early: 0, errors: [] });
  assert.deepEqual(exceptions, []);
});

test('setTimeout and clearTimeout take their arguments as the engine does', async () => {
  const { report, exceptions } = await runContent(`
    const runs = [];
    globalThis.ranString = () => runs.push('a string');
    let conversions = 0;
    const delay = { valueOf() {
      conversions += 1;
      return 0;
    } };
    const threw = [];
    const attempt = (action) => {
      try {
        return action();
      } catch (error) {
        threw.push(String(error));
        return undefined;
      }
    };
    // not an object: no timer, and its delay isn't converted
    const none = [setTimeout('ranString()', 0), setInterval('ranString()', 5), setTimeout(), setTimeout(5, delay), setInterval(null, delay)];
    // an object that isn't a function runs and does nothing
    const object = attempt(() => setTimeout({}, 0));
    const objectInterval = attempt(() => setInterval({}, 5));
    // only a number clears, as an int32
    attempt(() => clearTimeout(Symbol('id')));
    const kept = setTimeout(() => runs.push('kept'), 0);
    clearTimeout(String(kept));
    clearTimeout({ valueOf() {
      conversions += 1;
      return kept;
    } });
    clearTimeout(setTimeout(() => runs.push('cleared with id + 0.5'), 0) + 0.5);
    setTimeout(() => {
      clearInterval(objectInterval);
      Math.finish({ none, ids: [typeof object, typeof objectInterval], runs, conversions, threw });
    }, 40);
  `);
  assert.deepEqual(report, { none: [null, null, null, null, null], ids: ['number', 'number'], runs: ['kept'], conversions: 0, threw: [] });
  assert.deepEqual(exceptions, []);
});

test('timers set and cleared again and again leave the queue, and the rest run in the order they\'re due', async () => {
  const { report } = await runContent(`
    const runs = [];
    // a debounce: the long timer is cleared and set again on each event
    let pending = 0;
    for (let index = 0; index < 1000; index++) {
      clearTimeout(pending);
      pending = setTimeout(() => runs.push('debounced'), 30);
    }
    const kept = [];
    for (let index = 0; index < 300; index++) {
      const id = setTimeout(() => runs.push(index), 10 + (index % 7));
      if (index % 3) clearTimeout(id);
      else kept.push(index);
    }
    setTimeout(() => Math.finish({ runs, kept }), 60);
  `);
  const { runs, kept } = report as { runs: (number | string)[]; kept: number[] };
  const order = [...kept].sort((a, b) => (a % 7) - (b % 7) || a - b);
  assert.deepEqual(runs, [...order, 'debounced']);
});

test('of the timers due at the same time, a 0 ms one runs first: with a clock of whole milliseconds, a 1 ms one set a moment before isn\'t due before it', async () => {
  const { report } = await runContent(`
    const rounds = [];
    const round = () => {
      const runs = [];
      // set late in a millisecond: due most of one after the 0 ms ones set once the clock ticks, but at the same time by
      // it; the clock is held, so that a busy machine doesn't let it tick in between more often than that
      const start = Math.ceil(Math.fineNow());
      Math.holdClock(start + 0.9);
      setTimeout(() => runs.push('1 ms'), 1);
      Math.holdClock(start + 1.05);
      setTimeout(() => runs.push('0 ms'), 0);
      const { port1, port2 } = new MessageChannel();
      port2.onmessage = () => runs.push('message');
      port1.postMessage(0);
      setTimeout(() => runs.push('0 ms, set last'), 0);
      Math.releaseClock();
      setTimeout(() => {
        rounds.push(runs.join(', '));
        if (rounds.length < 3) round();
        else Math.finish(rounds);
      }, 20);
    };
    setTimeout(round, 0);
  `, 'visible', { wholeMilliseconds: true });
  assert.deepEqual(report, Array(3).fill('0 ms, message, 0 ms, set last, 1 ms'));
});
