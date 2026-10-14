// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The content's globals. The frame is a browser document, DesktopEngine has no DOM: the content sees the language's
// globals and the engine's, not window, document or the DOM classes (and its own navigator, not the browser's), so libraries that look for a browser
// (PixiJS checks `instanceof HTMLCanvasElement`, others `typeof document`) take the same paths as in the app, and the
// stand-ins a project installs for them (`globalThis.document ??= …`) are used.
//
// The content runs inside `with (scope)`: names it doesn't declare itself resolve through the scope proxy, which
// answers the hidden ones from the content's own globals; `globalThis`, `self` and the top-level `this` are a proxy of
// the global object that hides the same names. What the content assigns to a hidden name stays among its own globals,
// what it assigns to an engine global replaces it. As the engine's global object, the content's inherits Object.prototype
// (toString, hasOwnProperty, constructor, what the content adds to it) and can't be given another prototype. Unlike the
// engine, reading a name nobody defined gives undefined rather than a ReferenceError (the proxy can't tell `typeof x`
// from `x`), and a function the content calls by a global name gets the scope as `this` rather than undefined.

const LANGUAGE = [
  'Object', 'Function', 'Array', 'Number', 'parseFloat', 'parseInt', 'Infinity', 'NaN', 'undefined', 'Boolean', 'String',
  'Symbol', 'Date', 'Promise', 'RegExp', 'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError',
  'SyntaxError', 'TypeError', 'URIError', 'JSON', 'Math', 'Intl', 'ArrayBuffer', 'SharedArrayBuffer', 'Atomics',
  'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float16Array', 'Float32Array',
  'Float64Array', 'Uint8ClampedArray', 'BigUint64Array', 'BigInt64Array', 'DataView', 'Map', 'BigInt', 'Set', 'WeakMap',
  'WeakSet', 'Proxy', 'Reflect', 'FinalizationRegistry', 'WeakRef', 'Iterator', 'decodeURI', 'decodeURIComponent',
  'encodeURI', 'encodeURIComponent', 'escape', 'unescape', 'eval', 'isFinite', 'isNaN', 'WebAssembly',
];

/** What the engine defines globally (types/desktop-engine.d.ts) */
const ENGINE = [
  'DesktopEngine', 'DesktopEngineCore', 'DesktopEngineRuntime', 'console', 'performance', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'atob', 'btoa',
  'crypto', 'navigator', 'require', 'module', 'exports', 'postMessage', 'WebGLRenderingContext', 'WebGL2RenderingContext',
  'structuredClone', 'DOMException', 'Event', 'CustomEvent', 'EventTarget', 'MessageEvent', 'MessageChannel', 'MessagePort',
  'BroadcastChannel',
  'FileReader', 'Path2D', 'ImageData', 'ImageBitmap', 'createImageBitmap', 'CloseEvent', 'ProgressEvent', 'AbortController', 'AbortSignal',
  'fetch', 'Headers', 'Request', 'Response', 'WebSocket', 'XMLHttpRequest', 'XMLHttpRequestEventTarget',
  'XMLHttpRequestUpload', 'Blob', 'File', 'FormData', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'TextEncoderStream', 'TextDecoderStream', 'ByteLengthQueuingStrategy', 'CountQueuingStrategy', 'ReadableStream',
  'ReadableStreamDefaultController', 'ReadableStreamBYOBRequest', 'ReadableByteStreamController',
  'ReadableStreamDefaultReader', 'ReadableStreamBYOBReader', 'WritableStream', 'WritableStreamDefaultController',
  'WritableStreamDefaultWriter', 'TransformStream', 'TransformStreamDefaultController', 'Storage', 'localStorage',
  'sessionStorage', 'Audio', 'HTMLAudioElement', 'HTMLMediaElement', 'MediaError', 'TimeRanges', 'AudioContext',
  'BaseAudioContext', 'OfflineAudioContext', 'OfflineAudioCompletionEvent', 'AudioBuffer', 'AudioParam', 'AudioNode',
  'AudioDestinationNode', 'AudioListener', 'AudioScheduledSourceNode', 'AudioBufferSourceNode', 'OscillatorNode',
  'ConstantSourceNode', 'GainNode', 'DelayNode', 'BiquadFilterNode', 'IIRFilterNode', 'WaveShaperNode',
  'StereoPannerNode', 'PannerNode', 'ConvolverNode', 'DynamicsCompressorNode', 'AnalyserNode', 'ChannelSplitterNode',
  'ChannelMergerNode', 'PeriodicWave',
];

