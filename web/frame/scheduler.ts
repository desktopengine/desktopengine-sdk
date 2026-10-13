// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// Frames and timers as the engine runs them: requestAnimationFrame stops while the content is suspended or its drawing
// paused (the page is hidden, the desktop scrolled away) and keeps to the lower of the host's frame rate and
// DesktopEngine.preferredFramesPerSecond; the timers of a suspended content that come due wait for a tick once a
// second, which runs them all, and while the page is hidden they run no more often than the browser runs its own.
// Exceptions in callbacks are reported, the next ones still run.
//
// Frames come from the host: while callbacks wait, the frame asks for them (`frames`) and the host sends a `frame`
// message on each of its own display frames. The frame's own requestAnimationFrame can't be relied on: browsers slow
// it down in cross-origin frames the visitor hasn't interacted with, which a content's frame never is (it doesn't take
// the mouse). Until the host's first frame arrives (and with hosts that don't send them) the frame's own drive it.

import type { HostMessage } from '../protocol.ts';
import { guard, send, state } from './state.ts';

type FrameCallback = (time: number) => void;

// the realm's own, kept before the content's versions replace the globals
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
const nativeSetInterval = globalThis.setInterval.bind(globalThis);
const requestNativeFrame: (callback: FrameRequestCallback) => number = globalThis.requestAnimationFrame.bind(globalThis);

// what the content may replace, taken before it runs: the frames and timers are the runtime's, as the engine's are native
const { apply } = Reflect;
const { setPrototypeOf, getOwnPropertyDescriptor } = Object;
const { postMessage: portPostMessage } = MessagePort.prototype;
const MapClass = Map;
const { get: mapGet, set: mapSet, delete: mapDelete, forEach: mapForEach } = Map.prototype;
const mapSize = getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
const { max, min, ceil, floor } = Math;
const now = performance.now.bind(performance);
/**
 * An array without a prototype: it's only indexed and its length set, so nothing of Array.prototype's (a setter at an
 * index, Symbol.species) is looked up
 */
const list = <T>(): T[] => setPrototypeOf([], null) as T[];

let callbacks = new MapClass<number, FrameCallback>();
let nextFrameId = 1;
let looping = false;
/** The host sends frames: the native ones aren't asked for any more */
let hostDriven = false;
let lastFrame = -Infinity;
let frames = 0;

function frameInterval(): number {
  const host = state.hostMaxFramesPerSecond;
  const content = state.contentFramesPerSecond;
  const limit = host > 0 && content > 0 ? min(host, content) : host > 0 ? host : content;
  return limit > 0 ? 1000 / limit : 0;
}

function loop(time: number): void {
  if (!apply(mapSize, callbacks, [])) {
    setLooping(false);
    return;
  }
  if (!hostDriven) requestNativeFrame(loop);
  if (state.suspended || state.renderingPaused) return;
  const interval = frameInterval();
  // a couple of milliseconds early still counts: frames don't come exactly on time
  if (interval && time - lastFrame < interval - 2) return;
  lastFrame = time;
  frames += 1;
  const due = callbacks;
  callbacks = new MapClass();
  apply(mapForEach, due, [(callback: FrameCallback) => guard(() => callback(time))]);
}

/** Starts or stops the frames, telling the host whether to send its own */
function setLooping(value: boolean): void {
  if (looping === value) return;
  looping = value;
  if (looping && !hostDriven) requestNativeFrame(loop);
  send({ type: 'frames', wanted: looping });
}

/** One of the host's display frames */
export function hostFrame(): void {
  hostDriven = true;
  if (looping) loop(now());
}

export function requestAnimationFrame(callback: FrameCallback): number {
  if (typeof callback !== 'function') throw new TypeError('requestAnimationFrame needs a function');
  const id = nextFrameId++;
  apply(mapSet, callbacks, [id, callback]);
  setLooping(true);
  return id;
}

export function cancelAnimationFrame(id: number): void {
  apply(mapDelete, callbacks, [id]);
}

