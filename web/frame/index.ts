// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The web runtime inside the frame: waits for the host's launch message, sets up the globals the engine gives a mini
// program (DesktopEngine, requestAnimationFrame, timers, fs, require, localStorage, the network with its rules,
// audio behind its permission) and runs index.js. Then it passes the host's pointer events to the components under
// the pointer, and tells the host where its windows are.

import { contentFunction } from './realm.ts';
import type { FrameMessage, HostMessage, LaunchMessage, ParameterValue, WebScreen } from '../protocol.ts';
import { CanvasImageImpl, CanvasImpl, ComponentImpl, componentOf, ImageImpl, VideoImpl, WindowImpl, allVideos, allWindows, reportWindows, windowById } from './components.ts';
import { Evented, defineEvents } from './events.ts';
import { createFileSystem, loadPackage, requireFrom } from './files.ts';
import { installNetwork } from './network.ts';
import { cancelAnimationFrame, clearTimer, hostFrame, requestAnimationFrame, setInterval, setTimeout, startStats } from './scheduler.ts';
import { guard, hasPermission, report, send, state } from './state.ts';
import { installStorage } from './storage.ts';

const scope = globalThis as unknown as Record<string, unknown> & typeof globalThis;

// MARK: System and screens

class SystemImpl extends Evented {
  get appearance(): 'light' | 'dark' {
    return state.appearance;
  }

  triggerGC(): void {}

  cpuUsage(): number {
    if (!hasPermission('system-info')) throw new Error('cpuUsage() needs the "system-info" permission in manifest.json');
    // the web can't see the Mac: a plausible, slowly wandering value
    return Math.min(1, 0.08 + 0.06 * Math.sin(performance.now() / 7000) + 0.03 * Math.random());
  }

  memoryUsage(): { total: number; used: number; free: number } {
    if (!hasPermission('system-info')) throw new Error('memoryUsage() needs the "system-info" permission in manifest.json');
    const total = 16 * 1024 ** 3;
    const used = total * (0.58 + 0.04 * Math.sin(performance.now() / 20000));
    return { total, used, free: total - used };
  }
}
defineEvents(SystemImpl.prototype, ['appearancechange', 'parameterschange']);

function screenObject(screen: WebScreen, index: number): Record<string, unknown> {
  return Object.freeze({
    identifier: screen.id,
    isActive: true,
    isAsleep: false,
    isOnline: true,
    isMain: index === 0,
    isBuiltin: index === 0,
    isInMirrorSet: false,
    bounds: { ...screen.bounds },
    visibleFrame: { ...screen.visibleFrame },
    resolution: { width: screen.bounds.width * screen.scale, height: screen.bounds.height * screen.scale },
    physicalSize: { width: Math.round(screen.bounds.width * 0.2), height: Math.round(screen.bounds.height * 0.2) },
  });
}

class ScreenManagerImpl extends Evented {
  get screens(): Record<string, unknown>[] {
    return state.screens.map(screenObject);
  }

  get mainScreen(): Record<string, unknown> {
    return screenObject(state.screens[0], 0);
  }
}
defineEvents(ScreenManagerImpl.prototype, ['change']);

const system = new SystemImpl();
const screenManager = new ScreenManagerImpl();

// MARK: Audio

const audioContexts = new Set<{ context: AudioContext; wantsRunning: boolean }>();

function audioAllowed(): boolean {
  return hasPermission('audio') && !state.muted && !state.suspended;
}

function applyAudio(): void {
  for (const entry of audioContexts) {
    if (entry.context.state === 'closed') continue;
    if (audioAllowed() && entry.wantsRunning) entry.context.resume().catch(() => undefined);
    else entry.context.suspend().catch(() => undefined);
  }
  for (const video of allVideos()) video.applyAudio();
}

/** Without the audio permission an AudioContext stays suspended and play() fails, as in the app */
function installAudio(): void {
  const NativeAudioContext = scope.AudioContext;
  if (NativeAudioContext) {
    class AudioContext extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        const entry = { context: this as globalThis.AudioContext, wantsRunning: true };
        audioContexts.add(entry);
        const resume = NativeAudioContext.prototype.resume;
        this.resume = () => {
          entry.wantsRunning = true;
          return audioAllowed() ? resume.call(this) : Promise.resolve();
        };
        const suspend = NativeAudioContext.prototype.suspend;
        this.suspend = () => {
          entry.wantsRunning = false;
          return suspend.call(this);
        };
        if (!audioAllowed()) suspend.call(this).catch(() => undefined);
      }
    }
    scope.AudioContext = AudioContext;
  }
  const NativeAudio = scope.Audio;
  if (NativeAudio) {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!hasPermission('audio') && !(this instanceof HTMLVideoElement)) {
        return Promise.reject(new DOMException('playing sound needs the "audio" permission in manifest.json', 'NotAllowedError'));
      }
      if (this instanceof HTMLAudioElement) this.muted = state.muted;
      return play.call(this);
    };
  }
}