// what the content may replace, taken before it runs: every name the content looks up goes through the scope and
// global proxies below, so they read nothing it can change (Set.prototype.has, Array.prototype's iterator, Reflect's
// and Object's functions, Function.prototype.call), as the engine's lookups don't. Their handlers and the descriptors
// they give have no prototype: a proxy looks a trap or a descriptor's fields up through it, and would find what the
// content put on Object.prototype.
const { apply, construct, get, set, ownKeys, getOwnPropertyDescriptor, defineProperty, deleteProperty } = Reflect;
const { create, setPrototypeOf } = Object;
const ObjectPrototype = Object.prototype;
const { bind } = Function.prototype;
const FunctionClass = Function;
const ProxyClass = Proxy;
const { unscopables, toStringTag } = Symbol;

/** An object or array without a prototype: what's read of it is its own */
const bare = <T extends object>(object: T): T => setPrototypeOf(object, null) as T;

/** Names, as a dictionary without a prototype: looking one up reads nothing the content may replace, as Set's has() would */
type Names = Record<string, true>;
function names(list: readonly string[]): Names {
  const set = create(null) as Names;
  for (let index = 0; index < list.length; index++) set[list[index]] = true;
  return set;
}

const VISIBLE = names([...LANGUAGE, ...ENGINE]);
const ENGINE_GLOBALS = names(ENGINE);
/** Browser functions that throw unless `this` is the real global object */
const BOUND = names(['queueMicrotask', 'atob', 'btoa', 'postMessage']);

/** Whether the engine has a global of the name (a class of its own: the frame's may be the browser's) */
export const isEngineGlobal = (name: string): boolean => ENGINE_GLOBALS[name] === true;

const realGlobal = globalThis as unknown as Record<PropertyKey, unknown>;
/**
 * The content's own globals: the hidden names it assigned, and the globals it created. It inherits Object.prototype as
 * the engine's global object does, so what isn't among them is looked up there, with the content's global object as
 * the receiver: Object.prototype's getters and setters (`__proto__`, the content's own) see `globalThis`.
 */
const own: Record<PropertyKey, unknown> = create(ObjectPrototype);
/** The bound functions given for BOUND names, with what they're bound from */
const bound = create(null) as Record<string, { original: unknown; wrapper: unknown } | undefined>;

/** The engine's globals and the language's, and symbols but the browser's Symbol.toStringTag ("Window") */
const visible = (name: PropertyKey): name is string | symbol => (typeof name === 'symbol' ? name !== toStringTag : VISIBLE[name] === true);

function visibleValue(name: string | symbol): unknown {
  const value = realGlobal[name];
  if (typeof name !== 'string' || BOUND[name] !== true || typeof value !== 'function') return value;
  let entry = bound[name];
  if (!entry || entry.original !== value) {
    const wrapper = apply(bind, value, [realGlobal]) as object;
    // named as what it's bound from, as the engine's functions are ("The function atob can't be cloned")
    defineProperty(wrapper, 'name', bare({ value: (value as { name: unknown }).name, configurable: true }));
    entry = bare({ original: value as unknown, wrapper: wrapper as unknown });
    bound[name] = entry;
  }
  return entry.wrapper;
}

/** A descriptor the proxies give or pass on, without a prototype (undefined stays undefined) */
const bareDescriptor = (descriptor: PropertyDescriptor | undefined): PropertyDescriptor | undefined => descriptor && bare(descriptor);

