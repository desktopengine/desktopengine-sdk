// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// BroadcastChannel messages as the engine encodes them, so that a message is accepted, measured and copied here as it
// is in the app. A message is a tree of JSON values that the receiving content turns back into a copy, with the bytes
// of the ArrayBuffers, Blobs and ImageData in it alongside. A string, a boolean, a finite number other than -0 and null
// are themselves; anything else is an array, its kind first. Objects are numbered in the order they're met: ['r', n]
// is the n-th one again (shared objects and cycles). What can be sent is what the engine's structuredClone copies,
// without transferring: the browser's would take objects the engine refuses (an ImageBitmap) and refuse ones it takes
// (a Proxy). Its size, for the limits, is 2 bytes for each character of the tree's JSON text and the bytes alongside.

import {
  BlobClass, DOMExceptionClass, DOMExceptionPrototype, ErrorClass, ERRORS, FileClass, ImageDataClass, TYPED_ARRAYS, apply, arrayBufferByteLength,
  bigIntValueOf, blobSize, blobType, booleanValueOf, brand, call, copiedKeys, create, dataCloneError, dataViewByteLength, defineProperty,
  errorProperty, fileLastModified, fileName, getOwnPropertyDescriptor, getPrototypeOf, getTime, hasOwn, imageDataData, imageDataHeight,
  imageDataWidth, is, isArray, isArrayBuffer, isView, mapEntries, numberValueOf, ObjectPrototype, refuseEngineObject, refuseUncopiable,
  regExpFlags, regExpSource, setPrototypeOf, setSize, setValues, mapSize, sliceBuffer, stringValueOf, typedArrayByteLength, typedArrayName,
  type Constructor, type EngineObjectCheck,
} from './brands.ts';
import { isEngineConstructor } from './stand-ins.ts';

export type { EngineObjectCheck } from './brands.ts';

/** What travels alongside the tree: an ArrayBuffer, the pixels of an ImageData, or a Blob (which a frame can't read at once) */
export type MessageBytes = ArrayBuffer | ArrayBufferView | Blob;

export interface EncodedMessage {
  /** The tree's JSON text */
  tree: string;
  buffers: MessageBytes[];
}

// what the content may replace, taken before it runs (the rest in brands.ts)
const { isFinite } = Number;
const { stringify, parse } = JSON;

// MARK: - Encoding

/**
 * A node of the tree, or a list the messages go through here: an array without a prototype, its items defined (rest
 * parameters) or added by index rather than pushed. The content runs in this realm: what it put on Array.prototype
 * (setters for indexes, a toJSON) can't change what's in them or how JSON writes them, as in the engine.
 */
export const makeNode = (...items: unknown[]): unknown[] => setPrototypeOf(items, null) as unknown[];
export const append = (node: unknown[], item: unknown): void => {
  node[node.length] = item;
};

const encodeNumber = (value: number): unknown => (isFinite(value) && !is(value, -0) ? value : makeNode('n', is(value, -0) ? '-0' : String(value)));

