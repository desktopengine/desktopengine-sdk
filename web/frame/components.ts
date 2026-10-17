// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The engine's components on the web: Component (a flex container), Window (a positioned box on the desktop), Canvas
// (a real <canvas>: 2D and WebGL draw with the browser's contexts, which offer what the engine's have, see
// context2d.ts and webgl.ts), CanvasImage, Image and Video. The rules of the engine hold: the content's type limits
// the window types, at most 16 windows, widget and overlay windows below the menu bar and at most half a display,
// drawImage and texImage2D take the engine's Canvas and CanvasImage.

import { createContext2D } from './context2d.ts';
import { defineEvents, Evented } from './events.ts';
import { adaptWebGL } from './webgl.ts';
import { applyStyle, BASE_CSS, createStyle, readStyle, STYLE_KEYS, stylePoints, styleValue, type StyleValue } from './style.ts';
import { isDataURL, mediaURL } from './network.ts';
import { hasPermission, itemsOf, nextIdentifier, send, state } from './state.ts';
import type { Rect, WindowState } from '../protocol.ts';

// what the content may replace, taken before it runs: what the runtime does on its own (the host's messages, telling
// it where the windows are, destroying them when the content stops) uses nothing the content can change, as the
// engine's native components don't
const { apply } = Reflect;
const { assign } = Object;
const { has: setHas, add: setAdd, delete: setDelete } = Set.prototype;
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;
const { set: mapSet } = Map.prototype;
const { then } = Promise.prototype;
const { max, floor, sqrt } = Math;
const queueTask = queueMicrotask.bind(globalThis);

