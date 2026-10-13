// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// BroadcastChannel as the engine has it, with a scope. Frames have opaque origins, so the browser's BroadcastChannel
// reaches nothing: the host passes the messages between the frames of its desktop and keeps to the scopes (see
// WebDesktop.broadcast). A message goes as the engine encodes it (messages.ts) and the frame applies the engine's
// limits to it, so content fails here as it would in the app.
//
// As in browsers, a channel that isn't closed is kept while it has listeners for its messages; one without is let go
// once the content no longer refers to it, so a `new BroadcastChannel(name).postMessage(message)` doesn't stay open.

import type { ChannelScope, FrameMessage, HostMessage } from '../protocol.ts';
import { MessageEventClass } from './message-event.ts';
import { append, decodeMessage, encodeMessage, makeNode, messageSize, parseMessage, type EngineObjectCheck } from './messages.ts';

/** The scopes, as types/desktop-engine.d.ts gives them (a test checks) */
export const SCOPES: readonly ChannelScope[] = ['package', 'namespace'];

// the engine's limits: 1 MB a message, 240 messages and 16 MB a second
const MAXIMUM_SIZE = 1024 * 1024;
const MESSAGES_PER_SECOND = 240;
const BYTES_PER_SECOND = 16 * 1024 * 1024;

// what the content may replace, taken before it runs
const now = performance.now.bind(performance);
const DOMExceptionClass = DOMException;
const EventTargetClass = EventTarget;
const { addEventListener: addListener } = EventTarget.prototype;
const WeakRefClass = WeakRef;
const FinalizationRegistryClass = FinalizationRegistry;
const { apply } = Reflect;

type BroadcastMessage = Extract<HostMessage, { type: 'broadcast' }>;

/** The event types a channel is kept for while it has listeners */
const MESSAGE_TYPES = new Set(['message', 'messageerror']);

export interface ChannelHost {
  /** To the host */
  send(message: FrameMessage): void;
  /** Whether the content may open channels of scope "namespace" */
  namespaceChannels(): boolean;
  /** The runtime's stand-ins for the engine's own objects besides the ones of stand-ins.ts, which can't be sent as the engine's can't */
  isEngineObject?: EngineObjectCheck;
}

type ListenerOptions = { capture?: unknown; once?: unknown; signal?: AbortSignal | null };

/** A listener the content added for messages, and what was added for it (see addEventListener) */
interface Registration {
  type: string;
  listener: object;
  capture: boolean;
  wrapper: (this: unknown, event: Event) => unknown;
}

