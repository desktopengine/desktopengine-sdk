// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// A desktop on a web page that runs DesktopEngine mini programs, as the app runs them on the Mac. Each mini program
// runs in its own iframe, sandboxed with an opaque origin: it can't reach the page, its cookies or its storage. The
// iframes lie over the screens without taking the mouse; the desktop finds the window under the pointer from what the
// frames report (frames, hit and drag regions), passes the pointer on, and moves widgets and pets when they're dragged.
//
//   const desktop = new WebDesktop(element, { insets: { top: 24, bottom: 64 } });
//   const content = desktop.launch({ name: 'Clock', code, manifest, files });
//   content.on('console', ({ level, message }) => …);

import { frameDocument, type FrameMessage, type HostMessage, type ParameterValue, type Rect, type WebScreen, type WindowState } from '../protocol.ts';

declare const __FRAME_RUNTIME__: string;

export type { Rect, WebScreen, WindowState, ParameterValue };

/**
 * The page to serve at `DesktopOptions.frameURL`, on a site of its own: the frame runtime with a Content Security Policy
 * that lets contents reach only the preview proxy, as each frame gets by default. A frame that navigates away from it
 * (to a page without that policy) is stopped.
 */
export function framePage(options: { proxy?: string } = {}): string {
  return frameDocument(__FRAME_RUNTIME__, options);
}

export interface ScreenSpec {
  /** Points */
  width: number;
  height: number;
  name?: string;
}

export interface DesktopOptions {
  /** The screens, left to right, in points; by default one the size of the element, following it */
  screens?: ScreenSpec[];
  /** Points kept free at the top (the menu bar) and the bottom (the Dock) of every screen */
  insets?: { top?: number; bottom?: number };
  /** devicePixelRatio of the contents; the page's, at most 2, by default */
  scale?: number;
  /**
   * A page on an origin of its own that runs the frame runtime (`framePage()`), for sites where
   * the contents must be on another site than the page; by default each frame is an opaque-origin srcdoc document.
   * Use one for contents you don't trust: browsers that don't give sandboxed frames a process of their own (Safari
   * among them) run a srcdoc frame on the page's thread, where a content's endless loop freezes the page and
   * `terminate()` never gets to run.
   */
  frameURL?: string;
  /** The preview proxy: http(s) and ws(s) requests go to `<proxy>?url=…`. Without one, contents have no network */
  proxy?: string;
  appearance?: 'light' | 'dark';
  /** Frames per second at most, 0 for the display's */
  maxFramesPerSecond?: number;
  /** Sound is off until the visitor turns it on, by default */
  muted?: boolean;
  /** The language contents are told, navigator.language by default */
  locale?: string;
}

/** What the desktop needs to know of manifest.json */
export interface ManifestInfo {
  id?: string;
  type?: 'wallpaper' | 'widget' | 'pet';
  apiVersion?: number;
  permissions?: string[];
  network?: { domains?: string[] };
  widget?: { sizes?: string[] };
  parameters?: { key: string; default?: ParameterValue }[];
}

export interface ContentSpec {
  /** For logs and stack traces */
  name: string;
  /** index.js, as built */
  code: string;
  /** The package's other files, by path from its root */
  files?: Record<string, ArrayBuffer>;
  manifest?: ManifestInfo;
  /** What it may use, the manifest's permissions by default */
  permissions?: string[];
  /** Parameter values over the manifest's defaults */
  parameters?: Record<string, ParameterValue>;
  /** small, medium or large, for a widget */
  size?: 'small' | 'medium' | 'large';
  /** On the desktop, or above everything; pets float, the rest stay on the desktop, by default */
  level?: 'desktop' | 'floating';
  /** Where its window starts, global points */
  position?: { x: number; y: number };
  /** The screen it runs on, 0 by default */
  screen?: number;
  /** A wallpaper that runs across all screens (manifest `wallpaper.span`) */
  span?: boolean;
  instanceId?: string;
  /** Its own preview proxy instead of the desktop's, e.g. a link that lets it reach its network.domains only */
  proxy?: string;
}

type ContentEvents = {
  launched: void;
  console: { level: string; message: string };
  exception: { message: string; stack?: string };
  'host-message': unknown;
  windows: WindowState[];
  stats: { framesPerSecond: number };
};