const COMPONENT_EVENTS = ['framechange', 'click', 'dblclick', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave', 'mousemove', 'wheel'];
const STYLE_NAMES = new Set(STYLE_KEYS);
/** In Yoga these win over flex, whichever was set first; in CSS flex sets them */
const FLEX_LONGHANDS = ['flexGrow', 'flexShrink', 'flexBasis'];
const MAX_WINDOWS = 16;

/** Which component an element is, for finding what the pointer is on */
export const componentOf = new WeakMap<Element, ComponentImpl>();

export class ComponentImpl extends Evented {
  readonly identifier = nextIdentifier();
  readonly element: HTMLElement;
  parent: ComponentImpl | null = null;
  protected readonly childList: ComponentImpl[] = [];
  protected readonly styleValues = new Map<string, StyleValue>();
  private readonly styleObject: Record<string, unknown>;
  private resizeObserver: ResizeObserver | null = null;

  constructor(options?: Record<string, unknown>, element?: HTMLElement) {
    super();
    this.element = element ?? document.createElement('div');
    this.element.style.cssText = BASE_CSS + this.element.style.cssText;
    componentOf.set(this.element, this);
    this.styleObject = createStyle(this.styleValues, (key, value) => this.setStyle(key, value));
    this.style = options?.style as Record<string, unknown>;
  }

  get style(): Record<string, unknown> {
    return this.styleObject;
  }

  set style(value: Record<string, unknown>) {
    // read in full before it replaces the style (`component.style = component.style` keeps it); anything but an
    // object, an array or a typed array leaves it as it is
    const entries = readStyle(value);
    if (!entries) return;
    for (const key of [...this.styleValues.keys()]) this.setStyle(key, null);
    for (const [key, item] of entries) this.setStyle(key, item);
  }

  /** Sets one style property: a string or a number is kept as given, anything else unsets it */
  setStyle(key: string, value: unknown): void {
    if (!STYLE_NAMES.has(key)) return;
    const item = styleValue(value);
    if (item === null) this.styleValues.delete(key);
    else this.styleValues.set(key, item);
    applyStyle(this.element, key, item);
    if (key === 'flex') {
      for (const longhand of FLEX_LONGHANDS) {
        if (this.styleValues.has(longhand)) applyStyle(this.element, longhand, this.styleValues.get(longhand)!);
      }
    }
  }

  get width(): number {
    return this.element.getBoundingClientRect().width;
  }

  get height(): number {
    return this.element.getBoundingClientRect().height;
  }

  get children(): ComponentImpl[] {
    return [...this.childList];
  }

  appendChild(child: unknown, index?: unknown): void {
    if (!(child instanceof ComponentImpl)) throw new TypeError('appendChild needs a component');
    if (child instanceof WindowImpl) throw new TypeError('a Window can\'t be a child');
    if (child === this || child.contains(this)) throw new TypeError('a component can\'t contain itself');
    const count = this.childList.length - (child.parent === this ? 1 : 0);
    const position = index === undefined || index === -1 ? count : Number(index);
    if (!Number.isInteger(position) || position < 0 || position > count) throw new RangeError(`index ${String(index)} is out of range 0…${count}`);
    // moved within the window: it stays in it
    const wasInWindow = child.inWindow;
    child.parent?.detach(child);
    this.childList.splice(position, 0, child);
    child.parent = this;
    this.element.insertBefore(child.element, this.childList[position + 1]?.element ?? null);
    if (child.inWindow !== wasInWindow) child.notifyInWindow(!wasInWindow);
  }

  removeChild(child: unknown): void {
    if (!(child instanceof ComponentImpl) || child.parent !== this) throw new Error('not a child of this component');
    const wasInWindow = child.inWindow;
    this.detach(child);
    if (wasInWindow) child.notifyInWindow(false);
  }

  remove(): void {
    const wasInWindow = this.inWindow;
    this.parent?.detach(this);
    if (wasInWindow && !this.inWindow) this.notifyInWindow(false);
  }

  private detach(child: ComponentImpl): void {
    const index = this.childList.indexOf(child);
    if (index >= 0) this.childList.splice(index, 1);
    child.element.remove();
    child.parent = null;
  }

  contains(other: ComponentImpl): boolean {
    for (let node: ComponentImpl | null = other; node; node = node.parent) if (node === this) return true;
    return false;
  }

  /** The window it's in */
  get rootWindow(): WindowImpl | null {
    let node: ComponentImpl | null = this;
    while (node && !(node instanceof WindowImpl)) node = node.parent;
    return node as WindowImpl | null;
  }

  /** In a window that isn't destroyed, directly or inside other components */
  get inWindow(): boolean {
    const window = this.rootWindow;
    return window !== null && (apply(setHas, windows, [window]) as boolean);
  }

  private notifyInWindow(inWindow: boolean): void {
    this.inWindowChanged(inWindow);
    const children = this.childList;
    for (let index = 0; index < children.length; index++) children[index].notifyInWindow(inWindow);
  }

  /** Added to a window or removed from one, itself or with a parent */
  protected inWindowChanged(_inWindow: boolean): void {}

  override destroy(): void {
    super.destroy();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const children = this.childList;
    for (let index = 0; index < children.length; index++) children[index].destroy();
  }

  protected override listenersChanged(name: string): void {
    if (name === 'framechange' && !this.resizeObserver && this.listens('framechange')) {
      this.resizeObserver = new ResizeObserver(() => this.emit('framechange', this.frame()));
      this.resizeObserver.observe(this.element);
    }
  }

  /** The frame after layout, relative to the parent */
  frame(): Rect {
    const rect = this.element.getBoundingClientRect();
    const parentRect = this.element.parentElement?.getBoundingClientRect();
    return { x: rect.left - (parentRect?.left ?? 0), y: rect.top - (parentRect?.top ?? 0), width: rect.width, height: rect.height };
  }

  /** A point of the frame's page in this component's coordinates */
  localPoint(pageX: number, pageY: number): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: pageX - rect.left, y: pageY - rect.top };
  }
}
defineEvents(ComponentImpl.prototype, COMPONENT_EVENTS);

// MARK: Window

const LAYERS: Record<string, number> = { desktop: 0, widget: 2, overlay: 3, panel: 4, normal: 4 };
const windows = new Set<WindowImpl>();
/** Every window made here, by identity: a Proxy of one, or another object, is never a parent (no traps run) */
const madeWindows = new WeakSet<object>();
let windowOrder = 0;

function allowedTypes(): string[] | null {
  const type = state.launch?.allowedWindowType;
  return type ? [type] : null;
}