/** The message as the engine sends it; throws a DataCloneError for what can't be sent */
export function encodeMessage(message: unknown, isEngineObject?: EngineObjectCheck): EncodedMessage {
  const memory = new Map<object, number>();
  // one for each node of the tree that has one
  const buffers = makeNode() as MessageBytes[];

  function encodeValue(value: unknown): unknown {
    switch (typeof value) {
      case 'string':
      case 'boolean':
        return value;
      case 'number':
        return encodeNumber(value);
      case 'undefined':
        return makeNode('u');
      case 'bigint':
        return makeNode('i', String(value));
      case 'symbol':
        throw dataCloneError(`${String(value)} can't be cloned`);
      case 'function':
        // the engine's constructors are objects there (see stand-ins.ts)
        if (!isEngineConstructor(value)) throw dataCloneError(`The function ${(value as { name?: unknown }).name || '(anonymous)'} can't be cloned`);
    }
    if (value === null) return null;
    const object = value as object;
    const seen = memory.get(object);
    if (seen !== undefined) return makeNode('r', seen);
    memory.set(object, memory.size);

    if (typeof object === 'function') return encodeProperties(object, makeNode('o'));
    // the engine's native objects are refused before anything else is asked of them (see clone.ts)
    refuseEngineObject(object, isEngineObject);
    const prototype = getPrototypeOf(object);
    if (prototype === ObjectPrototype || prototype === null) {
      return encodeProperties(object, makeNode('o'));
    }
    if (isArray(object)) {
      return encodeProperties(object, makeNode('a', object.length));
    }

    if (brand(booleanValueOf, object)) return makeNode('B', call(booleanValueOf, object));
    if (brand(numberValueOf, object)) return makeNode('N', encodeNumber(call(numberValueOf, object)));
    if (brand(bigIntValueOf, object)) return makeNode('I', String(call(bigIntValueOf, object)));
    if (brand(stringValueOf, object)) return makeNode('S', call(stringValueOf, object));

    if (brand(getTime, object)) return makeNode('D', encodeNumber(call(getTime, object)));
    if (brand(regExpSource, object)) return makeNode('R', call(regExpSource, object), call(regExpFlags, object));

    const addBuffer = (bytes: MessageBytes): number => {
      const index = buffers.length;
      append(buffers, bytes);
      return index;
    };
    if (isArrayBuffer(object)) {
      // the browser won't copy a detached buffer, the engine sends it empty
      return makeNode('ab', addBuffer(call<number>(arrayBufferByteLength, object) > 0 ? object : new ArrayBuffer(0)));
    }
    if (isView(object)) {
      const buffer = (object as ArrayBufferView).buffer;
      if (!isArrayBuffer(buffer)) throw dataCloneError('A view of a SharedArrayBuffer can\'t be cloned');
      const view = object as ArrayBufferView & { length?: number };
      if (brand(dataViewByteLength, object)) {
        return makeNode('v', 'DataView', encodeValue(buffer), view.byteOffset, view.byteLength);
      }
      return makeNode('v', call(typedArrayName, object), encodeValue(buffer), view.byteOffset, view.length);
    }

    if (brand(mapSize, object)) {
      const node = makeNode('M');
      for (const [key, item] of call<Iterable<[unknown, unknown]>>(mapEntries, object)) {
        append(node, encodeValue(key));
        append(node, encodeValue(item));
      }
      return node;
    }
    if (brand(setSize, object)) {
      const node = makeNode('T');
      for (const item of call<Iterable<unknown>>(setValues, object)) {
        append(node, encodeValue(item));
      }
      return node;
    }

    if (brand(blobSize, object)) {
      const type = call<string>(blobType, object);
      if (brand(fileName, object)) {
        return makeNode('f', addBuffer(object as Blob), type, call(fileName, object), call(fileLastModified, object));
      }
      return makeNode('b', addBuffer(object as Blob), type);
    }
    if (brand(imageDataWidth, object)) {
      return makeNode('d', addBuffer(call<Uint8ClampedArray>(imageDataData, object)), call(imageDataWidth, object), call(imageDataHeight, object));
    }

    if (object instanceof DOMExceptionClass) {
      return makeNode('x', String(errorProperty(object, 'message')), String(errorProperty(object, 'name')));
    }
    if (object instanceof ErrorClass) {
      // DOMException.prototype is an Error (the browser's name getter refuses it, the engine's has none)
      const errorName = (): string => (object === DOMExceptionPrototype ? errorProperty(object, 'name') : object.name) as string;
      const name = hasOwn(ERRORS, errorName()) ? errorName() : 'Error';
      const message = getOwnPropertyDescriptor(object, 'message');
      return makeNode('e', name, message && 'value' in message ? String(message.value) : null, typeof object.stack === 'string' ? object.stack : null);
    }

    refuseUncopiable(object, prototype, isEngineObject);

    // an instance of a class of the content's own: its own properties, in a plain object
    return encodeProperties(object, makeNode('o'));
  }

  /** The keys and values of the object's own properties, added to the node */
  function encodeProperties(object: object, node: unknown[]): unknown[] {
    for (const key of copiedKeys(object)) {
      append(node, key);
      append(node, encodeValue((object as Record<string, unknown>)[key]));
    }
    return node;
  }

  return { tree: stringify(encodeValue(message)), buffers };
}

/** The bytes the engine counts for a message: 2 for each character of the tree, and the bytes alongside */
export function messageSize(message: EncodedMessage): number {
  let size = message.tree.length * 2;
  // by index: the list has no prototype (see makeNode)
  for (let index = 0; index < message.buffers.length; index++) {
    const bytes = message.buffers[index];
    if (isArrayBuffer(bytes)) size += call<number>(arrayBufferByteLength, bytes);
    else if (brand(blobSize, bytes)) size += call<number>(blobSize, bytes);
    else size += call<number>(brand(dataViewByteLength, bytes) ? dataViewByteLength : typedArrayByteLength, bytes);
  }
  return size;
}

// MARK: - Decoding

const malformed = (): DOMException => dataCloneError('The message is malformed');
const isIndex = (index: unknown, length: number): index is number => Number.isInteger(index) && (index as number) >= 0 && (index as number) < length;

/** The bytes of an ArrayBuffer or a view, in an ArrayBuffer of their own */
function ownBuffer(bytes: unknown): ArrayBuffer {
  if (isArrayBuffer(bytes)) return bytes;
  if (isView(bytes)) {
    const view = bytes as ArrayBufferView;
    return apply(sliceBuffer, view.buffer, [view.byteOffset, view.byteOffset + view.byteLength]) as ArrayBuffer;
  }
  throw malformed();
}

/**
 * The tree's JSON text parsed, and checked to be a message; throws when it isn't one. Another frame of the content's
 * scope may send anything.
 */
export function parseMessage(data: unknown): { tree: unknown; buffers: unknown[] } {
  const message = data as Partial<EncodedMessage> | null;
  if (typeof message !== 'object' || message === null || typeof message.tree !== 'string' || !isArray(message.buffers)) {
    throw malformed();
  }
  return { tree: parse(message.tree), buffers: message.buffers };
}

