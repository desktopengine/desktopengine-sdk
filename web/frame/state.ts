// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// What the frame's parts share: the launch, what was granted, and the way to the host.

import type { FrameMessage, LaunchMessage, WebScreen } from '../protocol.ts';

export const state = {
  launch: null as LaunchMessage | null,
  screens: [] as WebScreen[],
  appearance: 'dark' as 'light' | 'dark',
  suspended: false,
  renderingPaused: false,
  muted: true,
  /** The host's limit and the content's (DesktopEngine.preferredFramesPerSecond); the lower one wins */
  hostMaxFramesPerSecond: 0,
  contentFramesPerSecond: 0,
};

export function send(message: FrameMessage, transfer?: Transferable[]): void {
  // without a transfer list unless there is one: WebKit reads it with the Array iterator, which the content may replace
  if (transfer) parent.postMessage(message, '*', transfer);
  else parent.postMessage(message, '*');
}

export function hasPermission(permission: string): boolean {
  const permissions = state.launch?.permissions;
  if (!permissions) return false;
  // by index: the content may have replaced Array.prototype.includes, the engine checks its permissions natively
  for (let index = 0; index < permissions.length; index++) if (permissions[index] === permission) return true;
  return false;
}

// what the content may replace, taken before it runs: an exception is reported whatever the content did to them
const { apply } = Reflect;
const { indexOf, slice, trim } = String.prototype;
const ErrorClass = Error;
const toText = String;
const { setPrototypeOf } = Object;
const { forEach: setForEach } = Set.prototype;

/**
 * An array without a prototype, for the runtime's own lists: filled and read by index, so nothing the content put on
 * Array.prototype (an iterator, a setter at an index) is used
 */
export const list = <T>(): T[] => setPrototypeOf([], null) as T[];

/** The items of a set, in a list (Set.prototype.forEach as it was before the content ran) */
export function itemsOf<T>(set: Set<T>): T[] {
  const items = list<T>();
  apply(setForEach, set, [(item: T) => {
    items[items.length] = item;
  }]);
  return items;
}

/** The content's own frames (its code runs as desktopengine:///<name>/index.js), without the runtime's or the message */
function contentStack(stack: unknown): string | undefined {
  // the content may have set it to anything
  if (typeof stack !== 'string') return undefined;
  let lines = '';
  for (let start = 0; start < stack.length;) {
    let end = apply(indexOf, stack, ['\n', start]) as number;
    if (end < 0) end = stack.length;
    const line = apply(slice, stack, [start, end]) as string;
    if ((apply(indexOf, line, ['desktopengine:///']) as number) >= 0) {
      lines += `${lines ? '\n' : ''}${apply(trim, line, []) as string}`;
    }
    start = end + 1;
  }
  return lines || undefined;
}

/**
 * Errors in the content's callbacks go to the host, as uncaught exceptions do in the app, after `prefix` ("Unhandled
 * promise rejection: "). What can't be described (an object without a prototype, a getter that throws) is a fixed
 * message, as the app's: this never throws, else the exception would leave guard() and stop what called it (an
 * interval, the timers of a tick).
 */
export function report(error: unknown, prefix = ''): void {
  let message = 'Error: unknown error';
  let stack: string | undefined;
  try {
    const described: unknown = error instanceof ErrorClass ? `${error.name}: ${error.message}` : toText(error);
    if (typeof described === 'string') message = described;
  } catch {
    // the fixed message
  }
  try {
    if (error instanceof ErrorClass) stack = contentStack(error.stack);
  } catch {
    stack = undefined;
  }
  const exception: FrameMessage = { type: 'exception', message: prefix + message, stack };
  try {
    // not send(): WebKit reads its transfer list with Array.prototype[Symbol.iterator], which the content may replace
    parent.postMessage(exception, '*');
  } catch {
    // nothing else to report it with: what called this goes on
  }
}

export function guard<T>(action: () => T): T | undefined {
  try {
    return action();
  } catch (error) {
    report(error);
    return undefined;
  }
}

let identifiers = 0;
/** Like the engine's pointer strings */
export function nextIdentifier(): string {
  identifiers += 1;
  return `0x${(0x600000000000 + identifiers * 0x40).toString(16)}`;
}
