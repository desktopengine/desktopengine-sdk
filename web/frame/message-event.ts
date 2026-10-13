// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// MessageEvent as the engine has it: the event's data, origin, lastEventId, source and ports are its own properties,
// read from the init as the engine reads it. The source is always null and the ports are a frozen copy of what's
// given, whatever it is: the browser's MessageEvent takes only its own ports, which the content doesn't have (its
// MessageChannel is the runtime's, see clone.ts), so forwarding an event with ports would throw. The events are the
// browser's all the same, of its prototype, so its own events (a WebSocket's) are MessageEvents too.

// what the content may replace, taken before it runs
const BrowserMessageEvent = MessageEvent;
const { construct } = Reflect;
const { create, defineProperty, freeze } = Object;
const { from: arrayFrom } = Array;

const own = (event: object, key: string, value: unknown): void => {
  defineProperty(event, key, { value, writable: true, enumerable: true, configurable: true });
};

type Init = { cancelable?: unknown; data?: unknown; origin?: unknown; ports?: Iterable<unknown> | ArrayLike<unknown> } | null | undefined;

/** The content's MessageEvent */
export const MessageEventClass = function MessageEvent(this: unknown, type: unknown, init: Init = {}): MessageEvent {
  if (new.target === undefined) throw new TypeError('Cannot call a class constructor MessageEvent without |new|');
  // in the order the engine's Event and MessageEvent read them; the browser's gets a dictionary without a prototype,
  // so what the content put on Object.prototype isn't read as more of it
  const name = String(type);
  const cancelable = !!init?.cancelable;
  const event = construct(BrowserMessageEvent, [name, create(null, { cancelable: { value: cancelable, enumerable: true } })], new.target) as MessageEvent;
  own(event, 'data', (init as NonNullable<Init>).data);
  own(event, 'origin', (init as NonNullable<Init>).origin ?? '');
  own(event, 'lastEventId', '');
  own(event, 'source', null);
  own(event, 'ports', freeze(arrayFrom((init as NonNullable<Init>).ports ?? [])));
  return event;
} as unknown as typeof MessageEvent;
// named as the engine's, whatever the bundler calls it; its prototype is the browser's, which can't be replaced
defineProperty(MessageEventClass, 'name', { value: 'MessageEvent', configurable: true });
defineProperty(MessageEventClass, 'prototype', { value: BrowserMessageEvent.prototype, writable: false });

/** Installs the content's MessageEvent: not enumerable, as the engine's, and the constructor of the events */
export function installMessageEvent(scope: Record<string, unknown>): void {
  defineProperty(scope, 'MessageEvent', { value: MessageEventClass, writable: true, configurable: true, enumerable: false });
  defineProperty(BrowserMessageEvent.prototype, 'constructor', { value: MessageEventClass, writable: true, configurable: true, enumerable: false });
}
