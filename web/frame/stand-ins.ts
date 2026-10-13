// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The runtime's stand-ins for the engine's native objects: the evented ones (a window, a component,
// DesktopEngine.system), screens, text metrics, a 2D context, gradients and patterns, and the browser's objects that
// take the place of native ones (WebGL objects and extensions, `performance`). structuredClone and BroadcastChannel
// refuse them as the engine refuses its own, and copy what is made from one (Object.create) or a Proxy of one as an
// object of its own properties, as the engine does. They're known by identity, not by class, prototype or tag, which
// content can fake or reach.
//
// The engine's constructors (DesktopEngine.Window, DesktopEngineRuntime.System…) are objects in the app (`typeof` is
// "object"), which structuredClone copies as empty ones; here they're classes.

// what the content may replace, taken before it runs
const { add, has } = WeakSet.prototype;
const { apply } = Reflect;

const standIns = new WeakSet<object>();
const constructors = new WeakSet<object>();

/** Notes a stand-in for one of the engine's native objects */
export function standIn<T extends object>(value: T): T {
  apply(add, standIns, [value]);
  return value;
}

export const isStandIn = (value: unknown): boolean => apply(has, standIns, [value]) as boolean;

/** Notes a stand-in for one of the engine's constructors */
export function engineConstructor<T extends object>(value: T): T {
  apply(add, constructors, [value]);
  return value;
}

export const isEngineConstructor = (value: unknown): boolean => apply(has, constructors, [value]) as boolean;
