// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// Frames and timers as the engine runs them: requestAnimationFrame stops while the content is suspended or its drawing
// paused (the page is hidden, the desktop scrolled away) and keeps to the lower of the host's frame rate and
// DesktopEngine.preferredFramesPerSecond; timers of a suspended content run at most once a second. Exceptions in
// callbacks are reported, the next ones still run.

import { contentFunction } from './realm.ts';
import { guard, send, state } from './state.ts';

type FrameCallback = (time: number) => void;

// the realm's own, kept before the content's versions replace the globals
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
const nativeSetInterval = globalThis.setInterval.bind(globalThis);

let callbacks = new Map<number, FrameCallback>();
let nextFrameId = 1;
let looping = false;
let lastFrame = -Infinity;
let frames = 0;

function frameInterval(): number {
  const limits = [state.hostMaxFramesPerSecond, state.contentFramesPerSecond].filter((value) => value > 0);
  return limits.length ? 1000 / Math.min(...limits) : 0;
}

function loop(time: number): void {
  if (!callbacks.size) {
    looping = false;
    return;
  }
  requestNativeFrame(loop);
  if (state.suspended || state.renderingPaused) return;
  const interval = frameInterval();
  // a couple of milliseconds early still counts: frames don't come exactly on time
  if (interval && time - lastFrame < interval - 2) return;
  lastFrame = time;
  frames += 1;
  const due = callbacks;
  callbacks = new Map();
  for (const callback of due.values()) guard(() => callback(time));
}

const requestNativeFrame: (callback: FrameRequestCallback) => number = globalThis.requestAnimationFrame.bind(globalThis);

export function requestAnimationFrame(callback: FrameCallback): number {
  if (typeof callback !== 'function') throw new TypeError('requestAnimationFrame needs a function');
  const id = nextFrameId++;
  callbacks.set(id, callback);
  if (!looping) {
    looping = true;
    requestNativeFrame(loop);
  }
  return id;
}

export function cancelAnimationFrame(id: number): void {
  callbacks.delete(id);
}

// MARK: Timers

let nextTimerId = 1;
const timers = new Map<number, number>();
let lastSuspendedRun = 0;

function callable(handler: unknown): (...args: unknown[]) => void {
  if (typeof handler === 'function') return handler as (...args: unknown[]) => void;
  return contentFunction(String(handler), 'desktopengine:///timer') as () => void;
}

function delayOf(value: unknown): number {
  const delay = Number(value);
  return Number.isFinite(delay) && delay > 0 ? delay : 0;
}

/** Runs now, or later when the content is suspended and something ran less than a second ago */
function whenAwake(id: number, run: () => void): void {
  if (!state.suspended) {
    run();
    return;
  }
  const wait = 1000 - (performance.now() - lastSuspendedRun);
  if (wait <= 0) {
    lastSuspendedRun = performance.now();
    run();
    return;
  }
  timers.set(id, nativeSetTimeout(() => {
    if (timers.has(id)) whenAwake(id, run);
  }, wait));
}

export function setTimeout(handler: unknown, delay?: unknown, ...args: unknown[]): number {
  const callback = callable(handler);
  const id = nextTimerId++;
  timers.set(id, nativeSetTimeout(() => whenAwake(id, () => {
    timers.delete(id);
    guard(() => callback(...args));
  }), delayOf(delay)));
  return id;
}

export function setInterval(handler: unknown, delay?: unknown, ...args: unknown[]): number {
  const callback = callable(handler);
  const id = nextTimerId++;
  const period = Math.max(delayOf(delay), 4);
  const tick = () => {
    timers.set(id, nativeSetTimeout(() => whenAwake(id, () => {
      if (!timers.has(id)) return;
      guard(() => callback(...args));
      if (timers.has(id)) tick();
    }), state.suspended ? Math.max(period, 1000) : period));
  };
  tick();
  return id;
}

export function clearTimer(id: unknown): void {
  const native = timers.get(Number(id));
  if (native !== undefined) nativeClearTimeout(native);
  timers.delete(Number(id));
}

/** Frames drawn each second, for the host */
export function startStats(): void {
  nativeSetInterval(() => {
    send({ type: 'stats', framesPerSecond: frames });
    frames = 0;
  }, 1000);
}
