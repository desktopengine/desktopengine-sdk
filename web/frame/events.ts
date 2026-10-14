// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The engine's evented objects: `on<name>` properties and `off<name>()`, addEventListener with or without `on`, and
// listeners called with a plain payload and `this` set to the object, not with DOM events.

import { standIn } from './stand-ins.ts';
import { guard, itemsOf } from './state.ts';

export type Listener = (this: unknown, payload?: unknown) => void;

// what the content may replace, taken before it runs: the engine's evented objects are native, so adding a listener
// and calling the listeners use nothing the content can change (Map's and Set's methods, the iterators,
// Function.prototype.call)
const { apply } = Reflect;
const { getOwnPropertyDescriptor } = Object;
const MapClass = Map;
const SetClass = Set;
const { get: mapGet, set: mapSet, has: mapHas, delete: mapDelete, clear: mapClear } = Map.prototype;
const { add: setAdd, delete: setDelete } = Set.prototype;
const setSize = getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;
const toText = String;
const { startsWith, slice } = String.prototype;

type EventedInternals = { handlers: Map<string, Listener>; listenersChanged(name: string): void };

export class Evented {
  protected readonly listeners = new MapClass<string, Set<Listener>>();
  /** The `on<name>` callbacks */
  protected readonly handlers = new MapClass<string, Listener>();

  constructor() {
    // the engine's are native objects, which structuredClone and BroadcastChannel refuse
    standIn(this);
  }

  addEventListener(type: string, listener: Listener): void {
    if (typeof listener !== 'function') return;
    const name = eventName(type);
    let set = apply(mapGet, this.listeners, [name]) as Set<Listener> | undefined;
    if (!set) {
      set = new SetClass<Listener>();
      apply(mapSet, this.listeners, [name, set]);
    }
    apply(setAdd, set, [listener]);
    this.listenersChanged(name);
  }

  removeEventListener(type: string, listener: Listener): void {
    const name = eventName(type);
    const set = apply(mapGet, this.listeners, [name]) as Set<Listener> | undefined;
    if (set) apply(setDelete, set, [listener]);
    this.listenersChanged(name);
  }

  /** Whether anything listens for the event */
  listens(name: string): boolean {
    if (apply(mapHas, this.handlers, [name])) return true;
    const set = apply(mapGet, this.listeners, [name]) as Set<Listener> | undefined;
    return set !== undefined && (apply(setSize, set, []) as number) > 0;
  }

  emit(name: string, payload?: unknown): void {
    const handler = apply(mapGet, this.handlers, [name]) as Listener | undefined;
    if (handler) guard(() => apply(handler, this, [payload]));
    const set = apply(mapGet, this.listeners, [name]) as Set<Listener> | undefined;
    if (!set) return;
    // the listeners as they are when it's emitted: one an earlier one removes is still called
    const listeners = itemsOf(set);
    for (let index = 0; index < listeners.length; index++) {
      const listener = listeners[index];
      guard(() => apply(listener, this, [payload]));
    }
  }

  destroy(): void {
    apply(mapClear, this.listeners, []);
    apply(mapClear, this.handlers, []);
  }

  /** Subclasses start watching for an event once something listens (framechange), and may stop when nothing does */
  protected listenersChanged(_name: string): void {}
}

export function eventName(type: string): string {
  const name = toText(type);
  return apply(startsWith, name, ['on']) ? (apply(slice, name, [2]) as string) : name;
}

/** Adds `on<name>` and `off<name>()` for each event */
export function defineEvents(prototype: object, names: string[]): void {
  for (const name of names) {
    Object.defineProperty(prototype, `off${name}`, {
      // named as the method, as the engine's are
      value: {
        [`off${name}`](this: Evented) {
          const evented = this as unknown as EventedInternals;
          apply(mapDelete, evented.handlers, [name]);
          evented.listenersChanged(name);
        },
      }[`off${name}`],
      configurable: true,
      writable: true,
    });
    Object.defineProperty(prototype, `on${name}`, {
      get(this: Evented) {
        return (apply(mapGet, (this as unknown as EventedInternals).handlers, [name]) as Listener | undefined) ?? null;
      },
      set(this: Evented, value: unknown) {
        const evented = this as unknown as EventedInternals;
        if (typeof value === 'function') apply(mapSet, evented.handlers, [name, value]);
        else apply(mapDelete, evented.handlers, [name]);
        evented.listenersChanged(name);
      },
      configurable: true,
    });
  }
}