const WIDGET_SIZES: Record<string, { width: number; height: number }> = {
  small: { width: 164, height: 164 },
  medium: { width: 344, height: 164 },
  large: { width: 344, height: 344 },
};

const inside = (rect: Rect, x: number, y: number): boolean => x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;

let instances = 0;

/** One mini program on the desktop */
export class WebContent {
  iframe: HTMLIFrameElement;
  windows: WindowState[] = [];
  framesPerSecond = 0;
  /** Stacking among the contents; widgets and pets come to the front when pressed */
  order = 0;
  /** It has animation frame callbacks waiting: the desktop sends it its display frames */
  wantsFrames = false;
  private listeners = new Map<string, Set<(value: never) => void>>();
  private ready = false;
  private stopped = false;
  /** New parameters were sent and their answer hasn't come */
  private awaitingParameters = false;
  private parameterValues: Record<string, ParameterValue>;

  constructor(
    readonly desktop: WebDesktop,
    public spec: ContentSpec,
  ) {
    instances += 1;
    this.parameterValues = { ...defaultParameters(spec.manifest), ...spec.parameters };
    this.iframe = document.createElement('iframe');
    this.iframe.className = 'de-content';
    this.iframe.setAttribute('sandbox', 'allow-scripts');
    this.iframe.setAttribute('allow', 'autoplay');
    this.iframe.setAttribute('aria-hidden', 'true');
    this.iframe.tabIndex = -1;
    Object.assign(this.iframe.style, {
      position: 'absolute', left: '0', top: '0', border: '0', background: 'transparent', pointerEvents: 'none', colorScheme: 'normal',
    });
    this.watchNavigation(this.iframe);
    if (desktop.options.frameURL) this.iframe.src = desktop.options.frameURL;
    else this.iframe.srcdoc = frameDocument(__FRAME_RUNTIME__, { proxy: this.proxy });
  }

  /**
   * The frame's page loads once. A second load is the content leaving it for a page of its own, past the page's
   * content security policy (a sandboxed frame can still navigate itself): it's stopped.
   */
  private watchNavigation(iframe: HTMLIFrameElement): void {
    let loads = 0;
    iframe.addEventListener('load', () => {
      loads += 1;
      if (loads > 1 && iframe === this.iframe && !this.stopped) {
        this.emit('exception', { message: 'the content left its page (it navigated its frame), so it was stopped' });
        this.stop();
      }
    });
  }

  get type(): string | undefined {
    return this.spec.manifest?.type;
  }

  /** Where its requests go */
  get proxy(): string | undefined {
    return this.spec.proxy ?? this.desktop.options.proxy;
  }

  get parameters(): Record<string, ParameterValue> {
    return { ...this.parameterValues };
  }

