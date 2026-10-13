// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// How the engine's structuredClone and BroadcastChannel tell values apart, shared by the runtime's ports of them
// (clone.ts, messages.ts): what the content may replace, taken before it runs, the checks that a value is of a class
// (which a Proxy or an object of the class' prototype doesn't pass), and what can't be copied, refused with the
// engine's message.

import { contentGlobal, isEngineGlobal } from './realm.ts';
import { isStandIn } from './stand-ins.ts';

/** Whether an object is a stand-in for one of the engine's own besides the ones of stand-ins.ts (a test's) */
export type EngineObjectCheck = (value: object) => boolean;

export type Constructor = new (...args: never[]) => object;
export type ImageDataLike = { data: Uint8ClampedArray; width: number; height: number };

// MARK: - What the content may replace, taken before it runs

export const realGlobal = globalThis as unknown as Record<string, unknown>;
export const { getPrototypeOf, setPrototypeOf, keys, defineProperty, create, getOwnPropertyDescriptor, freeze, is } = Object;
const { getOwnPropertyNames } = Object;
const { ownKeys } = Reflect;
export const ObjectPrototype = Object.prototype;
const hasOwnProperty = Object.prototype.hasOwnProperty;
export const { apply } = Reflect;
export const { isArray } = Array;
export const { push } = Array.prototype;
export const { isView } = ArrayBuffer;
export const DOMExceptionClass = DOMException;
export const BlobClass = Blob;
export const FileClass = File;
export const ImageDataClass = realGlobal.ImageData as (new (data: Uint8ClampedArray, width: number, height: number) => ImageDataLike) | undefined;
export const PromiseClass = Promise;
export const ErrorClass = Error;
export const MapClass = Map;
export const SetClass = Set;
export const DateClass = Date;
export const RegExpClass = RegExp;
export const DataViewClass = DataView;

export const dataCloneError = (message: string): DOMException => new DOMExceptionClass(message, 'DataCloneError');
export const hasOwn = (object: object, key: PropertyKey): boolean => apply(hasOwnProperty, object, [key]) as boolean;

/** Calls a getter or method that throws a TypeError unless the value is of its class */
export function brand(method: unknown, value: unknown): boolean {
  if (typeof method !== 'function') return false;
  try {
    apply(method, value, []);
    return true;
  } catch {
    return false;
  }
}

const getter = (prototype: object | undefined, name: PropertyKey): unknown => (prototype ? getOwnPropertyDescriptor(prototype, name)?.get : undefined);
export const call = <T>(method: unknown, value: unknown, ...args: unknown[]): T => apply(method as (...args: unknown[]) => unknown, value, args) as T;
const TypedArrayPrototype = getPrototypeOf(Uint8Array.prototype) as object;
export const arrayBufferByteLength = getter(ArrayBuffer.prototype, 'byteLength');
const arrayBufferDetached = getter(ArrayBuffer.prototype, 'detached');
export const dataViewByteLength = getter(DataView.prototype, 'byteLength');
export const typedArrayName = getter(TypedArrayPrototype, Symbol.toStringTag);
export const typedArrayByteLength = getter(TypedArrayPrototype, 'byteLength');
export const mapSize = getter(Map.prototype, 'size');
export const setSize = getter(Set.prototype, 'size');
export const regExpSource = getter(RegExp.prototype, 'source');
export const regExpFlags = getter(RegExp.prototype, 'flags');
export const blobSize = getter(BlobClass.prototype, 'size');
export const blobType = getter(BlobClass.prototype, 'type');
export const fileName = getter(FileClass.prototype, 'name');
export const fileLastModified = getter(FileClass.prototype, 'lastModified');
export const imageDataWidth = getter(ImageDataClass?.prototype, 'width');
export const imageDataHeight = getter(ImageDataClass?.prototype, 'height');
export const imageDataData = getter(ImageDataClass?.prototype, 'data');
export const { valueOf: booleanValueOf } = Boolean.prototype;
export const { valueOf: numberValueOf } = Number.prototype;
export const { valueOf: bigIntValueOf } = BigInt.prototype;
export const { valueOf: stringValueOf } = String.prototype;
export const { getTime } = Date.prototype;
export const { entries: mapEntries, set: mapSet, get: mapGet, has: mapHas } = Map.prototype;
export const { values: setValues, add: setAdd, has: setHas } = Set.prototype;
const { has: weakMapHas } = WeakMap.prototype;
const { has: weakSetHas } = WeakSet.prototype;
const weakRefDeref = typeof WeakRef === 'function' ? WeakRef.prototype.deref : null;
export const { slice: sliceBuffer, transfer: transferBuffer } = ArrayBuffer.prototype as ArrayBuffer & { transfer?: () => ArrayBuffer };