function positiveRects(value: unknown): Rect[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new TypeError('a region is an array of { x, y, width, height }, or null');
  return value
    .map((rect) => ({ x: Number(rect?.x) || 0, y: Number(rect?.y) || 0, width: Number(rect?.width) || 0, height: Number(rect?.height) || 0 }))
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

/** A copy of a region, each rect a new object */
function copyRects(rects: Rect[]): Rect[] {
  const copy: Rect[] = [];
  for (let index = 0; index < rects.length; index++) copy[index] = { ...rects[index] };
  return copy;
}

let reportScheduled = false;
/** The host hit tests with the windows' frames and regions: tell it what changed, once per task */
export function reportWindows(): void {
  if (reportScheduled) return;
  reportScheduled = true;
  queueTask(() => {
    reportScheduled = false;
    const all = allWindows();
    const states: WindowState[] = [];
    for (let index = 0; index < all.length; index++) states[index] = all[index].stateForHost();
    send({ type: 'windows', windows: states });
  });
}

export class WindowImpl extends ComponentImpl {
  readonly type: string;
  readonly order = ++windowOrder;
  shown = false;
  allowsTiling = false;
  private hit: Rect[] | null = null;
  private drag: Rect[] | null = null;
  private frameRect: Rect = { x: 0, y: 0, width: 400, height: 300 };
  private parentRef: WindowImpl | null = null;
  /** Private: content can't redefine it on a window it passes as a parent */
  readonly #childWindows: WindowImpl[] = [];

  constructor(options?: Record<string, unknown>) {
    // each option read once, as in the app: a getter can't answer one type to the check and another to the window
    const givenType = options?.type;
    const style = options?.style;
    const parent = options?.parent;
    const parentWindow = isWindow(parent) ? parent : null;
    const type = typeof givenType === 'string' && givenType ? givenType : 'normal';
    const allowed = allowedTypes();
    if (allowed && !allowed.includes(type)) {
      throw new TypeError(`a ${state.launch?.contentType} placed here can't make "${type}" windows, only ${allowed.map((name) => `"${name}"`).join(' or ')} (launchOptions.windowType)`);
    }
    if (allowed && (apply(setSize, windows, []) as number) >= MAX_WINDOWS) {
      throw new Error(`content can have at most ${MAX_WINDOWS} windows: destroy() the ones it no longer needs`);
    }
    super(undefined);
    madeWindows.add(this);
    this.type = isKey(LAYERS, type) ? type : 'normal';
    this.element.style.position = 'absolute';
    this.element.style.zIndex = String(LAYERS[this.type] * 1000 + (this.order % 1000));
    this.element.hidden = true;
    apply(setAdd, windows, [this]);
    try {
      this.style = style as Record<string, unknown>;
      if (parentWindow) this.parentWindow = parentWindow;
      this.place();
    } catch (error) {
      // whatever threw (e.g. a property content redefined on the parent), the window that isn't made isn't counted
      apply(setDelete, windows, [this]);
      this.parentWindow = null;
      this.element.remove();
      try {
        reportWindows();
      } catch {
        // reported with the next change
      }
      throw error;
    }
  }

  override setStyle(key: string, value: unknown): void {
    if (key === 'left' || key === 'top' || key === 'width' || key === 'height') {
      // the frame, in points: kept as given like any style value, the default where it isn't a number of points
      const item = styleValue(value);
      if (item === null) this.styleValues.delete(key);
      else this.styleValues.set(key, item);
      const number = stylePoints(item);
      const field = key === 'left' ? 'x' : key === 'top' ? 'y' : key;
      const fallback = { x: 0, y: 0, width: 400, height: 300 }[field];
      this.frameRect = { ...this.frameRect, [field]: Number.isFinite(number) ? number : fallback };
      this.place();
      return;
    }
    super.setStyle(key, value);
  }

  get devicePixelRatio(): number {
    return this.screen()?.scale ?? 2;
  }

  get parentWindow(): WindowImpl | null {
    return this.parentRef;
  }

  set parentWindow(value: unknown) {
    if (this.parentRef) {
      // by index: destroy() sets it, also when the content stops
      const siblings = this.parentRef.#childWindows;
      let found = false;
      for (let index = 0; index < siblings.length; index++) {
        if (found) siblings[index - 1] = siblings[index];
        else found = siblings[index] === this;
      }
      if (found) siblings.length -= 1;
    }
    this.parentRef = isWindow(value) && value !== this ? value : null;
    if (this.parentRef) {
      const siblings = this.parentRef.#childWindows;
      siblings[siblings.length] = this;
    }
  }

  get childWindows(): WindowImpl[] {
    return [...this.#childWindows];
  }

  get hitRegion(): Rect[] | null {
    return this.hit ? copyRects(this.hit) : null;
  }

  set hitRegion(value: unknown) {
    this.hit = positiveRects(value);
    reportWindows();
  }

  get dragRegion(): Rect[] | null {
    return this.drag ? copyRects(this.drag) : null;
  }

  set dragRegion(value: unknown) {
    this.drag = positiveRects(value);
    reportWindows();
  }

  /** The screen its center is on */
  screen(): (typeof state.screens)[number] | undefined {
    const centerX = this.frameRect.x + this.frameRect.width / 2;
    const centerY = this.frameRect.y + this.frameRect.height / 2;
    const inside = (rect: Rect) => centerX >= rect.x && centerY >= rect.y && centerX < rect.x + rect.width && centerY < rect.y + rect.height;
    const screens = state.screens;
    for (let index = 0; index < screens.length; index++) if (inside(screens[index].bounds)) return screens[index];
    return screens[0];
  }

  /** widget and overlay windows stay below the menu bar and cover at most half of a display */
  private restricted(frame: Rect): Rect {
    if (!allowedTypes() || (this.type !== 'widget' && this.type !== 'overlay')) return frame;
    const screen = this.screen();
    if (!screen) return frame;
    let { width, height } = frame;
    const limit = (screen.bounds.width * screen.bounds.height) / 2;
    if (width * height > limit) {
      const scale = sqrt(limit / (width * height));
      width = floor(width * scale);
      height = floor(height * scale);
    }
    return { x: frame.x, y: max(frame.y, screen.visibleFrame.y), width, height };
  }

  /** Where it is on the desktop */
  get globalFrame(): Rect {
    return this.restricted(this.frameRect);
  }

  private place(): void {
    const frame = this.globalFrame;
    assign(this.element.style, { left: `${frame.x}px`, top: `${frame.y}px`, width: `${frame.width}px`, height: `${frame.height}px` });
    reportWindows();
  }

  /** The host moved it: the user dragged it */
  moveTo(x: number, y: number): void {
    this.frameRect = { ...this.frameRect, x, y };
    apply(mapSet, this.styleValues, ['left', x]);
    apply(mapSet, this.styleValues, ['top', y]);
    this.place();
    const frame = this.globalFrame;
    this.emit('move', { x: frame.x, y: frame.y });
  }

  show(): void {
    // as in the app: a destroyed window is gone for good
    if (!apply(setHas, windows, [this])) throw new Error('This window was destroyed; make a new one to show it again');
    if (this.shown) return;
    this.shown = true;
    if (!this.element.isConnected) document.body.appendChild(this.element);
    this.element.hidden = false;
    reportWindows();
    this.emit('show');
  }

  close(): void {
    this.emit('close');
    this.destroy();
  }

  override remove(): void {
    console.warn('Window doesn\'t support remove: use close() or destroy()');
  }

  override destroy(): void {
    if (!apply(setHas, windows, [this])) return;
    apply(setDelete, windows, [this]);
    this.shown = false;
    this.element.remove();
    this.parentWindow = null;
    super.destroy();
    reportWindows();
  }

  stateForHost(): WindowState {
    return {
      id: this.identifier,
      type: this.type,
      frame: this.globalFrame,
      visible: this.shown,
      z: LAYERS[this.type] * 1000 + (this.order % 1000),
      hitRegion: this.hitRegion,
      dragRegion: this.dragRegion,
      movable: this.type === 'widget' || this.type === 'overlay',
    };
  }

  /** The page hid the desktop or showed it again, like the window's occlusion changing */
  visibilityChanged(visible: boolean): void {
    if (this.shown) this.emit(visible ? 'show' : 'hide');
  }
}
defineEvents(WindowImpl.prototype, ['show', 'hide', 'close', 'resize', 'move', 'focus', 'blur', 'keydown', 'keyup', 'devicepixelratiochange', 'dragenter', 'dragover', 'dragleave', 'drop']);

export function windowById(id: string): WindowImpl | undefined {
  const all = allWindows();
  for (let index = 0; index < all.length; index++) if (all[index].identifier === id) return all[index];
  return undefined;
}

/** The windows that aren't destroyed, in a list */
export function allWindows(): WindowImpl[] {
  return itemsOf(windows);
}

// MARK: Canvas

/** The browser's object for an engine object passed to texImage2D and its kin */
/** The browser's element of an engine Canvas or CanvasImage, for the browser's own APIs; anything else as it is */
export function unwrap(value: unknown): unknown {
  if (value instanceof CanvasImpl) return value.canvas;
  if (value instanceof CanvasImageImpl) return value.image;
  return value;
}

let imageDataCanvas: HTMLCanvasElement | null = null;

/**
 * What the 2D context's drawImage and createPattern draw for an engine drawable: a Canvas, a CanvasImage once it
 * loaded (null before), an ImageBitmap, or ImageData, which the engine draws too and a browser doesn't
 */
function drawableSource(value: unknown): CanvasImageSource | null | undefined {
  if (value instanceof CanvasImpl) return value.canvas;
  if (value instanceof ImageBitmap) return value;
  if (value instanceof CanvasImageImpl) return value.complete ? value.image : null;
  if (value instanceof ImageData) {
    imageDataCanvas ??= document.createElement('canvas');
    imageDataCanvas.width = value.width;
    imageDataCanvas.height = value.height;
    imageDataCanvas.getContext('2d')!.putImageData(value, 0, 0);
    return imageDataCanvas;
  }
  return undefined;
}

export class CanvasImpl extends ComponentImpl {
  readonly canvas: HTMLCanvasElement;
  private explicitSize = { width: false, height: false };
  private context: object | null = null;
  /** A 2D context's: it keeps its state when the canvas is resized */
  private keepingState: ((resize: () => void) => void) | null = null;
  private contextType: string | null = null;
  private sizeObserver: ResizeObserver;

  constructor(options?: Record<string, unknown>) {
    const canvas = document.createElement('canvas');
    super(options, canvas);
    this.canvas = canvas;
    // 300 × 150 when it's given no style, as in the app
    if (this.styleValues.size === 0) {
      this.setStyle('width', 300);
      this.setStyle('height', 150);
    }
    // a drawing buffer that wasn't sized follows the layout
    this.sizeObserver = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      this.resizeBuffer(
        !this.explicitSize.width && rect.width >= 2 ? Math.min(Math.round(rect.width), 16383) : canvas.width,
        !this.explicitSize.height && rect.height >= 2 ? Math.min(Math.round(rect.height), 16383) : canvas.height,
      );
    });
    this.sizeObserver.observe(canvas);
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.emit('webglcontextlost', { type: 'webglcontextlost', statusMessage: 'the GPU stopped the canvas\' work', preventDefault() {} });
    });
    canvas.addEventListener('contextlost', () => this.emit('contextlost', { type: 'contextlost', statusMessage: 'the GPU stopped the canvas\' work', preventDefault() {} }));
  }

  override get width(): number {
    return this.canvas.width;
  }

  override set width(value: number) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return;
    this.explicitSize.width = true;
    this.resizeBuffer(Math.min(Math.max(number, 2), 16383), this.canvas.height);
  }

  override get height(): number {
    return this.canvas.height;
  }

  override set height(value: number) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return;
    this.explicitSize.height = true;
    this.resizeBuffer(this.canvas.width, Math.min(Math.max(number, 2), 16383));
  }

  /**
   * As the engine resizes the drawing buffer: the size it has already changes nothing (a browser clears the canvas and
   * resets a 2D context's state then), a new one clears it and keeps the state
   */
  private resizeBuffer(width: number, height: number): void {
    if (width === this.canvas.width && height === this.canvas.height) return;
    const resize = () => {
      if (width !== this.canvas.width) this.canvas.width = width;
      if (height !== this.canvas.height) this.canvas.height = height;
    };
    if (this.keepingState) this.keepingState(resize);
    else resize();
  }

  getContext(type: unknown, options?: unknown): object | null {
    const name = String(type);
    const kind = name === '2d' ? '2d' : name === 'webgl2' ? 'webgl2' : /webgl/.test(name) && !/webgl2/.test(name) ? 'webgl' : null;
    if (!kind) return null;
    if (this.contextType) return this.contextType === kind ? this.context : null;
    // As the engine reads them: only from an object, in the order of their names; a member that's undefined is the
    // default (antialiasing is off), any other value is converted to a boolean, so `{ alpha: null }` is opaque
    let alpha = true;
    let antialias = false;
    if ((typeof options === 'object' && options !== null) || typeof options === 'function') {
      const record = options as Record<string, unknown>;
      const alphaValue = record.alpha;
      const antialiasValue = record.antialias;
      if (alphaValue !== undefined) alpha = !!alphaValue;
      if (antialiasValue !== undefined) antialias = !!antialiasValue;
      // a getter made one meanwhile
      if (this.contextType) return this.contextType === kind ? this.context : null;
    }
    const attributes = { alpha, antialias, premultipliedAlpha: true, preserveDrawingBuffer: false };
    const context = this.canvas.getContext(kind, attributes);
    if (!context) return null;
    this.contextType = kind;
    if (kind === '2d') {
      const context2D = createContext2D(context as CanvasRenderingContext2D, this, drawableSource);
      this.context = context2D.context;
      this.keepingState = context2D.keepingState;
    } else {
      adaptWebGL(context as WebGLRenderingContext, kind === 'webgl2' ? 2 : 1, this, unwrap);
      this.context = context;
    }
    return this.context;
  }
}
defineEvents(CanvasImpl.prototype, ['webglcontextlost', 'contextlost']);

