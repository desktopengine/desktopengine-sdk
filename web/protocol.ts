// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The messages between a page that shows a desktop (the host, web/host) and the mini program running in a sandboxed
// iframe on it (the frame, web/frame). The frame has an opaque origin: it can't reach the page, its cookies or its
// storage, and the page treats everything the frame says as coming from the content. Also what the frame makes of the
// pretend app windows the host sends (readAppWindows, visibleTopEdges), plain functions a test holds to the engine's rule.
//
// Coordinates are global points, as DesktopEngine.Window uses them: origin at the top left of the main screen, y down.

/** `DesktopEngine.apiVersion` on the web, the same as the SDK's `API_VERSION` (a test checks) */
export const API_VERSION = 6;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebScreen {
  id: number;
  name: string;
  /** The whole screen */
  bounds: Rect;
  /** Without the menu bar and the Dock */
  visibleFrame: Rect;
  /** devicePixelRatio of what runs on it */
  scale: number;
}

export type ParameterValue = boolean | number | string | null;

/** Everything the frame needs to run a mini program */
export interface LaunchMessage {
  type: 'launch';
  /** For logs and stack traces */
  name: string;
  /** index.js, as built */
  code: string;
  /** The package's other files, by path from its root (manifest.json, images, data…) */
  files: Record<string, ArrayBuffer>;
  /** DesktopEngine.launchOptions, as the app makes them */
  options: Record<string, unknown>;
  screens: WebScreen[];
  /** The content type, for messages; undefined: no manifest */
  contentType?: 'wallpaper' | 'widget' | 'companion';
  /** The only window type it may make where it's placed (`options.windowType`); undefined: any (no manifest) */
  allowedWindowType?: string;
  /** What it was granted: network, audio, system-info… */
  permissions: string[];
  /** network.domains */
  networkDomains: string[];
  /** Where http(s) and ws(s) requests go: `<proxy>?url=<url>`; without one, the content has no network on the web */
  proxy?: string;
  /** Whether the proxy sends every method, with the request's headers and body; otherwise only GET and HEAD go */
  proxySendsAnyMethod?: boolean;
  appearance: 'light' | 'dark';
  apiVersion: number;
  /** At most this many frames per second (0: the display's) */
  maxFramesPerSecond: number;
  /** Sound starts muted on the web until the visitor turns it on */
  muted: boolean;
  /** Whether it gets keyactivity (DesktopOptions.keyActivity) */
  keyActivity: boolean;
  /** Whether it may open BroadcastChannels of scope "namespace" (ContentSpec.namespaceChannels) */
  namespaceChannels: boolean;
  /**
   * DesktopEngine.systemAudio as the page gives it, from the content's permissions and id (WebContent.systemAudio,
   * ContentSpec.officialId)
   */
  systemAudio: 'none' | 'restricted' | 'detailed';
  /** DesktopEngine.windows.list() at launch: the page's pretend app windows, only with the window-positions permission */
  appWindows: AppWindowInfo[];
}

/** Another app's window, as DesktopEngine.windows lists it: on the web, one of the page's pretend app windows */
export interface AppWindowInfo {
  id: number;
  frame: Rect;
  isActiveApp: boolean;
  isFullScreen: boolean;
  isFloating: boolean;
}

/** A part of a window's top edge that no window in front covers, as DesktopEngine.windows.visibleTopEdges() gives it */
export interface TopEdge {
  id: number;
  x: number;
  y: number;
  width: number;
}

/** The windows of an `app-windows` message (or the launch's), as the app gives them: finite numbers and booleans */
export function readAppWindows(value: unknown): AppWindowInfo[] {
  if (!Array.isArray(value)) return [];
  const finite = (number: unknown) => (typeof number === 'number' && Number.isFinite(number) ? number : 0);
  return value.map((raw: Partial<AppWindowInfo> | null) => {
    const frame = (raw?.frame ?? {}) as Partial<Rect>;
    return {
      id: finite(raw?.id),
      frame: { x: finite(frame.x), y: finite(frame.y), width: finite(frame.width), height: finite(frame.height) },
      isActiveApp: raw?.isActiveApp === true,
      isFullScreen: raw?.isFullScreen === true,
      isFloating: raw?.isFloating === true,
    };
  });
}

