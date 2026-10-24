// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The engine's 2D context on the web: an object with the engine's members (canvas-api.ts) that draws with the
// browser's context. What a browser has and the engine doesn't (filter, fontKerning…) reads as undefined, as in the app, and what the engine has and a browser doesn't (resetClip,
// resetCurrentState, isContextLost in WebKit) is made of the browser's. Values are taken the way the engine takes them:
// numbers only as numbers (anything else is 0, true is 1), colors and fonts in its subset of CSS, its compositing
// modes; a call that's missing arguments does nothing, where a browser throws.

// A browser without letterSpacing and wordSpacing (Safari before 18.4) keeps them for the getters and draws without.

import {
  COMPOSITE_OPERATIONS, CONTEXT_2D_METHODS, CONTEXT_2D_PROPERTIES, STATE_STACK_SIZE, TEXT_METRICS, formatColor, parseColor,
  parseFont, parseLength, type RGBA,
} from './canvas-api.ts';
import { PATH_METHODS, callPath, matrixArgument, nativePath, num, type PathMethod } from './path2d.ts';
import { standIn } from './stand-ins.ts';

type Method = (typeof CONTEXT_2D_METHODS)[number];
type Property = (typeof CONTEXT_2D_PROPERTIES)[number];

/**
 * The browser's image for one of the engine's drawables (Canvas, CanvasImage, ImageData): null when it has none yet
 * (an image that didn't load), undefined when the value isn't a drawable
 */
export type DrawableSource = (value: unknown) => CanvasImageSource | null | undefined;

/** The browser's compositing for the engine's modes whose names browsers don't have: darker is darken's other name */
const COMPOSITING: Readonly<Record<string, GlobalCompositeOperation>> = { darker: 'darken' };

/** What drawing state a save keeps: the browser's values for these, the transform and the line dash */
const STATE = [
  'fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'lineDashOffset',
  'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'globalCompositeOperation', 'font', 'textAlign',
  'textBaseline',
] as const;

const DEFAULT_FONT = '10px Helvetica';

/** The fill rule at `index` of the arguments: "evenodd", or nonzero */
const fillRule = (args: unknown[], index: number): CanvasFillRule => (typeof args[index] === 'string' && args[index] === 'evenodd' ? 'evenodd' : 'nonzero');
/** The families CSS doesn't take in quotes */
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded', '-apple-system', 'blinkmacsystemfont',
]);

const colors = new Map<string, string | null>();

/**
 * The browser's color for one the engine takes, null for one it ignores. Content sets the same few colors again and
 * again: they're read once
 */
function browserColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let color = colors.get(value);
  if (color === undefined) {
    const rgba = parseColor(value);
    color = rgba ? `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3] / 255})` : null;
    if (colors.size >= 512) colors.clear();
    colors.set(value, color);
  }
  return color;
}

/** A color the browser gives back (`#rrggbb` or `rgba(r, g, b, a)`, as only those are set), as the engine gives it */
function engineColor(value: string): string {
  if (value[0] === '#') return formatColor([1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)).concat(255) as RGBA);
  const [r = 0, g = 0, b = 0, a = 1] = (/\(([^)]*)\)/.exec(value)?.[1] ?? '').split(',').map(Number);
  return formatColor([r, g, b, Math.round(a * 255)]);
}

/** The browser's gradient or pattern of one given to content */
const natives = new WeakMap<object, CanvasGradient | CanvasPattern>();

const GRADIENT = Object.create(Object.prototype, {
  [Symbol.toStringTag]: { value: 'CanvasGradient' },
  addColorStop: {
    writable: true,
    value: function addColorStop(this: object, offset: unknown, color: unknown): void {
      const gradient = natives.get(this) as CanvasGradient | undefined;
      if (!gradient || arguments.length < 2) return;
      // invalid offsets and colors are ignored, where a browser throws
      const stop = num(offset);
      const css = browserColor(color);
      if (!(stop >= 0 && stop <= 1) || !css) return;
      gradient.addColorStop(stop, css);
    },
  },
}) as object;
const PATTERN = Object.create(Object.prototype, { [Symbol.toStringTag]: { value: 'CanvasPattern' } }) as object;
/**
 * The prototype of what measureText gives: as the engine's TextMetrics, an object of a class of its own with its values
 * as its own properties, which a BroadcastChannel refuses
 */
export const METRICS = Object.create(Object.prototype, { [Symbol.toStringTag]: { value: 'TextMetrics' } }) as object;

function style(native: CanvasGradient | CanvasPattern, prototype: object): object {
  // a native object in the engine, which structuredClone and BroadcastChannel refuse
  const value = standIn(Object.create(prototype) as object);
  natives.set(value, native);
  return value;
}