// MARK: CanvasImage

export class CanvasImageImpl extends Evented {
  readonly image = document.createElement('img');
  private source = '';
  private loaded = false;
  readonly nodeName = 'IMG';
  readonly tagName = 'IMG';

  constructor() {
    super();
    this.image.decoding = 'async';
    this.image.onload = () => {
      this.loaded = true;
      this.emit('load');
    };
    this.image.onerror = () => {
      if (!this.source) return;
      this.loaded = false;
      this.emit('error');
    };
  }

  get src(): string {
    return this.source;
  }

  set src(value: string) {
    this.source = String(value ?? '');
    this.loaded = false;
    if (!this.source) {
      this.image.removeAttribute('src');
      return;
    }
    const url = mediaURL(this.source);
    if (!url) {
      setTimeout(() => this.emit('error'));
      return;
    }
    this.image.src = url;
  }

  get width(): number {
    return this.loaded ? this.image.naturalWidth : 0;
  }

  get height(): number {
    return this.loaded ? this.image.naturalHeight : 0;
  }

  get complete(): boolean {
    return this.loaded;
  }

  loadFromLocal(path: string): void {
    this.src = path;
  }
}
defineEvents(CanvasImageImpl.prototype, ['load', 'error']);

/**
 * As in the app: options that aren't an object are none (defaults), each of `keys` is read once, now (a getter that
 * throws does now); the function returned assigns them to their properties, whose setters take or ignore them the same
 * as later on
 */