/**
 * The parts of the windows' top edges (front to back) that no window in front covers, front to back, as the engine
 * finds them: a full screen window has none; a window in front covers an edge where it spans the edge's height (its
 * top at or above it, its bottom below it) and cuts it in two, its left part first; what a cut leaves of 1 point or
 * less is dropped
 */
export function visibleTopEdges(windows: AppWindowInfo[]): TopEdge[] {
  const edges: TopEdge[] = [];
  windows.forEach((win, index) => {
    if (win.isFullScreen) return;
    const top = win.frame.y;
    let parts: [number, number][] = [[win.frame.x, win.frame.x + win.frame.width]];
    for (const front of windows.slice(0, index)) {
      if (front.frame.y > top || front.frame.y + front.frame.height <= top) continue;
      const left = front.frame.x;
      const right = front.frame.x + front.frame.width;
      parts = parts.flatMap(([start, end]): [number, number][] => [[start, Math.min(end, left)], [Math.max(start, right), end]]).filter(([start, end]) => end - start > 1);
    }
    for (const [start, end] of parts) edges.push({ id: win.id, x: start, y: top, width: end - start });
  });
  return edges;
}

export type ChannelScope = 'package' | 'namespace';

export type PointerKind = 'move' | 'down' | 'up' | 'leave' | 'click' | 'wheel';

/** Host → frame */
export type HostMessage =
  | LaunchMessage
  | {
      type: 'pointer';
      kind: PointerKind;
      /** The window the pointer is on, or pressed in */
      window: string | null;
      x: number;
      y: number;
      ctrlKey: boolean;
      altKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
      /** down / up: the DOM's button that went down or up, 0 otherwise */
      button: number;
      /** The DOM's buttons held after the event */
      buttons: number;
      deltaX?: number;
      deltaY?: number;
    }
  /** DesktopEngine.input's mouse events, wherever the pointer is on the desktop: only to content with the mouse permission that listens */
  | { type: 'global-mouse'; kind: 'move' | 'down' | 'up' | 'wheel'; x: number; y: number; button: number; deltaX: number; deltaY: number }
  /** DesktopEngine.input's keyactivity: keys pressed on the page, on a 100 ms grid */
  | { type: 'key-activity'; count: number }
  /**
   * DesktopEngine.systemAudio's analysis of what the page plays (`WebDesktop.setSystemAudioSource`), 60 times a second
   * to contents that hear it: the fine bands' powers, the smoothed mean square and the loudest sample since the last
   * one (the frame's `active`); null bands go back to the made-up signal
   */
  | { type: 'system-audio'; bands: Float32Array | null; level: number; peak: number }
  /** DesktopEngine.windows: the pretend app windows changed, front to back; only to content with the window-positions permission */
  | { type: 'app-windows'; windows: AppWindowInfo[] }
  | { type: 'move-window'; window: string; x: number; y: number }
  | { type: 'appearance'; appearance: 'light' | 'dark' }
  | { type: 'parameters'; parameters: Record<string, ParameterValue>; changed: string[] }
  | { type: 'screens'; screens: WebScreen[] }
  /** suspended: everything stops (timers once a second); renderingPaused: only drawing */
  | { type: 'playback'; suspended: boolean; renderingPaused: boolean; muted: boolean; maxFramesPerSecond: number }
  /**
   * A display frame, sent while the frame asked for them (`frames`). Browsers slow requestAnimationFrame down in
   * cross-origin frames the visitor hasn't interacted with (Safari to about 20–30 a second), and contents' frames never
   * take the mouse: the page's own frames drive their animation instead.
   */
  | { type: 'frame' }
  /** The pointer's look while the frame takes the pointer (see `input`): the host's grab and grabbing */
  | { type: 'cursor'; cursor: string }
  /**
   * A message on a BroadcastChannel the frame has open. Of the frame's own: `source` is the id of the channel that
   * posted it and `newest` of the newest channel it had then; -1 for another content's. `data` is the message as the
   * sending frame encoded it (frame/messages.ts), which the frame checks as it decodes it
   */
  | { type: 'broadcast'; scope: ChannelScope; name: string; data: unknown; source: number; newest: number }
  | { type: 'stop' };

