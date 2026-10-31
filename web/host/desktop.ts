// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// A desktop on a web page that runs DesktopEngine mini programs, as the app runs them on the Mac. Each mini program
// runs in its own iframe, sandboxed with an opaque origin: it can't reach the page, its cookies or its storage. The
// iframes lie over the screens without taking the mouse; the desktop finds the window under the pointer from what the
// frames report (frames, hit and drag regions), passes the pointer on, and moves widgets and companions when they're dragged.
//
//   const desktop = new WebDesktop(element, { insets: { top: 24, bottom: 64 } });
//   const content = desktop.launch({ name: 'Clock', code, manifest, files });
//   content.on('console', ({ level, message }) => …);

import { API_VERSION, frameDocument, itemVolume, type AppWindowInfo, type ChannelScope, type FrameMessage, type HostMessage, type ParameterValue, type Rect, type SuspendReason, type SystemStatusOverrides, type SystemStatusReading, type WebScreen, type WindowState } from '../protocol.ts';
import { ANALYSIS_RATE, analyseSpectrum, emptySnapshot } from '../system-audio.ts';
import { SystemStatusSimulation, strongerReason, systemStatusChanges } from '../system-status.ts';
import {
  declaredSizes, edgesAt, fitted, HINT_GAP, HINT_WIDTH, hitMargins, resizeCursor, resizedFrame, resizeHintShape, sanitizeCorner, SIZING_API_VERSION, widgetSizing,
  type CornerShape, type Edges, type Margins, type Size, type WidgetSizing, widgetFrame,
} from '../widget-sizes.ts';

/** The id prefix the store reserves */
const OFFICIAL_ID_PREFIX = 'app.desktopengine.official.';

declare const __FRAME_RUNTIME__: string;

export type { AppWindowInfo, Rect, WebScreen, WindowState, ParameterValue, SuspendReason, SystemStatusOverrides, SystemStatusReading };

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
  /**
   * The desktop's proxy sends every method with the request's headers and body, as `dev --web`'s does. By default
   * contents send GET and HEAD only, which is what the store's preview proxy takes; other requests fail in the frame
   */
  proxySendsAnyMethod?: boolean;
  appearance?: 'light' | 'dark';
  /** Frames per second at most, 0 for the display's */
  maxFramesPerSecond?: number;
  /**
   * Sound is off, by default. While it's on, the frame of a content that may play sound takes the pointer when it's
   * over one of its windows: browsers start a frame's sound only after the visitor pressed in that frame.
   */
  muted?: boolean;
  /** The language contents are told, navigator.language by default */
  locale?: string;
  /**
   * The contents that get DesktopEngine.input's keyactivity, of those that declare the key-activity permission: how many
   * keys the visitor presses on the page (never which ones), on a 100 ms grid. None by default.
   */
  keyActivity?: (content: ContentSpec) => boolean;
  /**
   * Pretend windows of other apps, global points, front to back: what DesktopEngine.windows lists to contents with the
   * window-positions permission. Drawn over wallpapers and widgets on the desktop, under widgets and companions above
   * all windows; the visitor drags them by their title bar, resizes them from their bottom right corner and closes them
   * (see `addAppWindow`). Undefined (the default, as in the store's preview): there are none and none can be added, the
   * list is empty.
   */
  appWindows?: Rect[];
}

/** What the desktop needs to know of manifest.json */
export interface ManifestInfo {
  id?: string;
  /** `pet` is the old name of `companion` */
  type?: 'wallpaper' | 'widget' | 'companion' | 'pet';
  apiVersion?: number;
  permissions?: string[];
  network?: { domains?: string[] };
  /** The volume the user's starts at, 0...1 */
  audio?: { volume?: unknown };
  /** Preset names and sizes of its own (`{ id, width, height, name }`); who may resize it and within what */
  widget?: { sizes?: unknown[]; resize?: unknown };
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
  /**
   * The item's volume as the user set it, 0...1, which the content reads (`DesktopEngine.audioSettings.volume`); the
   * manifest's `audio.volume` by default, or 1. The page doesn't scale the sound by it
   */
  volume?: number;
  /** For a widget: the id of one of its sizes, a preset's name (small, medium, large) or one of its own; its first by default */
  size?: string;
  /** For a widget that can be resized: the size it was left in, which it starts in instead of `size`'s */
  windowSize?: Size;
  /** For a widget: on the desktop (default), or above everything; a companion always floats above everything */
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
  /**
   * Whether it may use BroadcastChannels of scope "namespace": shared with the contents whose manifest id has the same
   * namespace, `app.desktopengine.<namespace>.<name>`. On by default, for contents whose id is checked (from the store,
   * or all run by one developer); turn it off for packages anyone could have made, as the app does for imported ones.
   */
  namespaceChannels?: boolean;
  /**
   * Whether the content's id counts as one the store checked. On by default, for the store's items;
   * `desktopengine dev --web` turns it off for the developer's copy.
   */
  officialId?: boolean;
}

type ContentEvents = {
  launched: void;
  console: { level: string; message: string };
  exception: { message: string; stack?: string };
  'host-message': unknown;
  windows: WindowState[];
  stats: { framesPerSecond: number };
};

/** How long a dropped widget takes to slide where it may be (ms), as in the app */
const SLIDE_DURATION = 250;

const inside = (rect: Rect, x: number, y: number): boolean => x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;

/** BroadcastChannel messages a content may post a second: the engine's 240, with room for timing differences */
const BROADCASTS_PER_SECOND = 300;

/** keyactivity is sent on this grid, in milliseconds, as the app does */
const KEY_GRID = 100;

let instances = 0;

/** One mini program on the desktop */
export class WebContent {
  iframe: HTMLIFrameElement;
  windows: WindowState[] = [];
  framesPerSecond = 0;
  /** @internal: the size a widget's window was told to start in (launchOptions.width / height) */
  launchedWidgetSize: { width: number; height: number } | null = null;
  /** Stacking among the contents; widgets and companions come to the front when pressed */
  order = 0;
  /** It has animation frame callbacks waiting: the desktop sends it its display frames */
  wantsFrames = false;
  /** It listens to DesktopEngine.input's mouse events, and has the mouse permission */
  wantsMouse = false;
  /** It listens to keyactivity, and the desktop gives it */
  wantsKeys = false;
  /** The BroadcastChannels its frame has open, by scope and name ("<scope>\n<name>") */
  readonly channels = new Set<string>();
  /** @internal: it was last told it's suspended */
  suspendedPlayback = false;
  private listeners = new Map<string, Set<(value: never) => void>>();
  private ready = false;
  private stopped = false;
  /** New parameters were sent and their answer hasn't come */
  private awaitingParameters = false;
  private parameterValues: Record<string, ParameterValue>;
  /** Tells contents apart */
  private readonly serial: number;
  /** BroadcastChannel messages it may still post now, see spendBroadcast */
  private broadcastAllowance = BROADCASTS_PER_SECOND;
  private broadcastTime = 0;

