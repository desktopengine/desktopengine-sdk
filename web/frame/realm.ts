// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The content's globals. The frame is a browser document, DesktopEngine has no DOM: the content sees the language's
// globals and the engine's, not window, document, navigator or the DOM classes, so libraries that look for a browser
// (PixiJS checks `instanceof HTMLCanvasElement`, others `typeof document`) take the same paths as in the app, and the
// stand-ins a project installs for them (`globalThis.document ??= …`) are used.
//
// The content runs inside `with (scope)`: names it doesn't declare itself resolve through the scope proxy, which
// answers the hidden ones from the content's own globals; `globalThis`, `self` and the top-level `this` are a proxy of
// the global object that hides the same names. What the content assigns to a hidden name stays among its own globals,
// what it assigns to an engine global replaces it. Unlike the engine, reading a name nobody defined gives undefined
// rather than a ReferenceError (the proxy can't tell `typeof x` from `x`).

const LANGUAGE = [
  'Object', 'Function', 'Array', 'Number', 'parseFloat', 'parseInt', 'Infinity', 'NaN', 'undefined', 'Boolean', 'String',
  'Symbol', 'Date', 'Promise', 'RegExp', 'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError',
  'SyntaxError', 'TypeError', 'URIError', 'JSON', 'Math', 'Intl', 'ArrayBuffer', 'SharedArrayBuffer', 'Atomics',
  'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float16Array', 'Float32Array',
  'Float64Array', 'Uint8ClampedArray', 'BigUint64Array', 'BigInt64Array', 'DataView', 'Map', 'BigInt', 'Set', 'WeakMap',
  'WeakSet', 'Proxy', 'Reflect', 'FinalizationRegistry', 'WeakRef', 'Iterator', 'decodeURI', 'decodeURIComponent',
  'encodeURI', 'encodeURIComponent', 'escape', 'unescape', 'eval', 'isFinite', 'isNaN', 'queueMicrotask', 'WebAssembly',
];

/** What the engine defines globally (types/desktop-engine.d.ts) */
const ENGINE = [
  'DesktopEngine', 'DesktopEngineCore', 'DesktopEngineRuntime', 'console', 'performance', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'require', 'module', 'exports',
  'postMessage', 'mixin', 'promisify', 'WebGLRenderingContext', 'WebGL2RenderingContext',
  'DOMException', 'Event', 'EventTarget', 'MessageEvent', 'CloseEvent', 'ProgressEvent', 'AbortController', 'AbortSignal',
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

const VISIBLE = new Set([...LANGUAGE, ...ENGINE]);
/** Browser functions that throw unless `this` is the real global object */
const BOUND = new Set(['queueMicrotask', 'postMessage']);

const realGlobal = globalThis as unknown as Record<PropertyKey, unknown>;
/** The content's own globals: the hidden names it assigned, and the globals it created */
const own: Record<PropertyKey, unknown> = Object.create(null);
const bound = new Map<string, unknown>();

const visible = (name: PropertyKey): name is string | symbol => typeof name === 'symbol' || VISIBLE.has(name as string);

function visibleValue(name: string | symbol): unknown {
  const value = realGlobal[name];
  if (typeof name !== 'string' || !BOUND.has(name) || typeof value !== 'function') return value;
  let wrapper = bound.get(name);
  if (!wrapper || (wrapper as { original?: unknown }).original !== value) {
    wrapper = Object.assign((value as (...args: unknown[]) => unknown).bind(realGlobal), { original: value });
    bound.set(name, wrapper);
  }
  return wrapper;
}

/** `globalThis`, `self` and `this` for the content */
export const contentGlobal: Record<PropertyKey, unknown> = new Proxy(own, {
  get: (target, name) => (name === 'globalThis' || name === 'self' ? contentGlobal : visible(name) ? visibleValue(name) : target[name]),
  set: (target, name, value) => {
    if (visible(name)) realGlobal[name] = value;
    else target[name] = value;
    return true;
  },
  has: (target, name) => (visible(name) ? name in realGlobal : name in target),
  deleteProperty: (target, name) => (visible(name) ? Reflect.deleteProperty(realGlobal, name) || true : Reflect.deleteProperty(target, name)),
  ownKeys: (target) => [
    ...Reflect.ownKeys(realGlobal).filter((name) => visible(name) && !Object.prototype.hasOwnProperty.call(target, name)),
    ...Reflect.ownKeys(target),
  ],
  getOwnPropertyDescriptor: (target, name) => {
    if (!visible(name)) return Reflect.getOwnPropertyDescriptor(target, name);
    const descriptor = Reflect.getOwnPropertyDescriptor(realGlobal, name);
    // the proxy's target doesn't have it, so it can't be reported as non-configurable
    return descriptor && { ...descriptor, configurable: true };
  },
  defineProperty: (target, name, descriptor) => (visible(name) ? Reflect.defineProperty(realGlobal, name, descriptor) || true : Reflect.defineProperty(target, name, descriptor)),
  getPrototypeOf: () => Object.prototype,
});

/** The names of a function's parameters resolve to them, not through the scope */
function scopeFor(parameters: Set<string>): object {
  return new Proxy(Object.create(null), {
    has: (_target, name) => typeof name === 'string' && !parameters.has(name) && (name === 'globalThis' || name === 'self' || !VISIBLE.has(name)),
    get: (_target, name) => (name === Symbol.unscopables ? undefined : name === 'globalThis' || name === 'self' ? contentGlobal : own[name]),
    set: (_target, name, value) => {
      own[name] = value;
      return true;
    },
  });
}

const SCOPE_PARAMETER = '__desktopEngineScope';

/**
 * Compiles code to run with the content's globals; `parameters` are its arguments' names. The code keeps its lines:
 * it starts on the first line of the function's body.
 */
export function contentFunction(code: string, sourceURL: string, parameters: string[] = []): (...args: unknown[]) => unknown {
  // the wrapper isn't strict (`with`), the content's "use strict" applies to the function it's in
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const program = new Function(SCOPE_PARAMETER, ...parameters, `with (${SCOPE_PARAMETER}) { return (function () {${code}\n}).call(this); }\n//# sourceURL=${sourceURL}`);
  const scope = scopeFor(new Set([SCOPE_PARAMETER, ...parameters]));
  return (...args: unknown[]) => program.call(contentGlobal, scope, ...args);
}