/** The content's BroadcastChannel class, and what takes the host's messages to its channels */
export function createChannels(host: ChannelHost): { BroadcastChannel: new (name: string, options?: { scope?: unknown }) => EventTarget; receive(message: BroadcastMessage): void } {
  /**
   * The open channels by scope and name ("<scope>\n<name>"), by id in the order they were made, held weakly: those
   * with listeners are in `listening` too
   */
  const openChannels = new Map<string, Map<number, WeakRef<BroadcastChannel>>>();
  /** The open channels with listeners for their messages, kept even when the content no longer refers to them */
  const listening = new Set<BroadcastChannel>();
  /** Forgets a channel the content let go without closing it */
  const released = new FinalizationRegistryClass<{ scope: ChannelScope; name: string; id: number }>(({ scope, name, id }) => forget(scope, name, id));
  let lastId = 0;
  let messageAllowance = MESSAGES_PER_SECOND;
  let byteAllowance = BYTES_PER_SECOND;
  let allowanceTime = 0;

  function spend(size: number): void {
    const time = now() / 1000;
    const elapsed = allowanceTime > 0 ? time - allowanceTime : 0;
    allowanceTime = time;
    messageAllowance = Math.min(MESSAGES_PER_SECOND, messageAllowance + elapsed * MESSAGES_PER_SECOND);
    byteAllowance = Math.min(BYTES_PER_SECOND, byteAllowance + elapsed * BYTES_PER_SECOND);
    if (messageAllowance < 1 || byteAllowance < size) {
      throw new DOMExceptionClass('Too many messages: content sends at most 240 messages and 16 MB a second on its BroadcastChannels', 'QuotaExceededError');
    }
    messageAllowance -= 1;
    byteAllowance -= size;
  }

  /** A channel is no longer open: the host is told once none of its scope and name is */
  function forget(scope: ChannelScope, name: string, id: number): void {
    const key = `${scope}\n${name}`;
    const channels = openChannels.get(key);
    if (!channels?.delete(id) || channels.size > 0) return;
    openChannels.delete(key);
    host.send({ type: 'channel', scope, name, open: false });
  }

  class BroadcastChannel extends EventTargetClass {
    #name: string;
    #scope: ChannelScope;
    #id: number;
    #closed = false;
    #onmessage: ((event: MessageEvent) => void) | null = null;
    #onmessageerror: ((event: MessageEvent) => void) | null = null;
    /** The content's listeners for messages */
    #registrations = new Set<Registration>();

    constructor(name: string, options?: { scope?: unknown }) {
      if (arguments.length < 1) throw new TypeError('BroadcastChannel: 1 argument required, but only 0 present');
      const channelName = String(name);
      let scope: ChannelScope = 'package';
      if (options !== undefined && options !== null) {
        if (typeof options !== 'object' && typeof options !== 'function') throw new TypeError('BroadcastChannel: the options must be an object');
        if (options.scope !== undefined) {
          const value = String(options.scope);
          if (!SCOPES.includes(value as ChannelScope)) {
            throw new TypeError(`BroadcastChannel: the scope must be "package" or "namespace", not "${value}"`);
          }
          scope = value as ChannelScope;
        }
      }
      if (scope === 'namespace' && !host.namespaceChannels()) {
        throw new DOMExceptionClass('BroadcastChannels of scope "namespace" are only for content installed from the store, or run by desktopengine dev or the Develop menu, with an id of the form app.desktopengine.<namespace>.<name>', 'SecurityError');
      }
      super();
      this.#name = channelName;
      this.#scope = scope;
      // the handlers are called first, as the engine's EventTarget calls them: added with the browser's addEventListener
      // as it was before the content ran, and for the capture phase, as WebKit calls a target's capture listeners first
      apply(addListener, this, ['message', (event: Event) => this.#handle(this.#onmessage, event), true]);
      apply(addListener, this, ['messageerror', (event: Event) => this.#handle(this.#onmessageerror, event), true]);
      const key = `${scope}\n${channelName}`;
      let channels = openChannels.get(key);
      if (!channels) {
        openChannels.set(key, (channels = new Map()));
        host.send({ type: 'channel', scope, name: channelName, open: true });
      }
      this.#id = ++lastId;
      channels.set(this.#id, new WeakRefClass(this));
      released.register(this, { scope, name: channelName, id: this.#id }, this);
    }

    #handle(handler: ((event: MessageEvent) => void) | null, event: Event): void {
      if (handler) apply(handler, this, [event]);
    }

    get name(): string {
      return this.#name;
    }

    get scope(): ChannelScope {
      return this.#scope;
    }

    get onmessage(): ((event: MessageEvent) => void) | null {
      return this.#onmessage;
    }

    set onmessage(handler: unknown) {
      this.#onmessage = typeof handler === 'function' ? (handler as (event: MessageEvent) => void) : null;
      this.#listenersChanged();
    }

    get onmessageerror(): ((event: MessageEvent) => void) | null {
      return this.#onmessageerror;
    }

    set onmessageerror(handler: unknown) {
      this.#onmessageerror = typeof handler === 'function' ? (handler as (event: MessageEvent) => void) : null;
      this.#listenersChanged();
    }

    // The listeners for messages are counted, to keep the channel while it has some. Each is added wrapped, so that
    // a `once` one is known to be gone when it's called.
    override addEventListener(type: string, listener: unknown, options?: unknown): void {
      const kind = String(type);
      if (!MESSAGE_TYPES.has(kind) || listener === null || (typeof listener !== 'function' && typeof listener !== 'object')) {
        super.addEventListener(type, listener as never, options as never);
        return;
      }
      const settings = typeof options === 'object' && options !== null ? (options as ListenerOptions) : null;
      const capture = settings ? Boolean(settings.capture) : Boolean(options);
      if (this.#find(kind, listener, capture)) return;
      const once = Boolean(settings?.once);
      const removed = (): void => this.#unregister(registration);
      const registration: Registration = {
        type: kind,
        listener,
        capture,
        wrapper(this: unknown, event: Event): unknown {
          if (once) removed();
          if (typeof listener === 'function') return apply(listener, this, [event]);
          const handleEvent = (listener as { handleEvent?: unknown }).handleEvent;
          if (typeof handleEvent !== 'function') throw new TypeError('The listener has no handleEvent method');
          return apply(handleEvent, listener, [event]);
        },
      };
      super.addEventListener(kind, registration.wrapper, options as never);
      const signal = settings?.signal;
      // an aborted signal adds nothing
      if (signal?.aborted) return;
      this.#registrations.add(registration);
      signal?.addEventListener('abort', removed, { once: true });
      this.#listenersChanged();
    }

    override removeEventListener(type: string, listener: unknown, options?: unknown): void {
      const kind = String(type);
      const capture = typeof options === 'object' && options !== null ? Boolean((options as ListenerOptions).capture) : Boolean(options);
      const registration = this.#find(kind, listener, capture);
      if (!registration) {
        super.removeEventListener(type, listener as never, options as never);
        return;
      }
      super.removeEventListener(kind, registration.wrapper, capture);
      this.#unregister(registration);
    }

    #find(type: string, listener: unknown, capture: boolean): Registration | undefined {
      for (const item of this.#registrations) {
        if (item.type === type && item.listener === listener && item.capture === capture) return item;
      }
      return undefined;
    }

    #unregister(registration: Registration): void {
      if (!this.#registrations.delete(registration)) return;
      this.#listenersChanged();
    }

    #listenersChanged(): void {
      if (!this.#closed && (this.#onmessage || this.#onmessageerror || this.#registrations.size > 0)) listening.add(this);
      else listening.delete(this);
    }

    postMessage(message: unknown): void {
      if (arguments.length < 1) throw new TypeError('postMessage: 1 argument required, but only 0 present');
      if (this.#closed) throw new DOMExceptionClass('The channel is closed', 'InvalidStateError');
      // throws a DataCloneError here as in the app, not in the host
      const data = encodeMessage(message, host.isEngineObject);
      const size = messageSize(data);
      if (size > MAXIMUM_SIZE) {
        throw new DOMExceptionClass('The message is too big: a message on a BroadcastChannel takes at most 1 MB', 'DataCloneError');
      }
      spend(size);
      host.send({ type: 'broadcast', scope: this.#scope, name: this.#name, data, source: this.#id, newest: lastId });
    }

    close(): void {
      if (this.#closed) return;
      this.#closed = true;
      listening.delete(this);
      released.unregister(this);
      forget(this.#scope, this.#name, this.#id);
    }

    get [Symbol.toStringTag](): string {
      return 'BroadcastChannel';
    }
  }

  // named as the engine's, whatever the bundler calls it (a refused channel is "A BroadcastChannel")
  Object.defineProperty(BroadcastChannel, 'name', { value: 'BroadcastChannel', configurable: true });
  Object.defineProperty(BroadcastChannel, 'length', { value: 1, configurable: true });

  /**
   * A message from the host, in a task of its own, to the channels of the scope and name but the one that posted it;
   * of the content's own, only to the channels it had when it posted it, as in browsers. Each channel gets a copy when
   * its turn comes, if it's listening then: as in browsers, a channel that a listener of one before it closes
   * synchronously doesn't get the message, and one that such a listener synchronously gives a listener does. Unlike
   * browsers, which give each channel a task of its own, all of them are served in this one host message, so the
   * microtasks a listener queues (its code after an await, say) run only once every channel has had its turn.
   */
  function receive(message: BroadcastMessage): void {
    const channels = openChannels.get(`${message.scope}\n${message.name}`);
    if (!channels) return;
    // the channels that get it, if they're listening when their turn comes (see makeNode for why not [])
    const destinations = makeNode() as BroadcastChannel[];
    let anyListening = false;
    for (const [id, reference] of channels) {
      if (id === message.source || (message.newest >= 0 && id > message.newest)) continue;
      const channel = reference.deref();
      if (!channel) continue;
      append(destinations, channel);
      if (listening.has(channel)) anyListening = true;
    }
    // none of the content's code has run since it came, so no channel can have started listening
    if (!anyListening) return;
    let parsed: { tree: unknown; buffers: unknown[] } | null;
    try {
      parsed = parseMessage(message.data);
    } catch {
      parsed = null;
    }
    // the last one gets the buffers that came, the others copies made before any listener has those
    for (let index = 0; index < destinations.length; index++) {
      const channel = destinations[index];
      // a closed channel isn't listening either
      if (!listening.has(channel)) continue;
      let data: unknown;
      let decodes = parsed !== null;
      if (parsed) {
        try {
          data = decodeMessage(parsed.tree, parsed.buffers, index < destinations.length - 1);
        } catch {
          decodes = false;
        }
      }
      channel.dispatchEvent(decodes ? new MessageEventClass('message', { data }) : new MessageEventClass('messageerror', {}));
    }
  }

  return { BroadcastChannel, receive };
}
