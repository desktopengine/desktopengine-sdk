// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// BroadcastChannel as the engine has it, with a scope. Frames have opaque origins, so the browser's BroadcastChannel
// reaches nothing: the host passes the messages between the frames of its desktop and keeps to the scopes (see
// WebDesktop.broadcast). The frame applies the engine's limits, so content fails here as it would in the app.

import type { ChannelScope, FrameMessage, HostMessage } from '../protocol.ts';

/** The scopes, as types/desktop-engine.d.ts gives them (a test checks) */
export const SCOPES: readonly ChannelScope[] = ['package', 'namespace'];

// the engine's limits: 1 MB a message, 240 messages and 16 MB a second
const MAXIMUM_SIZE = 1024 * 1024;
const MESSAGES_PER_SECOND = 240;
const BYTES_PER_SECOND = 16 * 1024 * 1024;

type BroadcastMessage = Extract<HostMessage, { type: 'broadcast' }>;

export interface ChannelHost {
  /** To the host */
  send(message: FrameMessage): void;
  /** Whether the content may open channels of scope "namespace" */
  namespaceChannels(): boolean;
}

/**
 * About the bytes the engine counts for a message: 2 for each character of its strings and keys, the bytes of its
 * ArrayBuffers (once each), and a few for anything else
 */
function messageSize(value: unknown): number {
  const ImageDataClass = (globalThis as { ImageData?: new (...args: never[]) => { data: Uint8ClampedArray } }).ImageData;
  const seen = new Set<unknown>();
  let size = 0;
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      size += item.length * 2 + 4;
      return;
    }
    if (item === null || typeof item !== 'object') {
      size += 8;
      return;
    }
    if (seen.has(item)) {
      size += 16;
      return;
    }
    seen.add(item);
    size += 8;
    if (item instanceof ArrayBuffer) size += item.byteLength;
    else if (ArrayBuffer.isView(item)) visit(item.buffer);
    else if (item instanceof Blob) size += item.size + 32;
    else if (item instanceof Map) for (const [key, entry] of item) visit(key), visit(entry);
    else if (item instanceof Set) for (const entry of item) visit(entry);
    else if (ImageDataClass && item instanceof ImageDataClass) size += item.data.byteLength;
    else if (item instanceof Date || item instanceof RegExp || item instanceof Error) size += String(item).length * 2;
    else for (const key of Object.keys(item)) {
      size += key.length * 2 + 4;
      visit((item as Record<string, unknown>)[key]);
    }
  };
  visit(value);
  return size;
}

/** The content's BroadcastChannel class, and what takes the host's messages to its channels */
export function createChannels(host: ChannelHost): { BroadcastChannel: new (name: string, options?: { scope?: unknown }) => EventTarget; receive(message: BroadcastMessage): void } {
  /** The open channels by scope and name ("<scope>\n<name>"), each with its id, in the order they were made */
  const openChannels = new Map<string, Map<EventTarget, number>>();
  let lastId = 0;
  let messageAllowance = MESSAGES_PER_SECOND;
  let byteAllowance = BYTES_PER_SECOND;
  let allowanceTime = 0;

  function spend(size: number): void {
    const now = performance.now() / 1000;
    const elapsed = allowanceTime > 0 ? now - allowanceTime : 0;
    allowanceTime = now;
    messageAllowance = Math.min(MESSAGES_PER_SECOND, messageAllowance + elapsed * MESSAGES_PER_SECOND);
    byteAllowance = Math.min(BYTES_PER_SECOND, byteAllowance + elapsed * BYTES_PER_SECOND);
    if (messageAllowance < 1 || byteAllowance < size) {
      throw new DOMException('Too many messages: content sends at most 240 messages and 16 MB a second on its BroadcastChannels', 'QuotaExceededError');
    }
    messageAllowance -= 1;
    byteAllowance -= size;
  }

  class BroadcastChannel extends EventTarget {
    #name: string;
    #scope: ChannelScope;
    #closed = false;
    #onmessage: ((event: MessageEvent) => void) | null = null;
    #onmessageerror: ((event: MessageEvent) => void) | null = null;

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
        throw new DOMException('BroadcastChannels of scope "namespace" are only for content installed from the store or run by desktopengine dev, with an id of the form app.desktopengine.<namespace>.<name>', 'SecurityError');
      }
      super();
      this.#name = channelName;
      this.#scope = scope;
      // the handlers are called where browsers call them: as the first listeners
      this.addEventListener('message', (event) => this.#onmessage?.call(this, event as MessageEvent));
      this.addEventListener('messageerror', (event) => this.#onmessageerror?.call(this, event as MessageEvent));
      const key = `${scope}\n${channelName}`;
      let channels = openChannels.get(key);
      if (!channels) {
        openChannels.set(key, (channels = new Map()));
        host.send({ type: 'channel', scope, name: channelName, open: true });
      }
      channels.set(this, ++lastId);
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
    }

    get onmessageerror(): ((event: MessageEvent) => void) | null {
      return this.#onmessageerror;
    }

    set onmessageerror(handler: unknown) {
      this.#onmessageerror = typeof handler === 'function' ? (handler as (event: MessageEvent) => void) : null;
    }

    postMessage(message: unknown): void {
      if (arguments.length < 1) throw new TypeError('postMessage: 1 argument required, but only 0 present');
      if (this.#closed) throw new DOMException('The channel is closed', 'InvalidStateError');
      // throws a DataCloneError here as in the app, not in the host
      const data = structuredClone(message);
      const size = messageSize(data);
      if (size > MAXIMUM_SIZE) {
        throw new DOMException('The message is too big: a message on a BroadcastChannel takes at most 1 MB', 'DataCloneError');
      }
      spend(size);
      const source = openChannels.get(`${this.#scope}\n${this.#name}`)?.get(this) ?? -1;
      host.send({ type: 'broadcast', scope: this.#scope, name: this.#name, data, source, newest: lastId });
    }

    close(): void {
      if (this.#closed) return;
      this.#closed = true;
      const key = `${this.#scope}\n${this.#name}`;
      const channels = openChannels.get(key);
      channels?.delete(this);
      if (channels?.size === 0) {
        openChannels.delete(key);
        host.send({ type: 'channel', scope: this.#scope, name: this.#name, open: false });
      }
    }

    get [Symbol.toStringTag](): string {
      return 'BroadcastChannel';
    }
  }

  /**
   * A message from the host, in a task of its own, to the channels of the scope and name but the one that posted it;
   * of the content's own, only to the channels it had when it posted it, as in browsers
   */
  function receive(message: BroadcastMessage): void {
    const channels = openChannels.get(`${message.scope}\n${message.name}`);
    if (!channels) return;
    const destinations = [...channels.entries()].filter(([, id]) => id !== message.source && !(message.newest >= 0 && id > message.newest));
    // every copy is made before a listener can change what it got; the last one gets what came
    const copies = destinations.map((_, index) => (index < destinations.length - 1 ? structuredClone(message.data) : message.data));
    for (const [index, [channel]] of destinations.entries()) {
      // closed by a listener of a channel before it
      if (channels.has(channel)) channel.dispatchEvent(new MessageEvent('message', { data: copies[index] }));
    }
  }

  return { BroadcastChannel, receive };
}