// MARK: Timers
//
// The content's timers run when they're due, each in a task of its own, as in the app: from a queue, in the order
// they're due, a 0 ms one at once, a later one once the browser's timer for the first of the queue fires. Of the same
// time, a 0 ms one runs first (a clock that counts whole milliseconds, as WebKit's does, gives a later one set a moment
// before the time of a 0 ms one), then the one set first. One that came due while the thread was busy runs before the
// 0 ms ones set since, as the app's run loop fires its timers in the order they're due (a browser may run a message
// before a timer that's late). A port's messages are 0 ms timers of the content's (clone.ts), so they take turns with
// its own as in the app. The tasks are messages of a MessageChannel of the frame's, which the content can't reach:
// browsers make timers set in a timer's callback, 5 deep, wait at least 4 ms (Chrome), and align them to 30 ms or more
// in a cross-origin frame nobody interacted with (WebKit; a content's frame never is), which the engine doesn't;
// nothing set in a message's task is nested, the browser's timer for the queue included. The queue is a binary heap, as
// a content may have many timers; one message at a time is asked for, and one that hasn't come in a second is taken as
// lost and asked for again.
//
// While the page is hidden (its tab in the background, its window minimized) the timers are the browser's again: each
// runs when the browser's timer for it fires, a 0 ms one too, so the browser slows them down as it does the page's own
// timers in the background, which it doesn't do to messages (a 0 ms loop or two ports answering each other would keep
// a core busy). What's queued when the page hides goes to the browser's timers, in the order it's due; when the page
// shows again, they all come back to the queue (else the 0 ms ones set since would run first).
//
// While the content is suspended its timers are throttled as the app's are (DETimerCollection's throttleInterval):
// the first one due in a second runs, the ones due after it wait for the next tick, a second after the last, which
// runs all that wait, in the order they came due, each in a task of its own from the queue (while the page is hidden
// too: what they set goes to the browser's timers); the content resuming runs them at once. The browser's timers don't
// wake exactly a second apart (a hidden page's are aligned to whole seconds), so one that comes a little early still
// counts as a second after the last. An interval keeps its own period throughout, as NSTimer does: the next run is
// due a period after the last one was due, not after its callback returned, and the runs a slow callback missed are
// skipped; after waiting for a tick it goes on a period from then.
//
// The arguments are taken as the engine takes them: a handler that isn't an object is no timer (null; a string isn't
// compiled), and one that isn't a function runs and does nothing; a delay goes through ToNumber, and NaN, a negative
// one and one past 2^31 - 1 ms are 0; clearTimeout and clearInterval take only a number, as an int32.

/** How often a suspended content's timers run, as the app's (a second) */
const THROTTLE = 1000;
/**
 * How much less than a second after the last tick a timer may come and still count as a second later: a couple of
 * milliseconds (browsers don't fire timers exactly on time) or, while the page is hidden, a tenth of a second (its
 * timers wake on whole seconds, give or take some tens of milliseconds, never more often)
 */
const THROTTLE_EARLY = 2;
const THROTTLE_EARLY_HIDDEN = 100;
/** A wake message that hasn't come in this long is taken as lost */
const LOST_WAKE = 1000;
/** The longest delay the engine takes: past it, the delay is 0 */
const MAX_DELAY = 2 ** 31 - 1;
/** Of this many cleared timers, at least, the queue is rid of them (they're passed over when they come first) */
const COMPACT_CLEARED = 64;

interface Task {
  id: number;
  /** When it's due, on performance.now()'s clock */
  due: number;
  /** Set with a delay (an interval always is): of the ones due at the same time, the ones without run first */
  delayed: boolean;
  /** Of the ones due at the same time, the one set first runs first */
  order: number;
  run: (task: Task) => void;
  /** The browser's timer for it (the page is hidden), QUEUED, DEFERRED (waiting for the next tick) or FIRED */
  handle: number;
  /** It waited for a tick and may run now, suspended or not */
  released: boolean;
}
const QUEUED = -1;
const DEFERRED = -2;
/** Taken from the queue, or its browser timer fired: it runs, or waits for a tick */
const FIRED = -3;
const isBrowserTimer = (handle: number): boolean => handle !== QUEUED && handle !== DEFERRED && handle !== FIRED;