/**
 * A copy of the message, `tree` parsed. `copies`: each ArrayBuffer is a copy, so the buffers can make more than one;
 * the last one takes them as they came. The sender may have made the tree some other way: what doesn't fit throws,
 * which makes a messageerror.
 */
export function decodeMessage(tree: unknown, buffers: unknown[], copies: boolean): unknown {
  // each buffer once, as encodeMessage gives it
  const taken = new Set<number>();
  const take = (index: unknown): unknown => {
    if (!isIndex(index, buffers.length) || taken.has(index)) throw malformed();
    taken.add(index);
    return buffers[index];
  };
  const buffer = (index: unknown): ArrayBuffer => {
    const bytes = take(index);
    if (bytes === undefined || bytes === null) return new ArrayBuffer(0);
    const own = ownBuffer(bytes);
    return copies && own === bytes ? (apply(sliceBuffer, own, [0]) as ArrayBuffer) : own;
  };
  /** A Blob's bytes: Blobs don't change, so the copies share them */
  const blobPart = (index: unknown): Blob | Uint8Array<ArrayBuffer> => {
    const bytes = take(index);
    if (brand(blobSize, bytes)) return bytes as Blob;
    return new Uint8Array(bytes === undefined || bytes === null ? new ArrayBuffer(0) : ownBuffer(bytes));
  };
  // the objects by number (see makeNode for why not [])
  const objects = makeNode();
  const decode = (node: unknown): unknown => {
    if (!isArray(node)) return node;
    switch (node[0]) {
      case 'n': return Number(node[1]);
      case 'u': return undefined;
      case 'i': return BigInt(node[1] as string);
      case 'r':
        // only an object met before
        if (!isIndex(node[1], objects.length)) throw malformed();
        return objects[node[1]];
      case 'a':
        if (!isIndex(node[1], 2 ** 32)) throw malformed();
        break;
    }
    // numbered before what's in it, as when it was encoded
    const index = objects.length;
    append(objects, undefined);
    const remember = <T>(object: T): T => (objects[index] = object);
    const properties = (object: object, start: number): object => {
      for (let i = start; i + 1 < node.length; i += 2) {
        // defined, not assigned: a "__proto__" key stays a property
        defineProperty(object, node[i] as PropertyKey, { value: decode(node[i + 1]), writable: true, enumerable: true, configurable: true });
      }
      return object;
    };
    switch (node[0]) {
      case 'o': return properties(remember({}), 1);
      case 'a': return properties(remember(new Array(node[1] as number)), 2);
      case 'B': return remember(Object(Boolean(node[1])));
      case 'N': return remember(Object(Number(decode(node[1]))));
      case 'I': return remember(Object(BigInt(node[1] as string)));
      case 'S': return remember(Object(String(node[1])));
      case 'D': return remember(new Date(decode(node[1]) as number));
      case 'R': return remember(new RegExp(node[1] as string, node[2] as string));
      case 'ab': return remember(buffer(node[1]));
      case 'v': {
        const bytes = decode(node[2]);
        const View = node[1] === 'DataView' ? (DataView as unknown as Constructor) : TYPED_ARRAYS[String(node[1])];
        if (!View) throw dataCloneError(`${String(node[1])} isn't supported`);
        if (!isArrayBuffer(bytes)) throw malformed();
        return remember(new (View as unknown as new (buffer: unknown, offset: unknown, length: unknown) => object)(bytes, node[3], node[4]));
      }
      case 'M': {
        const map = remember(new Map());
        for (let i = 1; i + 1 < node.length; i += 2) {
          map.set(decode(node[i]), decode(node[i + 1]));
        }
        return map;
      }
      case 'T': {
        const set = remember(new Set());
        for (let i = 1; i < node.length; i++) {
          set.add(decode(node[i]));
        }
        return set;
      }
      case 'b': return remember(new BlobClass([blobPart(node[1])], { type: String(node[2]) }));
      case 'f': return remember(new FileClass([blobPart(node[1])], String(node[3]), { type: String(node[2]), lastModified: node[4] as number }));
      case 'd': {
        if (!ImageDataClass) throw dataCloneError('ImageData isn\'t supported');
        return remember(new ImageDataClass(new Uint8ClampedArray(buffer(node[1])), node[2] as number, node[3] as number));
      }
      case 'x': return remember(new DOMExceptionClass(node[1] as string, node[2] as string));
      case 'e': {
        const name = String(node[1]);
        const copy = remember(create((hasOwn(ERRORS, name) ? ERRORS[name] : ErrorClass).prototype) as object);
        if (node[2] !== null) defineProperty(copy, 'message', { value: node[2], writable: true, configurable: true });
        if (node[3] !== null) defineProperty(copy, 'stack', { value: node[3], writable: true, configurable: true });
        return copy;
      }
    }
    throw dataCloneError(`Unknown kind of value ${String(node[0])}`);
  };
  return decode(tree);
}