/**
 * While the pointer is over one of its windows and sound is on, the host lets the frame of a content that may play
 * sound take the pointer: a press in the frame itself is what lets it start sound (Safari counts no events the host
 * passes on, and lets an AudioContext start only for a few seconds after one). The frame resumes its audio in the
 * press and passes the events back to the host, which sends them on to the content like its own.
 */
function installPointerInput(): void {
  const forward = (kind: Extract<FrameMessage, { type: 'input' }>['kind']) => (event: PointerEvent) => {
    if (kind === 'down' && event.button === 0) applyAudio();
    send({
      type: 'input',
      kind,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      button: event.button,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
  };
  scope.addEventListener('pointermove', forward('move'));
  scope.addEventListener('pointerdown', forward('down'));
  scope.addEventListener('pointerup', forward('up'));
  scope.addEventListener('pointercancel', forward('cancel'));
  document.documentElement.addEventListener('pointerleave', forward('leave'));
}

// MARK: Console

function format(values: unknown[]): string {
  return values
    .map((value) => {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return `${value.name}: ${value.message}`;
      try {
        return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
      } catch {
        return String(value);
      }
    })
    .join(' ');
}

function installConsole(): void {
  const original = scope.console;
  const forward = (level: 'log' | 'info' | 'warn' | 'error' | 'debug') => (...values: unknown[]) => {
    original[level](...values);
    send({ type: 'console', level, message: format(values) });
  };
  scope.console = { ...original, log: forward('log'), info: forward('info'), warn: forward('warn'), error: forward('error'), debug: forward('debug') };
}

// MARK: The DesktopEngine global

function named<T extends object>(constructor: T, name: string): T {
  Object.defineProperty(constructor, 'name', { value: name });
  return constructor;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

let parameters: Record<string, ParameterValue> = {};

function createGlobal(launch: LaunchMessage): Record<string, unknown> {
  parameters = deepFreeze({ ...((launch.options.parameters as Record<string, ParameterValue>) ?? {}) });
  const launchOptions = { ...launch.options };
  delete launchOptions.parameters;
  deepFreeze(launchOptions);
  const options = new Proxy(launchOptions, {
    get: (target, key) => (key === 'parameters' ? parameters : Reflect.get(target, key)),
    has: (target, key) => key === 'parameters' || Reflect.has(target, key),
    ownKeys: (target) => [...Reflect.ownKeys(target), 'parameters'],
    getOwnPropertyDescriptor: (target, key) =>
      key === 'parameters' ? { value: parameters, enumerable: true, configurable: true, writable: false } : Reflect.getOwnPropertyDescriptor(target, key),
  });

  const fs = createFileSystem();
  const utils = {
    applyNew(constructor: unknown, args: unknown) {
      if (arguments.length !== 2) return null;
      if (typeof constructor !== 'function') throw new TypeError('applyNew needs a constructor');
      if (!args || typeof args !== 'object') throw new TypeError('applyNew needs an array of arguments');
      return Reflect.construct(constructor, Array.from(args as ArrayLike<unknown>));
    },
    setTimeout,
    setInterval,
    clearTimeout: clearTimer,
    clearInterval: clearTimer,
    base64Encode(buffer: unknown) {
      if (!(buffer instanceof ArrayBuffer)) return null;
      let binary = '';
      for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    base64Decode(text: unknown) {
      if (typeof text !== 'string' || !text) return null;
      try {
        return Uint8Array.from(atob(text), (character) => character.charCodeAt(0)).buffer;
      } catch {
        return null;
      }
    },
  };

  const desktopEngine: Record<string, unknown> = {
    ...utils,
    Window: named(WindowImpl, 'Window'),
    Component: named(ComponentImpl, 'Component'),
    Video: named(VideoImpl, 'Video'),
    Image: named(ImageImpl, 'Image'),
    Canvas: named(CanvasImpl, 'Canvas'),
    CanvasImage: named(CanvasImageImpl, 'CanvasImage'),
    WebGLRenderingContext: scope.WebGLRenderingContext,
    WebGL2RenderingContext: scope.WebGL2RenderingContext,
    ScreenManager: screenManager,
    system,
    fs,
    launchOptions: options,
    apiVersion: launch.apiVersion,
  };
  Object.defineProperty(desktopEngine, 'preferredFramesPerSecond', {
    get: () => state.contentFramesPerSecond,
    set: (value: unknown) => {
      const number = Number(value);
      state.contentFramesPerSecond = Number.isFinite(number) && number > 0 ? number : 0;
    },
    enumerable: true,
  });
  for (const key of ['fs', 'launchOptions', 'apiVersion']) {
    Object.defineProperty(desktopEngine, key, { value: desktopEngine[key], writable: false, enumerable: true });
  }
  return desktopEngine;
}

// MARK: Launch

function launch(message: LaunchMessage): void {
  if (state.launch) return;
  state.launch = message;
  state.screens = message.screens;
  state.appearance = message.appearance;
  state.muted = message.muted;
  state.hostMaxFramesPerSecond = message.maxFramesPerSecond;
  loadPackage(message.files, message.code);
  installNetwork(scope);
  installStorage(scope);
  installAudio();
  if (hasPermission('audio')) installPointerInput();
  installConsole();

  const desktopEngine = createGlobal(message);
  const runtimeScope: Record<string, unknown> = {};
  for (const [name, value] of Object.entries({
    Window: WindowImpl, Component: ComponentImpl, Video: VideoImpl, Image: ImageImpl, Canvas: CanvasImpl, CanvasImage: CanvasImageImpl,
    ScreenManager: ScreenManagerImpl, System: SystemImpl,
  })) {
    Object.defineProperty(runtimeScope, name, { get: () => value, enumerable: true });
  }
  for (const name of ['AnimationFrameManager', 'FileSystem', 'LocalStorage', 'Network', 'Audio']) runtimeScope[name] = undefined;

  Object.assign(scope, {
    DesktopEngine: desktopEngine,
    DesktopEngineCore: { Utils: undefined, Performance: undefined },
    DesktopEngineRuntime: runtimeScope,
    requestAnimationFrame,
    cancelAnimationFrame,
    setTimeout,
    setInterval,
    clearTimeout: clearTimer,
    clearInterval: clearTimer,
    require: (id: string) => requireFrom('/', id, {}),
  });
  // the engine's core helpers
  scope.mixin = (instances: object[], target: Record<string, unknown>) => {
    for (const instance of instances) {
      for (const key in instance) {
        const value = (instance as Record<string, unknown>)[key];
        target[key] = typeof value === 'function' ? value.bind(instance) : value;
      }
    }
  };
  scope.promisify = (object: Record<string, (...args: unknown[]) => unknown>) => {
    for (const key of Object.keys(Object.getPrototypeOf(object))) {
      object[key] = new Proxy(object[key], {
        apply: (target, thisArg, args) => new Promise((resolve, reject) => {
          args[0] = { ...(args[0] as object ?? {}), success: resolve, fail: reject };
          target.apply(thisArg, args);
        }),
      });
    }
  };
  // the engine's global postMessage(name, message): 'host' reaches the app, here the page
  scope.postMessage = ((name: unknown, payload?: unknown) => {
    if (name === 'host') send({ type: 'host-message', message: JSON.parse(JSON.stringify(payload ?? null)) });
  }) as typeof scope.postMessage;

  scope.addEventListener('error', (event) => report(event.error ?? event.message));
  scope.addEventListener('unhandledrejection', (event) => report(`Unhandled promise rejection: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`));

  startStats();
  guard(() => {
    contentFunction(message.code, `desktopengine:///${encodeURIComponent(message.name)}/index.js`)();
  });
  send({ type: 'launched' });
}

// MARK: The pointer

let hovered: ComponentImpl[] = [];
let pressed: { chain: ComponentImpl[]; x: number; y: number; moved: boolean } | null = null;
let lastClick = { time: 0, x: 0, y: 0, target: null as ComponentImpl | null };

/** The components under a point of a window, the deepest first, up to the window */
function chainAt(win: WindowImpl, x: number, y: number): ComponentImpl[] {
  const element = document.elementFromPoint(x, y);
  let component: ComponentImpl | null = null;
  for (let node: Element | null = element; node && !component; node = node.parentElement) component = componentOf.get(node) ?? null;
  if (!component || component.rootWindow !== win) component = win;
  const chain: ComponentImpl[] = [];
  for (let node: ComponentImpl | null = component; node; node = node.parent) chain.push(node);
  return chain;
}

function mousePayload(component: ComponentImpl, message: Extract<HostMessage, { type: 'pointer' }>): Record<string, unknown> {
  return { ...component.localPoint(message.x, message.y), ctrlKey: message.ctrlKey, altKey: message.altKey, metaKey: message.metaKey, shiftKey: message.shiftKey };
}

function click(chain: ComponentImpl[], message: Extract<HostMessage, { type: 'pointer' }>): void {
  const now = performance.now();
  const double = now - lastClick.time < 400 && Math.hypot(message.x - lastClick.x, message.y - lastClick.y) < 5 && lastClick.target === chain[0];
  lastClick = { time: double ? 0 : now, x: message.x, y: message.y, target: chain[0] };
  for (const component of chain) {
    component.emit(double ? 'dbclick' : 'click', { position: component.localPoint(message.x, message.y) });
  }
}

function pointer(message: Extract<HostMessage, { type: 'pointer' }>): void {
  const win = message.window ? windowById(message.window) : undefined;
  if (message.kind === 'leave' || !win) {
    for (const component of hovered) component.emit('mouseleave', mousePayload(component, message));
    hovered = [];
    return;
  }
  const chain = chainAt(win, message.x, message.y);
  switch (message.kind) {
    case 'move': {
      for (const component of hovered) if (!chain.includes(component)) component.emit('mouseleave', mousePayload(component, message));
      for (const component of chain) if (!hovered.includes(component)) component.emit('mouseenter', mousePayload(component, message));
      hovered = chain;
      // while pressed, the components the press began on follow the pointer (mouseDragged goes up the views)
      const targets = pressed ? pressed.chain : chain;
      if (pressed && Math.hypot(message.x - pressed.x, message.y - pressed.y) > 3) pressed.moved = true;
      for (const component of targets) component.emit('mousemove', mousePayload(component, message));
      break;
    }
    case 'down':
      pressed = { chain, x: message.x, y: message.y, moved: false };
      for (const component of chain) component.emit('mousedown', mousePayload(component, message));
      break;
    case 'up': {
      const press = pressed;
      pressed = null;
      for (const component of press?.chain ?? chain) component.emit('mouseup', mousePayload(component, message));
      if (press && !press.moved) click(chain, message);
      break;
    }
    case 'click':
      click(chain, message);
      break;
    case 'wheel':
      // the engine sends wheel only to the key window, which content windows on the desktop never are
      break;
  }
}

// MARK: Messages from the host

scope.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== parent) return;
  const message = event.data as HostMessage;
  switch (message?.type) {
    case 'launch':
      launch(message);
      break;
    case 'pointer':
      if (state.launch) pointer(message);
      break;
    case 'frame':
      hostFrame();
      break;
    case 'cursor':
      document.documentElement.style.cursor = String(message.cursor);
      break;
    case 'move-window':
      windowById(message.window)?.moveTo(message.x, message.y);
      break;
    case 'appearance':
      if (message.appearance === state.appearance) break;
      state.appearance = message.appearance;
      system.emit('appearancechange', { appearance: state.appearance });
      break;
    case 'parameters': {
      parameters = deepFreeze({ ...message.parameters });
      const handled = system.listens('parameterschange');
      if (handled) system.emit('parameterschange', { parameters, changed: [...message.changed] });
      send({ type: 'parameters-result', handled });
      break;
    }
    case 'screens':
      state.screens = message.screens;
      reportWindows();
      screenManager.emit('change');
      break;
    case 'playback': {
      const wasVisible = !state.suspended && !state.renderingPaused;
      state.suspended = message.suspended;
      state.renderingPaused = message.renderingPaused;
      state.muted = message.muted;
      state.hostMaxFramesPerSecond = message.maxFramesPerSecond;
      const visible = !state.suspended && !state.renderingPaused;
      if (visible !== wasVisible) for (const win of allWindows()) win.visibilityChanged(visible);
      for (const video of allVideos()) video.suspend(state.suspended);
      applyAudio();
      break;
    }
    case 'stop':
      for (const win of allWindows()) win.destroy();
      for (const entry of audioContexts) entry.context.close().catch(() => undefined);
      break;
  }
});

send({ type: 'ready' });
