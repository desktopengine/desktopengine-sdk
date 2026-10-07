// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The engine's evented objects: `on<name>` properties and `off<name>()`, addEventListener with or without `on`, and
// listeners called with a plain payload and `this` set to the object, not with DOM events.

import { guard } from './state.ts';

export type Listener = (this: unknown, payload?: unknown) => void;

export class Evented {
  protected readonly listeners = new Map<string, Set<Listener>>();
  /** The `on<name>` callbacks */
  protected readonly handlers = new Map<string, Listener>();

  addEventListener(type: string, listener: Listener): void {
    if (typeof listener !== 'function') return;
    const name = eventName(type);
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(listener);
    this.listenersChanged(name);
  }

  removeEventListener(type: string, listener: Listener): void {
    const name = eventName(type);
    this.listeners.get(name)?.delete(listener);
    this.listenersChanged(name);
  }

  /** Whether anything listens for the event */
  listens(name: string): boolean {
    return this.handlers.has(name) || (this.listeners.get(name)?.size ?? 0) > 0;
  }

  emit(name: string, payload?: unknown): void {
    const handler = this.handlers.get(name);
    if (handler) guard(() => handler.call(this, payload));
    for (const listener of [...(this.listeners.get(name) ?? [])]) guard(() => listener.call(this, payload));
  }

  destroy(): void {
    this.listeners.clear();
    this.handlers.clear();
  }

  /** Subclasses start watching for an event once something listens (framechange), and may stop when nothing does */
  protected listenersChanged(_name: string): void {}
}

export function eventName(type: string): string {
  const name = String(type);
  return name.startsWith('on') ? name.slice(2) : name;
}

/** Adds `on<name>` and `off<name>()` for each event */
export function defineEvents(prototype: object, names: string[]): void {
  for (const name of names) {
    Object.defineProperty(prototype, `off${name}`, {
      value(this: Evented) {
        (this as unknown as { handlers: Map<string, Listener> }).handlers.delete(name);
        (this as unknown as { listenersChanged(name: string): void }).listenersChanged(name);
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(prototype, `on${name}`, {
      get(this: Evented) {
        return (this as unknown as { handlers: Map<string, Listener> }).handlers.get(name) ?? null;
      },
      set(this: Evented, value: unknown) {
        const handlers = (this as unknown as { handlers: Map<string, Listener> }).handlers;
        if (typeof value === 'function') handlers.set(name, value as Listener);
        else handlers.delete(name);
        (this as unknown as { listenersChanged(name: string): void }).listenersChanged(name);
      },
      configurable: true,
    });
  }
}