  constructor(
    readonly desktop: WebDesktop,
    public spec: ContentSpec,
  ) {
    instances += 1;
    this.serial = instances;
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

  get type(): ContentKind | undefined {
    return contentKind(this.spec.manifest?.type);
  }

  /** Where the user put it: a companion always floats above windows, a wallpaper is on the desktop, a widget on the desktop unless told */
  get level(): 'desktop' | 'floating' {
    if (this.type === 'companion') return 'floating';
    return this.type === 'wallpaper' ? 'desktop' : (this.spec.level ?? 'desktop');
  }

  /** The only window type it may make (launchOptions.windowType); undefined: any (no manifest) */
  get allowedWindowType(): string | undefined {
    return this.type && windowType(this.type, this.level);
  }

  /** DesktopEngine.audioSettings.volume: the spec's, the manifest's `audio.volume`, or 1, as the app picks it */
  get volume(): number {
    return itemVolume(this.spec.volume, this.spec.manifest?.audio?.volume);
  }

  /** It may play sound: its frame takes the pointer over its windows while the desktop's sound is on */
  get mayPlaySound(): boolean {
    return (this.spec.permissions ?? this.spec.manifest?.permissions ?? []).includes('audio');
  }

  /** It may follow the pointer anywhere on the desktop: DesktopEngine.input's mouse events */
  get mayFollowMouse(): boolean {
    return (this.spec.permissions ?? this.spec.manifest?.permissions ?? []).includes('mouse');
  }

  /** It's told where the pretend app windows are: DesktopEngine.windows */
  get seesAppWindows(): boolean {
    return (this.spec.permissions ?? this.spec.manifest?.permissions ?? []).includes('window-positions');
  }

  /** It's told how the pretend Mac is doing: DesktopEngine.systemStatus */
  get seesSystemStatus(): boolean {
    return (this.spec.permissions ?? this.spec.manifest?.permissions ?? []).includes('system-info');
  }

  /** It's told how many keys are pressed on the page: it declares key-activity and DesktopOptions.keyActivity gives it */
  get getsKeyActivity(): boolean {
    const permissions = this.spec.permissions ?? this.spec.manifest?.permissions ?? [];
    return permissions.includes('key-activity') && this.desktop.options.keyActivity?.(this.spec) === true;
  }

  /** Who its BroadcastChannels of the scope reach: contents with the same string; null when it can't use the scope */
  channelGroup(scope: ChannelScope): string | null {
    const id = this.spec.manifest?.id;
    switch (scope) {
      case 'package':
        // without an id, its instance is a package of its own
        return id ?? `instance:${this.serial}`;
      case 'namespace': {
        const namespace = id ? /^app\.desktopengine\.([^.]+)\./.exec(id)?.[1] : undefined;
        return this.spec.namespaceChannels !== false && namespace ? namespace : null;
      }
    }
    return null;
  }

  /** @internal: whether it may post one more BroadcastChannel message: its frame keeps it to the engine's rate, this only stops a frame that doesn't */
  spendBroadcast(): boolean {
    const now = performance.now() / 1000;
    this.broadcastAllowance = Math.min(BROADCASTS_PER_SECOND, this.broadcastAllowance + (this.broadcastTime ? now - this.broadcastTime : 0) * BROADCASTS_PER_SECOND);
    this.broadcastTime = now;
    if (this.broadcastAllowance < 1) return false;
    this.broadcastAllowance -= 1;
    return true;
  }

  /**
   * What DesktopEngine.systemAudio gives it, from its permissions and its id (see ContentSpec.officialId)
   */
  get systemAudio(): 'none' | 'restricted' | 'detailed' {
    const permissions = this.spec.permissions ?? this.spec.manifest?.permissions ?? [];
    const official = this.spec.officialId !== false && (this.spec.manifest?.id ?? '').startsWith(OFFICIAL_ID_PREFIX);
    if (!permissions.includes('system-audio') || (permissions.includes('network') && !official)) return 'none';
    return official ? 'detailed' : 'restricted';
  }

  /**
   * What it runs with, as launchOptions.permissions lists them: the ones it may use (ContentSpec.permissions) but
   * system-audio when it hears nothing (with network) and key-activity when the page doesn't give it, as the app leaves
   * out what it doesn't give
   */
  get givenPermissions(): string[] {
    const permissions = this.spec.permissions ?? this.spec.manifest?.permissions ?? [];
    return [...new Set(permissions)].filter((permission) => {
      if (permission === 'system-audio') return this.systemAudio !== 'none';
      if (permission === 'key-activity') return this.getsKeyActivity;
      return true;
    });
  }

  /** For a widget: how its window is sized, from its manifest, the size asked for and the one it was left in */
  get widgetSizing(): WidgetSizing | null {
    // widgets made for an API before widget sizing keep the window rules they were made with
    if (this.type !== 'widget' || !((this.spec.manifest?.apiVersion ?? 1) >= SIZING_API_VERSION)) return null;
    return widgetSizing(this.spec.manifest, widgetSize(this.spec).dimensions, this.spec.windowSize);
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
        this.windows = sanitizeWindows(message.windows, this.allowedWindowType);
        this.emit('windows', this.windows);
        this.desktop.windowsChanged(this);
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
      case 'input-wanted':
        this.wantsMouse = message.mouse === true && this.mayFollowMouse;
        this.wantsKeys = message.keys === true && this.getsKeyActivity;
        this.desktop.updateInputWatching();
        break;
      case 'window-corner':
        this.desktop.cornerMeasured(this, String(message.window), sanitizeCorner(message.shape));
        break;
      case 'parameters-result':
        // like the app: content that doesn't apply new parameters itself starts again with them (only an answer to
        // parameters that were sent counts)
        if (!this.awaitingParameters) break;
        this.awaitingParameters = false;
        if (!message.handled) this.restart();
        break;
      case 'input':
        this.desktop.frameInput(this, message);
        break;
      case 'channel': {
        const key = `${message.scope}\n${message.name}`;
        if (message.open !== true) this.channels.delete(key);
        else if (this.channelGroup(message.scope) !== null) this.channels.add(key);
        break;
      }
      case 'broadcast':
        this.desktop.broadcast(this, message);
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
   * Starts it again, e.g. after its code changed. A widget or companion starts where its window is now (kept on its screen),
   * not where it was first launched, unless `spec` gives it a position.
   */
  restart(spec?: Partial<ContentSpec>): void {
    const frame = this.windows.find((win) => win.visible && win.type !== 'desktop')?.frame;
    const widgetWindow = this.windows.find((win) => win.visible && win.widget);
    const widgetFrame = widgetWindow?.frame;
    const resizable = this.widgetSizing !== null && (this.widgetSizing.byUser || this.widgetSizing.byContent);
    const sizeChanged = spec?.size !== undefined && spec.size !== this.spec.size;
    if (spec) {
      this.spec = { ...this.spec, ...spec };
      if (spec.manifest || spec.parameters) this.parameterValues = { ...defaultParameters(this.spec.manifest), ...this.spec.parameters, ...spec.parameters };
    }
    // a widget that can be resized starts again in the size it was left in, unless it's given another size, which it
    // starts in; it's kept on its screen in that size
    // (only a size the user or the content left it in: not the one it started in, which may be scaled down to a screen
    // that has grown since, as the app keeps it)
    const launched = this.launchedWidgetSize;
    const leftIn = widgetFrame && launched && (widgetFrame.width !== launched.width || widgetFrame.height !== launched.height);
    if (sizeChanged) this.spec.windowSize = spec?.windowSize;
    else if (widgetFrame && leftIn && resizable && spec?.windowSize === undefined) this.spec.windowSize = { width: widgetFrame.width, height: widgetFrame.height };
    const size = this.widgetSizing?.size ?? (this.type === 'widget' ? widgetSize(this.spec).dimensions : undefined);
    // the widget's window as far off as it reaches past where it takes the mouse
    const margins = widgetWindow && size ? hitMargins(widgetWindow.hitRegion, size) : undefined;
    if (frame && spec?.position === undefined) this.spec.position = this.desktop.keptOnScreen({ ...frame, ...size }, this.spec.screen, margins);
    this.post({ type: 'stop' });
    this.ready = false;
    this.awaitingParameters = false;
    this.wantsFrames = false;
    this.wantsMouse = false;
    this.wantsKeys = false;
    this.channels.clear();
    this.desktop.updateInputWatching();
    this.windows = [];
    this.emit('windows', this.windows);
    this.desktop.releasePointer(this);
    const replacement = this.iframe.cloneNode() as HTMLIFrameElement;
    this.watchNavigation(replacement);
    if (this.desktop.options.frameURL) replacement.src = this.desktop.options.frameURL;
    else replacement.srcdoc = frameDocument(__FRAME_RUNTIME__, { proxy: this.proxy });
    this.iframe.replaceWith(replacement);
    this.iframe = replacement;
    // a new manifest may make it another type, or move a widget above all windows or back onto the desktop
    this.desktop.place(this);
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

  /** Whether the user may resize its window by the edges: the widget's window, when its manifest lets the user */
  userResizes(win: WindowState): boolean {
    return win.widget === true && this.widgetSizing?.byUser === true;
  }

  /** The window under a global point that takes the mouse there, the frontmost */
  windowAt(x: number, y: number): WindowState | null {
    let found: WindowState | null = null;
    for (const win of this.windows) {
      if (!win.visible || !inside(win.frame, x, y)) continue;
      const local = { x: x - win.frame.x, y: y - win.frame.y };
      // the edges of a widget the user resizes take the mouse, whatever its hit region
      const onEdge = this.userResizes(win) && edgesAt(local.x, local.y, win.frame) !== null;
      if (!onEdge && win.hitRegion && !win.hitRegion.some((rect) => inside(rect, local.x, local.y))) continue;
      if (!found || win.z > found.z) found = win;
    }
    return found;
  }
}

/** At most this many windows of a content count, as the engine allows */
const MAX_WINDOWS = 16;
export type ContentKind = 'wallpaper' | 'widget' | 'companion';

/** A manifest's type as the desktop treats it: `pet` is the old name of `companion`; undefined for anything else */
export function contentKind(type: unknown): ContentKind | undefined {
  if (type === 'pet') return 'companion';
  return type === 'wallpaper' || type === 'widget' || type === 'companion' ? type : undefined;
}

/** The window type of a content's windows where it's placed, as the app gives it */
export function windowType(kind: ContentKind, level: 'desktop' | 'floating'): string {
  if (kind === 'wallpaper') return 'desktop';
  return kind === 'companion' || level === 'floating' ? 'overlay' : 'widget';
}

/** A window's stacking within its content: a content can't rank its windows above another content's */
const MAX_Z = 10_000;

/**
 * The windows a frame says it has, as the host can trust them: the one type the content may make where it's placed (a
 * wallpaper only desktop windows), finite frames, stacking within bounds, and regions that are lists of rectangles. Anything else is
 * dropped rather than allowed to break hit testing for every content.
 */
export function sanitizeWindows(value: unknown, allowedType: string | undefined): WindowState[] {
  if (!Array.isArray(value)) return [];
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
    if (!frame || (allowedType && type !== allowedType)) continue;
    windows.push({
      id: String(win?.id ?? ''),
      type,
      frame,
      visible: win?.visible === true,
      z: Math.min(Math.max(finite(win?.z) ?? 0, 0), MAX_Z),
      hitRegion: rects(win?.hitRegion),
      dragRegion: rects(win?.dragRegion),
      movable: win?.movable === true,
      widget: win?.widget === true,
    });
  }
  return windows;
}

/** The size a widget launches in: the one asked for when its manifest declares it, else its first; and its points */
function widgetSize(spec: ContentSpec): { size: string; dimensions: Size } {
  const sizes = declaredSizes(spec.manifest);
  const size = sizes.find((declared) => declared.id === spec.size) ?? sizes[0];
  return { size: size.id, dimensions: { width: size.width, height: size.height } };
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
  /** The DOM's button pressed: the others than the primary one never move the window */
  button: number;
  start: { x: number; y: number };
  origin: { x: number; y: number };
  movesWindow: boolean;
  dragging: boolean;
  moved: boolean;
  /** Where the window was last taken while dragged */
  at: { x: number; y: number } | null;
  /** The edges of the widget's window it resizes, and the window's frame when it began */
  resize: { edges: Edges; frame: Rect } | null;
}

/** A pretend app window (`DesktopOptions.appWindows`) and its element */
interface AppWindow {
  id: number;
  frame: Rect;
  element: HTMLDivElement;
  title: HTMLDivElement;
}

/** A press on a pretend app window: it moves by its title bar and resizes from its bottom right corner */
interface AppWindowPress {
  window: AppWindow;
  pointerId: number;
  start: { x: number; y: number };
  origin: Rect;
  action: 'move' | 'resize' | null;
}

/** The pretend app windows' title bar, resize corner and smallest size, in points */
const APP_TITLE_HEIGHT = 28;
const APP_CORNER = 14;
const APP_MIN_SIZE = { width: 160, height: 100 };
/** Stacking of the pretend app windows: above contents on the desktop, below those above all windows */
const APP_WINDOW_Z = 50_000;
/** How near the widget's corner the pointer makes the resize hint full, and how faint it is elsewhere */
const HINT_CORNER = 18;
const HINT_RESTING_OPACITY = 0.75;
/** Ids of the hints' masks, one per desktop on the page */
let hintMasks = 0;
const FLOATING_Z = 100_000;

/** What the desktop reads of a pointer event, from the page or passed back by a frame */
/** A DOM wheel event's deltas as NSEvent's: about lines, positive toward the top and the left */
function wheelDeltas(deltaX: number, deltaY: number, deltaMode: number): { deltaX: number; deltaY: number } {
  // WheelEvent's DOM_DELTA_PIXEL (0), DOM_DELTA_LINE (1) and DOM_DELTA_PAGE (2)
  const lines = deltaMode === 0 ? 10 : deltaMode === 2 ? 1 / 30 : 1;
  // no -0 for a wheel that didn't turn that way
  return { deltaX: -deltaX / lines || 0, deltaY: -deltaY / lines || 0 };
}

interface PointerInput {
  pointerId: number;
  button: number;
  buttons: number;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export class WebDesktop {
  readonly element: HTMLDivElement;
  screens: WebScreen[] = [];
  readonly contents = new Set<WebContent>();
  private hovered: { content: WebContent; window: WindowState } | null = null;
  /**
   * The hint that the user can resize a widget, as in the app: once the pointer has rested on the widget a second, a
   * corner bracket fades in at the bottom right of its body, nudges toward the corner twice, and rests faint until the
   * pointer comes to the corner
   */
  private readonly hint: HTMLDivElement;
  /**
   * The widget the pointer rests on, its timer, whether the hint shows on it, and the shape its content draws at the
   * corner (measured by its frame as the hint is about to show, and again as its window changes)
   */
  private hintTarget: { content: WebContent; windowId: string; timer: number; shown: boolean; measuring: boolean; shape: CornerShape | null } | null = null;
  /** How many times the visitor resized a widget: after 3 the hint only fades in */
  private userResizes = 0;
  private press: Press | null = null;
  /** A dropped window sliding to where it may be, as a widget's does in the app */
  private slide: { content: WebContent; windowId: string; from: { x: number; y: number }; to: { x: number; y: number }; start: number; request: number } | null = null;
  /** The content whose frame takes the pointer (see `input` in the protocol) */
  private pointerTaker: WebContent | null = null;
  private visible = true;
  private paused = false;
  private nextOrder = 1;
  private scaleFactor = 1;
  private resizeTimer = 0;
  private frameRequest = 0;
  private audioContext: AudioContext | null = null;
  private readonly mediaSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  /** The element contents hear: its source, and the node it feeds the analysis */
  private systemAudio: { element: HTMLMediaElement; source: AudioNode; input: AudioNode; timer: number } | null = null;
  /** The pretend app windows, front to back, the one the visitor last pressed (the active app's) and the press on one */
  private appWindowList: AppWindow[] = [];
  private activeAppWindow: number | null = null;
  private appPress: AppWindowPress | null = null;
  private nextAppWindowId = 1;
  /** DesktopEngine.systemStatus: the made-up Mac all contents see, and the timer of its readings */
  private readonly statusSimulation = new SystemStatusSimulation();
  private statusTimer = 0;
  /** A suspension `simulateSuspension` started: its reason, the timer that ends it and what waits for that */
  private simulatedSuspension: { reason: SuspendReason; timer: number; ended: (() => void)[] } | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly onMessage = (event: MessageEvent) => {
    for (const content of this.contents) {
      if (event.source === content.iframe.contentWindow) content.receive(event.data as FrameMessage);
    }
  };
  private readonly onVisibility = () => this.updateAllPlayback();
  /** Keys pressed on the page since keyactivity was last sent, and whether it's on its way */
  private keyPresses = 0;
  private keyTimer = 0;
  private watchingKeys = false;
  /** The pointer anywhere on the page, over the page's own things on top of the desktop too, as in the app */
  private watchingMouse = false;
  private readonly onPagePointer = (event: PointerEvent) => {
    const point = this.point(event);
    const kind = event.type === 'pointermove' ? 'move' : event.type === 'pointerdown' ? 'down' : 'up';
    // off the desktop there's no screen; a button let go there still goes up
    if (kind !== 'up' && !inside(this.bounds, point.x, point.y)) return;
    this.globalMouse(kind, point, event);
  };
  private readonly onPageWheel = (event: WheelEvent) => {
    const point = this.point(event);
    if (inside(this.bounds, point.x, point.y)) this.globalWheel(point, event.deltaX, event.deltaY, event.deltaMode);
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    // a held key repeating is one press
    if (event.repeat) return;
    this.keyPresses += 1;
    if (this.keyTimer) return;
    // told at the next step of the grid, not when the key went down
    this.keyTimer = window.setTimeout(this.sendKeyActivity, KEY_GRID - (performance.now() % KEY_GRID));
  };
  private readonly sendKeyActivity = () => {
    this.keyTimer = 0;
    const count = this.keyPresses;
    this.keyPresses = 0;
    for (const content of this.contents) if (content.wantsKeys) content.post({ type: 'key-activity', count });
  };
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
    this.hint = document.createElement('div');
    this.hint.className = 'de-resize-hint';
    // as the app draws it: a stroke of light glass (what's behind it blurred) with a dark hairline around it, which shows
    // on a light wallpaper or a dark one, whatever the appearance. The parts fade, not the hint: an ancestor that's faded would leave the glass nothing to blur.
    const mask = `de-resize-hint-${++hintMasks}`;
    this.hint.innerHTML = `<div></div><svg fill="none" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:0;top:0">`
      + `<mask id="${mask}" maskUnits="userSpaceOnUse"><path stroke="white" stroke-width="${HINT_WIDTH + 1.5}"/><path stroke="black" stroke-width="${HINT_WIDTH - 0.5}"/></mask>`
      + `<path mask="url(#${mask})" stroke-width="${HINT_WIDTH + 1.5}"/></svg>`;
    Object.assign(this.hint.style, { position: 'absolute', pointerEvents: 'none' });
    Object.assign((this.hint.firstElementChild as HTMLElement).style, {
      position: 'absolute', inset: '0', opacity: '0',
      backdropFilter: 'blur(8px) saturate(1.8)', webkitBackdropFilter: 'blur(8px) saturate(1.8)',
    });
    (this.hint.lastElementChild as SVGSVGElement).style.opacity = '0';
    this.element.appendChild(this.hint);
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
    for (const frame of options.appWindows ?? []) this.createAppWindow(frame);
    this.appWindowList.reverse();
    this.stackAppWindows();
    this.activeAppWindow = this.appWindowList[0]?.id ?? null;
    this.element.addEventListener('pointermove', (event) => {
      if (this.appPress?.pointerId === event.pointerId) this.appWindowDrag(this.appPress, this.point(event));
      else this.pointerMove(this.point(event), event);
    });
    this.element.addEventListener('pointerdown', (event) => {
      const point = this.point(event);
      if (this.appWindowDown(point, event)) {
        event.preventDefault();
        this.element.setPointerCapture(event.pointerId);
        return;
      }
      const hit = this.pointerDown(point, event);
      if (!hit) return;
      if (hit.type !== 'desktop') event.preventDefault();
      this.element.setPointerCapture(event.pointerId);
    });
    this.element.addEventListener('pointerup', (event) => {
      if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
      if (this.appPress?.pointerId === event.pointerId) {
        this.appPress = null;
        this.pointerMove(this.point(event), event);
        return;
      }
      this.pointerUp(this.point(event), event);
    });
    this.element.addEventListener('pointercancel', (event) => {
      if (this.appPress?.pointerId === event.pointerId) this.appPress = null;
      else this.pointerCancel(event);
    });
    // the secondary button goes to the window, as in the app, which has no menu there
    this.element.addEventListener('contextmenu', (event) => {
      const point = this.point(event);
      const hit = this.windowAt(point.x, point.y);
      if (hit && hit.window.type !== 'desktop') event.preventDefault();
    });
    // the pointer going into the frame that takes it still hovers that frame's window
    this.element.addEventListener('pointerleave', () => {
      if (!this.press && !this.pointerTaker) {
        this.setHovered(null, { x: 0, y: 0 }, null);
        this.updateHint(null, { x: 0, y: 0 });
      }
    });
    // a wheel turned over a widget or a companion goes to its window instead of scrolling the page, as in the app
    this.element.addEventListener('wheel', (event) => {
      if (this.windowWheel(this.point(event), event, event.deltaX, event.deltaY, event.deltaMode)) event.preventDefault();
    }, { passive: false });
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
      const screensBefore = this.screens;
      const before = JSON.stringify(this.screens.map((screen) => screen.bounds));
      const scaleBefore = this.scaleFactor;
      this.layout();
      if (JSON.stringify(this.screens.map((screen) => screen.bounds)) === before) {
        if (scaleBefore !== this.scaleFactor) this.updateAllPlayback();
        return;
      }
      // like a display changing resolution: the contents start again on the new screens, a widget or companion at the
      // same place in its screen's free area (one at the right edge or on the Dock stays there as the page grows)
      for (const content of this.contents) {
        const position = this.followingScreens(content, screensBefore);
        content.restart(position ? { position } : undefined);
      }
    }, 250);
  }