export const isArrayBuffer = (value: unknown): value is ArrayBuffer => brand(arrayBufferByteLength, value);

/**
 * Whether an ArrayBuffer is detached, which the language's slice and transfer refuse with an error of their own: the
 * runtime throws the one the app's JavaScriptCore throws (a browser without `detached` can't detach either)
 */
export function detachedError(buffer: ArrayBuffer): TypeError | null {
  return typeof arrayBufferDetached === 'function' && call<boolean>(arrayBufferDetached, buffer) ? new TypeError('Receiver is detached') : null;
}

export const ERRORS: Record<string, ErrorConstructor> = { Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError };

export const TYPED_ARRAYS: Record<string, Constructor> = create(null) as Record<string, Constructor>;
for (const name of ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array']) {
  if (typeof realGlobal[name] === 'function') TYPED_ARRAYS[name] = realGlobal[name] as Constructor;
}

// MARK: - What can't be copied

/** The engine's classes that hold something other than data, as browsers' are: a clone would be an empty object */
const PLATFORM_CLASSES = [
  'EventTarget', 'Event', 'AbortController', 'Headers', 'Request', 'Response', 'URL', 'URLSearchParams', 'FormData',
  'TextEncoder', 'TextDecoder', 'TextEncoderStream', 'TextDecoderStream', 'ReadableStream', 'WritableStream',
  'TransformStream', 'ReadableStreamDefaultReader', 'ReadableStreamBYOBReader', 'WritableStreamDefaultWriter',
  'ReadableStreamDefaultController', 'ReadableByteStreamController', 'ReadableStreamBYOBRequest',
  'WritableStreamDefaultController', 'TransformStreamDefaultController', 'ByteLengthQueuingStrategy',
  'CountQueuingStrategy', 'Storage', 'BaseAudioContext', 'AudioNode', 'AudioParam', 'AudioBuffer', 'AudioListener',
  'PeriodicWave', 'MediaError', 'TimeRanges', 'Path2D', 'ImageBitmap',
];

/** The language's classes: their objects that aren't cloned as what they are go as plain objects, as in the engine */
const LANGUAGE_CLASSES = new Set([
  'Object', 'Function', 'Array', 'Number', 'Boolean', 'String', 'Symbol', 'BigInt', 'Date', 'Promise', 'RegExp', 'Error',
  'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError', 'SuppressedError',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'Iterator', 'DisposableStack', 'AsyncDisposableStack', ...keys(TYPED_ARRAYS),
  // the engine's is a class of its own, whose objects go as empty ones
  'MessageChannel',
]);

/**
 * The engine's classes of data, which it copies as what they are when they are (by brand: Blob, File, ImageData) or
 * are of the class (DOMException, an Error of its own): an object that only inherits one of their prototypes is
 * copied as a plain object or an Error, so the browser's prototypes of them don't make a platform object.
 */
const DATA_CLASSES = new Set(['Blob', 'File', 'ImageData', 'DOMException']);

/**
 * The engine's classes whose prototypes have enumerable members, which a clone of the prototype reads: the streams'
 * (the polyfill's in the engine; the browser's throw too). MediaError's are its constants (MEDIA_ERROR_CONSTANTS).
 */
const ENUMERABLE_MEMBERS = new Set([
  'ReadableStream', 'WritableStream', 'TransformStream', 'ReadableStreamDefaultReader', 'ReadableStreamBYOBReader',
  'WritableStreamDefaultWriter', 'ReadableStreamDefaultController', 'ReadableByteStreamController',
  'ReadableStreamBYOBRequest', 'WritableStreamDefaultController', 'TransformStreamDefaultController',
  'ByteLengthQueuingStrategy', 'CountQueuingStrategy',
]);

/**
 * The prototypes of the browser's classes as the frame has them before the content runs, with their classes' names.
 * The engine's native objects (a WebGL texture, a canvas' context) can't be sent; here some are the browser's.
 */