export interface Context2D {
  /** What content gets */
  context: object;
  /**
   * Resizes the canvas with `resize`: the engine keeps the drawing state then (a browser resets it), and clears the
   * pixels as a browser does
   */
  keepingState(resize: () => void): void;
}

/** The 2D context for content: a canvas' (its `canvas`), drawing with the browser's context */
export function createContext2D(native: CanvasRenderingContext2D, canvas: object, drawable: DrawableSource): Context2D {
  native.font = DEFAULT_FONT;
  /** The engine's name of the compositing mode, which the browser's can't tell (darker and darken are both multiply) */
  let composite = 'source-over';
  /** imageSmoothingEnabled isn't part of the engine's state: a restore leaves it */
  let smoothing = true;
  /** Whether the clip of the current state is on a save of its own, which resetClip restores */
  let clipped = false;
  /**
   * The gradients or patterns content set as the styles, which the getters give back: the browser's own objects
   * can't tell them (WebKit makes new ones once nothing else refers to them)
   */
  const objects: { fillStyle: object | null; strokeStyle: object | null } = { fillStyle: null, strokeStyle: null };
  /** letterSpacing and wordSpacing as the engine gives them back (and for a browser without them) */
  const spacing = { letterSpacing: '0px', wordSpacing: '0px' };
  /** What restore brings back that the browser's state doesn't have */
  const stack: {
    composite: string; clipped: boolean; fillStyle: object | null; strokeStyle: object | null; letterSpacing: string;
    wordSpacing: string;
  }[] = [];
  let warnedClip = false;

  const restoreNative = (): void => {
    native.restore();
    native.imageSmoothingEnabled = smoothing;
  };
  const snapshot = () => ({
    values: STATE.map((key) => native[key]),
    transform: native.getTransform(),
    dash: native.getLineDash(),
  });
  const apply = (state: ReturnType<typeof snapshot>): void => {
    STATE.forEach((key, index) => {
      (native as unknown as Record<string, unknown>)[key] = state.values[index];
    });
    native.setTransform(state.transform);
    native.setLineDash(state.dash);
  };
  /** The clip goes, the rest of the state stays */
  const unclip = (keepState: boolean): void => {
    if (clipped) {
      const state = keepState ? snapshot() : null;
      restoreNative();
      if (state) apply(state);
      clipped = false;
    } else if (stack.some((saved) => saved.clipped) && !warnedClip) {
      // the browser's clip of an earlier save stays until the restore that matches it
      warnedClip = true;
      console.warn('resetClip and resetCurrentState only remove a clip made after the last save() in the web preview; in the app they remove the clips made before it too');
    }
  };
  const sourceOf = (image: unknown, method: string): CanvasImageSource | null => {
    const source = drawable(image);
    if (source === undefined) {
      if ((typeof image === 'object' && image !== null) || typeof image === 'function') {
        console.warn(`\`CanvasRenderingContext2D.${method}\` image is not an Image, ImageData, ImageBitmap, Canvas or Video`);
      }
      return null;
    }
    return source;
  };
  const setStyle = (key: 'fillStyle' | 'strokeStyle', value: unknown): void => {
    if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
      const gradientOrPattern = natives.get(value);
      if (gradientOrPattern) {
        native[key] = gradientOrPattern;
        objects[key] = value;
      }
      return;
    }
    const css = browserColor(value);
    if (css) {
      native[key] = css;
      objects[key] = null;
    }
  };
  const getStyle = (key: 'fillStyle' | 'strokeStyle'): unknown => {
    const value = native[key];
    return typeof value === 'string' ? engineColor(value) : objects[key];
  };
  /** The engine's gradients take any numbers; the browser's throw for some (negative radii), and paint nothing then */
  const gradient = (make: () => CanvasGradient): object => {
    let made: CanvasGradient;
    try {
      made = make();
    } catch {
      made = native.createLinearGradient(0, 0, 0, 0);
    }
    return style(made, GRADIENT);
  };

  const methods: Record<Exclude<Method, PathMethod>, (...args: unknown[]) => unknown> = {
    isContextLost() {
      return native.isContextLost?.() ?? false;
    },
    save() {
      if (stack.length === STATE_STACK_SIZE - 1) {
        console.warn(`max canvas state stack size (${STATE_STACK_SIZE}) reached`);
        return;
      }
      native.save();
      stack.push({ composite, clipped, ...objects, ...spacing });
      clipped = false;
    },
    restore() {
      const saved = stack.pop();
      if (!saved) return;
      if (clipped) native.restore();
      restoreNative();
      ({ composite, clipped } = saved);
      objects.fillStyle = saved.fillStyle;
      objects.strokeStyle = saved.strokeStyle;
      spacing.letterSpacing = saved.letterSpacing;
      spacing.wordSpacing = saved.wordSpacing;
    },
    resetCurrentState() {
      unclip(false);
      composite = 'source-over';
      objects.fillStyle = null;
      objects.strokeStyle = null;
      spacing.letterSpacing = '0px';
      spacing.wordSpacing = '0px';
      if ('letterSpacing' in native) Object.assign(native, { letterSpacing: '0px', wordSpacing: '0px' });
      Object.assign(native, {
        globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
        miterLimit: 10, textBaseline: 'alphabetic', textAlign: 'start', font: DEFAULT_FONT, fillStyle: '#000',
        strokeStyle: '#000', lineDashOffset: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowBlur: 0, shadowOffsetX: 0,
        shadowOffsetY: 0,
      });
      native.setTransform(1, 0, 0, 1, 0, 0);
      native.setLineDash([]);
      native.beginPath();
    },
    rotate(angle) {
      if (arguments.length >= 1) native.rotate(num(angle));
    },
    translate(x, y) {
      if (arguments.length >= 2) native.translate(num(x), num(y));
    },
    scale(x, y) {
      if (arguments.length >= 2) native.scale(num(x), num(y));
    },
    transform(a, b, c, d, e, f) {
      if (arguments.length >= 6) native.transform(num(a), num(b), num(c), num(d), num(e), num(f));
    },
    setTransform(a, b, c, d, e, f) {
      if (arguments.length >= 6) {
        native.setTransform(num(a), num(b), num(c), num(d), num(e), num(f));
      } else if (arguments.length <= 1) {
        // a matrix, e.g. getTransform's, its values read as numbers; none is the identity
        native.setTransform(matrixArgument(a, 'setTransform'));
      }
    },
    getTransform() {
      // a DOMMatrix's values, not the DOMMatrix: the app's has no methods
      const { a, b, c, d, e, f, isIdentity } = native.getTransform();
      return {
        a, b, c, d, e, f, m11: a, m12: b, m13: 0, m14: 0, m21: c, m22: d, m23: 0, m24: 0, m31: 0, m32: 0, m33: 1, m34: 0,
        m41: e, m42: f, m43: 0, m44: 1, is2D: true, isIdentity,
      };
    },
    resetTransform() {
      native.setTransform(1, 0, 0, 1, 0, 0);
    },
    drawImage(image, ...rest) {
      const count = arguments.length;
      if (count !== 3 && count !== 5 && count < 9) return;
      const source = sourceOf(image, 'drawImage');
      if (!source) return;
      const [a, b, c, d, e, f, g, h] = rest.map(num);
      if (count === 3) native.drawImage(source, a, b);
      // the source rectangle is in whole pixels
      else if (count === 5) native.drawImage(source, a, b, c, d);
      else native.drawImage(source, Math.trunc(a), Math.trunc(b), Math.trunc(c), Math.trunc(d), e, f, g, h);
    },
    fillRect(x, y, width, height) {
      if (arguments.length >= 4) native.fillRect(num(x), num(y), num(width), num(height));
    },
    strokeRect(x, y, width, height) {
      if (arguments.length >= 4) native.strokeRect(num(x), num(y), num(width), num(height));
    },
    clearRect(x, y, width, height) {
      if (arguments.length >= 4) native.clearRect(num(x), num(y), num(width), num(height));
    },
    getImageData(x, y, width, height) {
      if (arguments.length < 4) return undefined;
      const w = Math.trunc(num(width));
      const h = Math.trunc(num(height));
      if (!(Math.abs(w) >= 1 && Math.abs(h) >= 1)) throw new DOMException('getImageData width and height must not be zero', 'IndexSizeError');
      return native.getImageData(num(x), num(y), w, h);
    },
    createImageData(width, height, data) {
      if (arguments.length < 2) return undefined;
      const w = Math.abs(Math.trunc(num(width)));
      const h = Math.abs(Math.trunc(num(height)));
      if (!(w >= 1 && h >= 1)) throw new DOMException('createImageData width and height must not be zero', 'IndexSizeError');
      const image = native.createImageData(w, h);
      // the engine's third argument fills it (the standard settings object is ignored)
      if (data instanceof Uint8ClampedArray) {
        if (data.length !== image.data.length) throw new DOMException('createImageData data must have width * height * 4 bytes', 'IndexSizeError');
        image.data.set(data);
      }
      return image;
    },
    putImageData(image, x, y) {
      if (arguments.length < 3) return;
      if (!(image instanceof ImageData)) throw new TypeError('putImageData needs an ImageData');
      native.putImageData(image, num(x), num(y));
    },
    createLinearGradient(x0, y0, x1, y1) {
      if (arguments.length < 4) return undefined;
      return gradient(() => native.createLinearGradient(num(x0), num(y0), num(x1), num(y1)));
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      if (arguments.length < 6) return undefined;
      return gradient(() => native.createRadialGradient(num(x0), num(y0), num(r0), num(x1), num(y1), num(r1)));
    },
    createConicGradient(startAngle, x, y) {
      if (arguments.length < 3) return undefined;
      return gradient(() => native.createConicGradient(num(startAngle), num(x), num(y)));
    },
    createPattern(image, repetition) {
      if (arguments.length < 1) return undefined;
      const source = sourceOf(image, 'createPattern');
      if (!source) return undefined;
      const name = arguments.length > 1 ? String(repetition) : 'repeat';
      const pattern = native.createPattern(source, name === 'repeat-x' || name === 'repeat-y' || name === 'no-repeat' ? name : 'repeat');
      return pattern ? style(pattern, PATTERN) : undefined;
    },
    beginPath() {
      native.beginPath();
    },
    fill(...args) {
      // a Path2D first, when there's one
      const path = nativePath(args[0]);
      const rule = fillRule(args, path ? 1 : 0);
      if (path) native.fill(path, rule);
      else native.fill(rule);
    },
    stroke(path) {
      const native2D = nativePath(path);
      if (native2D) native.stroke(native2D);
      else native.stroke();
    },
    isPointInPath(...args) {
      const path = nativePath(args[0]);
      const first = path ? 1 : 0;
      if (args.length < first + 2) throw new TypeError('isPointInPath takes a point (x, y)');
      const x = num(args[first]);
      const y = num(args[first + 1]);
      const rule = fillRule(args, first + 2);
      return path ? native.isPointInPath(path, x, y, rule) : native.isPointInPath(x, y, rule);
    },
    isPointInStroke(...args) {
      const path = nativePath(args[0]);
      const first = path ? 1 : 0;
      if (args.length < first + 2) throw new TypeError('isPointInStroke takes a point (x, y)');
      const x = num(args[first]);
      const y = num(args[first + 1]);
      return path ? native.isPointInStroke(path, x, y) : native.isPointInStroke(x, y);
    },
    measureText(text) {
      if (arguments.length < 1) return undefined;
      const metrics = native.measureText(String(text));
      return standIn(Object.freeze(Object.assign(Object.create(METRICS) as object, Object.fromEntries(TEXT_METRICS.map((key) => [key, metrics[key]])))));
    },
    fillText(text, x, y, maxWidth) {
      if (arguments.length < 3) return;
      if (arguments.length > 3) native.fillText(String(text), num(x), num(y), num(maxWidth));
      else native.fillText(String(text), num(x), num(y));
    },
    strokeText(text, x, y, maxWidth) {
      if (arguments.length < 3) return;
      if (arguments.length > 3) native.strokeText(String(text), num(x), num(y), num(maxWidth));
      else native.strokeText(String(text), num(x), num(y));
    },
    clip(...args) {
      if (!clipped) {
        native.save();
        clipped = true;
      }
      const path = nativePath(args[0]);
      const rule = fillRule(args, path ? 1 : 0);
      if (path) native.clip(path, rule);
      else native.clip(rule);
    },
    resetClip() {
      unclip(true);
    },
    getLineDash() {
      return native.getLineDash();
    },
    setLineDash(segments) {
      if (!Array.isArray(segments)) return;
      const values: number[] = [];
      for (const item of segments as unknown[]) {
        // a string may be a number
        const value = typeof item === 'number' ? item : typeof item === 'boolean' ? Number(item) : typeof item === 'string' ? parseFloat(item) : NaN;
        // as on the web, a negative or non-finite value makes the call be ignored
        if (!Number.isFinite(value) || value < 0) return;
        values.push(value);
      }
      native.setLineDash(values);
    },
  };

  // the engine keeps these as 32-bit floats
  const numeric = (key: 'lineWidth' | 'miterLimit' | 'lineDashOffset' | 'shadowBlur' | 'shadowOffsetX' | 'shadowOffsetY') => ({
    get: () => Math.fround(native[key]),
    set: (value: unknown) => {
      native[key] = num(value);
    },
  });
  const passed = (key: 'lineCap' | 'lineJoin' | 'textAlign' | 'textBaseline') => ({
    get: () => native[key],
    set: (value: unknown) => {
      (native as unknown as Record<string, unknown>)[key] = String(value);
    },
  });
  const properties: Record<Property, { get(): unknown; set(value: unknown): void }> = {
    globalCompositeOperation: {
      get: () => composite,
      set: (value) => {
        const name = String(value);
        if (!(COMPOSITE_OPERATIONS as readonly string[]).includes(name)) return;
        composite = name;
        native.globalCompositeOperation = COMPOSITING[name] ?? (name as GlobalCompositeOperation);
      },
    },
    lineCap: passed('lineCap'),
    lineJoin: passed('lineJoin'),
    textAlign: passed('textAlign'),
    textBaseline: passed('textBaseline'),
    fillStyle: { get: () => getStyle('fillStyle'), set: (value) => setStyle('fillStyle', value) },
    strokeStyle: { get: () => getStyle('strokeStyle'), set: (value) => setStyle('strokeStyle', value) },
    globalAlpha: {
      get: () => Math.fround(native.globalAlpha),
      set: (value) => {
        // clamped, where a browser ignores what's out of range
        const alpha = num(value);
        native.globalAlpha = alpha > 0 ? Math.min(alpha, 1) : 0;
      },
    },
    lineWidth: numeric('lineWidth'),
    miterLimit: numeric('miterLimit'),
    font: {
      get: () => native.font,
      set: (value) => {
        const font = parseFont(value);
        if (!font) return;
        // as CSS takes it; without families the font keeps its own
        const families = font.families
          ? font.families.split(', ').map((family) => (GENERIC_FAMILIES.has(family.toLowerCase()) ? family : JSON.stringify(family))).join(', ')
          : native.font.replace(/^.*?\d*\.?\d+px(?:\/\S+)?\s*/, '');
        native.font = `${font.italic ? 'italic ' : ''}${font.weight} ${font.size}px ${families}`;
      },
    },
    letterSpacing: {
      get: () => spacing.letterSpacing,
      set: (value) => {
        const length = parseLength(value);
        if (length === null) return;
        spacing.letterSpacing = length;
        if ('letterSpacing' in native) native.letterSpacing = length;
      },
    },
    wordSpacing: {
      get: () => spacing.wordSpacing,
      set: (value) => {
        const length = parseLength(value);
        if (length === null) return;
        spacing.wordSpacing = length;
        if ('wordSpacing' in native) native.wordSpacing = length;
      },
    },
    imageSmoothingEnabled: {
      get: () => smoothing,
      set: (value) => {
        smoothing = Boolean(value);
        native.imageSmoothingEnabled = smoothing;
      },
    },
    lineDashOffset: numeric('lineDashOffset'),
    shadowColor: {
      get: () => engineColor(native.shadowColor),
      set: (value) => {
        const css = browserColor(value);
        if (css) native.shadowColor = css;
      },
    },
    shadowBlur: numeric('shadowBlur'),
    shadowOffsetX: numeric('shadowOffsetX'),
    shadowOffsetY: numeric('shadowOffsetY'),
  };

  const context = standIn(Object.create(Object.prototype, { [Symbol.toStringTag]: { value: 'Canvas2DRenderingContext' } }) as object);
  Object.defineProperty(context, 'canvas', { get: () => canvas, enumerable: true });
  for (const [name, { get, set }] of Object.entries(properties)) Object.defineProperty(context, name, { get, set, enumerable: true });
  for (const [name, value] of Object.entries(methods)) Object.defineProperty(context, name, { value, writable: true, enumerable: true });
  for (const name of PATH_METHODS) {
    Object.defineProperty(context, name, { value: (...args: unknown[]) => callPath(native, name, args), writable: true, enumerable: true });
  }

  const keepingState = (resize: () => void): void => {
    // the saved states, read off the browser's stack before it forgets them: each save's, under the clip's own save
    // when its state had a clip
    const current = snapshot();
    if (clipped) native.restore();
    const saved: ReturnType<typeof snapshot>[] = [];
    for (let index = stack.length - 1; index >= 0; index--) {
      native.restore();
      saved[index] = snapshot();
      if (stack[index].clipped) native.restore();
    }
    resize();
    native.imageSmoothingEnabled = smoothing;
    const applySpacing = (values: typeof spacing): void => {
      if ('letterSpacing' in native) Object.assign(native, { letterSpacing: values.letterSpacing, wordSpacing: values.wordSpacing });
    };
    // the saves again, without their clips, which the browser forgot
    stack.forEach((entry, index) => {
      apply(saved[index]);
      applySpacing(entry);
      native.save();
      entry.clipped = false;
    });
    apply(current);
    applySpacing(spacing);
    clipped = false;
  };
  return { context, keepingState };
}