  /** Where a content's window goes on the new screens: the fractions of the free area left of and above it it had before */
  private followingScreens(content: WebContent, before: WebScreen[]): { x: number; y: number } | undefined {
    const frame = content.windows.find((win) => win.visible && win.type !== 'desktop')?.frame;
    if (!frame || !before.length) return undefined;
    const screen = content.spec.screen ?? 0;
    const was = before[Math.min(screen, before.length - 1)].visibleFrame;
    const area = this.screens[Math.min(screen, this.screens.length - 1)].visibleFrame;
    const fraction = (offset: number, free: number) => (free > 0 ? Math.min(Math.max(offset / free, 0), 1) : 0);
    const place = (start: number, free: number, f: number) => Math.round(start + Math.max(free, 0) * f);
    return {
      x: place(area.x, area.width - frame.width, fraction(frame.x - was.x, was.width - frame.width)),
      y: place(area.y, area.height - frame.height, fraction(frame.y - was.y, was.height - frame.height)),
    };
  }

  /**
   * @internal: where a window at `frame` goes on the screen numbered `screen`, moved in so all of it is on it, but for
   * `margins` (a widget's window round where it takes the mouse) on the left, the right and the bottom
   */
  keptOnScreen(frame: Rect, screen = 0, margins: Margins = { left: 0, right: 0, bottom: 0 }): { x: number; y: number } {
    const area = this.screens[Math.min(screen, this.screens.length - 1)].visibleFrame;
    const clamp = (value: number, low: number, high: number) => Math.round(Math.max(low, Math.min(value, high)));
    return {
      x: clamp(frame.x, area.x - margins.left, area.x + area.width - frame.width + margins.right),
      y: clamp(frame.y, area.y, area.y + area.height - frame.height + margins.bottom),
    };
  }