let nextTimerId = 1;
let nextOrder = 0;
/** The content's timers that haven't run, each with its task (an interval has a new one for each run) */
const timers = new MapClass<number, Task>();
const timer = (id: number): Task | undefined => apply(mapGet, timers, [id]) as Task | undefined;
const setTimer = (task: Task): void => {
  apply(mapSet, timers, [task.id, task]);
};
const deleteTimer = (id: number): void => {
  apply(mapDelete, timers, [id]);
};
/** Whether a task is still its timer's: the timer wasn't cleared, nor did the task run (an interval's goes on in another) */
const current = (task: Task): boolean => timer(task.id) === task;

// MARK: The queue

/**
 * The timers while the page can be seen, a binary heap in the order they run (`earlier`): the first is the next. Its
 * length isn't set as it shrinks: JavaScriptCore without its JIT (Safari's Lockdown Mode) takes a time in proportion
 * to the length to make one past 100,000 shorter.
 */
let queue = list<Task | undefined>();
let queued = 0;
/** Of the ones in the queue, how many were cleared */
let cleared = 0;
const earlier = (task: Task, other: Task): boolean => task.due < other.due
  || (task.due === other.due && (task.delayed === other.delayed ? task.order < other.order : !task.delayed));

function push(task: Task): void {
  task.handle = QUEUED;
  let index = queued++;
  while (index > 0) {
    const above = (index - 1) >> 1;
    if (!earlier(task, queue[above]!)) break;
    queue[index] = queue[above];
    index = above;
  }
  queue[index] = task;
}

function pop(): Task | undefined {
  if (!queued) return undefined;
  const first = queue[0]!;
  const size = --queued;
  const last = queue[size]!;
  queue[size] = undefined;
  if (size) {
    let index = 0;
    for (let child = 1; child < size; child = 2 * index + 1) {
      if (child + 1 < size && earlier(queue[child + 1]!, queue[child]!)) child += 1;
      if (!earlier(queue[child]!, last)) break;
      queue[index] = queue[child];
      index = child;
    }
    queue[index] = last;
  } else {
    // empty, its length is 0 at once
    queue.length = 0;
  }
  first.handle = FIRED;
  return first;
}

/** The first of the queue that's still its timer's, the cleared ones before it taken out */
function first(): Task | undefined {
  while (queued && !current(queue[0]!)) {
    pop();
    if (cleared > 0) cleared -= 1;
  }
  return queued ? queue[0] : undefined;
}

/** The queue without the cleared timers, so that long ones set and cleared again and again don't pile up in it */
function compact(): void {
  const tasks = queue;
  const count = queued;
  queue = list();
  queued = 0;
  cleared = 0;
  for (let index = 0; index < count; index++) {
    const task = tasks[index]!;
    if (current(task)) push(task);
  }
}

const channel = new MessageChannel();
/** A task was asked for (at `wokenAt`) and hasn't come: one at a time is */
let woken = false;
let wokenAt = 0;

function wake(): void {
  if (woken && now() - wokenAt < LOST_WAKE) return;
  woken = true;
  wokenAt = now();
  apply(portPostMessage, channel.port2, [null]);
}

/** The browser's timer for the first of the queue, while it isn't due yet; and when it's due */
let alarm: number | undefined;
let alarmFor = Infinity;
/** What the last alarm that fired was for: due by then, though the clock may say a little less (see browserTimer) */
let ripe = -Infinity;

function onAlarm(): void {
  alarm = undefined;
  ripe = max(ripe, alarmFor);
  alarmFor = Infinity;
  wake();
}