  on<K extends keyof ContentEvents>(event: K, listener: (value: ContentEvents[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener as (value: never) => void);
    return () => set!.delete(listener as (value: never) => void);
  }

  private emit<K extends keyof ContentEvents>(event: K, value: ContentEvents[K]): void {
    for (const listener of this.listeners.get(event) ?? []) (listener as (value: ContentEvents[K]) => void)(value);
  }

  post(message: HostMessage, transfer: Transferable[] = []): void {
    if (this.ready && !this.stopped) this.iframe.contentWindow?.postMessage(message, '*', transfer);
  }

  /** From its frame: checked to be its own window, and treated as the content's words */
  receive(message: FrameMessage): void {
    switch (message?.type) {
      case 'ready': {
        // once per frame: the launch (with the package's files) isn't handed out again
        if (this.ready) break;
        this.ready = true;
        const files: Record<string, ArrayBuffer> = {};
        for (const [path, data] of Object.entries(this.spec.files ?? {})) files[path] = data.slice(0);
        this.post(this.desktop.launchMessage(this, files), Object.values(files));
        this.desktop.updatePlayback(this);
        break;
      }
      case 'launched':
        this.emit('launched', undefined);
        break;
      case 'windows':
        this.windows = sanitizeWindows(message.windows, this.type);
        this.emit('windows', this.windows);
        break;
      case 'console':
        this.emit('console', { level: String(message.level), message: String(message.message) });
        break;
      case 'exception':
        this.emit('exception', { message: String(message.message), stack: message.stack ? String(message.stack) : undefined });
        break;
      case 'host-message':
        this.emit('host-message', message.message);
        break;
      case 'stats':
        this.framesPerSecond = Number(message.framesPerSecond) || 0;
        this.emit('stats', { framesPerSecond: this.framesPerSecond });
        break;
      case 'frames':
        this.wantsFrames = message.wanted === true;
        if (this.wantsFrames) this.desktop.startFrames();
        break;
      case 'parameters-result':
        // like the app: content that doesn't apply new parameters itself starts again with them (only an answer to
        // parameters that were sent counts)
        if (!this.awaitingParameters) break;
        this.awaitingParameters = false;
        if (!message.handled) this.restart();
        break;
    }
  }

  /** New parameter values; the content applies them itself if it listens to parameterschange */
  setParameters(values: Record<string, ParameterValue>): void {
    const changed = Object.keys(values).filter((key) => values[key] !== this.parameterValues[key]);
    if (!changed.length) return;
    this.parameterValues = { ...this.parameterValues, ...values };
    this.awaitingParameters = this.ready && !this.stopped;
    this.post({ type: 'parameters', parameters: this.parameters, changed });
  }

  /**
   * Starts it again, e.g. after its code changed. A widget or pet starts where its window is now (kept on its screen),
   * not where it was first launched, unless `spec` gives it a position.
   */
  restart(spec?: Partial<ContentSpec>): void {
    const frame = this.windows.find((win) => win.visible && win.type !== 'desktop')?.frame;
    if (spec) {
      this.spec = { ...this.spec, ...spec };
      if (spec.manifest || spec.parameters) this.parameterValues = { ...defaultParameters(this.spec.manifest), ...this.spec.parameters, ...spec.parameters };
    }
    if (frame && spec?.position === undefined) this.spec.position = this.desktop.keptOnScreen(frame, this.spec.screen);
    this.post({ type: 'stop' });
    this.ready = false;
    this.awaitingParameters = false;
    this.wantsFrames = false;
    this.windows = [];
    this.emit('windows', this.windows);
    const replacement = this.iframe.cloneNode() as HTMLIFrameElement;
    this.watchNavigation(replacement);
    if (this.desktop.options.frameURL) replacement.src = this.desktop.options.frameURL;
    else replacement.srcdoc = frameDocument(__FRAME_RUNTIME__, { proxy: this.proxy });
    this.iframe.replaceWith(replacement);
    this.iframe = replacement;
  }

  stop(): void {
    this.desktop.terminate(this);
  }

  /** @internal: the desktop terminated it */
  detach(): void {
    this.post({ type: 'stop' });
    this.stopped = true;
    this.iframe.remove();
  }

  /** The window under a global point that takes the mouse there, the frontmost */
  windowAt(x: number, y: number): WindowState | null {
    let found: WindowState | null = null;
    for (const win of this.windows) {
      if (!win.visible || !inside(win.frame, x, y)) continue;
      const local = { x: x - win.frame.x, y: y - win.frame.y };
      if (win.hitRegion && !win.hitRegion.some((rect) => inside(rect, local.x, local.y))) continue;
      if (!found || win.z > found.z) found = win;
    }
    return found;
  }
}

/** At most this many windows of a content count, as the engine allows */
const MAX_WINDOWS = 16;
/** A window's stacking within its content: a content can't rank its windows above another content's */
const MAX_Z = 10_000;

/**
 * The windows a frame says it has, as the host can trust them: the types its kind of content may make (a wallpaper only
 * desktop windows), finite frames, stacking within bounds, and regions that are lists of rectangles. Anything else is
 * dropped rather than allowed to break hit testing for every content.
 */
export function sanitizeWindows(value: unknown, contentType: string | undefined): WindowState[] {
  if (!Array.isArray(value)) return [];
  const allowed = contentType === 'wallpaper' ? ['desktop'] : contentType === 'widget' || contentType === 'pet' ? ['widget', 'overlay'] : null;
  const finite = (number: unknown): number | null => (typeof number === 'number' && Number.isFinite(number) ? number : null);
  const rect = (raw: unknown): Rect | null => {
    const r = raw as Partial<Rect> | null;
    const [x, y, width, height] = [finite(r?.x), finite(r?.y), finite(r?.width), finite(r?.height)];
    return x === null || y === null || width === null || height === null || width < 0 || height < 0 ? null : { x, y, width, height };
  };
  const rects = (raw: unknown): Rect[] | null => {
    if (raw === null || raw === undefined || !Array.isArray(raw)) return null;
    return raw.slice(0, 64).map(rect).filter((entry): entry is Rect => entry !== null);
  };
  const windows: WindowState[] = [];
  for (const raw of value.slice(0, MAX_WINDOWS)) {
    const win = raw as Partial<WindowState> | null;
    const frame = rect(win?.frame);
    const type = typeof win?.type === 'string' ? win.type : '';
    if (!frame || (allowed && !allowed.includes(type))) continue;
    windows.push({
      id: String(win?.id ?? ''),
      type,
      frame,
      visible: win?.visible === true,
      z: Math.min(Math.max(finite(win?.z) ?? 0, 0), MAX_Z),
      hitRegion: rects(win?.hitRegion),
      dragRegion: rects(win?.dragRegion),
      movable: win?.movable === true,
    });
  }
  return windows;
}

function defaultParameters(manifest?: ManifestInfo): Record<string, ParameterValue> {
  const values: Record<string, ParameterValue> = {};
  for (const parameter of manifest?.parameters ?? []) {
    if (parameter && typeof parameter.key === 'string' && parameter.default !== undefined) values[parameter.key] = parameter.default;
  }
  return values;
}

interface Press {
  content: WebContent;
  window: WindowState;
  pointerId: number;
  start: { x: number; y: number };
  origin: { x: number; y: number };
  movesWindow: boolean;
  dragging: boolean;
  moved: boolean;
}

export class WebDesktop {
  readonly element: HTMLDivElement;
  screens: WebScreen[] = [];
  readonly contents = new Set<WebContent>();
  private hovered: { content: WebContent; window: WindowState } | null = null;
  private press: Press | null = null;
  private visible = true;
  private paused = false;
  private nextOrder = 1;
  private scaleFactor = 1;
  private resizeTimer = 0;
  private frameRequest = 0;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly onMessage = (event: MessageEvent) => {
    for (const content of this.contents) {
      if (event.source === content.iframe.contentWindow) content.receive(event.data as FrameMessage);
    }
  };
  private readonly onVisibility = () => this.updateAllPlayback();
  /** The page's display frames, passed on to the contents waiting for one (see `frame` in the protocol) */
  private readonly onFrame = () => {
    this.frameRequest = 0;
    if (!this.playing) return;
    let wanted = false;
    for (const content of this.contents) {
      if (!content.wantsFrames) continue;
      wanted = true;
      content.post({ type: 'frame' });
    }
    if (wanted) this.frameRequest = requestAnimationFrame(this.onFrame);
  };