function readOptions<Key extends string>(options: unknown, keys: readonly Key[]): (target: Record<Key, unknown>) => void {
  const given = options !== null && (typeof options === 'object' || typeof options === 'function') ? options as Record<string, unknown> : undefined;
  const values = keys.map((key) => given?.[key]);
  return (target) => keys.forEach((key, index) => {
    if (values[index] !== undefined) target[key] = values[index];
  });
}

// MARK: Image

const POSITIONS: Record<string, string> = {
  top: 'center top', left: 'left center', center: 'center', bottom: 'center bottom', right: 'right center',
  'top-left': 'left top', 'top-right': 'right top', 'bottom-left': 'left bottom', 'bottom-right': 'right bottom',
};

function isWindow(value: unknown): value is WindowImpl {
  return typeof value === 'object' && value !== null && madeWindows.has(value);
}

/** One of the table's own keys (not e.g. 'constructor'), as a string only, as in the app */
function isKey(table: Record<string, unknown>, value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(table, value);
}

/** An image's size as a background-size: 'none' is the image's own size, a pixel to a CSS pixel as in the app */
const IMAGE_SIZES: Record<string, string> = { contain: 'contain', cover: 'cover', fill: '100% 100%', none: 'auto' };

export class ImageImpl extends ComponentImpl {
  private source: string | null = null;
  private sizeValue = 'contain';
  private positionValue = 'center';
  /** Counts the srcs set: only the last one calls back */
  private generation = 0;