const interfacePrototypes = new MapClass<object, string>();
for (const name of getOwnPropertyNames(realGlobal)) {
  if (LANGUAGE_CLASSES.has(name)) continue;
  const descriptor = getOwnPropertyDescriptor(realGlobal, name);
  const value: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  const prototype: unknown = typeof value === 'function' ? (value as { prototype?: unknown }).prototype : undefined;
  if (typeof prototype !== 'object' || prototype === null || prototype === ObjectPrototype) continue;
  // the class' own name (Audio's prototype is HTMLAudioElement's)
  const constructor: unknown = getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  call(mapSet, interfacePrototypes, prototype, typeof constructor === 'function' ? (constructor as { name: string }).name : name);
}
const interfaceName = (prototype: object): string | undefined => call(mapGet, interfacePrototypes, prototype);

/** A browser's prototype that makes a platform object of what's of its class */
const isPlatformPrototype = (prototype: object): boolean => {
  const name = interfaceName(prototype);
  return name !== undefined && !call<boolean>(setHas, DATA_CLASSES, name);
};

/**
 * The getter that tells an object of a browser's class from one that only inherits its prototype: one of the
 * prototype's own that refuses an object made from the prototype. Null when there's none (a WebGL texture has no
 * members): every object of the prototype is taken for one of the class.
 */
const brandGetters = new MapClass<object, unknown>();
function brandGetter(prototype: object): unknown {
  if (call<boolean>(mapHas, brandGetters, prototype)) return call(mapGet, brandGetters, prototype);
  let found: unknown = null;
  const names = ownKeys(prototype);
  for (let index = 0; index < names.length && found === null; index++) {
    const get = getOwnPropertyDescriptor(prototype, names[index])?.get;
    if (typeof get === 'function' && !brand(get, create(prototype))) found = get;
  }
  call(mapSet, brandGetters, prototype, found);
  return found;
}

/** The engine's globals whose objects are native ones all the same (see platformName) */
const NATIVE_GLOBAL_CLASSES = new Set(['ImageBitmap', 'Path2D']);
const ImageBitmapClass = realGlobal.ImageBitmap;
const imageBitmapWidth = getter((ImageBitmapClass as { prototype?: object } | undefined)?.prototype, 'width');

/**
 * `value instanceof constructor` as the engine's isPlatformObject has it: the engine's ImageBitmap is native, its
 * `instanceof` checks the object's kind (the runtime's Path2D does the same), so a Proxy or an object of its prototype
 * isn't one
 */
const isInstance = (value: object, constructor: unknown): boolean => (constructor === ImageBitmapClass
  ? brand(imageBitmapWidth, value) : value instanceof (constructor as Constructor));

/** The name the engine gives a refused object: its constructor's (read once, as the engine reads it) */
const constructorName = (value: object): unknown => (value as { constructor?: { name?: unknown } }).constructor?.name;

/**
 * The name the engine gives a refused platform object: its constructor's. The engine's native objects (its binding
 * objects) have no constructor of their own but for the WebGL contexts, so they're "Object": here those are the
 * browser's objects of classes the engine has no global for, or has as native ones.
 */
function platformName(value: object, prototype: object | null): unknown {
  const name = constructorName(value);
  for (let holder = prototype; holder !== null; holder = getPrototypeOf(holder)) {
    const className = interfaceName(holder);
    if (className === undefined) continue;
    return isEngineGlobal(className) && !call<boolean>(setHas, NATIVE_GLOBAL_CLASSES, className) ? name : 'Object';
  }
  return name;
}

const refusalOf = (name: unknown): DOMException => dataCloneError(`${typeof name === 'string' && name ? `A ${name}` : 'The object'} can't be cloned`);

/**
 * Throws what the engine throws for one of its native objects (here a stand-in, see stand-ins.ts, or what
 * `isEngineObject` takes for one): "A Object can't be cloned", unless the object has a constructor of its own
 */
export function refuseEngineObject(value: object, isEngineObject: EngineObjectCheck | undefined): void {
  if (!isStandIn(value) && !isEngineObject?.(value)) return;
  const name = constructorName(value);
  throw refusalOf(getOwnPropertyDescriptor(value, 'constructor') ? name : 'Object');
}

/**
 * Throws what the engine throws for an object that is none of the ones it copies as what they are (checked before): a
 * promise, a WeakMap, WeakSet or WeakRef, or a platform object. An instance of a class of the content's own passes, as
 * does an object made from an engine object (`Object.create(DesktopEngine.system)`): the engine's are native, the
 * classes of none of the ones above. `prototype` is the object's, read before (a Proxy's trap isn't called again).
 */