  constructor(
    readonly container: HTMLElement,
    readonly options: DesktopOptions = {},
  ) {
    this.element = document.createElement('div');
    this.element.className = 'de-desktop';
    Object.assign(this.element.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', touchAction: 'pan-y', userSelect: 'none' });
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(this.element);
    this.layout();
    window.addEventListener('message', this.onMessage);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
    this.resizeObserver.observe(container);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.visible = entries.some((entry) => entry.isIntersecting);
      this.updateAllPlayback();
    }, { rootMargin: '120px' });
    this.intersectionObserver.observe(container);
    this.element.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.element.addEventListener('pointerdown', (event) => this.pointerDown(event));
    this.element.addEventListener('pointerup', (event) => this.pointerUp(event));
    this.element.addEventListener('pointercancel', (event) => this.pointerCancel(event));
    this.element.addEventListener('pointerleave', () => {
      if (!this.press) this.setHovered(null, { x: 0, y: 0 }, null);
    });
    // a finger on a widget works it instead of scrolling the page
    this.element.addEventListener('touchstart', (event) => {
      const touch = event.changedTouches[0];
      if (!touch || !event.cancelable) return;
      const point = this.point(touch);
      const hit = this.windowAt(point.x, point.y);
      if (hit && hit.window.type !== 'desktop') event.preventDefault();
    }, { passive: false });
  }

  get scale(): number {
    return this.options.scale ?? Math.min(2, window.devicePixelRatio || 1);
  }

  /** The screens' union, in points */
  get bounds(): Rect {
    const right = Math.max(...this.screens.map((screen) => screen.bounds.x + screen.bounds.width));
    const bottom = Math.max(...this.screens.map((screen) => screen.bounds.y + screen.bounds.height));
    return { x: 0, y: 0, width: right, height: bottom };
  }