/** The alarm for a timer of the queue due at `due`, `delay` from now, unless the one set is for one due no later */
function setAlarm(due: number, delay: number): void {
  if (due >= alarmFor) return;
  if (alarm !== undefined) nativeClearTimeout(alarm);
  alarmFor = due;
  alarm = nativeSetTimeout(onAlarm, delay);
}

function clearAlarm(): void {
  if (alarm !== undefined) nativeClearTimeout(alarm);
  alarm = undefined;
  alarmFor = Infinity;
}

/** The queue goes on: a task for its first if it's due by `time`, else the alarm for when it will be */
function next(time: number): void {
  const task = first();
  if (!task) return;
  if (task.due <= time) wake();
  else setAlarm(task.due, max(0, ceil(task.due - now())));
}

channel.port1.onmessage = () => {
  woken = false;
  const time = max(now(), ripe);
  // what came due while the thread was busy runs before what was set since, whichever task the browser ran first
  let task = first();
  if (task && task.due <= time) pop();
  else task = undefined;
  next(time);
  if (task) fire(task);
};

/** Queues a timer that's due: its callback runs in a task of its own */
function enqueue(task: Task): void {
  push(task);
  wake();
}

// MARK: The page hidden

// The page's visibility, as the frame's document has it (a frame's is its page's). A runtime without a document is
// never hidden: the tests run it in node.
const pageDocument = typeof document === 'object' ? document : null;
const isPageHidden = (): boolean => pageDocument?.visibilityState === 'hidden';
/** While it is, the timers are the browser's (see above) */
let pageHidden = isPageHidden();

pageDocument?.addEventListener('visibilitychange', () => {
  if (isPageHidden() === pageHidden) return;
  pageHidden = !pageHidden;
  const time = now();
  if (pageHidden) {
    // the queue goes to the browser's timers, in its order (the task already asked for finds it empty)
    clearAlarm();
    for (let task = pop(); task; task = pop()) {
      if (current(task)) browserTimer(task, max(0, ceil(task.due - time)));
    }
    cleared = 0;
    return;
  }
  // the browser's timers come back to the queue, in the order they're due
  apply(mapForEach, timers, [(task: Task) => {
    if (!isBrowserTimer(task.handle)) return;
    nativeClearTimeout(task.handle);
    push(task);
  }]);
  next(time);
});

/**
 * The browser's timer for a task while the page is hidden, `delay` from now: it's due when that fires. A timer just
 * set gives it the delay itself, not `due - now()`: that can come out a little less than the delay (the clock ticked
 * in between, or the float rounded), and browsers cut a delay to whole milliseconds, so it would fire early; for the
 * same reason a delay that's computed is rounded up, and the alarm that fires has its task due.
 */
function browserTimer(task: Task, delay: number): void {
  task.handle = nativeSetTimeout(() => {
    if (!current(task)) return;
    task.handle = FIRED;
    fire(task);
  }, delay);
}

/** Sets the timer `id` to be due at `due`, `delay` from now: queued, or on the browser's timer while the page is hidden */
function schedule(id: number, due: number, delay: number, run: (task: Task) => void): void {
  const task: Task = { id, due, delayed: delay > 0, order: nextOrder++, run, handle: QUEUED, released: false };
  setTimer(task);
  if (pageHidden) {
    browserTimer(task, delay);
    return;
  }
  push(task);
  if (delay <= 0) wake();
  else setAlarm(due, delay);
}

// MARK: Suspended

/** The timers that wait for the next tick, in the order they came due */
let deferred = list<Task>();
/** When the last tick was, or the last timer that didn't wait for one ran */
let lastTick = -Infinity;
let tick: number | undefined;

