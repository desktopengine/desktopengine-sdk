// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The engine's components on the web: Component (a flex container), Window (a positioned box on the desktop), Canvas
// (a real <canvas>, so 2D and WebGL are the browser's), CanvasImage, Image and Video. The rules of the engine hold:
// the content's type limits the window types, at most 16 windows, widget and overlay windows below the menu bar and
// at most half a display, drawImage and texImage2D take the engine's Canvas and CanvasImage.

import { defineEvents, Evented } from './events.ts';
import { applyStyle, BASE_CSS, createStyle, type StyleValue } from './style.ts';
import { mediaURL } from './network.ts';
import { hasPermission, nextIdentifier, send, state } from './state.ts';
import type { Rect, WindowState } from '../protocol.ts';

const COMPONENT_EVENTS = ['framechange', 'click', 'dbclick', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave', 'mousemove', 'wheel'];
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
    const style = options?.style;
    if (style && typeof style === 'object') this.style = style as Record<string, unknown>;
  }

  get style(): Record<string, unknown> {
    return this.styleObject;
  }

  set style(value: Record<string, unknown>) {
    for (const key of [...this.styleValues.keys()]) this.setStyle(key, null);
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) this.setStyle(key, item);
    }
  }

  setStyle(key: string, value: unknown): void {
    if (value === null || value === undefined) {
      this.styleValues.delete(key);
      applyStyle(this.element, key, null);
      return;
    }
    if (applyStyle(this.element, key, value)) this.styleValues.set(key, value as StyleValue);
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
    child.parent?.detach(child);
    this.childList.splice(position, 0, child);
    child.parent = this;
    this.element.insertBefore(child.element, this.childList[position + 1]?.element ?? null);
    child.attached();
  }

  removeChild(child: unknown): void {
    if (!(child instanceof ComponentImpl) || child.parent !== this) throw new Error('not a child of this component');
    this.detach(child);
  }

  remove(): void {
    this.parent?.detach(this);
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

  protected attached(): void {}

  override destroy(): void {
    super.destroy();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const child of this.childList) child.destroy();
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
let windowOrder = 0;

function allowedTypes(): string[] | null {
  switch (state.launch?.contentType) {
    case 'wallpaper':
      return ['desktop'];
    case 'widget':
    case 'companion':
      return ['widget', 'overlay'];
    default:
      return null;
  }
}

function positiveRects(value: unknown): Rect[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new TypeError('a region is an array of { x, y, width, height }, or null');
  return value
    .map((rect) => ({ x: Number(rect?.x) || 0, y: Number(rect?.y) || 0, width: Number(rect?.width) || 0, height: Number(rect?.height) || 0 }))
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

let reportScheduled = false;
/** The host hit tests with the windows' frames and regions: tell it what changed, once per task */
export function reportWindows(): void {
  if (reportScheduled) return;
  reportScheduled = true;
  queueMicrotask(() => {
    reportScheduled = false;
    const list: WindowState[] = [...windows].map((win) => win.stateForHost());
    send({ type: 'windows', windows: list });
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
  readonly childWindowList: WindowImpl[] = [];

  constructor(options?: Record<string, unknown>) {
    const type = typeof options?.type === 'string' ? options.type : 'normal';
    const allowed = allowedTypes();
    if (allowed && !allowed.includes(type)) {
      throw new TypeError(`a ${state.launch?.contentType} can't make "${type}" windows, only ${allowed.map((name) => `"${name}"`).join(' or ')}`);
    }
    if (allowed && windows.size >= MAX_WINDOWS) {
      throw new Error(`content can have at most ${MAX_WINDOWS} windows: destroy() the ones it no longer needs`);
    }
    super(undefined);
    this.type = type in LAYERS ? type : 'normal';
    this.element.style.position = 'absolute';
    this.element.style.zIndex = String(LAYERS[this.type] * 1000 + (this.order % 1000));
    this.element.hidden = true;
    windows.add(this);
    if (options?.style && typeof options.style === 'object') this.style = options.style as Record<string, unknown>;
    if (options?.parent instanceof WindowImpl) this.parentWindow = options.parent;
    this.place();
  }

  override setStyle(key: string, value: unknown): void {
    if (['left', 'top', 'width', 'height'].includes(key)) {
      const number = typeof value === 'number' ? value : parseFloat(String(value));
      if (value === null || value === undefined) this.styleValues.delete(key);
      else if (Number.isFinite(number)) this.styleValues.set(key, value as StyleValue);
      else return;
      const field = key === 'left' ? 'x' : key === 'top' ? 'y' : key;
      const fallback = { x: 0, y: 0, width: 400, height: 300 }[field as 'x' | 'y' | 'width' | 'height'];
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
      const list = this.parentRef.childWindowList;
      list.splice(list.indexOf(this), 1);
    }
    this.parentRef = value instanceof WindowImpl && value !== this ? value : null;
    this.parentRef?.childWindowList.push(this);
  }

  get childWindows(): WindowImpl[] {
    return [...this.childWindowList];
  }

  get hitRegion(): Rect[] | null {
    return this.hit ? this.hit.map((rect) => ({ ...rect })) : null;
  }

  set hitRegion(value: unknown) {
    this.hit = positiveRects(value);
    reportWindows();
  }

  get dragRegion(): Rect[] | null {
    return this.drag ? this.drag.map((rect) => ({ ...rect })) : null;
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
    return state.screens.find((screen) => inside(screen.bounds)) ?? state.screens[0];
  }

  /** widget and overlay windows stay below the menu bar and cover at most half of a display */
  private restricted(frame: Rect): Rect {
    if (!allowedTypes() || (this.type !== 'widget' && this.type !== 'overlay')) return frame;
    const screen = this.screen();
    if (!screen) return frame;
    let { width, height } = frame;
    const limit = (screen.bounds.width * screen.bounds.height) / 2;
    if (width * height > limit) {
      const scale = Math.sqrt(limit / (width * height));
      width = Math.floor(width * scale);
      height = Math.floor(height * scale);
    }
    return { x: frame.x, y: Math.max(frame.y, screen.visibleFrame.y), width, height };
  }

  /** Where it is on the desktop */
  get globalFrame(): Rect {
    return this.restricted(this.frameRect);
  }

  private place(): void {
    const frame = this.globalFrame;
    Object.assign(this.element.style, { left: `${frame.x}px`, top: `${frame.y}px`, width: `${frame.width}px`, height: `${frame.height}px` });
    reportWindows();
  }

  /** The host moved it: the user dragged it */
  moveTo(x: number, y: number): void {
    this.frameRect = { ...this.frameRect, x, y };
    this.styleValues.set('left', x);
    this.styleValues.set('top', y);
    this.place();
    const frame = this.globalFrame;
    this.emit('move', { x: frame.x, y: frame.y });
  }

  show(): void {
    // as in the app: a destroyed window is gone for good
    if (!windows.has(this)) throw new Error('This window was destroyed; make a new one to show it again');
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
    if (!windows.has(this)) return;
    windows.delete(this);
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
defineEvents(WindowImpl.prototype, ['show', 'hide', 'close', 'resize', 'move', 'focus', 'blur', 'keydown', 'keyup', 'devicepixelratiochange']);

export function windowById(id: string): WindowImpl | undefined {
  for (const win of windows) if (win.identifier === id) return win;
  return undefined;
}

export function allWindows(): WindowImpl[] {
  return [...windows];
}

// MARK: Canvas

/** The browser's object for an engine object passed to drawImage, createPattern or texImage2D */
function unwrap(value: unknown): unknown {
  if (value instanceof CanvasImpl) return value.canvas;
  if (value instanceof CanvasImageImpl) return value.image;
  return value;
}

export class CanvasImpl extends ComponentImpl {
  readonly canvas: HTMLCanvasElement;
  private explicitSize = { width: false, height: false };
  private context: RenderingContext | null = null;
  private contextType: string | null = null;
  private sizeObserver: ResizeObserver;

  constructor(options?: Record<string, unknown>) {
    const canvas = document.createElement('canvas');
    super(options, canvas);
    this.canvas = canvas;
    // 300 × 150 when it's given no size, as on the web
    if (!this.styleValues.has('width') && !this.styleValues.has('flex') && !this.styleValues.has('flexGrow')) this.setStyle('width', 300);
    if (!this.styleValues.has('height') && !this.styleValues.has('flex') && !this.styleValues.has('flexGrow')) this.setStyle('height', 150);
    // a drawing buffer that wasn't sized follows the layout
    this.sizeObserver = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      if (!this.explicitSize.width && rect.width >= 2) canvas.width = Math.min(Math.round(rect.width), 16383);
      if (!this.explicitSize.height && rect.height >= 2) canvas.height = Math.min(Math.round(rect.height), 16383);
    });
    this.sizeObserver.observe(canvas);
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.emit('webglcontextlost', { type: 'webglcontextlost', statusMessage: 'the GPU stopped the canvas\' work', preventDefault() {} });
    });
    canvas.addEventListener('contextlost', () => this.emit('contextlost', { type: 'contextlost', statusMessage: 'the GPU stopped the canvas\' work', preventDefault() {} }));
  }

  override setStyle(key: string, value: unknown): void {
    super.setStyle(key, value);
    // the element is the canvas (this.canvas isn't set yet while the constructor applies the first style)
    if (key === 'imageRendering') this.element.style.imageRendering = value === 'crisp-edges' ? 'pixelated' : String(value ?? '');
  }

  override get width(): number {
    return this.canvas.width;
  }

  override set width(value: number) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return;
    this.explicitSize.width = true;
    this.canvas.width = Math.min(Math.max(number, 2), 16383);
  }

  override get height(): number {
    return this.canvas.height;
  }

  override set height(value: number) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return;
    this.explicitSize.height = true;
    this.canvas.height = Math.min(Math.max(number, 2), 16383);
  }

  getContext(type: unknown, options?: Record<string, unknown>): RenderingContext | null {
    const name = String(type);
    const kind = name === '2d' ? '2d' : name === 'webgl2' ? 'webgl2' : /webgl/.test(name) && !/webgl2/.test(name) ? 'webgl' : null;
    if (!kind) return null;
    if (this.contextType) return this.contextType === kind ? this.context : null;
    const attributes = {
      alpha: options?.alpha !== false,
      antialias: options?.antialias === true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    };
    const context = this.canvas.getContext(kind, attributes) as RenderingContext | null;
    if (!context) return null;
    this.context = context;
    this.contextType = kind;
    if (kind === '2d') this.adapt2D(context as CanvasRenderingContext2D);
    else this.adaptWebGL(context as WebGLRenderingContext);
    return context;
  }

  private adapt2D(context: CanvasRenderingContext2D): void {
    const canvas = this;
    Object.defineProperty(context, 'canvas', { get: () => canvas });
    const drawImage = context.drawImage.bind(context) as (...args: unknown[]) => void;
    const createPattern = context.createPattern.bind(context);
    const createImageData = context.createImageData.bind(context) as (...args: unknown[]) => ImageData;
    const setLineDash = context.setLineDash.bind(context);
    Object.assign(context, {
      drawImage: (...args: unknown[]) => drawImage(unwrap(args[0]), ...args.slice(1)),
      createPattern: (image: unknown, repetition?: string | null) => createPattern(unwrap(image) as CanvasImageSource, repetition ?? 'repeat') ?? undefined,
      // the engine's third argument fills it
      createImageData: (...args: unknown[]) => {
        if (args[0] instanceof ImageData) return createImageData(args[0]);
        const data = createImageData(Number(args[0]), Number(args[1]));
        if (args[2] instanceof Uint8ClampedArray) data.data.set(args[2].subarray(0, data.data.length));
        return data;
      },
      setLineDash: (segments: unknown[]) => setLineDash(Array.from(segments ?? [], (value) => Number(value))),
      resetCurrentState: () => {
        context.reset?.();
      },
      isPointInPath: () => {
        console.warn('isPointInPath isn\'t implemented in DesktopEngine');
        return undefined;
      },
    });
  }

  private adaptWebGL(context: WebGLRenderingContext): void {
    const canvas = this;
    Object.defineProperty(context, 'canvas', { get: () => canvas });
    for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D']) {
      const original = (context as unknown as Record<string, ((...args: unknown[]) => void) | undefined>)[name];
      if (!original) continue;
      (context as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => original.apply(context, args.map(unwrap));
    }
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

// MARK: Image

const POSITIONS: Record<string, string> = {
  top: 'center top', left: 'left center', center: 'center', bottom: 'center bottom', right: 'right center',
  'top-left': 'left top', 'top-right': 'right top', 'bottom-left': 'left bottom', 'bottom-right': 'right bottom',
};

export class ImageImpl extends ComponentImpl {
  private source: string | null = null;
  private sizeValue = 'contain';
  private positionValue = 'center';
  private loader: HTMLImageElement | null = null;

  constructor(options?: Record<string, unknown>) {
    super(options);
    Object.assign(this.element.style, { backgroundRepeat: 'no-repeat', backgroundSize: 'contain', backgroundPosition: 'center' });
    if (typeof options?.size === 'string') this.size = options.size;
    if (typeof options?.position === 'string') this.position = options.position;
    if (typeof options?.src === 'string') this.src = options.src;
  }

  get src(): string | null {
    return this.source;
  }

  set src(value: string | null) {
    this.source = value === null || value === undefined ? null : String(value);
    // a src replaced before it loaded calls neither callback
    if (this.loader) this.loader.onload = this.loader.onerror = null;
    this.element.style.backgroundImage = '';
    if (!this.source) return;
    const url = mediaURL(this.source);
    if (!url) {
      const reason = /^https?:/i.test(this.source) && !hasPermission('network') ? 'the "network" permission is needed' : 'the image can\'t be read';
      setTimeout(() => this.emit('error', { errMsg: reason }));
      return;
    }
    const loader = document.createElement('img');
    this.loader = loader;
    loader.onload = () => {
      this.element.style.backgroundImage = `url("${url}")`;
      this.emit('load');
    };
    loader.onerror = () => this.emit('error', { errMsg: 'the image can\'t be read' });
    loader.src = url;
  }

  get size(): string {
    return this.sizeValue;
  }

  set size(value: string) {
    if (value !== 'contain' && value !== 'cover') return;
    this.sizeValue = value;
    this.element.style.backgroundSize = value;
  }

  get position(): string {
    return this.positionValue;
  }

  set position(value: string) {
    if (!(value in POSITIONS)) return;
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
  private start = 0;
  /** Playing when the content was suspended: plays again after */
  private resume = false;

  constructor(options?: Record<string, unknown>) {
    const video = document.createElement('video');
    super(options, video);
    this.video = video;
    video.playsInline = true;
    video.style.objectFit = 'contain';
    videos.add(this);
    const emit = (name: string, payload?: () => unknown) => video.addEventListener(name === 'error' ? 'error' : name, () => this.emit(name, payload?.()));
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
    video.addEventListener('error', () => this.emit('error', { errMsg: video.error?.message || 'the video can\'t be played' }));
    video.addEventListener('loadedmetadata', () => {
      if (this.start) video.currentTime = this.start;
    });
    for (const key of ['objectFit', 'initialTime', 'playbackRate', 'autoplay', 'loop', 'muted', 'volume', 'src']) {
      if (options && key in options) (this as unknown as Record<string, unknown>)[key] = options[key];
    }
    this.applyAudio();
  }

  get src(): string | null {
    return this.source;
  }

  set src(value: string | null) {
    this.source = value === null || value === undefined ? null : String(value);
    const url = this.source ? mediaURL(this.source) : null;
    if (this.source && !url) {
      setTimeout(() => this.emit('error', { errMsg: 'the video can\'t be read' }));
      this.video.removeAttribute('src');
      return;
    }
    if (url) this.video.src = url;
    else this.video.removeAttribute('src');
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
    if (['contain', 'cover', 'fill'].includes(value)) this.video.style.objectFit = value;
  }

  get playbackRate(): number {
    return this.video.playbackRate;
  }

  set playbackRate(value: number) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) this.video.playbackRate = value;
  }

  get autoplay(): boolean {
    return this.video.autoplay;
  }

  set autoplay(value: boolean) {
    if (typeof value === 'boolean') this.video.autoplay = value;
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

  play(): void {
    this.video.play().catch((error: Error) => {
      // browsers only play sound after the visitor did something: play silently instead
      if (error.name === 'NotAllowedError' && !this.video.muted) {
        this.video.muted = true;
        this.video.play().catch(() => undefined);
      }
    });
  }

  pause(): void {
    this.video.pause();
  }

  seek(time: number): void {
    if (typeof time !== 'number' || !Number.isFinite(time)) throw new TypeError('seek needs a finite number of seconds');
    this.video.currentTime = time;
  }

  suspend(suspended: boolean): void {
    if (suspended) {
      this.resume = !this.video.paused;
      this.video.pause();
    } else if (this.resume) {
      this.resume = false;
      this.play();
    }
  }

  override destroy(): void {
    videos.delete(this);
    this.video.pause();
    this.video.removeAttribute('src');
    super.destroy();
  }
}
defineEvents(VideoImpl.prototype, ['waiting', 'progress', 'play', 'pause', 'ended', 'timeupdate', 'error']);

export function allVideos(): VideoImpl[] {
  return [...videos];
}