  private layout(): void {
    const top = this.options.insets?.top ?? 0;
    const bottom = this.options.insets?.bottom ?? 0;
    const specs = this.options.screens ?? [{ width: this.container.clientWidth || 1, height: this.container.clientHeight || 1, name: 'Web Display' }];
    let x = 0;
    this.screens = specs.map((spec, index) => {
      const bounds = { x, y: 0, width: spec.width, height: spec.height };
      x += spec.width;
      return {
        id: index + 1,
        name: spec.name ?? (index ? `Display ${index + 1}` : 'Built-in Display'),
        bounds,
        visibleFrame: { x: bounds.x, y: top, width: bounds.width, height: Math.max(0, bounds.height - top - bottom) },
        scale: this.scale,
      };
    });
    const union = this.bounds;
    // fixed screens are scaled to fit the element's width
    this.scaleFactor = this.options.screens ? Math.min(1, (this.container.clientWidth || union.width) / union.width) : 1;
    Object.assign(this.element.style, { width: `${union.width}px`, height: `${union.height}px`, transform: this.scaleFactor === 1 ? '' : `scale(${this.scaleFactor})` });
    for (const content of this.contents) Object.assign(content.iframe.style, { width: `${union.width}px`, height: `${union.height}px` });
  }

  private scheduleResize(): void {
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      const before = JSON.stringify(this.screens.map((screen) => screen.bounds));
      const scaleBefore = this.scaleFactor;
      this.layout();
      if (JSON.stringify(this.screens.map((screen) => screen.bounds)) === before) {
        if (scaleBefore !== this.scaleFactor) this.updateAllPlayback();
        return;
      }
      // like a display changing resolution: the contents start again on the new screens
      for (const content of this.contents) content.restart();
    }, 250);
  }

  /** @internal: where a window at `frame` goes on the screen numbered `screen`, moved in so all of it is on it */
  keptOnScreen(frame: Rect, screen = 0): { x: number; y: number } {
    const area = this.screens[Math.min(screen, this.screens.length - 1)].visibleFrame;
    const clamp = (value: number, start: number, free: number) => Math.round(Math.min(Math.max(value, start), start + Math.max(free, 0)));
    return { x: clamp(frame.x, area.x, area.width - frame.width), y: clamp(frame.y, area.y, area.height - frame.height) };
  }

  /** Starts a mini program on the desktop */
  launch(spec: ContentSpec): WebContent {
    const content = new WebContent(this, spec);
    content.order = content.type === 'wallpaper' ? 0 : this.nextOrder++;
    const union = this.bounds;
    Object.assign(content.iframe.style, { width: `${union.width}px`, height: `${union.height}px` });
    this.contents.add(content);
    this.stack();
    this.element.appendChild(content.iframe);
    return content;
  }

  terminate(content: WebContent): void {
    if (!this.contents.delete(content)) return;
    if (this.hovered?.content === content) this.hovered = null;
    if (this.press?.content === content) this.press = null;
    content.detach();
  }

  /** The appearance contents are told, light or dark */
  setAppearance(appearance: 'light' | 'dark'): void {
    this.options.appearance = appearance;
    for (const content of this.contents) content.post({ type: 'appearance', appearance });
  }

  setMuted(muted: boolean): void {
    this.options.muted = muted;
    this.updateAllPlayback();
  }

  /** Pauses every content, like the app does when the desktop can't be seen */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.updateAllPlayback();
  }

  /** Whether contents draw: what `playback` tells them (suspended or rendering paused otherwise) */
  private get playing(): boolean {
    return document.visibilityState !== 'hidden' && !this.paused && this.visible;
  }

  /** @internal: a content asked for frames, or the desktop can be seen again */
  startFrames(): void {
    if (!this.frameRequest && this.playing && [...this.contents].some((content) => content.wantsFrames)) this.frameRequest = requestAnimationFrame(this.onFrame);
  }

  destroy(): void {
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    for (const content of [...this.contents]) this.terminate(content);
    window.removeEventListener('message', this.onMessage);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.element.remove();
  }

  /** @internal */
  launchMessage(content: WebContent, files: Record<string, ArrayBuffer>): HostMessage {
    const spec = content.spec;
    const manifest = spec.manifest ?? {};
    const permissions = spec.permissions ?? manifest.permissions ?? [];
    return {
      type: 'launch',
      name: spec.name,
      code: spec.code,
      files,
      options: this.launchOptions(content, permissions),
      screens: this.screens,
      contentType: manifest.type,
      permissions,
      networkDomains: manifest.network?.domains ?? [],
      proxy: content.proxy,
      appearance: this.options.appearance ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
      apiVersion: 1,
      maxFramesPerSecond: this.options.maxFramesPerSecond ?? 0,
      muted: this.options.muted ?? true,
    };
  }

  /** DesktopEngine.launchOptions as the app makes them */
  private launchOptions(content: WebContent, permissions: string[]): Record<string, unknown> {
    const spec = content.spec;
    const type = spec.manifest?.type;
    const level = spec.level ?? (type === 'pet' ? 'floating' : 'desktop');
    const display = (screen: WebScreen) => ({ id: screen.id, name: screen.name, frame: { ...screen.bounds }, visibleFrame: { ...screen.visibleFrame }, scale: screen.scale });
    const options: Record<string, unknown> = {
      instanceId: spec.instanceId ?? `web-${instances}`,
      type,
      level,
      windowType: level === 'floating' ? 'overlay' : 'widget',
      parameters: content.parameters,
      locale: this.options.locale ?? navigator.language,
      permissions: [...permissions].sort(),
    };
    const screen = this.screens[Math.min(spec.screen ?? 0, this.screens.length - 1)];
    if (spec.span && type === 'wallpaper') {
      options.displays = this.screens.map(display);
    } else {
      options.display = display(screen);
    }
    if (type === 'widget') {
      const sizes = spec.manifest?.widget?.sizes ?? [];
      const size = spec.size && (!sizes.length || sizes.includes(spec.size)) ? spec.size : (sizes[0] as keyof typeof WIDGET_SIZES) ?? 'small';
      const dimensions = WIDGET_SIZES[size] ?? WIDGET_SIZES.small;
      options.size = size;
      options.width = dimensions.width;
      options.height = dimensions.height;
      // the app's default place: the top right of the display, below the widgets already there
      const others = [...this.contents].filter((other) => other !== content && other.type === 'widget' && !other.spec.position).length;
      options.position = spec.position ?? {
        x: screen.visibleFrame.x + screen.visibleFrame.width - dimensions.width - 20,
        y: screen.visibleFrame.y + 20 + others * (dimensions.height + 20),
      };
    } else if (spec.position) {
      options.position = spec.position;
    }
    return options;
  }

  /** Wallpapers at the bottom, then widgets and pets in the order they were last pressed */
  private stack(): void {
    for (const content of this.contents) content.iframe.style.zIndex = String(content.type === 'wallpaper' ? content.order : 1000 + content.order);
  }

  private bringToFront(content: WebContent): void {
    if (content.type === 'wallpaper') return;
    content.order = this.nextOrder++;
    this.stack();
  }

  /** @internal */
  updatePlayback(content: WebContent): void {
    const hidden = document.visibilityState === 'hidden';
    content.post({
      type: 'playback',
      suspended: hidden || this.paused,
      renderingPaused: !this.visible,
      muted: this.options.muted ?? true,
      maxFramesPerSecond: this.options.maxFramesPerSecond ?? 0,
    });
  }

  private updateAllPlayback(): void {
    for (const content of this.contents) this.updatePlayback(content);
    this.startFrames();
  }

  // MARK: The pointer

  private point(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    const scale = rect.width ? this.bounds.width / rect.width : 1;
    return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale };
  }

  /** The frontmost window that takes the mouse at a global point, of any content */
  windowAt(x: number, y: number): { content: WebContent; window: WindowState } | null {
    let best: { content: WebContent; window: WindowState; rank: number } | null = null;
    for (const content of this.contents) {
      const win = content.windowAt(x, y);
      if (!win) continue;
      const rank = Number(content.iframe.style.zIndex || 0) * 100000 + win.z;
      if (!best || rank > best.rank) best = { content, window: win, rank };
    }
    return best ? { content: best.content, window: best.window } : null;
  }

  private pointer(content: WebContent, kind: Extract<HostMessage, { type: 'pointer' }>['kind'], windowId: string | null, point: { x: number; y: number }, event: PointerEvent | null): void {
    content.post({
      type: 'pointer',
      kind,
      window: windowId,
      x: point.x,
      y: point.y,
      ctrlKey: event?.ctrlKey ?? false,
      altKey: event?.altKey ?? false,
      metaKey: event?.metaKey ?? false,
      shiftKey: event?.shiftKey ?? false,
    });
  }

  private setHovered(hit: { content: WebContent; window: WindowState } | null, point: { x: number; y: number }, event: PointerEvent | null): void {
    const previous = this.hovered;
    if (previous && (previous.content !== hit?.content || previous.window.id !== hit?.window.id)) {
      this.pointer(previous.content, 'leave', previous.window.id, point, event);
    }
    this.hovered = hit;
  }

  private movesAt(win: WindowState, x: number, y: number): boolean {
    if (!win.movable) return false;
    if (win.dragRegion === null) return true;
    return win.dragRegion.some((rect) => inside(rect, x - win.frame.x, y - win.frame.y));
  }

  private pointerMove(event: PointerEvent): void {
    const point = this.point(event);
    const press = this.press;
    if (press && press.pointerId === event.pointerId) {
      this.dragMove(press, point, event);
      return;
    }
    const hit = this.windowAt(point.x, point.y);
    this.setHovered(hit, point, event);
    if (hit) this.pointer(hit.content, 'move', hit.window.id, point, event);
    this.element.style.cursor = hit && this.movesAt(hit.window, point.x, point.y) ? 'grab' : '';
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.press) return;
    const point = this.point(event);
    const hit = this.windowAt(point.x, point.y);
    if (!hit) return;
    if (hit.window.type !== 'desktop') event.preventDefault();
    this.element.setPointerCapture(event.pointerId);
    this.bringToFront(hit.content);
    const movesWindow = this.movesAt(hit.window, point.x, point.y);
    this.press = {
      content: hit.content,
      window: hit.window,
      pointerId: event.pointerId,
      start: point,
      origin: { x: hit.window.frame.x, y: hit.window.frame.y },
      movesWindow,
      dragging: false,
      moved: false,
    };
    // a press that moves the window reaches the contents only once it turns into a drag; a click just clicks
    if (!movesWindow) this.pointer(hit.content, 'down', hit.window.id, point, event);
  }

  private dragMove(press: Press, point: { x: number; y: number }, event: PointerEvent): void {
    const dx = point.x - press.start.x;
    const dy = point.y - press.start.y;
    if (!press.moved && Math.hypot(dx, dy) > 3) press.moved = true;
    if (!press.movesWindow) {
      this.pointer(press.content, 'move', press.window.id, point, event);
      return;
    }
    if (!press.moved) return;
    if (!press.dragging) {
      press.dragging = true;
      this.pointer(press.content, 'down', press.window.id, press.start, event);
      this.element.style.cursor = 'grabbing';
    }
    const next = this.clamp(press.window, press.origin.x + dx, press.origin.y + dy);
    press.content.post({ type: 'move-window', window: press.window.id, x: next.x, y: next.y });
  }

  /** A dragged window stays on the screens, below the menu bar */
  private clamp(win: WindowState, x: number, y: number): { x: number; y: number } {
    const union = this.bounds;
    const screen = this.screens.find((candidate) => inside(candidate.bounds, x + win.frame.width / 2, y + win.frame.height / 2)) ?? this.screens[0];
    return {
      x: Math.round(Math.min(Math.max(x, 0), union.width - win.frame.width)),
      y: Math.round(Math.min(Math.max(y, screen.visibleFrame.y), screen.bounds.y + screen.bounds.height - win.frame.height)),
    };
  }

  private pointerUp(event: PointerEvent): void {
    const press = this.press;
    if (!press || press.pointerId !== event.pointerId) return;
    this.press = null;
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
    const point = this.point(event);
    if (press.movesWindow) {
      if (press.dragging) this.pointer(press.content, 'up', press.window.id, point, event);
      else this.pointer(press.content, 'click', press.window.id, press.start, event);
    } else {
      this.pointer(press.content, 'up', press.window.id, point, event);
    }
    this.pointerMove(event);
  }

  private pointerCancel(event: PointerEvent): void {
    const press = this.press;
    if (!press || press.pointerId !== event.pointerId) return;
    this.press = null;
    if (press.dragging || !press.movesWindow) this.pointer(press.content, 'up', press.window.id, press.start, event);
    this.setHovered(null, press.start, event);
    this.element.style.cursor = '';
  }
}