  constructor(options?: Record<string, unknown>) {
    super(options);
    Object.assign(this.element.style, { backgroundRepeat: 'no-repeat', backgroundSize: 'contain', backgroundPosition: 'center' });
    readOptions(options, ['size', 'position', 'src'])(this as Record<'size' | 'position' | 'src', unknown>);
  }

  get src(): string | null {
    return this.source;
  }

  /** As in the app, only a string that isn't empty: anything else leaves the src as it was */
  set src(value: string | null) {
    if (typeof value !== 'string' || !value) return;
    this.source = value;
    // As in the app (in a component or not): a src replaced before it loaded calls neither callback, and the picture
    // shown stays until the new one has loaded, or goes when it can't be
    const generation = ++this.generation;
    const fail = (errMsg: string) => {
      if (generation !== this.generation) return;
      this.element.style.backgroundImage = '';
      this.emit('error', { errMsg });
    };
    // the app loads no data: URL into an Image, only into a CanvasImage
    const url = isDataURL(value) ? null : mediaURL(value);
    if (!url) {
      const reason = /^https?:/i.test(value) && !hasPermission('network') ? 'the "network" permission is needed' : 'the image can\'t be read';
      setTimeout(() => fail(reason));
      return;
    }
    const loader = document.createElement('img');
    loader.onload = () => {
      if (generation !== this.generation) return;
      this.element.style.backgroundImage = `url("${url}")`;
      this.emit('load');
    };
    loader.onerror = () => fail('the image can\'t be read');
    loader.src = url;
  }

  get size(): string {
    return this.sizeValue;
  }

  set size(value: string) {
    if (!isKey(IMAGE_SIZES, value)) return;
    this.sizeValue = value;
    this.element.style.backgroundSize = IMAGE_SIZES[value];
  }