/** A timer that's due runs; while the content is suspended it waits for the next tick, unless it's the first in a second */
function fire(task: Task): void {
  if (state.suspended && !task.released) {
    const time = now();
    if (time - lastTick < THROTTLE - (pageHidden ? THROTTLE_EARLY_HIDDEN : THROTTLE_EARLY) || deferred.length) {
      task.handle = DEFERRED;
      deferred[deferred.length] = task;
      tick ??= nativeSetTimeout(onTick, max(0, ceil(lastTick + THROTTLE - now())));
      return;
    }
    lastTick = time;
  }
  task.run(task);
}

function onTick(): void {
  tick = undefined;
  lastTick = now();
  release();
}

/**
 * What waits for a tick runs, each in a task of its own from the queue, as each of the app's runs in a call of its own
 * (the microtasks of one run before the next): while the page is hidden too, as what they set goes to the browser's
 * timers then
 */
function release(): void {
  const waiting = deferred;
  deferred = list();
  for (let index = 0; index < waiting.length; index++) {
    const task = waiting[index];
    if (!current(task) || task.handle !== DEFERRED) continue;
    task.released = true;
    enqueue(task);
  }
}

// The host's playback messages, which index.ts acts on (this listener may come before its): once the content resumes,
// what waits for the next tick runs at once, after the message (the content's callbacks would see it half handled)
let suspended = false;
addEventListener('message', (event: MessageEvent) => {
  const message = event.data as HostMessage | null;
  if (event.source !== parent || message?.type !== 'playback') return;
  const resumed = suspended && !message.suspended;
  suspended = message.suspended;
  if (!resumed || !deferred.length) return;
  if (tick !== undefined) nativeClearTimeout(tick);
  tick = undefined;
  release();
});

// MARK: The content's timers

/** As the engine's JSValueIsObject: a function too */
const isObject = (value: unknown): boolean => (typeof value === 'object' && value !== null) || typeof value === 'function';

function delayOf(value: unknown): number {
  // ToNumber, as the engine's JSValueToNumber: what it throws (a symbol, a BigInt) goes to the content
  const delay = +(value as number);
  return delay >= 0 && delay <= MAX_DELAY ? delay : 0;
}

export function setTimeout(handler: unknown, delay?: unknown, ...args: unknown[]): number | null {
  if (!isObject(handler)) return null;
  const wait = delayOf(delay);
  const id = nextTimerId++;
  schedule(id, now() + wait, wait, () => {
    deleteTimer(id);
    if (typeof handler === 'function') guard(() => apply(handler, undefined, args));
  });
  return id;
}

export function setInterval(handler: unknown, delay?: unknown, ...args: unknown[]): number | null {
  if (!isObject(handler)) return null;
  // as browsers do: without a delay it would run the thread flat out
  const period = max(delayOf(delay), 4);
  const id = nextTimerId++;
  const run = (task: Task): void => {
    const started = now();
    if (typeof handler === 'function') guard(() => apply(handler, undefined, args));
    if (!current(task)) return;
    // a period after this one was due (after it ran, if it waited for a tick), past the runs it missed
    const time = now();
    let due = (task.released ? started : task.due) + period;
    if (due <= time) due += (floor((time - due) / period) + 1) * period;
    schedule(id, due, max(0, ceil(due - time)), run);
  };
  schedule(id, now() + period, period, run);
  return id;
}

export function clearTimer(id: unknown): void {
  // as the engine: a string or an object (its valueOf isn't called) clears nothing, a number is made an int32
  if (typeof id !== 'number') return;
  const key = id | 0;
  const task = timer(key);
  if (!task) return;
  deleteTimer(key);
  if (isBrowserTimer(task.handle)) {
    nativeClearTimeout(task.handle);
  } else if (task.handle === QUEUED) {
    cleared += 1;
    if (cleared >= COMPACT_CLEARED && cleared * 2 > queued) compact();
  }
}

/** Frames drawn each second, for the host; and a lost wake message is asked for again (see above) */
export function startStats(): void {
  nativeSetInterval(() => {
    send({ type: 'stats', framesPerSecond: frames });
    frames = 0;
    if (woken && queued && now() - wokenAt >= LOST_WAKE) wake();
  }, 1000);
}