export function refuseUncopiable(value: object, prototype: object | null, isEngineObject: EngineObjectCheck | undefined): void {
  // the realm's Promise answers for every promise, async functions' too
  if (value instanceof PromiseClass || brand(weakMapHas, value) || brand(weakSetHas, value) || (weakRefDeref && brand(weakRefDeref, value))) {
    throw refusalOf(constructorName(value));
  }
  if (value === realGlobal || value === contentGlobal || value === realGlobal.crypto) throw refusalOf(platformName(value, prototype));
  refuseEngineObject(value, isEngineObject);
  for (let holder = prototype; holder !== null; holder = getPrototypeOf(holder)) {
    if (isStandIn(holder)) return;
  }
  for (const name of PLATFORM_CLASSES) {
    const constructor = realGlobal[name];
    if (typeof constructor === 'function' && isInstance(value, constructor)) throw refusalOf(platformName(value, prototype));
  }
  for (let holder = prototype; holder !== null; holder = getPrototypeOf(holder)) {
    if (!isPlatformPrototype(holder)) continue;
    const get = brandGetter(holder);
    if (get === null || brand(get, value)) throw refusalOf(platformName(value, prototype));
  }
}

/** The constants the engine's MediaError has on its prototype, enumerable (WebKit's has one more) */
const MEDIA_ERROR_CONSTANTS = new Set(['MEDIA_ERR_ABORTED', 'MEDIA_ERR_NETWORK', 'MEDIA_ERR_DECODE', 'MEDIA_ERR_SRC_NOT_SUPPORTED']);
const ImageDataPrototype: object | undefined = ImageDataClass?.prototype;

/**
 * Whether an own property is a browser's ImageData's pixels (browsers make them an own property, which a clone of a
 * Proxy of one would read; the engine's are native): a Uint8ClampedArray that can't be assigned, of an object of the
 * ImageData prototype
 */
function isPixels(value: object, key: string): boolean {
  const descriptor = getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor) || descriptor.writable || !isView(descriptor.value)
    || call(typedArrayName, descriptor.value) !== 'Uint8ClampedArray') return false;
  for (let holder = getPrototypeOf(value); holder !== null; holder = getPrototypeOf(holder)) {
    if (holder === ImageDataPrototype) return true;
  }
  return false;
}

/**
 * The keys of an object's own enumerable properties, which the engine copies, but of a browser class' prototype, only
 * the ones the content added: the engine's classes have the members on their prototypes not enumerable (but for
 * ENUMERABLE_MEMBERS), the browser's attributes, operations and constants are
 */
export function copiedKeys(value: object): string[] {
  const all = keys(value);
  const className = interfaceName(value);
  if (className === undefined || call<boolean>(setHas, ENUMERABLE_MEMBERS, className)) {
    // what's of the ImageData prototype without being an ImageData (a Proxy of one) has no pixels in the engine
    for (let index = 0; index < all.length; index++) {
      if (all[index] === 'data' && isPixels(value, 'data')) {
        const copied: string[] = [];
        for (let other = 0; other < all.length; other++) if (other !== index) call(push, copied, all[other]);
        return copied;
      }
    }
    return all;
  }
  const copied: string[] = [];
  for (let index = 0; index < all.length; index++) {
    const descriptor = getOwnPropertyDescriptor(value, all[index]);
    // what a content's assignment makes is writable and configurable, a constant is neither
    if (descriptor && 'value' in descriptor && typeof descriptor.value !== 'function'
      && (className === 'MediaError' ? call<boolean>(setHas, MEDIA_ERROR_CONSTANTS, all[index]) : descriptor.writable || descriptor.configurable)) {
      call(push, copied, all[index]);
    }
  }
  return copied;
}

// MARK: - DOMException

export const DOMExceptionPrototype = DOMExceptionClass.prototype as object;
const domExceptionName = getter(DOMExceptionPrototype, 'name');
const domExceptionMessage = getter(DOMExceptionPrototype, 'message');

/**
 * `value[key]` as the engine reads a DOMException's message or name, or an Error's name: the engine's DOMException has
 * them as the object's own properties and its prototype has neither, the browser's has them in internal slots, read by
 * getters of its prototype that refuse anything else
 */
export function errorProperty(value: object, key: 'message' | 'name'): unknown {
  if (brand(domExceptionName, value) && !getOwnPropertyDescriptor(value, key)) {
    return call(key === 'name' ? domExceptionName : domExceptionMessage, value);
  }
  for (let holder: object | null = value; holder !== null; holder = getPrototypeOf(holder)) {
    if (holder === DOMExceptionPrototype) continue;
    const descriptor = getOwnPropertyDescriptor(holder, key);
    if (descriptor) return descriptor.get ? apply(descriptor.get, value, []) : descriptor.value;
  }
  return undefined;
}