  get position(): string {
    return this.positionValue;
  }

  set position(value: string) {
    if (!isKey(POSITIONS, value)) return;
    this.positionValue = value;
    this.element.style.backgroundPosition = POSITIONS[value];
  }
}
defineEvents(ImageImpl.prototype, ['load', 'error']);

// MARK: Video

const videos = new Set<VideoImpl>();

export class VideoImpl extends ComponentImpl {
  readonly video: HTMLVideoElement;
  private source: string | null = null;
  private wantsMuted = false;
  private wantedVolume = 1;
  /** `playbackRate` as set; the element's is kept in the range the browser plays */
  private rate = 1;
  private start = 0;
  /** Played once loaded; not the element's autoplay, which would start a video that was paused out of a window */
  private plays = false;
  /** Where to go once the file's metadata is in: initialTime, or where it left the window */
  private loadTime = 0;
  /** Playing when the content was suspended: plays again after */
  private resume = false;
  /**
   * Out of a window (or not in one yet), as in the app: the element lets go of the file, playing, pausing and seeking
   * only note what to do, and it continues from there when it's in a window
   */
  private offscreen: { time: number; playing: boolean } | null = { time: 0, playing: false };
  /** Paused, its pause event not sent yet: unloading the element drops that event */
  private pausePending = false;
  /** `paused`, as in the app: set by play() and pause() at once, then by the play and pause events */
  private isPaused = true;
  /** The duration once the file's metadata was in: the element forgets it out of a window */
  private knownDuration = NaN;

