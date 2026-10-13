// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// What content sees of structuredClone, MessageChannel and MessagePort, as a report: the web runtime's has to be the
// app's (structured-clone-app.json, recorded by running this as a content's code in the app). It runs as a content's
// code, in the app, in a frame of the web runtime, and in node with the web runtime's functions (web-clone.test.ts).
// `runCorpus(done, options)` calls `done` with the report, a JSON value. What the place it runs in doesn't have (the
// DesktopEngine global, ImageData, SharedArrayBuffer) is reported as "unavailable"; `options.throwingListeners` adds
// listeners that throw, which node would take for uncaught exceptions.

// eslint-disable-next-line no-unused-vars
function runCorpus(done, options) {
  'use strict';

  const UNAVAILABLE = 'unavailable';
  const report = { clone: {}, transfer: {}, ports: {}, later: {}, delivery: [] };
  const has = (name) => typeof globalThis[name] === 'function';

  // MARK: Describing values

  /** The objects a description names instead of describing them: the originals, to tell a copy from them */
  const known = new Map();
  const PROTOTYPES = new Map();
  for (const name of ['Object', 'Array', 'Map', 'Set', 'Date', 'RegExp', 'Boolean', 'Number', 'String', 'BigInt', 'Symbol',
    'ArrayBuffer', 'DataView', 'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
    'AggregateError', 'DOMException', 'Blob', 'File', 'ImageData', 'MessagePort', 'MessageChannel', 'Promise', 'Int8Array',
    'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array',
    'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array']) {
    if (has(name)) PROTOTYPES.set(globalThis[name].prototype, name);
  }
  const prototypeOf = (value) => {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null) return 'null';
    return PROTOTYPES.get(prototype) ?? `other ${Object.prototype.toString.call(prototype)}`;
  };
  const flags = (descriptor) => `${descriptor.writable ? 'w' : '-'}${descriptor.enumerable ? 'e' : '-'}${descriptor.configurable ? 'c' : '-'}`;
  const isIndex = (key) => String(Number(key)) === key && Number(key) >= 0;
  const bytes = (view) => Array.from(new Uint8Array(view.buffer ?? view, view.byteOffset ?? 0, view.byteLength));

  function describe(value, seen = new Map()) {
    switch (typeof value) {
      case 'undefined': return 'undefined';
      case 'boolean': return `boolean ${value}`;
      case 'number': return `number ${Object.is(value, -0) ? '-0' : String(value)}`;
      case 'bigint': return `bigint ${String(value)}`;
      case 'string': return `string ${JSON.stringify(value)}`;
      case 'symbol': return `symbol ${String(value)}`;
      case 'function': return `function ${value.name}`;
    }
    if (value === null) return 'null';
    if (known.has(value)) return `known ${known.get(value)}`;
    if (seen.has(value)) return `seen ${seen.get(value)}`;
    seen.set(value, seen.size);
    const node = { proto: prototypeOf(value), tag: Object.prototype.toString.call(value) };
    // what the language and platform classes hold; their own properties are the platform's own business
    let ownProperties = true;
    let indexes = true;
    if (value instanceof ArrayBuffer) {
      node.buffer = [value.byteLength, bytes(value), value.resizable === true];
      indexes = false;
    } else if (ArrayBuffer.isView(value)) {
      node.view = [value.byteOffset, value.byteLength, value.length ?? null, describe(value.buffer, seen)];
      indexes = false;
    } else if (value instanceof Map) {
      node.entries = Array.from(value, ([key, item]) => [describe(key, seen), describe(item, seen)]);
    } else if (value instanceof Set) {
      node.values = Array.from(value, (item) => describe(item, seen));
    } else if (value instanceof Date) {
      node.time = String(value.getTime());
    } else if (value instanceof RegExp) {
      node.regExp = [value.source, value.flags];
    } else if (typeof DOMException === 'function' && value instanceof DOMException) {
      // the app's DOMException is an Error of its own, without a tag
      delete node.tag;
      node.exception = [value.name, value.message, value.code];
      ownProperties = false;
    } else if (has('File') && value instanceof File) {
      node.file = [value.size, value.type, value.name, value.lastModified];
      ownProperties = false;
    } else if (has('Blob') && value instanceof Blob) {
      node.blob = [value.size, value.type];
      ownProperties = false;
    } else if (has('ImageData') && value instanceof ImageData) {
      // the app's are objects of its own, whose prototype isn't ImageData.prototype
      node.proto = 'ImageData';
      node.imageData = [value.width, value.height, Array.from(value.data)];
      ownProperties = false;
    } else if (value instanceof Error) {
      node.error = [value.name, value.message];
    }
    for (const [name, valueOf] of [['Boolean', Boolean.prototype.valueOf], ['Number', Number.prototype.valueOf], ['String', String.prototype.valueOf], ['BigInt', BigInt.prototype.valueOf]]) {
      try {
        node.primitive = `${name} ${describe(valueOf.call(value))}`;
        break;
      } catch {
        // not of this class
      }
    }
    if (ownProperties) {
      node.own = Reflect.ownKeys(value).filter((key) => !(indexes === false && isIndex(key))).map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        let described = 'accessor';
        if ('value' in descriptor) described = key === 'stack' && typeof descriptor.value === 'string' ? 'a stack' : describe(descriptor.value, seen);
        return [typeof key === 'symbol' ? String(key) : key, described, flags(descriptor)];
      });
    }
    return node;
  }

  const MARKER = { marker: true };
  function errorOf(error) {
    if (error === MARKER) return 'the marker';
    if (error === null || typeof error !== 'object') return `thrown ${describe(error)}`;
    const isException = typeof DOMException === 'function' && error instanceof DOMException;
    return [error.constructor?.name, error.name, error.message, isException ? error.code : null];
  }

  /** The copy of what `make` gives, or what it threw; `options` makes the options for it, `after` describes it afterwards */
  function clone(section, label, make, options, after) {
    let value;
    try {
      value = make();
    } catch (error) {
      section[label] = { setup: errorOf(error) };
      return;
    }
    if (value === UNAVAILABLE) {
      section[label] = UNAVAILABLE;
      return;
    }
    const result = {};
    try {
      const copy = options === undefined ? structuredClone(value) : structuredClone(value, options(value));
      result.copy = describe(copy);
      result.same = copy === value;
    } catch (error) {
      result.throws = errorOf(error);
    }
    if (after) result.after = after(value);
    section[label] = result;
  }

  const sharedBuffers = typeof SharedArrayBuffer === 'function';
  const imageData = has('ImageData');
  const engine = typeof DesktopEngine === 'object' && DesktopEngine !== null;
  const gl = engine ? new DesktopEngine.Canvas().getContext('webgl') : null;

  // MARK: What's copied

  /** A Proxy of an object of a class, which the class' getter doesn't take for one (node's Blob does) */
  const notTakenForOne = (proxy, Class, name) => {
    try {
      Object.getOwnPropertyDescriptor(Class.prototype, name).get.call(proxy);
      return UNAVAILABLE;
    } catch {
      return proxy;
    }
  };

  const accepted = {
    undefined: () => undefined,
    null: () => null,
    numbers: () => [0, -0, NaN, Infinity, -Infinity, 1.5, 2 ** 53, Number.MIN_VALUE],
    strings: () => ['', 'text', 'a\n"\u0001\ud800', '\u{1F600}'],
    booleans: () => [true, false],
    bigints: () => [0n, -10n, 2n ** 80n],
    'a plain object': () => ({ a: 1, b: 'x', nested: { c: [1, 2], d: null }, u: undefined }),
    'an object without a prototype': () => Object.assign(Object.create(null), { a: 1, b: { c: 2 } }),
    'key order': () => ({ b: 1, 2: 'two', a: 2, 1: 'one', [-1]: 'minus', '01': 'zero one' }),
    'non-enumerable and symbol keys': () => Object.defineProperties({ [Symbol('s')]: 1, seen: 1 }, { hidden: { value: 2, enumerable: false } }),
    'a frozen object': () => Object.freeze({ a: Object.freeze([1]) }),
    'a cycle': () => {
      const value = { name: 'root', list: [] };
      value.self = value;
      value.list.push(value, value.list);
      return value;
    },
    'shared references': () => {
      const shared = { k: 1 };
      return { one: shared, two: shared, list: [shared, [shared]], map: new Map([[shared, shared]]) };
    },
    'a sparse array': () => Object.assign([1, , 3, , ], { extra: 'x', '-1': 'minus' }),
    'a long empty array': () => {
      const array = [];
      array.length = 5;
      return array;
    },
    'an array subclass': () => {
      class List extends Array {}
      return List.from([1, 2]);
    },
    'an array-like object': () => Object.create(Array.prototype, { 0: { value: 'a', enumerable: true }, length: { value: 1, enumerable: true } }),
    '__proto__ keys': () => JSON.parse('{"__proto__": {"x": 1}, "list": [{"__proto__": null}]}'),
    'a defined __proto__ key': () => Object.defineProperty({}, '__proto__', { value: 5, enumerable: true, writable: true, configurable: true }),
    'boxed primitives': () => [Object(1), Object(-0), Object(NaN), Object('ab'), Object(true), Object(false), Object(10n), Object(Symbol('boxed'))],
    'a boxed string with an extra property': () => Object.assign(Object('hi'), { extra: 1 }),
    dates: () => [new Date(5), new Date(NaN), new Date(-8.64e15)],
    'a date with extra properties': () => Object.assign(new Date(0), { extra: 1 }),
    'a date subclass': () => {
      class Day extends Date {}
      return new Day(86400000);
    },
    'regular expressions': () => [/a+b/gi, new RegExp('x', 'dgimsuy'), new RegExp(''), /\//],
    'a regular expression with a lastIndex': () => {
      const value = /a/g;
      value.lastIndex = 3;
      value.extra = 1;
      return value;
    },
    'an ArrayBuffer': () => new Uint8Array([1, 2, 3]).buffer,
    'an empty ArrayBuffer': () => new ArrayBuffer(0),
    'a resizable ArrayBuffer': () => {
      const buffer = new ArrayBuffer(2, { maxByteLength: 8 });
      return buffer.resizable === true ? buffer : UNAVAILABLE;
    },
    'views sharing a buffer': () => {
      const buffer = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]).buffer;
      return { bytes: new Uint8Array(buffer, 2, 4), floats: new Float32Array(buffer), view: new DataView(buffer, 1, 3), buffer, again: new Uint8Array(buffer, 2, 4) };
    },
    'every kind of typed array': () => ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
      'Float32Array', 'Float64Array'].map((name) => new globalThis[name]([1, 2])).concat([new BigInt64Array([1n]), new BigUint64Array([2n])]),
    'a Float16Array': () => (has('Float16Array') ? new Float16Array([1.5]) : UNAVAILABLE),
    'a typed array with an extra property': () => Object.assign(new Uint8Array(2), { extra: 'x' }),
    'a typed array subclass': () => {
      class Bytes extends Uint8Array {}
      return new Bytes([9]);
    },
    'a length-tracking view': () => {
      const buffer = new ArrayBuffer(2, { maxByteLength: 8 });
      return buffer.resizable === true ? new Uint8Array(buffer) : UNAVAILABLE;
    },
    'a DataView with an offset': () => new DataView(new ArrayBuffer(6), 2),
    'a Map': () => new Map([[1, 'one'], ['k', [2]], [{ key: true }, new Set([3])], [NaN, -0]]),
    'a Set': () => new Set(['x', 3, { y: 1 }, -0]),
    'a Map in itself': () => {
      const map = new Map();
      map.set(map, map);
      return map;
    },
    'a Map with extra properties': () => Object.assign(new Map([[1, 2]]), { extra: 1 }),
    'a Map subclass': () => {
      class Registry extends Map {}
      return new Registry([['a', 1]]);
    },
    errors: () => [new Error('plain'), new EvalError('eval'), new RangeError('range'), new ReferenceError('reference'),
      new SyntaxError('syntax'), new TypeError('type'), new URIError('uri')],
    'an AggregateError': () => (typeof AggregateError === 'function' ? new AggregateError([new Error('inner')], 'many') : UNAVAILABLE),
    'an error subclass': () => {
      class AppError extends Error {}
      return new AppError('app');
    },
    'an error subclass with a name': () => {
      class AppError extends TypeError {
        constructor(message) {
          super(message);
          this.name = 'AppError';
        }
      }
      return new AppError('named');
    },
    'an error named as another kind': () => Object.assign(new Error('renamed'), { name: 'RangeError' }),
    'an error with a custom name': () => Object.assign(new Error('custom'), { name: 'Custom' }),
    'an error named on its prototype': () => {
      const error = new Error('inherited');
      Object.setPrototypeOf(error, Object.create(Error.prototype, { name: { value: 'URIError' } }));
      return error;
    },
    'an error without a message': () => new TypeError(),
    'an error with a message getter': () => Object.defineProperty(new Error(), 'message', { get: () => 'got', enumerable: false, configurable: true }),
    'an error with a number message': () => Object.assign(new Error(), { message: 42 }),
    'an error with extra properties': () => Object.assign(new Error('extra'), { code: 1, cause: 'why' }),
    'an error with a cause': () => new Error('caused', { cause: new Error('cause') }),
    'an error whose stack isn\'t a string': () => Object.defineProperty(new Error('stack'), 'stack', { value: 5, configurable: true, writable: true }),
    'an error made from the prototype': () => Object.create(Error.prototype),
    'DOMExceptions': () => [new DOMException('gone', 'NotFoundError'), new DOMException(), new DOMException('custom', 'Custom'), new DOMException('clone', 'DataCloneError')],
    'a Blob': () => new Blob(['hello'], { type: 'Text/Plain' }),
    'a Blob with an unusual type': () => new Blob(['x'], { type: 'aéb' }),
    'a File': () => new File(['yo'], 'a.txt', { type: 'text/plain', lastModified: 5 }),
    'a File with a fractional time': () => new File([], 'b', { lastModified: 7.9 }),
    'a Blob subclass': () => {
      class Note extends Blob {}
      return new Note(['n']);
    },
    'a Blob whose type is overridden': () => {
      class Typed extends Blob {
        get type() {
          return 'Overridden/Type';
        }
      }
      return new Typed(['t']);
    },
    'a File whose name and time are overridden': () => {
      class Named extends File {
        get name() {
          return 7;
        }
        get lastModified() {
          return '12.5';
        }
      }
      return new Named(['n'], 'real.txt', { lastModified: 3 });
    },
    'a Blob with extra properties': () => Object.assign(new Blob(['e']), { extra: 1 }),
    'an ImageData': () => (imageData ? new ImageData(new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]), 2, 1) : UNAVAILABLE),
    'an empty ImageData': () => (imageData ? new ImageData(1, 1) : UNAVAILABLE),
    'class instances': () => {
      class Point {
        #secret = 1;
        static count = 0;
        constructor() {
          this.x = 1;
          this.y = 2;
        }
        get sum() {
          return this.x + this.y + this.#secret;
        }
      }
      return [new Point(), Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true } })];
    },
    'own getters': () => {
      let reads = 0;
      const value = { get counted() { reads += 1; return reads; }, plain: 1 };
      return Object.defineProperty(value, 'hidden', { get: () => 'no', enumerable: false });
    },
    'a getter that adds properties': () => {
      const value = { first: 1 };
      Object.defineProperty(value, 'adds', { enumerable: true, get() { value.later = 'added'; return 2; } });
      value.last = 3;
      return value;
    },
    'a getter that deletes properties': () => {
      const value = {};
      Object.defineProperty(value, 'deletes', { enumerable: true, configurable: true, get() { delete value.gone; return 1; } });
      value.gone = 'gone';
      return value;
    },
    proxies: () => [new Proxy({ a: 1 }, {}), new Proxy([1, 2], {}), new Proxy(new Map([[1, 2]]), {})],
    'a proxy whose traps are seen': () => {
      const seenTraps = [];
      const proxy = new Proxy({ a: 1, b: { c: 2 } }, {
        getPrototypeOf(target) { seenTraps.push('getPrototypeOf'); return Reflect.getPrototypeOf(target); },
        ownKeys(target) { seenTraps.push('ownKeys'); return Reflect.ownKeys(target); },
        getOwnPropertyDescriptor(target, key) { seenTraps.push(`descriptor ${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
        get(target, key, receiver) { seenTraps.push(`get ${String(key)}`); return Reflect.get(target, key, receiver); },
      });
      known.set(seenTraps, 'traps');
      return { proxy, seenTraps };
    },
    'the arguments object': () => (function () { return arguments; })(1, 'two'),
    'iterators and generators': () => [[1].values(), new Map().entries(), (function* () { yield 1; })()],
    'the language\'s namespaces': () => [Math, JSON, Reflect, Intl],
    'Intl objects': () => [new Intl.NumberFormat('en'), new Intl.DateTimeFormat('en')],
    'a FinalizationRegistry': () => new FinalizationRegistry(() => {}),
    'a bare SharedArrayBuffer': () => (sharedBuffers ? new SharedArrayBuffer(4) : UNAVAILABLE),
    'a MessageChannel': () => new MessageChannel(),
    'an object of a prototype without a prototype': () => Object.create(Object.create(null, { inherited: { value: 1, enumerable: true } }), { own: { value: 2, enumerable: true } }),
    'a deep object': () => {
      let value = { leaf: true };
      for (let index = 0; index < 40; index++) value = { child: value };
      return value;
    },
    'the navigator': () => (typeof navigator === 'object' ? navigator : UNAVAILABLE),
    // what only inherits a class of data, or wraps one: copied as an object of its own properties, not refused
    'an object made from the Blob prototype': () => Object.create(Blob.prototype),
    'a proxy of a Blob': () => notTakenForOne(new Proxy(new Blob(['x']), {}), Blob, 'size'),
    'an object made from the File prototype': () => Object.create(File.prototype),
    'a proxy of a File': () => notTakenForOne(new Proxy(new File(['x'], 'f.txt'), {}), File, 'name'),
    'one inside an object': () => ({ inner: Object.create(Blob.prototype), n: 1 }),
    'an object of a function made to inherit Blob': () => {
      function Fake() {
        this.z = 3;
      }
      Fake.prototype = Object.create(Blob.prototype);
      return new Fake();
    },
    'an object made from the ImageData prototype': () => (imageData ? Object.create(ImageData.prototype) : UNAVAILABLE),
    'a proxy of an ImageData': () => (imageData ? new Proxy(new ImageData(1, 1), {}) : UNAVAILABLE),
    'an object made from the DOMException prototype': () => Object.create(DOMException.prototype),
    'an error of the DOMException prototype': () => Object.setPrototypeOf(new Error('err'), DOMException.prototype),
    'a DOMException subclass with a name getter': () => {
      class Overridden extends DOMException {
        get name() {
          return 'Overridden';
        }
      }
      return new Overridden('sub', 'AbortError');
    },
    'a DOMException with a name of its own': () => Object.defineProperty(new DOMException('own', 'NotFoundError'), 'name', { value: 'Own', configurable: true }),
    // what a class says of itself isn't what it is
    'a class tagged as a gradient': () => {
      class Tagged {
        constructor() {
          this.stop = 1;
        }
        get [Symbol.toStringTag]() {
          return 'CanvasGradient';
        }
      }
      return new Tagged();
    },
    'a class field tagged as a pattern': () => {
      class Tagged {
        a = 1;
        [Symbol.toStringTag] = 'CanvasPattern';
      }
      return { inner: new Tagged() };
    },
    'a class whose tag getter throws': () => {
      class Tagged {
        constructor() {
          this.v = 1;
        }
        get [Symbol.toStringTag]() {
          throw MARKER;
        }
      }
      return new Tagged();
    },
    'a strict proxy of a class instance': () => {
      class Point {
        constructor() {
          this.x = 1;
          this.y = 2;
        }
      }
      return new Proxy(new Point(), {
        get(target, key) {
          if (!(key in target)) throw MARKER;
          return target[key];
        },
      });
    },
    'a proxy of a class instance whose traps are seen': () => {
      // node's Blob reads a property to tell a Blob
      let read = false;
      try {
        Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(new Proxy({}, { get: () => { read = true; } }));
      } catch {
        // not a Blob
      }
      if (read) return UNAVAILABLE;
      class Point {
        constructor() {
          this.x = 1;
        }
      }
      const seenTraps = [];
      // all but getPrototypeOf, which each class the engine checks for asks (and places have different classes)
      const proxy = new Proxy(new Point(), {
        ownKeys(target) { seenTraps.push('ownKeys'); return Reflect.ownKeys(target); },
        getOwnPropertyDescriptor(target, key) { seenTraps.push(`descriptor ${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
        get(target, key, receiver) { seenTraps.push(`get ${String(key)}`); return Reflect.get(target, key, receiver); },
        has(target, key) { seenTraps.push(`has ${String(key)}`); return Reflect.has(target, key); },
      });
      known.set(seenTraps, 'traps');
      return { proxy, seenTraps };
    },
    // what's made from one of the engine's own objects isn't one
    'an object made from DesktopEngine.system': () => (engine ? Object.create(DesktopEngine.system) : UNAVAILABLE),
    'an object made from a canvas': () => (engine ? Object.assign(Object.create(new DesktopEngine.Canvas()), { own: 1 }) : UNAVAILABLE),
    'an object made from a gradient': () => (engine ? Object.create(new DesktopEngine.Canvas().getContext('2d').createLinearGradient(0, 0, 1, 1)) : UNAVAILABLE),
    'an object made from text metrics': () => (engine ? Object.create(new DesktopEngine.Canvas().getContext('2d').measureText('x')) : UNAVAILABLE),
    'an object made from a screen': () => (engine ? Object.create(DesktopEngine.ScreenManager.mainScreen) : UNAVAILABLE),
    'an object made from performance': () => (engine ? Object.create(performance) : UNAVAILABLE),
    'an object made from a WebGL texture': () => (gl ? Object.create(gl.createTexture()) : UNAVAILABLE),
    'an object made from a WebGL extension': () => (gl?.getExtension('OES_vertex_array_object') ? Object.create(gl.getExtension('OES_vertex_array_object')) : UNAVAILABLE),
    'an object made from the WebGL context\'s prototype': () => (engine && has('WebGLRenderingContext') ? Object.create(WebGLRenderingContext.prototype) : UNAVAILABLE),
    'an object made from the ImageBitmap prototype': () => (engine && has('ImageBitmap') ? Object.create(ImageBitmap.prototype) : UNAVAILABLE),
    // the engine's constructors are objects
    'the engine\'s constructors': () => (engine ? [DesktopEngine.Window, DesktopEngine.Component, DesktopEngine.Video, DesktopEngine.Image, DesktopEngine.Canvas,
      DesktopEngine.CanvasImage] : UNAVAILABLE),
    'the runtime\'s constructors': () => (engine ? ['Window', 'Component', 'Video', 'Image', 'Canvas', 'CanvasImage', 'ScreenManager', 'System', 'Input',
      'SystemAudio', 'Windows'].map((name) => DesktopEngineRuntime[name]) : UNAVAILABLE),
    'DesktopEngineRuntime': () => (engine ? DesktopEngineRuntime : UNAVAILABLE),
    'DesktopEngineCore': () => (engine ? DesktopEngineCore : UNAVAILABLE),
  };
  // the prototypes of classes: the engine's have their members not enumerable
  for (const name of ['EventTarget', 'Event', 'CustomEvent', 'MessageEvent', 'CloseEvent', 'ProgressEvent', 'DOMException', 'AbortController',
    'AbortSignal', 'Headers', 'Request', 'Response', 'WebSocket', 'XMLHttpRequest', 'Blob', 'File', 'FormData', 'URL', 'URLSearchParams',
    'TextEncoder', 'TextDecoder', 'TextEncoderStream', 'TextDecoderStream', 'Storage', 'FileReader', 'Path2D', 'ImageData', 'ImageBitmap',
    'WebGLRenderingContext', 'WebGL2RenderingContext', 'MessageChannel', 'MessagePort', 'BroadcastChannel', 'MediaError', 'TimeRanges',
    'AudioBuffer', 'AudioParam', 'AudioListener', 'PeriodicWave', 'AudioContext', 'AudioNode', 'GainNode']) {
    accepted[`the ${name} prototype`] = () => (has(name) ? globalThis[name].prototype : UNAVAILABLE);
    accepted[`the ${name} prototype inside an object`] = () => (has(name) ? { inside: globalThis[name].prototype } : UNAVAILABLE);
  }
  for (const [label, make] of Object.entries(accepted)) clone(report.clone, label, make);

  // MARK: What's refused

  const refused = {
    'a function': () => function named() {},
    'an arrow function': () => () => 1,
    'an anonymous function': () => [function () {}][0],
    'an async function': () => async function waits() {},
    'a class': () => class Shape {},
    'a bound function': () => function base() {}.bind(null),
    'a function deep inside': () => ({ list: [1, { callback() {} }] }),
    'a function as a Map key': () => new Map([[() => 1, 1]]),
    'a symbol': () => Symbol('alone'),
    'a well-known symbol': () => Symbol.iterator,
    'a symbol inside': () => ({ s: Symbol.for('registered') }),
    'a promise': () => Promise.resolve(1),
    'an async function\'s promise': () => (async () => 1)(),
    'a promise subclass': () => {
      class Later extends Promise {}
      return Later.resolve(1);
    },
    'an object of the promise prototype': () => Object.create(Promise.prototype),
    'a thenable': () => ({ then() {} }),
    'a WeakMap': () => new WeakMap(),
    'a WeakSet': () => new WeakSet(),
    'a WeakRef': () => (typeof WeakRef === 'function' ? new WeakRef({}) : UNAVAILABLE),
    'a WeakMap with its own constructor': () => Object.assign(new WeakMap(), { constructor: { name: 'Custom' } }),
    'a WeakMap without a constructor name': () => Object.assign(new WeakMap(), { constructor: { name: '' } }),
    'a WeakMap without a constructor': () => Object.setPrototypeOf(new WeakMap(), null),
    'a view of a SharedArrayBuffer': () => (sharedBuffers ? new Uint8Array(new SharedArrayBuffer(4)) : UNAVAILABLE),
    'a DataView of a SharedArrayBuffer': () => (sharedBuffers ? new DataView(new SharedArrayBuffer(4)) : UNAVAILABLE),
    'a getter that throws': () => ({ get boom() { throw MARKER; } }),
    'a proxy that throws': () => new Proxy({}, { ownKeys() { throw MARKER; } }),
    'a detached ArrayBuffer': () => {
      const buffer = new ArrayBuffer(4);
      if (typeof buffer.transfer !== 'function') return UNAVAILABLE;
      buffer.transfer();
      return buffer;
    },
    'a view of a detached ArrayBuffer': () => {
      const buffer = new ArrayBuffer(4);
      if (typeof buffer.transfer !== 'function') return UNAVAILABLE;
      const view = new Uint8Array(buffer);
      buffer.transfer();
      return view;
    },
    'a MessagePort': () => new MessageChannel().port1,
    'a MessagePort inside': () => ({ port: new MessageChannel().port2 }),
    'an EventTarget': () => new EventTarget(),
    'an Event': () => new Event('x'),
    'a MessageEvent': () => new MessageEvent('message', { data: 1 }),
    'a CustomEvent': () => (has('CustomEvent') ? new CustomEvent('x') : UNAVAILABLE),
    'an AbortController': () => new AbortController(),
    'an AbortSignal': () => new AbortController().signal,
    'a URL': () => new URL('https://example.com/a?b=c'),
    'URLSearchParams': () => new URLSearchParams('a=1'),
    'Headers': () => new Headers({ a: '1' }),
    'a Request': () => new Request('https://example.com/'),
    'a Response': () => new Response('body'),
    'FormData': () => new FormData(),
    'a TextEncoder': () => new TextEncoder(),
    'a TextDecoder': () => new TextDecoder(),
    'a ReadableStream': () => new ReadableStream(),
    'a WritableStream': () => new WritableStream(),
    'a TransformStream': () => new TransformStream(),
    'a queuing strategy': () => new CountQueuingStrategy({ highWaterMark: 1 }),
    'a BroadcastChannel': () => {
      const channel = new BroadcastChannel('corpus');
      setTimeout(() => channel.close(), 0);
      return channel;
    },
    'crypto': () => (typeof crypto === 'object' ? crypto : UNAVAILABLE),
    'localStorage': () => (typeof localStorage === 'object' ? localStorage : UNAVAILABLE),
    'sessionStorage': () => (typeof sessionStorage === 'object' ? sessionStorage : UNAVAILABLE),
    'an object made from localStorage': () => (typeof localStorage === 'object' ? Object.create(localStorage) : UNAVAILABLE),
    'a FileReader': () => (has('FileReader') ? new FileReader() : UNAVAILABLE),
    'an XMLHttpRequest': () => (has('XMLHttpRequest') && engine ? new XMLHttpRequest() : UNAVAILABLE),
    'a Path2D': () => (has('Path2D') && engine ? new Path2D() : UNAVAILABLE),
    'DesktopEngine.system': () => (engine ? DesktopEngine.system : UNAVAILABLE),
    'DesktopEngine.input': () => (engine ? DesktopEngine.input : UNAVAILABLE),
    'the screen manager': () => (engine ? DesktopEngine.ScreenManager : UNAVAILABLE),
    'a screen': () => (engine ? DesktopEngine.ScreenManager.mainScreen : UNAVAILABLE),
    'the screens': () => (engine ? { screens: DesktopEngine.ScreenManager.screens } : UNAVAILABLE),
    'a component': () => (engine ? new DesktopEngine.Component() : UNAVAILABLE),
    'a canvas': () => (engine ? new DesktopEngine.Canvas() : UNAVAILABLE),
    'a canvas image': () => (engine ? new DesktopEngine.CanvasImage() : UNAVAILABLE),
    'an image': () => (engine ? new DesktopEngine.Image() : UNAVAILABLE),
    'a 2D context': () => (engine ? new DesktopEngine.Canvas().getContext('2d') : UNAVAILABLE),
    'a gradient': () => (engine ? new DesktopEngine.Canvas().getContext('2d').createLinearGradient(0, 0, 1, 1) : UNAVAILABLE),
    'text metrics': () => (engine ? new DesktopEngine.Canvas().getContext('2d').measureText('x') : UNAVAILABLE),
    'a WebGL context': () => (engine ? new DesktopEngine.Canvas().getContext('webgl') ?? UNAVAILABLE : UNAVAILABLE),
    'a WebGL texture': () => {
      const gl = engine ? new DesktopEngine.Canvas().getContext('webgl') : null;
      return gl ? gl.createTexture() : UNAVAILABLE;
    },
    'the console': () => (engine ? console : UNAVAILABLE),
    'performance': () => (engine ? performance : UNAVAILABLE),
    'an AudioContext': () => (engine && has('AudioContext') ? new AudioContext() : UNAVAILABLE),
    'an audio node': () => (engine && has('AudioContext') ? new AudioContext().createGain() : UNAVAILABLE),
    'an Audio element': () => (engine && has('Audio') ? new Audio() : UNAVAILABLE),
    'an EventTarget subclass whose tag getter throws': () => {
      class Target extends EventTarget {
        get [Symbol.toStringTag]() {
          throw MARKER;
        }
      }
      return new Target();
    },
    'an engine object with a constructor of its own': () => (engine ? Object.defineProperty(new DesktopEngine.Component(), 'constructor', { value: { name: 'Named' } }) : UNAVAILABLE),
    // what WebGL makes is the engine's own
    'a WebGL buffer': () => (gl ? gl.createBuffer() : UNAVAILABLE),
    'a WebGL program': () => (gl ? gl.createProgram() : UNAVAILABLE),
    'a WebGL shader': () => (gl ? gl.createShader(gl.VERTEX_SHADER) : UNAVAILABLE),
    'a WebGL framebuffer': () => (gl ? gl.createFramebuffer() : UNAVAILABLE),
    'a WebGL renderbuffer': () => (gl ? gl.createRenderbuffer() : UNAVAILABLE),
    'a WebGL shader precision format': () => (gl ? gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT) : UNAVAILABLE),
    'a WebGL uniform location and active info': () => {
      if (!gl) return UNAVAILABLE;
      const program = gl.createProgram();
      for (const [type, source] of [[gl.VERTEX_SHADER, 'attribute vec2 p; uniform float u; void main() { gl_Position = vec4(p * u, 0.0, 1.0); }'],
        [gl.FRAGMENT_SHADER, 'precision mediump float; void main() { gl_FragColor = vec4(1.0); }']]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      const location = gl.getUniformLocation(program, 'u');
      const info = gl.getActiveUniform(program, 0);
      return location && info ? { location, info } : UNAVAILABLE;
    },
    'a WebGL 2 vertex array': () => {
      const gl2 = engine ? new DesktopEngine.Canvas().getContext('webgl2') : null;
      return gl2 ? gl2.createVertexArray() : UNAVAILABLE;
    },
    'an OES vertex array': () => (gl?.getExtension('OES_vertex_array_object') ? gl.getExtension('OES_vertex_array_object').createVertexArrayOES() : UNAVAILABLE),
    'a WebGL extension inside an object': () => (gl?.getExtension('ANGLE_instanced_arrays') ? { instancing: gl.getExtension('ANGLE_instanced_arrays'), size: 4 } : UNAVAILABLE),
    // the runtime's functions, named as the engine's
    'the timer functions': () => (engine ? { setTimeout } : UNAVAILABLE),
    'setInterval': () => (engine ? { setInterval } : UNAVAILABLE),
    'clearTimeout': () => (engine ? { clearTimeout } : UNAVAILABLE),
    'clearInterval': () => (engine ? { clearInterval } : UNAVAILABLE),
    'requestAnimationFrame': () => (engine ? { requestAnimationFrame } : UNAVAILABLE),
    'cancelAnimationFrame': () => (engine ? { cancelAnimationFrame } : UNAVAILABLE),
    'DesktopEngine.setTimeout': () => (engine ? { timer: DesktopEngine.setTimeout } : UNAVAILABLE),
    'queueMicrotask': () => (engine ? { queueMicrotask } : UNAVAILABLE),
    'atob and btoa': () => (engine ? { atob, btoa } : UNAVAILABLE),
    'the global postMessage': () => (engine ? { postMessage } : UNAVAILABLE),
    'fetch': () => (engine ? { fetch } : UNAVAILABLE),
    'createImageBitmap': () => (engine && has('createImageBitmap') ? { createImageBitmap } : UNAVAILABLE),
    'require': () => (engine ? { require } : UNAVAILABLE),
    'a storage\'s method': () => (engine ? { getItem: localStorage.getItem } : UNAVAILABLE),
    'console.log': () => (engine ? { log: console.log } : UNAVAILABLE),
  };
  for (const name of ['OES_vertex_array_object', 'ANGLE_instanced_arrays', 'OES_element_index_uint', 'OES_standard_derivatives', 'EXT_blend_minmax',
    'OES_texture_float', 'WEBGL_depth_texture', 'EXT_texture_filter_anisotropic']) {
    refused[`the ${name} extension`] = () => gl?.getExtension(name) ?? UNAVAILABLE;
  }
  for (const [label, make] of Object.entries(refused)) clone(report.clone, label, make);
  // what a canvas reads back, which the app copies as ImageData only when it is one
  clone(report.clone, 'the pixels of a canvas', () => (engine ? new DesktopEngine.Canvas().getContext('2d').getImageData(0, 0, 1, 1) : UNAVAILABLE));
  // the options are data: copied as JSON would copy them
  if (engine) {
    const options = DesktopEngine.launchOptions;
    report.clone['launch options'] = describe(structuredClone(options)) === undefined ? 'no copy'
      : JSON.stringify(describe(structuredClone(options))) === JSON.stringify(describe(JSON.parse(JSON.stringify(options))));
  } else {
    report.clone['launch options'] = UNAVAILABLE;
  }

  // MARK: Arguments and transferring

  const detached = (buffer) => [buffer.byteLength, buffer.detached === true];
  const transfer = report.transfer;
  clone(transfer, 'no options', () => 0);
  try {
    structuredClone();
    transfer['none at all'] = 'returned';
  } catch (error) {
    transfer['none at all'] = errorOf(error);
  }
  for (const [label, options] of Object.entries({ 'null options': null, 'number options': 5, 'string options': 'x', 'function options': () => {},
    'an array as options': [new ArrayBuffer(1)], 'empty options': {}, 'an undefined transfer': { transfer: undefined }, 'a null transfer': { transfer: null },
    'a number transfer': { transfer: 5 }, 'a string transfer': { transfer: 'ab' }, 'an object transfer': { transfer: {} }, 'an empty transfer': { transfer: [] },
    'a plain object in the transfer': { transfer: [{}] }, 'a view in the transfer': { transfer: [new Uint8Array(1)] }, 'a function in the transfer': { transfer: [() => {}] },
    'a SharedArrayBuffer in the transfer': sharedBuffers ? { transfer: [new SharedArrayBuffer(1)] } : UNAVAILABLE })) {
    if (options === UNAVAILABLE) transfer[label] = UNAVAILABLE;
    else clone(transfer, label, () => ({ value: 1 }), () => options);
  }
  const transferable = typeof ArrayBuffer.prototype.transfer === 'function';
  clone(transfer, 'a transferred buffer', () => new Uint8Array([1, 2]).buffer, (buffer) => ({ transfer: [buffer] }), detached);
  clone(transfer, 'a transferred buffer with views', () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    return { buffer, view: new Uint8Array(buffer, 1), data: new DataView(buffer) };
  }, (value) => ({ transfer: [value.buffer] }), (value) => [detached(value.buffer), value.view.length]);
  clone(transfer, 'a transferred buffer not in the value', () => ({ buffer: new ArrayBuffer(4) }), (value) => ({ transfer: [value.buffer] }), (value) => detached(value.buffer));
  clone(transfer, 'a transfer of a value that can\'t be copied', () => ({ buffer: new ArrayBuffer(4), f() {} }), (value) => ({ transfer: [value.buffer] }), (value) => detached(value.buffer));
  clone(transfer, 'a buffer twice in the transfer', () => new ArrayBuffer(4), (buffer) => ({ transfer: [buffer, buffer] }), detached);
  clone(transfer, 'a transfer that\'s a Set', () => new ArrayBuffer(4), (buffer) => ({ transfer: new Set([buffer]) }), detached);
  clone(transfer, 'a transfer that\'s a generator', () => new ArrayBuffer(4), (buffer) => ({ transfer: (function* () { yield buffer; })() }), detached);
  clone(transfer, 'a transfer whose iterator throws', () => 1, () => ({ transfer: { [Symbol.iterator]() { throw MARKER; } } }));
  clone(transfer, 'a transfer read through a getter', () => new ArrayBuffer(2), (buffer) => {
    let reads = 0;
    return { get transfer() { reads += 1; return reads === 1 ? [buffer] : []; } };
  }, detached);
  clone(transfer, 'a transfer checked before the value', () => () => 1, () => ({ transfer: 5 }));
  clone(transfer, 'a transfer whose items are checked in order', () => 1, () => ({ transfer: [new ArrayBuffer(1), {}, 5] }));
  clone(transfer, 'a detached buffer in the transfer', () => {
    const buffer = new ArrayBuffer(4);
    if (!transferable) return UNAVAILABLE;
    buffer.transfer();
    return { buffer };
  }, (value) => ({ transfer: [value.buffer] }));
  clone(transfer, 'a transferred buffer whose transfer is replaced', () => {
    const buffer = new ArrayBuffer(4);
    buffer.transfer = () => {
      transfer['the replaced transfer was called'] = true;
    };
    return buffer;
  }, (buffer) => ({ transfer: [buffer] }), (buffer) => buffer.byteLength);
  clone(transfer, 'a buffer whose slice is replaced', () => {
    const buffer = new ArrayBuffer(4);
    buffer.slice = () => new Uint8Array([7]).buffer;
    return buffer;
  });
  clone(transfer, 'a view whose buffer is replaced', () => Object.defineProperty(new Uint8Array(2), 'buffer', { value: new Uint8Array([5, 6]).buffer }));
  {
    const channel = new MessageChannel();
    known.set(channel.port1, 'port1');
    known.set(channel.port2, 'port2');
    clone(transfer, 'a transferred port', () => channel.port1, () => ({ transfer: [channel.port1] }));
    clone(transfer, 'a transferred port inside', () => ({ port: channel.port1, again: [channel.port1] }), () => ({ transfer: [channel.port1] }));
    clone(transfer, 'a port in the value but not the transfer', () => ({ port: channel.port1 }), () => ({ transfer: [channel.port2] }));
    clone(transfer, 'a port twice in the transfer', () => 1, () => ({ transfer: [channel.port1, channel.port1] }));
    clone(transfer, 'an object of the port prototype in the transfer', () => {
      const fake = Object.create(MessagePort.prototype);
      known.set(fake, 'fake port');
      return { fake };
    }, (value) => ({ transfer: [value.fake] }));
    channel.port1.close();
  }

  // MARK: The ports' shape and arguments

  const ports = report.ports;
  const attempt = (label, action) => {
    try {
      const result = action();
      ports[label] = result === undefined ? 'returned' : result;
    } catch (error) {
      ports[label] = errorOf(error);
    }
  };
  const ownNames = (object) => Reflect.ownKeys(object).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return `${String(key)} ${'value' in descriptor ? typeof descriptor.value : `${descriptor.get ? 'get' : ''}${descriptor.set ? 'set' : ''}`} ${flags(descriptor)}`;
  });
  attempt('new MessagePort()', () => new MessagePort());
  attempt('a subclass of MessagePort', () => {
    class Port extends MessagePort {}
    return new Port();
  });
  attempt('the MessagePort prototype', () => ownNames(MessagePort.prototype));
  attempt('the MessageChannel prototype', () => ownNames(MessageChannel.prototype));
  attempt('the lengths and names', () => [structuredClone.length, structuredClone.name, MessagePort.length, MessagePort.name, MessageChannel.length,
    MessageChannel.name, MessagePort.prototype.postMessage.length, MessagePort.prototype.start.length]);
  attempt('the prototype chain', () => [Object.getPrototypeOf(MessagePort.prototype) === EventTarget.prototype, Object.getPrototypeOf(MessageChannel.prototype) === Object.prototype]);
  {
    const channel = new MessageChannel();
    const { port1, port2 } = channel;
    attempt('a channel', () => [Object.prototype.toString.call(channel), Object.prototype.toString.call(port1), channel.port1 === port1,
      port1 !== port2, port1 instanceof MessagePort, port1 instanceof EventTarget, Object.keys(channel), Object.getOwnPropertyNames(port1),
      Object.getOwnPropertyDescriptor(port1, 'onmessageerror'), port1.onmessage, port1.onmessageerror]);
    attempt('onmessage values', () => {
      const values = [];
      for (const handler of [5, 'text', undefined, null, { handleEvent() {} }, () => {}, true]) {
        port1.onmessage = handler;
        values.push(describe(port1.onmessage));
      }
      port1.onmessage = null;
      return values;
    });
    attempt('postMessage()', () => port1.postMessage());
    for (const [label, options] of Object.entries({ 'a number': 5, 'a string': 'x', 'a function': () => {}, null: null, undefined, 'a symbol': Symbol('o'),
      'a transfer of a number': { transfer: 5 }, 'a null transfer': { transfer: null }, 'a transfer of an object': { transfer: [{}] } })) {
      attempt(`postMessage with ${label}`, () => port1.postMessage('x', options));
    }
    attempt('postMessage of a function', () => port1.postMessage(() => 1));
    attempt('a port through itself', () => port1.postMessage(port1, [port1]));
    attempt('a port through itself in the options', () => port1.postMessage(1, { transfer: [port1] }));
    attempt('a port twice', () => port1.postMessage(1, [port2, port2]));
    attempt('a buffer through an array', () => {
      const buffer = new ArrayBuffer(2);
      port1.postMessage(buffer, [buffer]);
      return detached(buffer);
    });
    attempt('a buffer through a Set', () => {
      const buffer = new ArrayBuffer(2);
      port1.postMessage(1, new Set([buffer]));
      return detached(buffer);
    });
    attempt('a buffer through the options', () => {
      const buffer = new ArrayBuffer(2);
      port1.postMessage(1, { transfer: [buffer] });
      return detached(buffer);
    });
    attempt('a string iterable as options', () => {
      const options = new String('ab');
      port1.postMessage(1, options);
    });
    port1.close();
    attempt('a closed port posts', () => {
      const buffer = new ArrayBuffer(2);
      port1.postMessage(buffer, [buffer]);
      port2.postMessage(1);
      return detached(buffer);
    });
    attempt('a closed port still refuses', () => port1.postMessage(() => 1));
    attempt('closing twice', () => {
      port1.close();
      port1.start();
      return port1.onmessage;
    });
  }

  // MARK: MessageEvent

  {
    const { port1, port2 } = new MessageChannel();
    const eventOf = (event) => [event.type, describe(event.data), describe(event.origin), describe(event.lastEventId), event.source === null,
      Array.isArray(event.ports), Object.isFrozen(event.ports), event.ports.map((port) => (port === port1 ? 'port1' : port === port2 ? 'port2' : describe(port))),
      event.bubbles, event.cancelable, event instanceof MessageEvent, event instanceof Event, event.constructor === MessageEvent];
    attempt('a MessageEvent with ports', () => eventOf(new MessageEvent('message', { data: 1, ports: [port1, port2] })));
    attempt('a MessageEvent with a source', () => eventOf(new MessageEvent('message', { source: port1 })));
    attempt('a MessageEvent made from another', () => {
      const event = new MessageEvent('message', { data: { a: 1 }, origin: 'o', ports: [port2] });
      const again = new MessageEvent('message', event);
      return [eventOf(again), again.data === event.data, again.ports !== event.ports];
    });
    attempt('a MessageEvent with an unusual init', () => eventOf(new MessageEvent('x', { data: 1, origin: 5, lastEventId: 'id', source: {}, ports: 'ab',
      bubbles: true, cancelable: true, composed: true })));
    attempt('a MessageEvent without an init', () => eventOf(new MessageEvent('x')));
    attempt('a MessageEvent without arguments', () => eventOf(new MessageEvent()));
    attempt('a MessageEvent of a symbol', () => new MessageEvent(Symbol('type')).type);
    attempt('a MessageEvent with ports that aren\'t a list', () => eventOf(new MessageEvent('x', { ports: 5 })));
    attempt('MessageEvent without new', () => MessageEvent('x'));
    attempt('a subclass of MessageEvent', () => {
      class Note extends MessageEvent {}
      const event = new Note('note', { data: 2, ports: [port1] });
      return [event instanceof Note, event instanceof MessageEvent, event.data, event.ports.length, Object.getPrototypeOf(event) === Note.prototype];
    });
    attempt('the MessageEvent class', () => [MessageEvent.length, MessageEvent.name, Object.getOwnPropertyDescriptor(MessageEvent, 'prototype').writable,
      Object.getPrototypeOf(MessageEvent.prototype) === Event.prototype]);
    attempt('a MessageEvent with ports dispatched to a port', () => {
      let got = null;
      port2.onmessage = (event) => {
        got = event.ports.length;
      };
      port2.dispatchEvent(new MessageEvent('message', { ports: [port1] }));
      port2.onmessage = null;
      return got;
    });
    port1.close();
    port2.close();
  }

  // MARK: What the content changes

  // the runtime's own doesn't use what the content replaces
  attempt('with WeakMap\'s and WeakSet\'s methods replaced', () => {
    const replaced = [[WeakMap.prototype, ['get', 'set', 'has', 'delete']], [WeakSet.prototype, ['add', 'has', 'delete']]];
    const saved = replaced.map(([prototype, names]) => names.map((name) => prototype[name]));
    const calls = [];
    for (const [prototype, names] of replaced) {
      for (const name of names) {
        prototype[name] = function () {
          calls.push(name);
          throw MARKER;
        };
      }
    }
    try {
      const channel = new MessageChannel();
      channel.port1.postMessage({ map: new Map([[1, 2]]) });
      channel.port1.close();
      return [channel.port1 instanceof MessagePort, describe(structuredClone({ a: [1] })), calls];
    } finally {
      replaced.forEach(([prototype, names], index) => names.forEach((name, slot) => {
        prototype[name] = saved[index][slot];
      }));
    }
  });
  attempt('a BroadcastChannel with WeakMap\'s methods replaced', () => {
    if (!engine) return UNAVAILABLE;
    const saved = [WeakMap.prototype.get, WeakMap.prototype.has];
    WeakMap.prototype.get = WeakMap.prototype.has = () => {
      throw MARKER;
    };
    try {
      const channel = new BroadcastChannel('corpus tampering');
      channel.onmessage = () => {};
      channel.postMessage(1);
      channel.close();
      return 'worked';
    } finally {
      [WeakMap.prototype.get, WeakMap.prototype.has] = saved;
    }
  });

  // MARK: Delivery

  const log = (line) => report.delivery.push(line);
  // a while, longer where timers are slow: only the order of what happens counts
  const later = (callback, delay) => setTimeout(callback, delay * (options?.timeScale ?? 1));
  const scenarios = [];
  const scenario = (name, run) => scenarios.push([name, run]);

  scenario('a listener waits for start()', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port2.addEventListener('message', (event) => log(`listener ${event.data}`));
    port1.postMessage('a');
    port1.postMessage('b');
    later(() => {
      log('before start');
      port2.start();
      port2.start();
      setTimeout(() => log('a timer after start'), 0);
      later(finish, 20);
    }, 5);
  });
  scenario('onmessage starts the port', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port1.postMessage('early');
    port2.onmessage = (event) => log(`onmessage ${event.data}`);
    port1.postMessage('late');
    log('posted');
    later(finish, 20);
  });
  scenario('one message a task', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = (event) => {
      log(`message ${event.data}`);
      queueMicrotask(() => log(`microtask ${event.data}`));
      Promise.resolve().then(() => log(`promise ${event.data}`));
      setTimeout(() => log(`timer ${event.data}`), 0);
    };
    port2.addEventListener('message', (event) => log(`listener ${event.data}`));
    port1.postMessage(1);
    port1.postMessage(2);
    port1.postMessage(3);
    setTimeout(() => log('timer set after posting'), 0);
    later(finish, 30);
  });
  scenario('two channels take turns', (finish) => {
    const first = new MessageChannel();
    const second = new MessageChannel();
    first.port2.onmessage = (event) => log(`first ${event.data}`);
    second.port2.onmessage = (event) => log(`second ${event.data}`);
    first.port1.postMessage('a');
    first.port1.postMessage('b');
    second.port1.postMessage('c');
    second.port1.postMessage('d');
    first.port1.postMessage('e');
    later(finish, 30);
  });
  scenario('both ways', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = (event) => {
      log(`port1 got ${event.data}`);
      if (event.data < 4) port1.postMessage(event.data + 1);
    };
    port2.onmessage = (event) => {
      log(`port2 got ${event.data}`);
      if (event.data < 4) port2.postMessage(event.data + 1);
    };
    port1.postMessage(1);
    later(finish, 40);
  });
  scenario('closing the receiving port', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = (event) => {
      log(`got ${event.data}`);
      if (event.data === 'first') port2.close();
    };
    port1.postMessage('first');
    port1.postMessage('second');
    later(() => {
      port1.postMessage('after');
      port2.start();
      log(`onmessage after close ${typeof port2.onmessage}`);
      later(finish, 10);
    }, 10);
  });
  scenario('closing the sending port', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = (event) => log(`port2 got ${event.data}`);
    port1.onmessage = (event) => log(`port1 got ${event.data}`);
    port1.postMessage('queued');
    port2.postMessage('to the closed one');
    port1.close();
    port1.postMessage('after closing');
    port2.postMessage('to the closed one again');
    later(finish, 20);
  });
  scenario('closing before the timer', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = (event) => log(`got ${event.data}`);
    port1.postMessage('never');
    port2.close();
    later(finish, 10);
  });
  scenario('a handler taken away', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = (event) => log(`first handler ${event.data}`);
    port2.onmessage = null;
    port1.postMessage('lost');
    later(() => {
      port2.onmessage = (event) => log(`second handler ${event.data}`);
      port1.postMessage('found');
      later(finish, 10);
    }, 10);
  });
  scenario('an object as the handler', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = { handleEvent: () => log('handleEvent called') };
    port2.addEventListener('message', (event) => log(`listener ${event.data}`));
    port1.postMessage('object');
    later(finish, 10);
  });
  scenario('the handler goes first', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port2.addEventListener('message', function first(event) {
      log(`listener ${event.data} ${this === port2}`);
      port2.onmessage = (later) => log(`replaced handler ${later.data}`);
    });
    port2.addEventListener('message', { handleEvent(event) { log(`listener object ${event.data} ${this !== port2}`); } });
    port2.onmessage = function (event) {
      log(`handler ${event.data} ${this === port2}`);
    };
    port1.postMessage(1);
    port1.postMessage(2);
    later(finish, 20);
  });
  scenario('stopping the others', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = (event) => {
      log(`handler ${event.data}`);
      event.stopImmediatePropagation();
    };
    port2.addEventListener('message', () => log('never called'));
    port1.postMessage('stop');
    later(finish, 10);
  });
  scenario('removing a listener', (finish) => {
    const { port1, port2 } = new MessageChannel();
    const listener = (event) => log(`listener ${event.data}`);
    port2.addEventListener('message', listener);
    port2.addEventListener('message', listener);
    port2.addEventListener('message', (event) => log(`once ${event.data}`), { once: true });
    port2.start();
    port1.postMessage(1);
    later(() => {
      port2.removeEventListener('message', listener);
      port1.postMessage(2);
      log('removed');
      later(finish, 10);
    }, 10);
  });
  scenario('the event', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = (event) => {
      log(JSON.stringify([event instanceof MessageEvent, event instanceof Event, event.type, event.target === port2, event.currentTarget === port2,
        event.origin, event.lastEventId, event.source, Array.isArray(event.ports), Object.isFrozen(event.ports), event.ports.length, event.data]));
    };
    port1.postMessage({ deep: [1] });
    later(finish, 10);
  });
  scenario('a copy each time', (finish) => {
    const { port1, port2 } = new MessageChannel();
    const value = { list: [1], date: new Date(3) };
    port2.onmessage = (event) => {
      log(`copy ${event.data !== value} ${event.data.list !== value.list} ${event.data.list[0]} ${event.data.date.getTime()}`);
    };
    port1.postMessage(value);
    value.list[0] = 2;
    port1.postMessage(value);
    later(finish, 10);
  });
  scenario('a transferred port', (finish) => {
    const carrier = new MessageChannel();
    const carried = new MessageChannel();
    carrier.port2.onmessage = (event) => {
      log(`ports ${event.ports.length} ${event.ports[0] === carried.port1} ${event.data.port === carried.port1} ${Object.isFrozen(event.ports)}`);
      event.ports[0].postMessage('through the carried port');
    };
    carried.port2.onmessage = (event) => log(`carried got ${event.data}`);
    carrier.port1.postMessage({ port: carried.port1 }, [carried.port1]);
    carried.port1.postMessage('the sender still has it');
    later(finish, 20);
  });
  scenario('the other end in the transfer', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = (event) => log(`got ${event.data} ${event.ports[0] === port2}`);
    port1.postMessage('itself', [port2]);
    later(finish, 10);
  });
  scenario('a transferred buffer', (finish) => {
    const { port1, port2 } = new MessageChannel();
    const buffer = new Uint8Array([4, 5, 6]).buffer;
    port2.onmessage = (event) => log(`got ${event.data !== buffer} ${Array.from(new Uint8Array(event.data))} ${event.ports.length}`);
    port1.postMessage(buffer, [buffer]);
    log(`right after posting ${detached(buffer)}`);
    later(finish, 10);
  });
  scenario('dispatching by hand', (finish) => {
    const { port2 } = new MessageChannel();
    port2.onmessage = (event) => log(`handler ${event.data}`);
    port2.onmessageerror = (event) => log(`error handler ${event.type}`);
    port2.dispatchEvent(new MessageEvent('message', { data: 'by hand' }));
    port2.dispatchEvent(new MessageEvent('messageerror'));
    log('dispatched');
    later(finish, 10);
  });
  scenario('posting while delivering', (finish) => {
    const { port1, port2 } = new MessageChannel();
    let count = 0;
    port2.onmessage = (event) => {
      log(`got ${event.data}`);
      if (count++ < 2) {
        port1.postMessage(`${event.data}+`);
        setTimeout(() => log(`timer from ${event.data}`), 0);
      }
    };
    port1.postMessage('a');
    port1.postMessage('b');
    later(finish, 30);
  });
  scenario('forwarding an event with its ports', (finish) => {
    const carrier = new MessageChannel();
    const carried = new MessageChannel();
    const bus = new EventTarget();
    bus.addEventListener('message', (event) => log(`bus got ${event.data} ${event.ports.length} ${event.ports[0] === carried.port1}`));
    carrier.port2.onmessage = (event) => {
      log(`got ${event.data} with ${event.ports.length}`);
      bus.dispatchEvent(new MessageEvent('message', event));
      bus.dispatchEvent(new MessageEvent('message', { data: `${event.data} copied`, ports: event.ports }));
      bus.dispatchEvent(new MessageEvent('message', { data: `${event.data} spread`, ports: [...event.ports] }));
    };
    carrier.port1.postMessage('carry', [carried.port1]);
    later(() => {
      carrier.port1.close();
      carried.port2.close();
      finish();
    }, 10);
  });
  scenario('a capture listener that stops the others', (finish) => {
    const { port1, port2 } = new MessageChannel();
    port2.addEventListener('message', (event) => {
      log(`capture listener ${event.data}`);
      event.stopImmediatePropagation();
    }, { capture: true });
    port2.onmessage = (event) => log(`handler ${event.data}`);
    port2.addEventListener('message', (event) => log(`listener ${event.data}`));
    port1.postMessage('stopped');
    later(finish, 10);
  });
  scenario('a port made while the content\'s addEventListener is replaced', (finish) => {
    const added = EventTarget.prototype.addEventListener;
    let calls = 0;
    EventTarget.prototype.addEventListener = function () {
      calls += 1;
    };
    let channel;
    try {
      channel = new MessageChannel();
    } finally {
      EventTarget.prototype.addEventListener = added;
    }
    log(`addEventListener called ${calls} times`);
    channel.port2.onmessage = (event) => log(`handler ${event.data}`);
    channel.port1.postMessage('still');
    later(finish, 10);
  });
  if (options?.throwingListeners) {
    scenario('a listener that throws', (finish) => {
      const { port1, port2 } = new MessageChannel();
      port2.onmessage = () => {
        throw new Error('thrown on purpose');
      };
      port2.addEventListener('message', (event) => log(`next listener ${event.data}`));
      port1.postMessage('still');
      later(finish, 10);
    });
  }

  // what's made or read asynchronously: an ImageBitmap, the bytes of copied Blobs
  const settle = async () => {
    const later = report.later;
    if (engine && typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(new ImageData(1, 1));
        clone(later, 'an ImageBitmap', () => bitmap);
      } catch (error) {
        later['an ImageBitmap'] = { setup: errorOf(error) };
      }
    } else {
      later['an ImageBitmap'] = UNAVAILABLE;
    }
    const blob = new Blob(['bytes ', new Uint8Array([104, 105])], { type: 'text/plain' });
    const copies = structuredClone({ blob, file: new File([blob], 'f.txt'), slice: blob.slice(2, 5) });
    later['the bytes of copied Blobs'] = [await copies.blob.text(), await copies.file.text(), await copies.slice.text()];
  };
  const next = (index) => {
    if (index >= scenarios.length) {
      settle().then(() => done(report), (error) => {
        report.later.failed = errorOf(error);
        done(report);
      });
      return;
    }
    const [name, run] = scenarios[index];
    log(`- ${name}`);
    run(() => next(index + 1));
  };
  next(0);
}
