// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// structuredClone, MessageChannel and MessagePort as the engine has them, not the browser's: the same values copied
// the same way, the same ones refused with the same errors, transferring and delivering as the app does. The browser's
// would refuse what the engine copies (a Proxy, a boxed symbol), copy what it refuses (an ImageBitmap), move a
// transferred ArrayBuffer rather than copy it, and give a transferred port a new object on the other side.
//
// There is one thread: a MessageChannel's ports are both in the content, and a message is a copy delivered in a task
// of its own, a 0 ms timer of the content's (as in the app: in turn with its timers, and waiting while the content is
// paused, as they do; see scheduler.ts for why that isn't the browser's nested timers). Transferring an ArrayBuffer
// copies it and detaches the original where the browser has ArrayBuffer.prototype.transfer (the app doesn't detach one
// the engine has read, given to WebGL or a canvas, which JavaScriptCore keeps; here every one is); a transferred
// MessagePort is the same object. The events are the engine's MessageEvent (message-event.ts).

import {
  BlobClass, DataViewClass, DateClass, DOMExceptionClass, DOMExceptionPrototype, ErrorClass, ERRORS, FileClass, ImageDataClass, MapClass,
  RegExpClass, SetClass, apply, bigIntValueOf, booleanValueOf, brand, call, copiedKeys, create, dataCloneError, dataViewByteLength,
  defineProperty, detachedError, errorProperty, getOwnPropertyDescriptor, getPrototypeOf, getTime, hasOwn, imageDataWidth, isArray,
  isArrayBuffer, isView, mapEntries, mapGet, mapHas, mapSet, mapSize, numberValueOf, ObjectPrototype, push, realGlobal,
  refuseEngineObject, refuseUncopiable, regExpFlags, regExpSource, setAdd, setSize, setValues, sliceBuffer, stringValueOf,
  transferBuffer, typedArrayName, blobSize, type EngineObjectCheck, type ImageDataLike,
} from './brands.ts';
import { MessageEventClass } from './message-event.ts';
import { isEngineConstructor } from './stand-ins.ts';

export interface MessagingHost {
  /** The content's setTimeout: a port's messages come in tasks of its timers */
  setTimeout(callback: () => void, delay: number): unknown;
  /** The runtime's stand-ins for the engine's own objects besides the ones of stand-ins.ts, refused as the engine refuses its own */
  isEngineObject?: EngineObjectCheck;
}

export interface MessagePortLike extends EventTarget {
  onmessage: unknown;
  onmessageerror: unknown;
  postMessage(message: unknown, options?: unknown): void;
  start(): void;
  close(): void;
}

export interface Messaging {
  structuredClone(value: unknown, options?: unknown): unknown;
  MessageChannel: new () => { readonly port1: MessagePortLike; readonly port2: MessagePortLike };
  /** Made by MessageChannel only */
  MessagePort: abstract new () => MessagePortLike;
  /** The engine's (message-event.ts) */
  MessageEvent: typeof MessageEvent;
}

// what the content may replace, taken before it runs (the rest in brands.ts)
const EventTargetClass = EventTarget;
const { addEventListener: addListener } = EventTarget.prototype;
const { trunc } = Math;
const { now } = Date;
const { shift } = Array.prototype;

/** A message on its way to a port: the copy, and the ports transferred with it */
interface PortMessage {
  data: unknown;
  ports: MessagePortLike[];
}