  /** Starts a mini program on the desktop */
  launch(spec: ContentSpec): WebContent {
    const content = new WebContent(this, spec);
    const union = this.bounds;
    Object.assign(content.iframe.style, { width: `${union.width}px`, height: `${union.height}px` });
    this.contents.add(content);
    this.place(content);
    this.element.appendChild(content.iframe);
    return content;
  }

  /** @internal: stacks a content where its type and level go, as it launches or starts again */
  place(content: WebContent): void {
    // wallpapers are all at the bottom; anything else gets an order of its own, in front of the others of its level
    if (content.type === 'wallpaper') content.order = 0;
    else if (content.order === 0) content.order = this.nextOrder++;
    this.stack();
  }

  terminate(content: WebContent): void {
    if (!this.contents.delete(content)) return;
    this.releasePointer(content);
    if (this.hovered?.content === content) {
      this.hovered = null;
      this.updateHint(null, { x: 0, y: 0 });
    }
    if (this.press?.content === content) this.press = null;
    content.detach();
    this.updateInputWatching();
    this.updateStatusTimer();
  }

  /** The appearance contents are told, light or dark */
  setAppearance(appearance: 'light' | 'dark'): void {
    this.options.appearance = appearance;
    for (const content of this.contents) content.post({ type: 'appearance', appearance });
    for (const win of this.appWindowList) this.styleAppWindow(win);
  }

  setMuted(muted: boolean): void {
    this.options.muted = muted;
    if (muted && this.pointerTaker && !this.press) this.takePointer(null);
    this.updateAllPlayback();
  }

  /**
   * What contents with the system-audio permission hear instead of a made-up signal like music: an audio or video
   * element on the page, analysed while it plays (the page plays it, so it's heard too); null goes back to the made-up
   * signal. Call it from a click or a key press: the page's audio starts only after one.
   */
  setSystemAudioSource(element: HTMLMediaElement | null): void {
    if (this.systemAudio?.element === element) return;
    if (this.systemAudio) {
      clearInterval(this.systemAudio.timer);
      this.systemAudio.source.disconnect(this.systemAudio.input);
      this.systemAudio = null;
    }
    if (!element) {
      for (const content of this.contents) {
        if (content.systemAudio !== 'none') content.post({ type: 'system-audio', bands: null, level: 0, peak: 0 });
      }
      return;
    }
    const context = (this.audioContext ??= new AudioContext());
    context.resume().catch(() => undefined);
    // an element gets one source node for good
    let source = this.mediaSources.get(element);
    if (!source) {
      source = context.createMediaElementSource(element);
      this.mediaSources.set(element, source);
    }
    // the app hears a stereo mix: the element's sound as one, which the analysis takes in mono ((L + R) / 2), as the
    // app's does, and each of its two channels for the peak (an analyser gives only the mono)
    const stereo = context.createGain();
    stereo.channelCount = 2;
    stereo.channelCountMode = 'explicit';
    stereo.channelInterpretation = 'speakers';
    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    const channels = context.createChannelSplitter(2);
    const channelAnalysers = [0, 1].map((channel) => {
      const channelAnalyser = context.createAnalyser();
      channelAnalyser.fftSize = analyser.fftSize;
      channels.connect(channelAnalyser, channel);
      return channelAnalyser;
    });
    source.disconnect();
    source.connect(stereo);
    stereo.connect(analyser);
    stereo.connect(channels);
    source.connect(context.destination);
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    const samples = new Float32Array(analyser.fftSize);
    const snapshot = emptySnapshot();
    // as the app measures them: the level of the last 1/60 s, and the loudest sample of either channel since the last
    // analysis
    const hop = Math.max(1, Math.round(context.sampleRate / ANALYSIS_RATE));
    let analysedAt = context.currentTime;
    const timer = window.setInterval(() => {
      analyser.getFloatFrequencyData(spectrum);
      analyser.getFloatTimeDomainData(samples);
      const fresh = Math.min(samples.length, Math.max(hop, Math.round((context.currentTime - analysedAt) * context.sampleRate)));
      analysedAt = context.currentTime;
      let sum = 0;
      for (let index = samples.length - hop; index < samples.length; index++) sum += samples[index] * samples[index];
      let peak = 0;
      for (const channelAnalyser of channelAnalysers) {
        channelAnalyser.getFloatTimeDomainData(samples);
        for (let index = samples.length - fresh; index < samples.length; index++) peak = Math.max(peak, Math.abs(samples[index]));
      }
      analyseSpectrum(spectrum, context.sampleRate, analyser.fftSize, sum / hop, snapshot);
      for (const content of this.contents) {
        if (content.systemAudio !== 'none') content.post({ type: 'system-audio', bands: snapshot.bands.slice(), level: snapshot.level, peak });
      }
    }, 1000 / ANALYSIS_RATE);
    this.systemAudio = { element, source, input: stereo, timer };
  }