/** `globalThis`, `self` and `this` for the content */
export const contentGlobal: Record<PropertyKey, unknown> = new ProxyClass(own, bare<ProxyHandler<Record<PropertyKey, unknown>>>({
  get: (target, name, receiver) => (name === 'globalThis' || name === 'self' ? contentGlobal : visible(name) ? visibleValue(name) : get(target, name, receiver)),
  set: (target, name, value, receiver) => {
    if (!visible(name)) return set(target, name, value, receiver);
    realGlobal[name] = value;
    return true;
  },
  has: (target, name) => (visible(name) ? name in realGlobal : name in target),
  deleteProperty: (target, name) => (visible(name) ? deleteProperty(realGlobal, name) || true : deleteProperty(target, name)),
  ownKeys: (target) => {
    // by index, into an array without a prototype: no iterator, filter or push the content may have replaced
    const keys = bare<(string | symbol)[]>([]);
    const globals = ownKeys(realGlobal);
    for (let index = 0; index < globals.length; index++) {
      const name = globals[index];
      if (visible(name) && !getOwnPropertyDescriptor(target, name)) keys[keys.length] = name;
    }
    const created = ownKeys(target);
    for (let index = 0; index < created.length; index++) keys[keys.length] = created[index];
    return keys;
  },
  getOwnPropertyDescriptor: (target, name) => {
    if (!visible(name)) return bareDescriptor(getOwnPropertyDescriptor(target, name));
    const descriptor = bareDescriptor(getOwnPropertyDescriptor(realGlobal, name));
    // the proxy's target doesn't have it, so it can't be reported as non-configurable
    if (descriptor) descriptor.configurable = true;
    return descriptor;
  },
  defineProperty: (target, name, descriptor) => (visible(name)
    ? defineProperty(realGlobal, name, bare(descriptor)) || true
    : defineProperty(target, name, bare(descriptor))),
  getPrototypeOf: () => ObjectPrototype,
  // the engine's global object keeps its prototype: setting another fails
  setPrototypeOf: (_target, prototype) => prototype === ObjectPrototype,
}));

/** The names of a function's parameters resolve to them, not through the scope */
function scopeFor(parameters: Names): object {
  return new ProxyClass(create(null) as object, bare<ProxyHandler<object>>({
    has: (_target, name) => typeof name === 'string' && parameters[name] !== true && (name === 'globalThis' || name === 'self' || VISIBLE[name] !== true),
    get: (_target, name) => (name === unscopables ? undefined : name === 'globalThis' || name === 'self' ? contentGlobal : get(own, name, contentGlobal)),
    set: (_target, name, value) => set(own, name, value, contentGlobal),
    // `delete name` of a global the content created
    deleteProperty: (_target, name) => deleteProperty(own, name),
  }));
}

const SCOPE_PARAMETER = '__desktopEngineScope';
/** Runs the content's function with `this` as given, whatever the content made of Function.prototype.call */
const RUN_PARAMETER = '__desktopEngineRun';
const run = (action: () => unknown, self: unknown): unknown => apply(action, self, []);

/**
 * Compiles code to run with the content's globals; `parameters` are its arguments' names. The code keeps its lines:
 * it starts on the first line of the function's body.
 */
export function contentFunction(code: string, sourceURL: string, parameters: readonly string[] = []): (...args: unknown[]) => unknown {
  // require compiles while the content runs: the lists by index, without spread or the content's iterator
  const source = bare<string[]>([SCOPE_PARAMETER, RUN_PARAMETER]);
  for (let index = 0; index < parameters.length; index++) source[source.length] = parameters[index];
  const scope = scopeFor(names(source));
  // the wrapper isn't strict (`with`), the content's "use strict" applies to the function it's in
  source[source.length] = `with (${SCOPE_PARAMETER}) { return ${RUN_PARAMETER}(function () {${code}\n}, this); }\n//# sourceURL=${sourceURL}`;
  const program = construct(FunctionClass, source) as (...args: unknown[]) => unknown;
  return (...args: unknown[]) => {
    const values = bare<unknown[]>([scope, run]);
    for (let index = 0; index < args.length; index++) values[values.length] = args[index];
    return apply(program, contentGlobal, values);
  };
}
