// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The messages between a page that shows a desktop (the host, web/host) and the mini program running in a sandboxed
// iframe on it (the frame, web/frame). The frame has an opaque origin: it can't reach the page, its cookies or its
// storage, and the page treats everything the frame says as coming from the content.
//
// Coordinates are global points, as DesktopEngine.Window uses them: origin at the top left of the main screen, y down.

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
  /** The content type limits the window types it may make; undefined: any (no manifest) */
  contentType?: 'wallpaper' | 'widget' | 'pet';
  /** What it was granted: network, audio, system-info… */
  permissions: string[];
  /** network.domains */
  networkDomains: string[];
  /** Where http(s) and ws(s) requests go: `<proxy>?url=<url>`; without one, the content has no network on the web */
  proxy?: string;
  appearance: 'light' | 'dark';
  apiVersion: number;
  /** At most this many frames per second (0: the display's) */
  maxFramesPerSecond: number;
  /** Sound starts muted on the web until the visitor turns it on */
  muted: boolean;
}

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
      deltaX?: number;
      deltaY?: number;
    }
  | { type: 'move-window'; window: string; x: number; y: number }
  | { type: 'appearance'; appearance: 'light' | 'dark' }
  | { type: 'parameters'; parameters: Record<string, ParameterValue>; changed: string[] }
  | { type: 'screens'; screens: WebScreen[] }
  /** suspended: everything stops (timers once a second); renderingPaused: only drawing */
  | { type: 'playback'; suspended: boolean; renderingPaused: boolean; muted: boolean; maxFramesPerSecond: number }
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
  /** Whether the content applied new parameters itself (it listens to parameterschange); the host restarts it otherwise */
  | { type: 'parameters-result'; handled: boolean };

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