/** A window as the host sees it: where it is and which parts take the mouse */
export interface WindowState {
  id: string;
  type: string;
  frame: Rect;
  visible: boolean;
  /** Stacking within the content: the type's level, then the order windows were made */
  z: number;
  hitRegion: Rect[] | null;
  dragRegion: Rect[] | null;
  /** widget and overlay windows move when dragged (by their dragRegion) */
  movable: boolean;
}

/** Frame → host */
export type FrameMessage =
  | { type: 'ready' }
  | { type: 'launched' }
  | { type: 'windows'; windows: WindowState[] }
  | { type: 'console'; level: 'log' | 'info' | 'warn' | 'error' | 'debug'; message: string }
  | { type: 'exception'; message: string; stack?: string }
  /** postMessage('host', …): move, close */
  | { type: 'host-message'; message: unknown }
  | { type: 'stats'; framesPerSecond: number }
  /** Whether it has animation frame callbacks waiting: the host sends `frame` messages while it does */
  | { type: 'frames'; wanted: boolean }
  /** What of DesktopEngine.input it listens to: the host sends `global-mouse` and `key-activity` only then */
  | { type: 'input-wanted'; mouse: boolean; keys: boolean }
  /** The frame has a BroadcastChannel of the scope and name open (or no longer): the host sends it their messages */
  | { type: 'channel'; scope: ChannelScope; name: string; open: boolean }
  /**
   * postMessage on a BroadcastChannel, from the channel with the id `source` when `newest` was the newest; `data` is the
   * encoded message (frame/messages.ts), which the host passes on as it is
   */
  | { type: 'broadcast'; scope: ChannelScope; name: string; data: unknown; source: number; newest: number }
  /** Whether the content applied new parameters itself (it listens to parameterschange); the host restarts it otherwise */
  | { type: 'parameters-result'; handled: boolean }
  /**
   * The pointer's events in the frame itself, passed back to the host to handle as its own. Browsers let a frame play
   * sound only after the visitor pressed in it (Safari counts no events the host passes on), so while the pointer is
   * over a window of content that may play sound, the host lets its frame take the pointer. Points are global, like
   * the host's: the frame covers the screens from their origin.
   */
  | {
      type: 'input';
      kind: 'move' | 'down' | 'up' | 'cancel' | 'leave' | 'wheel';
      x: number;
      y: number;
      pointerId: number;
      button: number;
      buttons: number;
      ctrlKey: boolean;
      altKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
      /** wheel: the DOM's deltas and their mode */
      deltaX?: number;
      deltaY?: number;
      deltaMode?: number;
    };

/** The frame's page, made by the host: the content's permissions decide what it may connect to */
export function frameDocument(runtime: string, { proxy }: { proxy?: string } = {}): string {
  const remote = proxy ? ` ${new URL(proxy).origin}` : '';
  const policy = [
    "default-src 'none'",
    // the content's own code runs with new Function, as in the app (eval and Function work there too)
    "script-src 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'unsafe-inline'",
    `img-src blob: data:${remote}`,
    `media-src blob: data:${remote}`,
    `connect-src blob: data:${remote}${proxy ? ` ${new URL(proxy).origin.replace(/^http/, 'ws')}` : ''}`,
    'font-src data: blob:',
    'worker-src blob:',
  ].join('; ');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">` +
    '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style></head>' +
    `<body><script>${runtime.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