  /** Pauses every content, like the app does when the desktop can't be seen; they get `resume` with the reason 'paused' */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.updateAllPlayback();
  }

  // MARK: DesktopEngine.systemStatus

  /** The made-up system status contents with the system-info permission see now */
  get systemStatus(): SystemStatusReading {
    return this.statusSimulation.current;
  }

  /** What the page set over the made-up system status (`setSystemStatus`) */
  get systemStatusOverrides(): SystemStatusOverrides {
    return { ...this.statusSimulation.overrides };
  }

  /**
   * Sets parts of the made-up system status, over what was set before; a key set to undefined goes back to the
   * simulation. What the app hears of at once from macOS (the power source, charging, Low Power Mode, the thermal
   * state, the network, memory pressure) comes to contents at once, the rest with the next reading.
   *
   *   desktop.setSystemStatus({ power: 'ac', batteryLevel: 0.08 });
   *   desktop.setSystemStatus({ online: false });
   *   desktop.setSystemStatus({ batteryLevel: undefined });
   */
  setSystemStatus(overrides: SystemStatusOverrides): void {
    const merged: Record<string, unknown> = { ...this.statusSimulation.overrides };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    }
    this.applySystemStatus(merged as SystemStatusOverrides);
  }

  /** Back to the made-up system status, nothing set over it */
  resetSystemStatus(): void {
    this.applySystemStatus({});
  }

  private applySystemStatus(overrides: SystemStatusOverrides): void {
    const previous = this.statusSimulation.current;
    this.statusSimulation.overrides = overrides;
    const next = this.statusSimulation.sample();
    // a notification of macOS's in the app: a new reading at once, the next one a second later
    if (systemStatusChanges(previous, next).length) {
      this.sendSystemStatus(next);
      if (this.statusTimer) {
        clearInterval(this.statusTimer);
        this.statusTimer = 0;
        this.updateStatusTimer();
      }
    }
  }

  /**
   * Suspends every content for `ms` as the app does when the Mac sleeps ('sleep'), its displays sleep ('displaysleep')
   * or the user pauses all content ('paused'): no drawing, no system status readings, timers once a second. Then they
   * run again and get DesktopEngine.systemStatus's `resume` with the reason, and a new reading. A suspension already
   * on goes on to the new end, with the stronger reason (sleep, then displaysleep, then paused). Resolves when they run again.
   */
  simulateSuspension(reason: SuspendReason = 'sleep', ms = 5000): Promise<void> {
    const current = this.simulatedSuspension;
    if (current) clearTimeout(current.timer);
    const timer = window.setTimeout(() => this.endSuspension(), Math.max(0, ms));
    const suspension = { reason: strongerReason(reason, current?.reason), timer, ended: current?.ended ?? [] };
    this.simulatedSuspension = suspension;
    const ended = new Promise<void>((resolve) => suspension.ended.push(resolve));
    this.updateAllPlayback();
    return ended;
  }

  /** Ends a suspension `simulateSuspension` started, before its time */
  endSuspension(): void {
    const suspension = this.simulatedSuspension;
    if (!suspension) return;
    clearTimeout(suspension.timer);
    this.simulatedSuspension = null;
    this.updateAllPlayback();
    for (const resolve of suspension.ended) resolve();
  }

  /** Why the contents are suspended, null when they aren't: a simulated suspension, the page hidden or paused */
  private get suspendReason(): SuspendReason | null {
    const paused = document.visibilityState === 'hidden' || this.paused ? 'paused' : null;
    return this.simulatedSuspension ? strongerReason(this.simulatedSuspension.reason, paused) : paused;
  }

  /** A reading to the contents that see the system status */
  private sendSystemStatus(reading: SystemStatusReading): void {
    for (const content of this.contents) if (content.seesSystemStatus) content.post({ type: 'system-status', reading });
  }

  /** Readings about once a second while a content sees them */
  private updateStatusTimer(): void {
    const wanted = [...this.contents].some((content) => content.seesSystemStatus);
    if (wanted && !this.statusTimer) {
      this.statusTimer = window.setInterval(() => this.sendSystemStatus(this.statusSimulation.sample()), 1000);
    } else if (!wanted && this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = 0;
    }
  }

  /** Whether contents draw: what `playback` tells them (suspended or rendering paused otherwise) */
  private get playing(): boolean {
    return this.suspendReason === null && this.visible;
  }

  /** @internal: a content asked for frames, or the desktop can be seen again */
  startFrames(): void {
    if (!this.frameRequest && this.playing && [...this.contents].some((content) => content.wantsFrames)) this.frameRequest = requestAnimationFrame(this.onFrame);
  }

  destroy(): void {
    this.setSystemAudioSource(null);
    clearInterval(this.statusTimer);
    this.statusTimer = 0;
    if (this.simulatedSuspension) clearTimeout(this.simulatedSuspension.timer);
    const suspension = this.simulatedSuspension;
    this.simulatedSuspension = null;
    for (const resolve of suspension?.ended ?? []) resolve();
    this.audioContext?.close().catch(() => undefined);
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    clearTimeout(this.keyTimer);
    this.keyTimer = 0;
    this.watchingKeys = false;
    this.watchingMouse = false;
    this.watchPage(false, false);
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
    const permissions = content.givenPermissions;
    this.updateStatusTimer();
    return {
      type: 'launch',
      name: spec.name,
      code: spec.code,
      files,
      options: this.launchOptions(content, permissions),
      screens: this.screens,
      contentType: contentKind(manifest.type),
      allowedWindowType: content.allowedWindowType,
      permissions,
      networkDomains: manifest.network?.domains ?? [],
      proxy: content.proxy,
      // a content's own proxy is the store's kind
      proxySendsAnyMethod: this.options.proxySendsAnyMethod === true && !content.spec.proxy,
      appearance: this.options.appearance ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
      apiVersion: API_VERSION,
      maxFramesPerSecond: this.options.maxFramesPerSecond ?? 0,
      muted: this.options.muted ?? true,
      volume: content.volume,
      keyActivity: content.getsKeyActivity,
      namespaceChannels: content.channelGroup('namespace') !== null,
      systemAudio: content.systemAudio,
      appWindows: content.seesAppWindows ? this.appWindows : [],
      systemStatus: content.seesSystemStatus ? this.statusSimulation.current : undefined,
      widgetSizing: content.widgetSizing ?? undefined,
    };
  }

  /**
   * @internal: a message a content posted on a BroadcastChannel, to every content (the sender too, for its other
   * channels) that has a channel of the scope and name open and shares the scope with it. Copied by the browser, in the
   * order they're posted; the frame keeps to the engine's limits, the desktop drops what goes past them anyway.
   */
  broadcast(sender: WebContent, message: Extract<FrameMessage, { type: 'broadcast' }>): void {
    const scope = message.scope;
    const group = sender.channelGroup(scope);
    if (group === null || !sender.spendBroadcast()) return;
    const name = String(message.name);
    const key = `${scope}\n${name}`;
    for (const content of this.contents) {
      if (!content.channels.has(key) || content.channelGroup(scope) !== group) continue;
      const own = content === sender;
      content.post({ type: 'broadcast', scope, name, data: message.data, source: own ? Number(message.source) : -1, newest: own ? Number(message.newest) : -1 });
    }
  }

  /** DesktopEngine.launchOptions as the app makes them */
  private launchOptions(content: WebContent, permissions: string[]): Record<string, unknown> {
    const spec = content.spec;
    const type = spec.manifest?.type;
    const level = content.level;
    const display = (screen: WebScreen) => ({ id: screen.id, name: screen.name, frame: { ...screen.bounds }, visibleFrame: { ...screen.visibleFrame }, scale: screen.scale });
    const options: Record<string, unknown> = {
      instanceId: spec.instanceId ?? `web-${instances}`,
      type,
      level,
      windowType: content.allowedWindowType ?? (level === 'floating' ? 'overlay' : 'widget'),
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
      // the size picked, or the one it was left in, scaled down to fit the display
      const { size, dimensions: picked } = widgetSize(spec);
      const sizing = content.widgetSizing;
      const dimensions = sizing ? fitted(sizing.size, screen.visibleFrame, sizing) : picked;
      options.size = size;
      options.width = dimensions.width;
      options.height = dimensions.height;
      content.launchedWidgetSize = dimensions;
      // the app's default place: the top right of the display, below the widgets already there
      const others = [...this.contents].filter((other) => other !== content && other.type === 'widget' && !other.spec.position).length;
      options.position = spec.position ?? {
        x: Math.max(screen.visibleFrame.x, screen.visibleFrame.x + screen.visibleFrame.width - dimensions.width - 20),
        y: screen.visibleFrame.y + 20 + others * (dimensions.height + 20),
      };
    } else if (spec.position) {
      options.position = spec.position;
    }
    return options;
  }

  /**
   * Wallpapers at the bottom, then widgets on the desktop, the pretend app windows, and widgets and companions above
   * all windows; among them in the order they were last pressed
   */
  private stack(): void {
    for (const content of this.contents) {
      const z = content.type === 'wallpaper' ? content.order : content.level === 'floating' ? FLOATING_Z + content.order : 1000 + content.order;
      content.iframe.style.zIndex = String(z);
    }
  }

  private bringToFront(content: WebContent): void {
    if (content.type === 'wallpaper') return;
    content.order = this.nextOrder++;
    this.stack();
  }

  /** @internal */
  updatePlayback(content: WebContent): void {
    const reason = this.suspendReason;
    const suspended = reason !== null;
    // a content running again gets a fresh reading after `resume`, as in the app
    if (content.suspendedPlayback && !suspended && content.seesSystemStatus) {
      content.post({ type: 'system-status', reading: this.statusSimulation.fresh() });
    }
    content.suspendedPlayback = suspended;
    content.post({
      type: 'playback',
      suspended,
      renderingPaused: !this.visible,
      muted: this.options.muted ?? true,
      maxFramesPerSecond: this.options.maxFramesPerSecond ?? 0,
      ...(reason ? { suspendReason: reason } : {}),
    });
  }

  private updateAllPlayback(): void {
    for (const content of this.contents) this.updatePlayback(content);
    this.startFrames();
  }

  // MARK: DesktopEngine.input

  /** The pointer anywhere on the page, to the contents that follow it */
  private globalMouse(kind: 'move' | 'down' | 'up' | 'wheel', point: { x: number; y: number }, event: { button: number } | null, deltaX = 0, deltaY = 0): void {
    for (const content of this.contents) {
      if (!content.wantsMouse) continue;
      content.post({ type: 'global-mouse', kind, x: point.x, y: point.y, button: event?.button ?? 0, deltaX, deltaY });
    }
  }

  /** A DOM wheel event as DesktopEngine.input's wheel: like NSEvent's deltas, about lines, positive toward the top and the left */
  private globalWheel(point: { x: number; y: number }, deltaX: number, deltaY: number, deltaMode: number): void {
    const deltas = wheelDeltas(deltaX, deltaY, deltaMode);
    this.globalMouse('wheel', point, null, deltas.deltaX, deltas.deltaY);
  }

  /**
   * A wheel turned at a point, as the app gives it: to the widget's or companion's window that takes the mouse there,
   * over its hit region (the edges a widget is resized by take the mouse but aren't part of it), never the key window
   * as they are; a wallpaper or another window doesn't get it. Whether such a window is there, so the page doesn't scroll.
   */
  private windowWheel(point: { x: number; y: number }, event: Omit<PointerInput, 'pointerId' | 'button'>, deltaX: number, deltaY: number, deltaMode: number): boolean {
    const hit = this.windowAt(point.x, point.y);
    if (!hit || (hit.window.type !== 'widget' && hit.window.type !== 'overlay')) return false;
    const { frame, hitRegion } = hit.window;
    if (hitRegion && !hitRegion.some((rect) => inside(rect, point.x - frame.x, point.y - frame.y))) return true;
    const deltas = wheelDeltas(deltaX, deltaY, deltaMode);
    hit.content.post({
      type: 'pointer',
      kind: 'wheel',
      window: hit.window.id,
      x: point.x,
      y: point.y,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      button: 0,
      buttons: event.buttons,
      deltaX: deltas.deltaX,
      deltaY: deltas.deltaY,
    });
    return true;
  }

  /** @internal: watches the page's pointer while a content follows the mouse, and counts its key presses while one listens to keyactivity */
  updateInputWatching(): void {
    const mouse = [...this.contents].some((content) => content.wantsMouse);
    const keys = [...this.contents].some((content) => content.wantsKeys);
    if (mouse !== this.watchingMouse || keys !== this.watchingKeys) this.watchPage(mouse !== this.watchingMouse ? mouse : null, keys !== this.watchingKeys ? keys : null);
    this.watchingMouse = mouse;
    this.watchingKeys = keys;
  }

  /** Adds (true) or removes (false) the page's listeners for the mouse and for keys; null leaves them as they are */
  private watchPage(mouse: boolean | null, keys: boolean | null): void {
    const options = { capture: true, passive: true };
    if (mouse !== null) {
      for (const type of ['pointermove', 'pointerdown', 'pointerup'] as const) {
        if (mouse) document.addEventListener(type, this.onPagePointer, options);
        else document.removeEventListener(type, this.onPagePointer, options);
      }
      if (mouse) document.addEventListener('wheel', this.onPageWheel, options);
      else document.removeEventListener('wheel', this.onPageWheel, options);
    }
    if (keys !== null) {
      if (keys) {
        document.addEventListener('keydown', this.onKeyDown, true);
      } else {
        document.removeEventListener('keydown', this.onKeyDown, true);
        clearTimeout(this.keyTimer);
        this.keyTimer = 0;
        this.keyPresses = 0;
      }
    }
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
    // a pretend app window in front of it takes the point
    const app = this.appWindowAt(x, y);
    if (best && app && Number(app.element.style.zIndex) * 100000 > best.rank) return null;
    return best ? { content: best.content, window: best.window } : null;
  }

  // MARK: Pretend app windows

  /** The pretend app windows, front to back, as DesktopEngine.windows lists them */
  get appWindows(): AppWindowInfo[] {
    return this.appWindowList.map((win) => ({
      id: win.id,
      frame: { ...win.frame },
      isActiveApp: win.id === this.activeAppWindow,
      isFullScreen: false,
      isFloating: false,
    }));
  }

  /**
   * Opens a pretend app window in front of the others and makes it the active app's, at `frame` (global points) or a bit
   * below and right of the last one; returns its id. Only with `DesktopOptions.appWindows`, -1 without.
   */
  addAppWindow(frame?: Rect): number {
    if (!this.options.appWindows) return -1;
    const win = this.createAppWindow(frame);
    this.activeAppWindow = win.id;
    this.stackAppWindows();
    this.sendAppWindows();
    return win.id;
  }

  /** A new pretend app window in front of the others, not yet stacked or told about */
  private createAppWindow(frame?: Rect): AppWindow {
    const area = this.screens[0].visibleFrame;
    const offset = 30 * (this.appWindowList.length % 8);
    const rect = frame ?? { x: area.x + 80 + offset, y: area.y + 50 + offset, width: 480, height: 300 };
    const element = document.createElement('div');
    element.className = 'de-app-window';
    const title = document.createElement('div');
    const dots = ['#ff5f57', '#febc2e', '#28c840'].map((color) => `<span style="width:12px;height:12px;border-radius:50%;background:${color};display:inline-block"></span>`).join('');
    title.innerHTML = `<span style="display:flex;gap:8px">${dots}</span><span class="de-app-window-title" style="flex:1;text-align:center;margin-right:52px"></span>`;
    Object.assign(title.style, { height: `${APP_TITLE_HEIGHT}px`, display: 'flex', alignItems: 'center', padding: '0 10px', font: '600 13px -apple-system, BlinkMacSystemFont, sans-serif' });
    element.appendChild(title);
    Object.assign(element.style, { position: 'absolute', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.35), 0 0 0 0.5px rgba(0,0,0,0.3)' });
    const win: AppWindow = { id: this.nextAppWindowId++, frame: { ...rect }, element, title };
    (title.querySelector('.de-app-window-title') as HTMLElement).textContent = `Window ${win.id}`;
    this.appWindowList.unshift(win);
    this.styleAppWindow(win);
    this.element.appendChild(element);
    return win;
  }

  /** Closes a pretend app window */
  removeAppWindow(id: number): void {
    const index = this.appWindowList.findIndex((win) => win.id === id);
    if (index < 0) return;
    const [win] = this.appWindowList.splice(index, 1);
    win.element.remove();
    if (this.appPress?.window === win) this.appPress = null;
    if (this.activeAppWindow === id) this.activeAppWindow = this.appWindowList[0]?.id ?? null;
    this.stackAppWindows();
    this.sendAppWindows();
  }

  private styleAppWindow(win: AppWindow): void {
    const dark = (this.options.appearance ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'dark';
    Object.assign(win.element.style, {
      left: `${win.frame.x}px`, top: `${win.frame.y}px`, width: `${win.frame.width}px`, height: `${win.frame.height}px`,
      background: dark ? '#26262a' : '#ffffff', color: dark ? '#e8e8ea' : '#2b2b2e',
    });
    win.title.style.background = dark ? '#36363b' : '#ebebed';
    win.title.style.borderBottom = dark ? '1px solid #111' : '1px solid #d4d4d8';
  }

  private stackAppWindows(): void {
    const count = this.appWindowList.length;
    this.appWindowList.forEach((win, index) => { win.element.style.zIndex = String(APP_WINDOW_Z + count - index); });
  }

  /** The frontmost pretend app window at a global point */
  private appWindowAt(x: number, y: number): AppWindow | undefined {
    return this.appWindowList.find((win) => inside(win.frame, x, y));
  }

  /** @internal: tells the contents that may see them where the pretend app windows are */
  sendAppWindows(): void {
    const windows = this.appWindows;
    for (const content of this.contents) if (content.seesAppWindows) content.post({ type: 'app-windows', windows });
  }

  /** A press on the pretend app window in front at the point, if there's one in front of every content's window there */
  private appWindowDown(point: { x: number; y: number }, event: PointerInput): boolean {
    if (this.press || this.appPress || event.button !== 0) return false;
    const win = this.appWindowAt(point.x, point.y);
    if (!win) return false;
    const hit = this.windowAt(point.x, point.y);
    if (hit) return false;
    const local = { x: point.x - win.frame.x, y: point.y - win.frame.y };
    // the red dot closes it
    if (local.y < APP_TITLE_HEIGHT && Math.hypot(local.x - 16, local.y - APP_TITLE_HEIGHT / 2) <= 7) {
      this.removeAppWindow(win.id);
      return true;
    }
    this.appWindowList = [win, ...this.appWindowList.filter((other) => other !== win)];
    this.activeAppWindow = win.id;
    this.stackAppWindows();
    const resize = local.x >= win.frame.width - APP_CORNER && local.y >= win.frame.height - APP_CORNER;
    this.appPress = {
      window: win,
      pointerId: event.pointerId,
      start: point,
      origin: { ...win.frame },
      action: resize ? 'resize' : local.y < APP_TITLE_HEIGHT ? 'move' : null,
    };
    this.setHovered(null, point, event);
    this.sendAppWindows();
    return true;
  }

  private appWindowDrag(press: AppWindowPress, point: { x: number; y: number }): void {
    const dx = point.x - press.start.x;
    const dy = point.y - press.start.y;
    const win = press.window;
    if (press.action === 'move') {
      const union = this.bounds;
      const top = Math.min(...this.screens.map((screen) => screen.visibleFrame.y));
      win.frame.x = Math.round(Math.min(Math.max(press.origin.x + dx, 40 - win.frame.width), union.width - 40));
      win.frame.y = Math.round(Math.min(Math.max(press.origin.y + dy, top), union.height - APP_TITLE_HEIGHT));
    } else if (press.action === 'resize') {
      win.frame.width = Math.round(Math.max(press.origin.width + dx, APP_MIN_SIZE.width));
      win.frame.height = Math.round(Math.max(press.origin.height + dy, APP_MIN_SIZE.height));
    } else {
      return;
    }
    this.styleAppWindow(win);
    this.sendAppWindows();
  }

  /** `button` is the one that went down or up, for down and up */
  private pointer(content: WebContent, kind: Extract<HostMessage, { type: 'pointer' }>['kind'], windowId: string | null, point: { x: number; y: number }, event: PointerInput | null, button = 0, noClick = false): void {
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
      button: kind === 'down' || kind === 'up' ? button : 0,
      buttons: event?.buttons ?? 0,
      ...(noClick ? { noClick: true } : {}),
    });
  }

  private setHovered(hit: { content: WebContent; window: WindowState } | null, point: { x: number; y: number }, event: PointerInput | null): void {
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

  private pointerMove(point: { x: number; y: number }, event: PointerInput): void {
    const press = this.press;
    if (press && press.pointerId === event.pointerId) {
      this.dragMove(press, point, event);
      return;
    }
    const hit = this.windowAt(point.x, point.y);
    const edges = hit ? this.resizeEdgesAt(hit, point) : null;
    this.setHovered(hit, point, event);
    // the edges of a widget the user resizes are its window's, as in the app: the content isn't told about them
    if (hit && !edges) this.pointer(hit.content, 'move', hit.window.id, point, event);
    else if (hit) this.pointer(hit.content, 'leave', hit.window.id, point, event);
    this.takePointer(hit && hit.content.mayPlaySound && !(this.options.muted ?? true) ? hit.content : null);
    const app = hit ? undefined : this.appWindowAt(point.x, point.y);
    const corner = app && point.x >= app.frame.x + app.frame.width - APP_CORNER && point.y >= app.frame.y + app.frame.height - APP_CORNER;
    this.setCursor(edges ? resizeCursor(edges) : hit && this.movesAt(hit.window, point.x, point.y) ? 'grab' : corner ? 'nwse-resize' : '');
    this.updateHint(hit && hit.content.userResizes(hit.window) ? hit : null, point);
  }

  /** The window pressed, if the press is on one. Another button pressed during a press isn't a press of its own */
  private pointerDown(point: { x: number; y: number }, event: PointerInput): WindowState | null {
    if (event.button < 0 || this.press) return null;
    const hit = this.windowAt(point.x, point.y);
    // pressing the desktop makes the Finder the active app, and pressing a widget on it DesktopEngine (widgets and
    // companions above all windows don't make it active): none of the pretend app windows is theirs
    const activates = !hit || hit.window.type === 'desktop' || hit.window.type === 'widget';
    if (event.button === 0 && activates && this.activeAppWindow !== null && !this.appWindowAt(point.x, point.y)) {
      this.activeAppWindow = null;
      this.sendAppWindows();
    }
    // the app passes only the primary button's presses on the desktop to wallpapers
    if (!hit || (event.button !== 0 && hit.window.type === 'desktop')) return null;
    if (event.button === 0) this.bringToFront(hit.content);
    // grabbed again while it slides: from where it is now
    const sliding = this.slide?.content === hit.content && this.slide.windowId === hit.window.id ? this.stopSlide() : null;
    const edges = event.button === 0 ? this.resizeEdgesAt(hit, point) : null;
    const movesWindow = event.button === 0 && !edges && this.movesAt(hit.window, point.x, point.y);
    this.press = {
      content: hit.content,
      window: hit.window,
      pointerId: event.pointerId,
      button: event.button,
      start: point,
      origin: sliding ?? { x: hit.window.frame.x, y: hit.window.frame.y },
      movesWindow,
      dragging: false,
      moved: false,
      at: null,
      resize: edges ? { edges, frame: { ...hit.window.frame } } : null,
    };
    // a press that moves the window reaches the contents only once it turns into a drag; a click just clicks; a
    // press on the edges that resize the widget doesn't reach it
    if (!movesWindow && !edges) this.pointer(hit.content, 'down', hit.window.id, point, event, event.button);
    return hit.window;
  }

  private dragMove(press: Press, point: { x: number; y: number }, event: PointerInput): void {
    const dx = point.x - press.start.x;
    const dy = point.y - press.start.y;
    if (!press.moved && Math.hypot(dx, dy) > 3) {
      press.moved = true;
      // a drag or a resize: the hint goes
      if (press.movesWindow || press.resize) this.hideHint(true);
    }
    if (press.resize) {
      const sizing = press.content.widgetSizing;
      if (!sizing) return;
      const { frame, edges } = press.resize;
      const screen = this.screens.find((candidate) => inside(candidate.bounds, frame.x + frame.width / 2, frame.y + frame.height / 2)) ?? this.screens[0];
      const next = resizedFrame(frame, edges, dx, dy, sizing, screen.visibleFrame);
      press.content.post({ type: 'resize-window', window: press.window.id, ...next });
      return;
    }
    if (!press.movesWindow) {
      this.pointer(press.content, 'move', press.window.id, point, event);
      return;
    }
    if (!press.moved) return;
    if (!press.dragging) {
      press.dragging = true;
      this.pointer(press.content, 'down', press.window.id, press.start, event, press.button);
      this.setCursor('grabbing');
    }
    const next = this.dragLimit(press.window, press.origin.x + dx, press.origin.y + dy);
    press.at = next;
    press.content.post({ type: 'move-window', window: press.window.id, x: next.x, y: next.y, dragging: true });
  }

  /** A dragged window follows the pointer, only kept below the menu bar as macOS does; it's put back once it's dropped */
  private dragLimit(win: WindowState, x: number, y: number): { x: number; y: number } {
    const screen = this.screens.find((candidate) => inside(candidate.bounds, x + win.frame.width / 2, y + win.frame.height / 2)) ?? this.screens[0];
    return { x: Math.round(x), y: Math.round(Math.max(y, screen.visibleFrame.y)) };
  }

  /**
   * A dragged window was dropped at `at`, the pointer at `point`: a widget's goes where its rules let it be on the
   * screen under the pointer (where it takes the mouse inside its visible frame), sliding there in a quarter of a
   * second, easing out (at once with reduced motion); every window is told where it stays
   */
  private drop(content: WebContent, win: WindowState, at: { x: number; y: number }, point: { x: number; y: number }): void {
    const sizing = content.widgetSizing;
    let to = at;
    if (win.widget && sizing) {
      const screen = this.screens.find((candidate) => inside(candidate.bounds, point.x, point.y)) ?? this.screens[0];
      const size = { width: win.frame.width, height: win.frame.height };
      const kept = widgetFrame({ ...at, ...size }, sizing, size, screen.visibleFrame, win.hitRegion);
      to = { x: kept.x, y: kept.y };
    }
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if ((to.x === at.x && to.y === at.y) || reduced) {
      content.post({ type: 'move-window', window: win.id, x: to.x, y: to.y });
      return;
    }
    this.slide = { content, windowId: win.id, from: at, to, start: performance.now(), request: 0 };
    this.slide.request = requestAnimationFrame(this.slideStep);
  }

  private readonly slideStep = (): void => {
    const slide = this.slide;
    if (!slide) return;
    const progress = Math.min(1, (performance.now() - slide.start) / SLIDE_DURATION);
    // ease out, no overshoot
    const eased = 1 - (1 - progress) ** 3;
    const x = Math.round(slide.from.x + (slide.to.x - slide.from.x) * eased);
    const y = Math.round(slide.from.y + (slide.to.y - slide.from.y) * eased);
    if (progress < 1) {
      slide.content.post({ type: 'move-window', window: slide.windowId, x, y, dragging: true });
      slide.request = requestAnimationFrame(this.slideStep);
      return;
    }
    this.slide = null;
    slide.content.post({ type: 'move-window', window: slide.windowId, x: slide.to.x, y: slide.to.y });
  };

  /** Stops a window sliding where it is, and gives where that is */
  private stopSlide(): { x: number; y: number } | null {
    const slide = this.slide;
    if (!slide) return null;
    this.slide = null;
    cancelAnimationFrame(slide.request);
    const eased = 1 - (1 - Math.min(1, (performance.now() - slide.start) / SLIDE_DURATION)) ** 3;
    return { x: Math.round(slide.from.x + (slide.to.x - slide.from.x) * eased), y: Math.round(slide.from.y + (slide.to.y - slide.from.y) * eased) };
  }

  private pointerUp(point: { x: number; y: number }, event: PointerInput): void {
    const press = this.press;
    if (!press || press.pointerId !== event.pointerId) return;
    this.press = null;
    if (press.resize) {
      // its window's, not the content's
      if (press.moved) this.userResizes += 1;
    } else if (press.movesWindow) {
      // dragged: mousedown and mouseup, no click, as in the app
      if (press.dragging) this.pointer(press.content, 'up', press.window.id, point, event, press.button, true);
      else this.pointer(press.content, 'click', press.window.id, press.start, event);
      if (press.at) this.drop(press.content, press.window, press.at, point);
    } else {
      this.pointer(press.content, 'up', press.window.id, point, event, press.button);
    }
    this.pointerMove(point, event);
  }

  private pointerCancel(event: PointerInput): void {
    const press = this.press;
    if (!press || press.pointerId !== event.pointerId) return;
    this.press = null;
    if (!press.resize && (press.dragging || !press.movesWindow)) this.pointer(press.content, 'up', press.window.id, press.start, event, press.button, true);
    if (press.at) this.drop(press.content, press.window, press.at, { x: press.at.x + press.window.frame.width / 2, y: press.at.y + press.window.frame.height / 2 });
    this.setHovered(null, press.start, event);
    this.setCursor('');
  }

  /** The edges of a widget's window under the point that resize it, when the user may; null elsewhere */
  private resizeEdgesAt(hit: { content: WebContent; window: WindowState }, point: { x: number; y: number }): Edges | null {
    if (!hit.content.userResizes(hit.window)) return null;
    const { frame } = hit.window;
    return edgesAt(point.x - frame.x, point.y - frame.y, frame);
  }

  /** @internal: a content's windows changed, e.g. the widget being resized: the hint follows its window */
  windowsChanged(content: WebContent): void {
    const hovered = this.hovered;
    if (hovered?.content !== content) return;
    const win = content.windows.find((candidate) => candidate.id === hovered.window.id && candidate.visible);
    if (!win) {
      this.updateHint(null, { x: 0, y: 0 });
      return;
    }
    this.hovered = { content, window: win };
    if (this.press?.content === content && this.press.window.id === win.id) this.press.window = win;
    const target = this.hintTarget;
    if (target?.shown && target.content === content && target.windowId === win.id) {
      this.placeHint(win, content);
      this.measureCorner(win, content);
    }
  }

  /** The frame asks what a window draws at its body's corner, for the hint */
  private measureCorner(win: WindowState, content: WebContent): void {
    if (!this.hintTarget) return;
    this.hintTarget.measuring = true;
    content.post({ type: 'measure-corner', window: win.id, body: { x: 0, y: 0, width: win.frame.width, height: win.frame.height } });
  }

  /** @internal: a frame measured a window's corner: the hint shows around it, or follows it */
  cornerMeasured(content: WebContent, windowId: string, shape: CornerShape | null): void {
    const target = this.hintTarget;
    if (!target || target.content !== content || target.windowId !== windowId || !target.measuring) return;
    target.measuring = false;
    target.shape = shape;
    const win = content.windows.find((candidate) => candidate.id === windowId && candidate.visible);
    if (!win) return;
    if (target.shown) {
      this.placeHint(win, content);
      return;
    }
    if (this.press) return;
    target.shown = true;
    this.placeHint(win, content);
    this.fadeHint(HINT_RESTING_OPACITY, 250);
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || this.userResizes >= 3) return;
    // toward the bottom right and back, twice
    const out = `translate(${3}px, ${3}px)`;
    this.hint.animate([
      { transform: 'none', easing: 'ease-in-out' },
      { transform: out, easing: 'ease-in-out' },
      { transform: 'none', easing: 'ease-in-out' },
      { transform: out, easing: 'ease-in-out' },
      { transform: 'none' },
    ], { duration: 1200 });
  }

  /**
   * The pointer is over a widget the visitor may resize (or none): a second after it came, the hint shows; it goes
   * when the pointer leaves, unless it went to the corner where the window is resized or onto the hint, as in the app
   */
  private updateHint(hit: { content: WebContent; window: WindowState } | null, point: { x: number; y: number }): void {
    const target = this.hintTarget;
    if (hit && target && target.content === hit.content && target.windowId === hit.window.id) {
      if (target.shown) this.fadeHint(this.atResizeCorner(hit.window, point) ? 1 : HINT_RESTING_OPACITY, 150);
      return;
    }
    const targetWindow = target && target.content.windows.find((win) => win.id === target.windowId && win.visible);
    if (targetWindow && (this.atResizeCorner(targetWindow, point) || (target.shown && this.onHint(point)))) {
      if (target.shown) this.fadeHint(this.atResizeCorner(targetWindow, point) ? 1 : HINT_RESTING_OPACITY, 150);
      return;
    }
    this.hideHint();
    if (!hit) return;
    const timer = window.setTimeout(() => this.showHint(), 1000);
    this.hintTarget = { content: hit.content, windowId: hit.window.id, timer, shown: false, measuring: false, shape: null };
  }

  /** Once the frame has measured the widget's corner, the hint shows around it (see cornerMeasured) */
  private showHint(): void {
    const target = this.hintTarget;
    const win = target?.content.windows.find((candidate) => candidate.id === target.windowId && candidate.visible);
    if (!target || !win || this.press) return;
    this.measureCorner(win, target.content);
  }

  /**
   * The hint fades out and its timer stops. As a drag or a resize starts (`untilLeft`), it doesn't come back until the
   * pointer has left the widget, as in the app
   */
  private hideHint(untilLeft = false): void {
    const target = this.hintTarget;
    if (!target) return;
    window.clearTimeout(target.timer);
    if (target.shown) {
      for (const animation of this.hint.getAnimations()) if (animation.effect && (animation.effect as KeyframeEffect).getKeyframes().some((frame) => frame.transform)) animation.cancel();
      this.fadeHint(0, 200);
    }
    target.shown = false;
    target.measuring = false;
    if (!untilLeft) this.hintTarget = null;
  }

  private fadeHint(opacity: number, duration: number): void {
    for (const part of [this.hint.firstElementChild as HTMLElement, this.hint.lastElementChild as SVGSVGElement]) {
      const from = getComputedStyle(part).opacity;
      if (Number(from) === opacity) continue;
      part.style.opacity = String(opacity);
      part.animate([{ opacity: from }, { opacity: String(opacity) }], { duration, easing: 'ease-in-out' });
    }
  }

  /**
   * Just outside the window's bottom right corner, where it's resized, curved around the corner the widget draws (the
   * arc's center is the drawn corner's, its radius reaches past the window's edges, across a clear margin), as in the
   * app; inside the corner when the screen's edge would hide it
   */
  private placeHint(win: WindowState, content: WebContent): void {
    const shape = this.hintTarget?.shape ?? { right: 0, bottom: 0, radius: 0 };
    // the corner of a square around the drawn corner's center that reaches the window's edges
    const margin = Math.max(shape.right, shape.bottom);
    const x = win.frame.x + win.frame.width - shape.right + margin;
    const y = win.frame.y + win.frame.height - shape.bottom + margin;
    const reach = HINT_GAP + HINT_WIDTH + 2;
    const screen = this.screens.find(({ bounds }) => x > bounds.x && x <= bounds.x + bounds.width && y > bounds.y && y <= bounds.y + bounds.height);
    const outside = !screen || (x + reach <= screen.bounds.x + screen.bounds.width && y + reach <= screen.bounds.y + screen.bounds.height);
    const hint = resizeHintShape(shape.radius + margin, outside);
    const glass = this.hint.firstElementChild as HTMLElement;
    const stroke = `<svg xmlns="http://www.w3.org/2000/svg" width="${hint.width}" height="${hint.height}"><path d="${hint.path}" fill="none" stroke="black" stroke-width="${HINT_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const strokeImage = `url("data:image/svg+xml,${encodeURIComponent(stroke)}")`;
    Object.assign(glass.style, {
      background: 'rgba(255, 255, 255, 0.45)',
      maskImage: strokeImage, webkitMaskImage: strokeImage,
    });
    const svg = this.hint.lastElementChild as SVGSVGElement;
    svg.setAttribute('width', String(hint.width));
    svg.setAttribute('height', String(hint.height));
    svg.setAttribute('viewBox', `0 0 ${hint.width} ${hint.height}`);
    svg.setAttribute('stroke', 'rgba(0, 0, 0, 0.28)');
    for (const path of svg.querySelectorAll('path')) path.setAttribute('d', hint.path);
    // over its frame, which comes later on the page at the same level
    if (this.hint.nextSibling) this.element.appendChild(this.hint);
    Object.assign(this.hint.style, {
      left: `${x - hint.corner.x}px`,
      top: `${y - hint.corner.y}px`,
      width: `${hint.width}px`,
      height: `${hint.height}px`,
      zIndex: content.iframe.style.zIndex,
    });
  }

  /** Whether the point is at the window's bottom right corner, where it resizes */
  /** Whether a point is on the hint as it's placed */
  private onHint(point: { x: number; y: number }): boolean {
    const { offsetLeft: x, offsetTop: y, offsetWidth: width, offsetHeight: height } = this.hint;
    return point.x >= x && point.x < x + width && point.y >= y && point.y < y + height;
  }

  private atResizeCorner(win: WindowState, point: { x: number; y: number }): boolean {
    return Math.hypot(point.x - (win.frame.x + win.frame.width), point.y - (win.frame.y + win.frame.height)) <= HINT_CORNER;
  }

  private setCursor(cursor: string): void {
    this.element.style.cursor = cursor;
    this.pointerTaker?.post({ type: 'cursor', cursor });
  }

  /**
   * Lets one content's frame take the pointer, or none: the frame then gets the visitor's presses itself, which its
   * sound needs, and passes the events back (`frameInput`). It covers the screens, so it gives the pointer back as soon
   * as the pointer leaves its windows; during a press it keeps it until the press ends.
   */
  private takePointer(content: WebContent | null): void {
    if (content === this.pointerTaker) return;
    if (this.pointerTaker) this.pointerTaker.iframe.style.pointerEvents = 'none';
    this.pointerTaker = content;
    if (content) content.iframe.style.pointerEvents = 'auto';
  }

  /** @internal: the content stopped or starts again in a new frame */
  releasePointer(content: WebContent): void {
    if (this.pointerTaker === content) this.takePointer(null);
  }

  /**
   * @internal: the pointer's events in the frame that takes it. The frame is the content's, so it's believed only as
   * far as it reaches the content itself: a press counts only on its own window and while the page has the visitor's
   * activation (a press in a child frame gives it to the page too), and only the frame that takes the pointer, or that
   * was pressed, is heard.
   */
  frameInput(content: WebContent, message: Extract<FrameMessage, { type: 'input' }>): void {
    const press = this.press;
    if (content !== this.pointerTaker && press?.content !== content) return;
    const x = Number(message.x);
    const y = Number(message.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const point = { x, y };
    if (message.kind === 'wheel') {
      // only over its own windows: the frame takes the pointer there
      if (this.windowAt(x, y)?.content !== content) return;
      const delta = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
      this.globalWheel(point, delta(message.deltaX), delta(message.deltaY), delta(message.deltaMode));
      const modifiers = {
        buttons: Number(message.buttons) || 0,
        ctrlKey: message.ctrlKey === true,
        altKey: message.altKey === true,
        metaKey: message.metaKey === true,
        shiftKey: message.shiftKey === true,
      };
      this.windowWheel(point, modifiers, delta(message.deltaX), delta(message.deltaY), delta(message.deltaMode));
      return;
    }
    const event: PointerInput = {
      pointerId: Number(message.pointerId) || 0,
      button: Number(message.button) || 0,
      buttons: Number(message.buttons) || 0,
      ctrlKey: message.ctrlKey === true,
      altKey: message.altKey === true,
      metaKey: message.metaKey === true,
      shiftKey: message.shiftKey === true,
    };
    switch (message.kind) {
      case 'move':
        this.globalMouse('move', point, event);
        this.pointerMove(point, event);
        break;
      case 'down': {
        if (navigator.userActivation && !navigator.userActivation.isActive) return;
        if (this.windowAt(x, y)?.content !== content) return;
        this.globalMouse('down', point, event);
        this.pointerDown(point, event);
        break;
      }
      case 'up':
        if (press?.content !== content) break;
        this.globalMouse('up', point, event);
        this.pointerUp(point, event);
        break;
      case 'cancel':
        if (press?.content === content) this.pointerCancel(event);
        break;
      case 'leave':
        if (press) return;
        this.takePointer(null);
        this.setHovered(null, point, event);
        this.setCursor('');
        break;
    }
  }
}