/** The content's structuredClone, MessageChannel and MessagePort, with the MessageEvent their messages come in */
export function createMessaging(host: MessagingHost): Messaging {
  const schedule = host.setTimeout;
  const { isEngineObject } = host;

  // MARK: - structuredClone

  /** `transfer`: the ArrayBuffers and MessagePorts to move rather than copy */
  function transferList(transfer: unknown, source: unknown): unknown[] {
    if (transfer === undefined) return [];
    if (transfer === null || typeof transfer !== 'object' || typeof (transfer as Iterable<unknown>)[Symbol.iterator] !== 'function') {
      throw new TypeError('transfer must be an array');
    }
    const list = [...(transfer as Iterable<unknown>)];
    for (let index = 0; index < list.length; index++) {
      const item = list[index];
      if (!(item instanceof MessagePort) && !isArrayBuffer(item)) {
        throw dataCloneError('Only ArrayBuffers and MessagePorts can be transferred');
      }
      if (list.indexOf(item) !== index) {
        throw dataCloneError('An object is in the transfer list more than once');
      }
      if (item === source) {
        throw dataCloneError('A MessagePort can\'t be transferred through itself');
      }
    }
    return list;
  }

  /** `value.slice(0)` as the engine calls it, failing as the app's JavaScriptCore fails for a detached buffer */
  function copyBuffer(buffer: ArrayBuffer): unknown {
    const slice = (buffer as { slice?: unknown }).slice;
    if (slice === sliceBuffer) {
      const detached = detachedError(buffer);
      if (detached) throw detached;
    }
    return apply(slice as (start: number) => unknown, buffer, [0]);
  }

  function cloneValue(value: unknown, memory: Map<object, unknown>): unknown {
    if (typeof value === 'symbol') throw dataCloneError(`${String(value)} can't be cloned`);
    // the engine's constructors are objects there (see stand-ins.ts)
    if (typeof value === 'function' && !isEngineConstructor(value)) {
      throw dataCloneError(`The function ${(value as { name?: unknown }).name || '(anonymous)'} can't be cloned`);
    }
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (call<boolean>(mapHas, memory, value)) return call(mapGet, memory, value);

    const object = value as Record<string, unknown>;
    const remember = <T>(copy: T): T => {
      call(mapSet, memory, object, copy);
      return copy;
    };
    if (typeof object === 'function') return copyProperties(object, remember({}), memory);
    // the engine's native objects are refused before anything else is asked of them (a 2D context's stand-in is a
    // plain object, the engine's isn't)
    refuseEngineObject(object, isEngineObject);
    const prototype = getPrototypeOf(object);
    if (prototype === ObjectPrototype || prototype === null) {
      return copyProperties(object, remember({}), memory);
    }
    if (isArray(object)) {
      return copyProperties(object, remember(new Array((object as unknown as unknown[]).length)), memory);
    }

    // primitives in objects
    if (brand(booleanValueOf, object)) return remember(Object(call(booleanValueOf, object)));
    if (brand(numberValueOf, object)) return remember(Object(call(numberValueOf, object)));
    if (brand(bigIntValueOf, object)) return remember(Object(call(bigIntValueOf, object)));
    if (brand(stringValueOf, object)) return remember(Object(call(stringValueOf, object)));

    if (brand(getTime, object)) return remember(new DateClass(call<number>(getTime, object)));
    if (brand(regExpSource, object)) return remember(new RegExpClass(call<string>(regExpSource, object), call<string>(regExpFlags, object)));

    if (isArrayBuffer(object)) return remember(copyBuffer(object));
    if (isView(object)) {
      const view = object as unknown as ArrayBufferView & { length: number };
      if (!isArrayBuffer(view.buffer)) throw dataCloneError('A view of a SharedArrayBuffer can\'t be cloned');
      const buffer = cloneValue(view.buffer, memory);
      if (brand(dataViewByteLength, object)) {
        return remember(new DataViewClass(buffer as ArrayBuffer, view.byteOffset, view.byteLength));
      }
      // the content's global, as the engine looks it up
      const View = realGlobal[call<string>(typedArrayName, object)] as new (buffer: unknown, offset: number, length: number) => object;
      return remember(new View(buffer, view.byteOffset, view.length));
    }

    if (brand(mapSize, object)) {
      const copy = remember(new MapClass());
      for (const [key, item] of call<Iterable<[unknown, unknown]>>(mapEntries, object)) {
        call(mapSet, copy, cloneValue(key, memory), cloneValue(item, memory));
      }
      return copy;
    }
    if (brand(setSize, object)) {
      const copy = remember(new SetClass());
      for (const item of call<Iterable<unknown>>(setValues, object)) {
        call(setAdd, copy, cloneValue(item, memory));
      }
      return copy;
    }

    if (brand(blobSize, object)) {
      // what the object says, read and made into a type, a name and a time in the order the engine's Blob and File do it
      const normalizeType = (type: unknown): string => {
        const text = String(type ?? '');
        return /^[\x20-\x7E]*$/.test(text) ? text.toLowerCase() : '';
      };
      if (object instanceof FileClass) {
        const { name, type, lastModified } = { name: object.name, type: object.type, lastModified: object.lastModified };
        const fileType = normalizeType(type);
        const fileName = String(name);
        const time = lastModified === undefined ? now() : trunc(Number(lastModified)) || 0;
        return remember(new FileClass([object as unknown as Blob], fileName, { type: fileType, lastModified: time }));
      }
      // blobs never change: the copy shares the bytes
      return remember(new BlobClass([object as unknown as Blob], { type: normalizeType(object.type) }));
    }
    // the content's global, as the engine looks it up; the engine's `instanceof ImageData` checks the object's kind,
    // which the browser's ImageData's own getter does here
    const ImageData = realGlobal.ImageData as (new (data: Uint8ClampedArray, width: unknown, height: unknown) => ImageDataLike) | undefined;
    if (typeof ImageData === 'function' && (ImageData === ImageDataClass ? brand(imageDataWidth, object) : object instanceof ImageData)) {
      return remember(new ImageData(new Uint8ClampedArray(object.data as ArrayLike<number>), object.width, object.height));
    }

    if (object instanceof DOMExceptionClass) {
      return remember(new DOMExceptionClass(String(errorProperty(object, 'message')), String(errorProperty(object, 'name'))));
    }
    if (object instanceof ErrorClass) {
      // DOMException.prototype is an Error (the browser's name getter refuses it, the engine's has none)
      const errorName = (): unknown => (object === DOMExceptionPrototype ? errorProperty(object, 'name') : object.name);
      const name = hasOwn(ERRORS, errorName() as PropertyKey) ? (errorName() as string) : 'Error';
      const copy = remember(create(ERRORS[name].prototype) as object);
      const message = getOwnPropertyDescriptor(object, 'message');
      if (message && 'value' in message) {
        defineProperty(copy, 'message', { value: String(message.value), writable: true, configurable: true });
      }
      if (typeof object.stack === 'string') {
        defineProperty(copy, 'stack', { value: object.stack, writable: true, configurable: true });
      }
      return copy;
    }

    refuseUncopiable(object, prototype, isEngineObject);

    // an instance of a class of the content's own: its own properties, in a plain object
    return copyProperties(object, remember({}), memory);
  }

  function copyProperties(value: object, copy: object, memory: Map<object, unknown>): object {
    for (const key of copiedKeys(value)) {
      // defined, not assigned: a "__proto__" key stays a property
      defineProperty(copy, key, {
        value: cloneValue((value as Record<string, unknown>)[key], memory), writable: true, enumerable: true, configurable: true,
      });
    }
    return copy;
  }

  /**
   * A copy of the value, with the ports among the transferred objects; the transferred ArrayBuffers are detached once
   * the whole value is copied
   */
  function serialize(value: unknown, transfer: unknown, source?: MessagePort): PortMessage {
    const list = transferList(transfer, source);
    const memory = new MapClass<object, unknown>();
    const ports: MessagePort[] = [];
    for (const item of list) {
      if (item instanceof MessagePort) {
        call(mapSet, memory, item, item);
        call(push, ports, item);
      }
    }
    const copy = cloneValue(value, memory);
    for (const item of list) {
      if (isArrayBuffer(item) && typeof (item as { transfer?: unknown }).transfer === 'function') {
        // `item.transfer()`, read again as the engine reads it
        const transfer = (item as { transfer?: unknown }).transfer;
        if (transfer === transferBuffer) {
          const detached = detachedError(item);
          if (detached) throw detached;
        }
        apply(transfer as () => unknown, item, []);
      }
    }
    return { data: copy, ports };
  }

  function structuredClone(value: unknown, options: unknown = undefined): unknown {
    if (arguments.length < 1) {
      throw new TypeError('structuredClone: 1 argument required, but only 0 present');
    }
    if (options !== undefined && options !== null && typeof options !== 'object') {
      throw new TypeError('structuredClone: the options must be an object');
    }
    return serialize(value, (options as { transfer?: unknown } | null | undefined)?.transfer).data;
  }

  // MARK: - MessageChannel

  const kCreate = Symbol('create');
  const kEntangle = Symbol('entangle');
  const kEnqueue = Symbol('enqueue');

  class MessagePort extends EventTargetClass {
    #other: MessagePort | null = null;
    #queue: PortMessage[] = [];
    #started = false;
    #closed = false;
    #scheduled = false;
    #onmessage: unknown = null;
    declare onmessageerror: unknown;

    constructor(key: unknown) {
      if (key !== kCreate) {
        throw new TypeError('Illegal constructor');
      }
      super();
      this.onmessageerror = null;
      // The handlers are called first, as the engine's EventTarget calls them: `on<type>` as it is when the event comes
      // (the browser's EventTarget doesn't call them for a class of the content's realm). Added with the browser's
      // addEventListener as it was before the content ran, and for the capture phase, as WebKit calls a target's
      // capture listeners before the others.
      apply(addListener, this, ['message', (event: Event) => this.#handle('message', event), true]);
      apply(addListener, this, ['messageerror', (event: Event) => this.#handle('messageerror', event), true]);
    }

    #handle(type: string, event: Event): void {
      const handler: unknown = (this as unknown as Record<string, unknown>)[`on${type}`];
      if (typeof handler === 'function') apply(handler, this, [event]);
    }

    get onmessage(): unknown {
      return this.#onmessage;
    }

    // setting it starts the port, as in browsers (addEventListener doesn't)
    set onmessage(handler: unknown) {
      this.#onmessage = typeof handler === 'function' || (handler !== null && typeof handler === 'object') ? handler : null;
      this.start();
    }

    postMessage(message: unknown, options: unknown = undefined): void {
      if (arguments.length < 1) {
        throw new TypeError('postMessage: 1 argument required, but only 0 present');
      }
      let transfer: unknown;
      if (options !== undefined && options !== null && typeof options === 'object'
        && typeof (options as Iterable<unknown>)[Symbol.iterator] === 'function') {
        transfer = options;
      } else if (options !== undefined && options !== null) {
        if (typeof options !== 'object') {
          throw new TypeError('postMessage: the options must be an object or an array');
        }
        transfer = (options as { transfer?: unknown }).transfer;
      }
      const copy = serialize(message, transfer, this);
      if (this.#closed || !this.#other) return;
      this.#other[kEnqueue](copy);
    }

    start(): void {
      if (this.#started || this.#closed) return;
      this.#started = true;
      this.#schedule();
    }

    close(): void {
      if (this.#closed) return;
      this.#closed = true;
      this.#queue = [];
      if (this.#other) {
        this.#other[kEntangle](null);
        this.#other = null;
      }
    }

    [kEntangle](port: MessagePort | null): void {
      this.#other = port;
    }

    [kEnqueue](message: PortMessage): void {
      if (this.#closed) return;
      call(push, this.#queue, message);
      this.#schedule();
    }

    // one message per task
    #schedule(): void {
      if (!this.#started || this.#scheduled || this.#queue.length === 0) return;
      this.#scheduled = true;
      schedule(() => {
        this.#scheduled = false;
        if (this.#closed) return;
        const message = call<PortMessage | undefined>(shift, this.#queue);
        if (message) {
          // as the engine makes it, of the message
          this.dispatchEvent(new MessageEventClass('message', message as unknown as MessageEventInit));
        }
        this.#schedule();
      }, 0);
    }

    get [Symbol.toStringTag](): string {
      return 'MessagePort';
    }
  }

  class MessageChannel {
    #port1 = new MessagePort(kCreate);
    #port2 = new MessagePort(kCreate);

    constructor() {
      this.#port1[kEntangle](this.#port2);
      this.#port2[kEntangle](this.#port1);
    }

    get port1(): MessagePort {
      return this.#port1;
    }

    get port2(): MessagePort {
      return this.#port2;
    }

    get [Symbol.toStringTag](): string {
      return 'MessageChannel';
    }
  }

  // named as the engine's, whatever the bundler calls them (a refused port is "A MessagePort")
  for (const [value, name] of [[structuredClone, 'structuredClone'], [MessagePort, 'MessagePort'], [MessageChannel, 'MessageChannel']] as const) {
    defineProperty(value, 'name', { value: name, configurable: true });
  }

  return {
    structuredClone,
    MessageChannel,
    MessagePort: MessagePort as unknown as abstract new () => MessagePortLike,
    MessageEvent: MessageEventClass,
  };
}