  constructor(options?: Record<string, unknown>) {
    const video = document.createElement('video');
    super(options, video);
    // read before the video is counted, so that a getter that throws does first; assigned at the end
    const keys = ['objectFit', 'initialTime', 'playbackRate', 'autoplay', 'loop', 'muted', 'volume', 'src'] as const;
    const assignOptions = readOptions(options, keys);
    this.video = video;
    video.playsInline = true;
    video.style.objectFit = 'contain';
    apply(setAdd, videos, [this]);
    // not out of a window: the element emptying isn't the video's
    const emit = (name: string, payload?: () => unknown) => video.addEventListener(name, () => {
      if (name === 'pause') this.pausePending = false;
      if (this.offscreen) return;
      if (name === 'play' || name === 'pause') this.isPaused = name === 'pause';
      this.emit(name, payload?.());
    });
    emit('waiting');
    emit('play');
    emit('pause');
    emit('ended');
    emit('timeupdate', () => ({ position: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0 }));
    emit('progress', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
      return { buffered: duration ? Math.min(100, (end / duration) * 100) : 0, duration };
    });
    video.addEventListener('error', () => {
      if (!this.offscreen) this.emit('error', { errMsg: video.error?.message || 'the video can\'t be played' });
    });
    video.addEventListener('loadedmetadata', () => {
      if (this.loadTime) video.currentTime = this.loadTime;
    });
    video.addEventListener('durationchange', () => {
      if (Number.isFinite(video.duration) && video.duration > 0) this.knownDuration = video.duration;
    });
    assignOptions(this as Record<(typeof keys)[number], unknown>);
    this.applyAudio();
  }

  get src(): string | null {
    return this.source;
  }

  /** As in the app, only a string that isn't empty: anything else leaves the src as it was */
  set src(value: string | null) {
    if (typeof value !== 'string' || !value) return;
    this.source = value;
    this.knownDuration = NaN;
    if (isDataURL(value)) {
      // as in the app, which takes it for a file of an unknown scheme: a warning, no error event, and nothing plays
      console.warn(`Can't load ${value}: Unsupported scheme: ${value}`);
    } else if (!mediaURL(value)) {
      setTimeout(() => this.emit('error', { errMsg: 'the video can\'t be read' }));
    }
    if (this.offscreen) {
      this.offscreen = { time: this.start, playing: this.plays };
      return;
    }
    this.load(this.start, this.plays);
  }

  private load(time: number, play: boolean): void {
    const url = this.source && !isDataURL(this.source) ? mediaURL(this.source) : null;
    this.loadTime = time;
    if (!url) {
      this.video.removeAttribute('src');
      return;
    }
    this.video.src = url;
    if (play) this.play();
  }

  get initialTime(): number {
    return this.start;
  }

  set initialTime(value: number) {
    if (typeof value === 'number' && Number.isFinite(value)) this.start = value;
  }

  get objectFit(): string {
    return this.video.style.objectFit;
  }

  set objectFit(value: string) {
    if (typeof value === 'string' && ['contain', 'cover', 'fill', 'none'].includes(value)) this.video.style.objectFit = value;
  }

  get playbackRate(): number {
    return this.rate;
  }

  set playbackRate(value: number) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return;
    this.rate = value;
    // Chrome plays only 1/16...16 and throws outside it, the app takes any rate: the nearest one the browser plays
    const played = Math.min(Math.max(value, 1 / 16), 16);
    // the default too: loading a src (or the element again in a window) sets the rate to it, the app keeps the rate
    this.video.defaultPlaybackRate = played;
    this.video.playbackRate = played;
  }

  get autoplay(): boolean {
    return this.plays;
  }

  set autoplay(value: boolean) {
    if (typeof value === 'boolean') this.plays = value;
  }

  get loop(): boolean {
    return this.video.loop;
  }

  set loop(value: boolean) {
    if (typeof value === 'boolean') this.video.loop = value;
  }

  get muted(): boolean {
    return this.wantsMuted;
  }

  set muted(value: boolean) {
    if (typeof value !== 'boolean') return;
    this.wantsMuted = value;
    this.applyAudio();
  }

  get volume(): number {
    return this.wantedVolume;
  }

  set volume(value: number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    this.wantedVolume = Math.min(Math.max(value, 0), 1);
    this.applyAudio();
  }

  /** Sound needs the audio permission, and the visitor turning it on */
  applyAudio(): void {
    this.video.muted = this.wantsMuted || state.muted || !hasPermission('audio');
    this.video.volume = this.wantedVolume;
  }

  /** The playback position in seconds: out of a window where it continues from */
  get currentTime(): number {
    return this.offscreen ? this.offscreen.time : this.video.currentTime;
  }

  /** The length in seconds, NaN until it's known */
  get duration(): number {
    return this.knownDuration;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  play(): void {
    this.isPaused = false;
    if (this.offscreen) {
      // at the end it starts over, as the element does
      if (this.offscreen.time >= this.knownDuration) this.offscreen.time = 0;
      this.offscreen.playing = true;
      return;
    }
    // also when the content resumes: with the promise's then as it was before the content ran
    apply(then, this.video.play(), [undefined, (error: Error) => {
      // browsers only play sound after the visitor did something: play silently instead
      if (error.name === 'NotAllowedError' && !this.video.muted) {
        this.video.muted = true;
        apply(then, this.video.play(), [undefined, () => undefined]);
      }
    }]);
  }

  pause(): void {
    this.isPaused = true;
    if (this.offscreen) {
      this.offscreen.playing = false;
      return;
    }
    this.pauseElement();
  }

  private pauseElement(): void {
    if (!this.video.paused) this.pausePending = true;
    this.video.pause();
  }

  seek(time: number): void {
    if (typeof time !== 'number' || !Number.isFinite(time)) throw new TypeError('seek needs a finite number of seconds');
    if (this.offscreen) {
      this.offscreen.time = Math.min(Math.max(time, 0), Number.isNaN(this.knownDuration) ? Infinity : this.knownDuration);
      return;
    }
    this.video.currentTime = time;
  }

  protected override inWindowChanged(inWindow: boolean): void {
    if (!inWindow) {
      if (this.offscreen) return;
      this.offscreen = { time: this.video.currentTime, playing: !this.video.paused };
      this.pauseElement();
      const paused = this.pausePending;
      this.video.removeAttribute('src');
      this.video.load();
      // stopped like when it's paused, as in the app
      if (paused) {
        this.pausePending = false;
        this.isPaused = true;
        setTimeout(() => this.emit('pause'));
      }
      return;
    }
    const offscreen = this.offscreen;
    if (!offscreen) return;
    this.offscreen = null;
    // while the content is suspended it plays once it resumes
    if (offscreen.playing && state.suspended) this.resume = true;
    this.load(offscreen.time, offscreen.playing && !state.suspended);
  }

  suspend(suspended: boolean): void {
    if (suspended) {
      this.resume = !this.video.paused;
      this.pauseElement();
    } else if (this.resume) {
      this.resume = false;
      this.play();
    }
  }

  override destroy(): void {
    apply(setDelete, videos, [this]);
    this.video.pause();
    this.video.removeAttribute('src');
    super.destroy();
  }
}
defineEvents(VideoImpl.prototype, ['waiting', 'progress', 'play', 'pause', 'ended', 'timeupdate', 'error']);

/** The videos that aren't destroyed, in a list */
export function allVideos(): VideoImpl[] {
  return itemsOf(videos);
}
