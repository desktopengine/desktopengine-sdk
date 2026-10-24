// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The web runtime inside the frame: waits for the host's launch message, sets up the globals the engine gives a mini
// program (DesktopEngine, requestAnimationFrame, timers, fs, require, localStorage, the network with its rules,
// audio behind its permission) and runs index.js. Then it passes the host's pointer events to the components under
// the pointer, and tells the host where its windows are.

import { contentFunction } from './realm.ts';
import { readAppWindows, sameAppWindows, visibleTopEdges, type AppWindowInfo, type FrameMessage, type HostMessage, type LaunchMessage, type ParameterValue, type SuspendReason, type SystemStatusReading, type TopEdge, type WebScreen } from '../protocol.ts';
import { CanvasImageImpl, CanvasImpl, ComponentImpl, componentOf, ImageImpl, VideoImpl, WindowImpl, allVideos, allWindows, reportWindows, unwrap, windowById, windowCorner } from './components.ts';
import { Evented, defineEvents } from './events.ts';
import { createFileSystem, fileBytes, loadPackage, requireFrom } from './files.ts';
import { createFrameFonts } from './fonts.ts';
import { audioURL, installNetwork } from './network.ts';
import { createImageBitmapFunction } from './bitmap.ts';
import { createChannels } from './channels.ts';
import { createMessaging } from './clone.ts';
import { installMessageEvent } from './message-event.ts';
import { createPath2D } from './path2d.ts';
import { cancelAnimationFrame, clearTimer, hostFrame, requestAnimationFrame, setInterval, setTimeout, startStats } from './scheduler.ts';
import { guard, hasPermission, itemsOf, list, report, send, state } from './state.ts';
import { createSyncStorage, installStorage } from './storage.ts';
import { engineConstructor, standIn } from './stand-ins.ts';
import { RESTRICTED_BAND_COUNT, RESTRICTED_QUANTUM, FINE_BAND_COUNT, emptySnapshot, isAudible, mergeBands, normalizedLevel, restrictedRefresh, syntheticSnapshot, type Snapshot } from '../system-audio.ts';
import { readSuspendReason, readSystemStatus, restingSystemStatus, strongerReason, systemStatusChanges } from '../system-status.ts';

const scope = globalThis as unknown as Record<string, unknown> & typeof globalThis;

// what the content may replace, taken before it runs: the host's messages are handled, and the console, postMessage
// and the events work, whatever the content did to the language's prototypes and globals, as in the engine, where
// they're native
const { apply } = Reflect;
const { values: objectValues, keys: objectKeys, freeze, defineProperty, getOwnPropertyDescriptor, getPrototypeOf, setPrototypeOf } = Object;
const { defineProperty: reflectDefine, deleteProperty: reflectDelete } = Reflect;
const { stringify, parse } = JSON;
const { isFinite } = Number;
const { max, floor, hypot } = Math;
const toNumber = Number;
const toText = String;
const ErrorClass = Error;
const Float32ArrayClass = Float32Array;
const typedArrayLength = getOwnPropertyDescriptor(getPrototypeOf(Uint8Array.prototype) as object, 'length')!.get!;
const PromiseClass = Promise;
const { then } = Promise.prototype;
const { resolve: promiseResolve, reject: promiseReject } = Promise;
const { get: mapGet, set: mapSet, has: mapHas, delete: mapDelete, forEach: mapForEach } = Map.prototype;
const { add: setAdd, delete: setDelete } = Set.prototype;
const { get: weakMapGet, set: weakMapSet, has: weakMapHas, delete: weakMapDelete } = WeakMap.prototype;
const { has: weakSetHas, add: weakSetAdd } = WeakSet.prototype;
const now = performance.now.bind(performance);
const dateNow = Date.now;
const contains = <T>(items: T[], item: T): boolean => {
  for (let index = 0; index < items.length; index++) if (items[index] === item) return true;
  return false;
};
/** A promise's failure dropped */
const ignoreFailure = (promise: Promise<unknown>): void => {
  apply(then, promise, [undefined, () => undefined]);
};
/** A descriptor without a prototype: defining with it reads none of what the content put on Object.prototype */
const descriptor = (fields: PropertyDescriptor): PropertyDescriptor => setPrototypeOf(fields, null) as PropertyDescriptor;

// MARK: System and screens

class SystemImpl extends Evented {
  get appearance(): 'light' | 'dark' {
    return state.appearance;
  }

  triggerGC(): void {}
}
defineEvents(SystemImpl.prototype, ['appearancechange', 'parameterschange']);

/** The prototype of the screens: as the engine's, objects of a class of their own with their values as own properties */
const SCREEN = Object.create(Object.prototype, { [Symbol.toStringTag]: { value: 'Screen' } }) as object;

/** A screen: a native object in the engine, which structuredClone and BroadcastChannel refuse */
function screenObject(screen: WebScreen, index: number): Record<string, unknown> {
  return standIn(Object.freeze(Object.assign(Object.create(SCREEN) as Record<string, unknown>, {
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
  })));
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

// MARK: Input

const MOUSE_EVENTS = ['mousemove', 'mousedown', 'mouseup', 'wheel'];
/** Where the host last saw the pointer on the desktop */
let lastPointer: { x: number; y: number } | null = null;
let inputWanted = { mouse: false, keys: false };

/** DesktopEngine.input: the host sends the pointer anywhere on the desktop and the page's key presses while it listens */
class InputImpl extends Evented {
  get pointer(): { x: number; y: number } | null {
    if (!hasPermission('mouse')) return null;
    if (lastPointer) return { ...lastPointer };
    // not seen yet: the middle of the main screen
    const bounds = state.screens[0]?.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

  get keyActivityAvailable(): boolean {
    return state.launch?.keyActivity === true;
  }

  override destroy(): void {
    super.destroy();
    this.listenersChanged('');
  }

  protected override listenersChanged(_name: string): void {
    let listensForMouse = false;
    for (let index = 0; index < MOUSE_EVENTS.length && !listensForMouse; index++) listensForMouse = this.listens(MOUSE_EVENTS[index]);
    const wanted = {
      mouse: hasPermission('mouse') && listensForMouse,
      keys: this.keyActivityAvailable && this.listens('keyactivity'),
    };
    if (wanted.mouse === inputWanted.mouse && wanted.keys === inputWanted.keys) return;
    inputWanted = wanted;
    send({ type: 'input-wanted', ...wanted });
  }
}
defineEvents(InputImpl.prototype, [...MOUSE_EVENTS, 'keyactivity']);

function globalMouse(message: Extract<HostMessage, { type: 'global-mouse' }>): void {
  if (!hasPermission('mouse')) return;
  const x = toNumber(message.x);
  const y = toNumber(message.y);
  if (!isFinite(x) || !isFinite(y)) return;
  lastPointer = { x, y };
  switch (message.kind) {
    case 'move':
      input.emit('mousemove', { x, y });
      break;
    case 'down':
    case 'up':
      input.emit(message.kind === 'down' ? 'mousedown' : 'mouseup', { x, y, button: toNumber(message.button) || 0 });
      break;
    case 'wheel':
      input.emit('wheel', { x, y, deltaX: toNumber(message.deltaX) || 0, deltaY: toNumber(message.deltaY) || 0 });
      break;
  }
}

// MARK: System audio

/** What the page plays (`system-audio` messages), or null for the made-up signal */
let pageAudio: Snapshot | null = null;
/** When the page's sound was last audible (performance.now()) */
let pageAudibleAt = -Infinity;
const systemAudioStart = now();
/**
 * The analysis the content reads, one for all of it as in the app; without the detailed analysis, a new one only when
 * `next` (performance.now()) is due, see restrictedRefresh
 */
const systemAudioReading = { snapshot: emptySnapshot(), next: -Infinity };
/** DesktopEngine.systemAudio, the only one there is: as in the app, the constructor works once */
let systemAudio: SystemAudioImpl | null = null;

/**
 * As in the app: the one SystemAudio or Windows, made by DesktopEngine's getter or by content before it read that,
 * becomes the property's value (the getter would only try to make another)
 */
function settleSingleton(key: 'systemAudio' | 'windows' | 'systemStatus', value: object): void {
  const desktopEngine = scope.DesktopEngine;
  if (typeof desktopEngine !== 'object' || desktopEngine === null) return;
  if (reflectDelete(desktopEngine, key)) {
    reflectDefine(desktopEngine, key, descriptor({ value, writable: false, enumerable: true, configurable: true }));
  }
}

function systemAudioActive(): boolean {
  return pageAudio === null || now() - pageAudibleAt < 1000;
}

/**
 * DesktopEngine.systemAudio: a browser can't hear the Mac, so a made-up signal like music, or the page's analysis of an
 * element it plays (WebDesktop.setSystemAudioSource)
 */
class SystemAudioImpl extends Evented {
  #bandCount = RESTRICTED_BAND_COUNT;
  /** What the last activechange told, or what `active` read when the content started listening */
  #active = systemAudioActive();
  /** Whether `active` reads #active: while the content listens for activechange */
  #tracksActive = false;

  constructor() {
    if (systemAudio) throw new TypeError('Illegal constructor');
    if (!state.launch || state.launch.systemAudio === 'none') {
      throw new Error('This content can\'t hear what the Mac plays: it needs the "system-audio" permission, without "network"');
    }
    super();
    systemAudio = this;
    settleSingleton('systemAudio', this);
  }

  get #detailed(): boolean {
    return state.launch?.systemAudio === 'detailed';
  }

  #current(): Snapshot {
    const reading = systemAudioReading;
    const now = performance.now();
    if (!this.#detailed) {
      const next = restrictedRefresh(reading.next, now);
      if (next === null) return reading.snapshot;
      reading.next = next;
    }
    if (pageAudio) {
      reading.snapshot.bands.set(pageAudio.bands);
      reading.snapshot.level = pageAudio.level;
    } else {
      syntheticSnapshot((now - systemAudioStart) / 1000, reading.snapshot);
    }
    return reading.snapshot;
  }

  get supported(): boolean {
    return true;
  }

  /**
   * As in the app: while the content listens for activechange, active changes only along with an event, so it never
   * reads a change no event tells (e.g. between the page's messages while a hidden page's timers are slowed down)
   */
  get active(): boolean {
    return this.#tracksActive ? this.#active : systemAudioActive();
  }

  protected override listenersChanged(name: string): void {
    if (name !== 'activechange') return;
    const tracks = this.listens(name);
    // a new listener hears of changes from what active read before it was added
    if (tracks && !this.#tracksActive) this.#active = systemAudioActive();
    this.#tracksActive = tracks;
  }

  get level(): number {
    const level = normalizedLevel(this.#current().level);
    return this.#detailed ? level : Math.round(level / RESTRICTED_QUANTUM) * RESTRICTED_QUANTUM;
  }

  get bandCount(): number {
    return this.#bandCount;
  }

  set bandCount(value: unknown) {
    // as the engine: a number only, NaN aside; fractions dropped, and ±Infinity clamped like any other out of range
    if (typeof value !== 'number' || Number.isNaN(value)) return;
    this.#bandCount = Math.min(Math.max(Math.floor(value), 1), this.maxBandCount);
  }

  get maxBandCount(): number {
    return this.#detailed ? FINE_BAND_COUNT : RESTRICTED_BAND_COUNT;
  }

  getBands(array: unknown): void {
    if (!(array instanceof Float32Array)) throw new TypeError('getBands: the argument must be a Float32Array');
    mergeBands(this.#current(), array, this.#bandCount, !this.#detailed);
  }

  /** @internal: the page's sound started or stopped */
  activeChanged(): void {
    const active = systemAudioActive();
    if (active === this.#active) return;
    this.#active = active;
    // no payload, like the engine's other change events
    this.emit('activechange');
  }
}
defineEvents(SystemAudioImpl.prototype, ['activechange']);

function pageSystemAudio(message: Extract<HostMessage, { type: 'system-audio' }>): void {
  if (!state.launch || state.launch.systemAudio === 'none') return;
  if (message.bands instanceof Float32ArrayClass && apply(typedArrayLength, message.bands, []) === FINE_BAND_COUNT) {
    // the page's sound starting counts as audible: its first moments may be quiet
    if (!pageAudio) pageAudibleAt = now();
    pageAudio = { bands: message.bands, level: toNumber(message.level) || 0 };
    // as in the app: a sample since the page's last analysis louder than -60 dB, not the smoothed level
    if (isAudible(toNumber(message.peak))) pageAudibleAt = now();
  } else {
    pageAudio = null;
  }
  systemAudio?.activeChanged();
}

// MARK: Other apps' windows

/** The page's pretend app windows, front to back, as the host last sent them */
let appWindows: AppWindowInfo[] = [];

/**
 * DesktopEngine.windows, the only one there is (the constructor works once, as in the app): the host sends its pretend
 * app windows when they change, only with the permission. `change` comes only when they did, never for a listener
 * being added.
 */
class WindowsImpl extends Evented {
  constructor() {
    if (windows) throw new TypeError('Illegal constructor');
    if (!hasPermission('window-positions')) throw new Error('DesktopEngine.windows needs the "window-positions" permission in manifest.json, and the user\'s consent');
    super();
    windows = this;
    settleSingleton('windows', this);
  }

  list(): AppWindowInfo[] {
    return appWindows.map((win) => ({ ...win, frame: { ...win.frame } }));
  }

  /** The parts of the windows' top edges that no window in front covers, front to back, as the engine finds them */
  visibleTopEdges(): TopEdge[] {
    return visibleTopEdges(appWindows);
  }
}
defineEvents(WindowsImpl.prototype, ['change']);

function updateAppWindows(value: unknown): void {
  if (!hasPermission('window-positions')) return;
  const next = readAppWindows(value);
  if (sameAppWindows(next, appWindows)) return;
  appWindows = next;
  windows?.emit('change');
}

// MARK: System status

/** The events that come with readings: listening to any of them keeps the readings coming (`resume` alone doesn't) */
const STATUS_READING_EVENTS = ['change', 'powerchange', 'thermalchange', 'networkchange', 'memorypressurechange'];
/** A read keeps the readings coming for this long, ms */
const STATUS_READ_WINDOW = 2000;

/** One reading as the content sees it: frozen objects, the same ones until the next reading */
interface StatusView {
  reading: SystemStatusReading;
  cpu: object;
  memory: object;
  network: object;
  power: object;
  disk: object;
}

/** The page's latest reading, which the next reading the content gets is taken from */
let pageStatus: SystemStatusReading | null = null;
/** What the content reads: the latest reading it got; null before the first */
let statusView: StatusView | null = null;
/** The reading the next one's discrete events compare with: the last `change`'s, or what it read before it listened */
let statusBaseline: SystemStatusReading | null = null;
/** The reading the content last read or was told about with `change` */
let statusLastRead: SystemStatusReading | null = null;
let statusReadAt = -Infinity;
/** Whether the content listens to any of the events that come with readings */
let statusListening = false;
/** Since when the content is suspended (Date.now()) and why, the strongest reason during it */
let suspension: { at: number; reason: SuspendReason } | null = null;
/** DesktopEngine.systemStatus, the only one there is: as in the app, the constructor works once */
let systemStatus: SystemStatusImpl | null = null;

/** A frozen copy, deep as the reading's objects are */
function frozenStatus(reading: SystemStatusReading): StatusView {
  const cores: object[] = [];
  for (let index = 0; index < reading.cpu.cores.length; index++) {
    const core = reading.cpu.cores[index];
    const usage = core.usage;
    // defined, not assigned: nothing the content put on Array.prototype is called
    reflectDefine(cores, index, descriptor({ value: freeze({ usage, efficiency: core.efficiency }), writable: true, enumerable: true, configurable: true }));
  }
  freeze(cores);
  const { memory, network, power, disk } = reading;
  const battery = power.battery;
  return {
    reading,
    cpu: freeze({ usage: reading.cpu.usage, cores }),
    memory: freeze({
      total: memory.total, used: memory.used, app: memory.app, wired: memory.wired, compressed: memory.compressed, cached: memory.cached,
      swapUsed: memory.swapUsed, pressure: memory.pressure, swapping: memory.swapping,
    }),
    network: freeze({
      online: network.online, interface: network.interface, expensive: network.expensive,
      receivedPerSecond: network.receivedPerSecond, sentPerSecond: network.sentPerSecond,
      received: network.received, sent: network.sent,
    }),
    power: freeze({
      source: power.source,
      battery: battery && freeze({
        level: battery.level, charging: battery.charging, full: battery.full, timeToEmpty: battery.timeToEmpty, timeToFull: battery.timeToFull,
      }),
      adapterWatts: power.adapterWatts,
      systemWatts: power.systemWatts,
      lowPowerMode: power.lowPowerMode,
    }),
    disk: freeze({ total: disk.total, available: disk.available }),
  };
}

/** Whether readings come: while the content listens to an event that comes with them, or read in the last 2 seconds */
function statusSampling(): boolean {
  return systemStatus !== null && (statusListening || now() - statusReadAt < STATUS_READ_WINDOW);
}

/**
 * A new reading of the page's latest: `change`, then the discrete events for what differs from the last `change`'s
 * (or, for the first since the content listened, from what it read before)
 */
function takeStatusReading(): void {
  const status = systemStatus;
  const reading = pageStatus;
  if (!status || !reading) return;
  // measured since the reading before, or over a moment before it after readings stopped, as the app's sampler does
  statusView = frozenStatus(reading);
  if (!statusListening) return;
  const previous = statusBaseline;
  statusBaseline = reading;
  statusLastRead = reading;
  status.emit('change');
  if (!previous) return;
  const changes = systemStatusChanges(previous, reading);
  for (let index = 0; index < changes.length; index++) status.emit(changes[index]);
}

/** One of the page's readings: the content gets it while readings come, and never while it's suspended */
function pageSystemStatus(value: unknown): void {
  if (!hasPermission('system-info')) return;
  const reading = readSystemStatus(value);
  if (!reading) return;
  pageStatus = reading;
  if (statusSampling() && !state.suspended) takeStatusReading();
}

/** The content suspended, or running again: `resume` says for how long and why, then a new reading comes */
function statusSuspended(suspended: boolean, reason: SuspendReason): void {
  if (suspended) {
    if (suspension) suspension.reason = strongerReason(suspension.reason, reason);
    else suspension = { at: dateNow(), reason };
    return;
  }
  const ended = suspension;
  suspension = null;
  if (!ended || !systemStatus) return;
  systemStatus.emit('resume', freeze({ suspendedAt: ended.at, resumedAt: dateNow(), reason: ended.reason }));
  // a listener may have suspended it again
  if (!state.suspended && statusSampling()) takeStatusReading();
}

/**
 * DesktopEngine.systemStatus: a browser can't see the Mac, so the page makes up how it's doing, one reading about once a
 * second for all its contents (WebDesktop.setSystemStatus sets any of it). A reading comes in a message of the page's,
 * so the properties never change while the content's JS runs; while it listens, they change along with `change`.
 */
class SystemStatusImpl extends Evented {
  constructor() {
    if (systemStatus) throw new TypeError('Illegal constructor');
    if (!hasPermission('system-info')) throw new Error('DesktopEngine.systemStatus needs the "system-info" permission in manifest.json, and the user\'s consent');
    super();
    systemStatus = this;
    settleSingleton('systemStatus', this);
  }

  /**
   * The reading the content reads now: while readings come, the one it has; otherwise a fresh one, taken at once, as the
   * app's sampler starts again (the same one until the running JS returns, the page's readings come between)
   */
  #view(): StatusView {
    if (!statusView || !statusSampling()) {
      const reading = pageStatus ?? restingSystemStatus();
      if (!statusView || statusView.reading !== reading) statusView = frozenStatus(reading);
    }
    statusReadAt = now();
    statusLastRead = statusView.reading;
    return statusView;
  }

  protected override listenersChanged(_name: string): void {
    let listening = false;
    for (let index = 0; index < STATUS_READING_EVENTS.length && !listening; index++) listening = this.listens(STATUS_READING_EVENTS[index]);
    // the first change after it starts listening compares with what it read or was told about before, if anything
    if (listening && !statusListening) statusBaseline = statusLastRead;
    statusListening = listening;
  }

  get cpu(): object {
    return this.#view().cpu;
  }

  get memory(): object {
    return this.#view().memory;
  }

  get network(): object {
    return this.#view().network;
  }

  get power(): object {
    return this.#view().power;
  }

  get thermal(): string {
    return this.#view().reading.thermal;
  }

  get temperature(): number | null {
    return this.#view().reading.temperature;
  }

  get disk(): object {
    return this.#view().disk;
  }

  get bootTime(): number {
    return this.#view().reading.bootTime;
  }
}
defineEvents(SystemStatusImpl.prototype, [...STATUS_READING_EVENTS, 'resume']);

const system = new SystemImpl();
const screenManager = new ScreenManagerImpl();
const input = new InputImpl();
let windows: WindowsImpl | null = null;

// MARK: Audio

const audioContexts = new Set<{ context: AudioContext; wantsRunning: boolean }>();
/** Audio elements playing, or waiting to: they follow the sound being turned on and off */
const audioElements = new Set<HTMLAudioElement>();
/** The Audio elements that leave audioElements when they end */
const endWatched = new WeakSet<HTMLAudioElement>();
/** muted as the content set it on each Audio element; the element itself is muted too while the sound is off */
const contentMuted = new WeakMap<HTMLMediaElement, boolean>();
/**
 * Audio elements to start when the sound may start (applyAudio), with the play() calls waiting for it: ones the browser
 * held back until the visitor pressed in the frame, and ones paused while the content is (suspended)
 */
const heldPlays = new Map<HTMLAudioElement, HeldPlay[]>();
const nativeMuted = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted')!;
const nativePlay = HTMLMediaElement.prototype.play;
const nativePause = HTMLMediaElement.prototype.pause;
/** The src of each Audio element as the content set it: as in the app, what `src` reads */
const audioSources = new WeakMap<HTMLMediaElement, string>();
/** The error of an Audio element whose src the app wouldn't load, while that src is its own */
const audioFailures = new WeakMap<HTMLMediaElement, MediaError>();

function audioAllowed(): boolean {
  return hasPermission('audio') && !state.muted && !state.suspended;
}

type HeldPlay = { resolve: () => void; reject: (error: unknown) => void };

function applyAudio(): void {
  const contexts = itemsOf(audioContexts);
  for (let index = 0; index < contexts.length; index++) {
    const entry = contexts[index];
    if (entry.context.state === 'closed') continue;
    if (audioAllowed() && entry.wantsRunning) ignoreFailure(entry.context.resume());
    else ignoreFailure(entry.context.suspend());
  }
  const videos = allVideos();
  for (let index = 0; index < videos.length; index++) videos[index].applyAudio();
  const elements = itemsOf(audioElements);
  for (let index = 0; index < elements.length; index++) applyElementAudio(elements[index]);
  if (state.suspended) {
    // as in the app: playing Audio elements pause while the content is paused, and go on afterwards
    for (let index = 0; index < elements.length; index++) {
      const element = elements[index];
      if (element.paused) continue;
      apply(nativePause, element, []);
      if (!apply(mapHas, heldPlays, [element])) apply(mapSet, heldPlays, [element, list<HeldPlay>()]);
    }
    return;
  }
  apply(mapForEach, heldPlays, [(held: HeldPlay[], element: HTMLAudioElement) => {
    apply(then, apply(nativePlay, element, []), [() => {
      if (apply(mapGet, heldPlays, [element]) !== held) return;
      apply(mapDelete, heldPlays, [element]);
      for (let index = 0; index < held.length; index++) held[index].resolve();
    }, (error: unknown) => {
      if ((error instanceof DOMException && error.name === 'NotAllowedError') || apply(mapGet, heldPlays, [element]) !== held) return;
      apply(mapDelete, heldPlays, [element]);
      apply(setDelete, audioElements, [element]);
      for (let index = 0; index < held.length; index++) held[index].reject(error);
    }]);
  }]);
}

function applyElementAudio(element: HTMLMediaElement): void {
  apply(nativeMuted.set!, element, [((apply(weakMapGet, contentMuted, [element]) as boolean | undefined) ?? false) || state.muted || !hasPermission('audio')]);
}

/** Without the audio permission an AudioContext stays suspended and play() fails, as in the app */
function installAudio(): void {
  const NativeAudioContext = scope.AudioContext;
  if (NativeAudioContext) {
    // the browser's, taken before the content runs: applyAudio resumes and suspends the contexts through them
    const { resume, suspend } = NativeAudioContext.prototype;
    class AudioContext extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        const entry = { context: this as globalThis.AudioContext, wantsRunning: true };
        apply(setAdd, audioContexts, [entry]);
        this.resume = () => {
          entry.wantsRunning = true;
          return audioAllowed() ? apply(resume, this, []) as Promise<void> : apply(promiseResolve, PromiseClass, []) as Promise<void>;
        };
        this.suspend = () => {
          entry.wantsRunning = false;
          return apply(suspend, this, []) as Promise<void>;
        };
        if (!audioAllowed()) ignoreFailure(apply(suspend, this, []) as Promise<void>);
      }
    }
    // named and of the length the engine's is, whatever the bundler calls it (structuredClone refuses "A AudioContext")
    Object.defineProperty(AudioContext, 'name', { value: 'AudioContext', configurable: true });
    Object.defineProperty(AudioContext, 'length', { value: 0, configurable: true });
    scope.AudioContext = AudioContext;
  }
  const NativeAudio = scope.Audio;
  if (NativeAudio) {
    Object.defineProperty(HTMLAudioElement.prototype, 'muted', {
      configurable: true,
      enumerable: true,
      get(this: HTMLAudioElement) {
        return (apply(weakMapGet, contentMuted, [this]) as boolean | undefined) ?? false;
      },
      set(this: HTMLAudioElement, value: unknown) {
        apply(weakMapSet, contentMuted, [this, !!value]);
        applyElementAudio(this);
      },
    });
    // with the language's functions as they were before the content ran: a Video's element plays through them too, also
    // when the content resumes
    const AudioElement = HTMLAudioElement;
    installAudioSources(NativeAudio);
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!(this instanceof AudioElement)) return apply(nativePlay, this, []) as Promise<void>;
      const failure = apply(weakMapGet, audioFailures, [this]) as MediaError | undefined;
      if (failure) return apply(promiseReject, PromiseClass, [new DOMException(failure.message, 'NotSupportedError')]) as Promise<void>;
      if (!hasPermission('audio')) {
        return apply(promiseReject, PromiseClass, [new DOMException('playing sound needs the "audio" permission in manifest.json', 'NotAllowedError')]) as Promise<void>;
      }
      const element = this;
      if (!apply(weakSetHas, endWatched, [element])) {
        apply(weakSetAdd, endWatched, [element]);
        element.addEventListener('ended', () => apply(setDelete, audioElements, [element]));
      }
      apply(setAdd, audioElements, [element]);
      applyElementAudio(element);
      const hold = () => new PromiseClass<void>((resolve, reject) => {
        const held = (apply(mapGet, heldPlays, [element]) as HeldPlay[] | undefined) ?? list<HeldPlay>();
        held[held.length] = { resolve, reject };
        apply(mapSet, heldPlays, [element, held]);
      });
      if (state.suspended) return hold();
      // a browser plays sound in the frame only after the visitor pressed in it: the play waits for that (applyAudio)
      // instead of failing, as there is nothing to wait for in the app
      return apply(then, apply(nativePlay, element, []), [undefined, (error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'NotAllowedError')) throw error;
        return hold();
      }]) as Promise<void>;
    };
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      if (this instanceof AudioElement) {
        const held = apply(mapGet, heldPlays, [this]) as HeldPlay[] | undefined;
        apply(mapDelete, heldPlays, [this]);
        apply(setDelete, audioElements, [this]);
        if (held) {
          for (let index = 0; index < held.length; index++) {
            held[index].reject(new DOMException('The play() request was interrupted by a call to pause()', 'AbortError'));
          }
        }
      }
      apply(nativePause, this, []);
    };
  }
}

/**
 * Audio elements load their src as the app does (audioURL): the browser would take data: and blob: URLs, which the app
 * doesn't, and resolve a package's path against the page. A src the app wouldn't load leaves the element empty, and
 * then fails as in the app: an error event, `error` a MediaError of code 4 with the app's message, `networkState`
 * NETWORK_NO_SOURCE, and play() rejected with a NotSupportedError. `src` reads back what was set; `new Audio(src)`,
 * setAttribute('src') and load() go through it too.
 */
function installAudioSources(NativeAudio: typeof Audio): void {
  // the browser's, taken before the content runs
  const AudioElementPrototype = HTMLAudioElement.prototype;
  const MediaErrorPrototype = MediaError.prototype;
  const nativeSrc = getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!.set!;
  const nativeError = getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'error')!.get!;
  const nativeNetworkState = getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'networkState')!.get!;
  const nativeLoad = HTMLMediaElement.prototype.load;
  const { setAttribute: nativeSetAttribute, removeAttribute } = Element.prototype;
  const { dispatchEvent } = EventTarget.prototype;
  const EventClass = Event;
  const DOMExceptionClass = DOMException;
  const { toLowerCase } = String.prototype;
  const objectCreate = Object.create;

  const loadSource = (element: HTMLMediaElement, src: string): void => {
    apply(weakMapSet, audioSources, [element, src]);
    apply(weakMapDelete, audioFailures, [element]);
    const target = src ? audioURL(src) : null;
    if (target && 'url' in target) {
      apply(nativeSrc, element, [target.url]);
      return;
    }
    apply(removeAttribute, element, ['src']);
    apply(nativeLoad, element, []);
    if (!target) return;
    // the browser makes no MediaError of its own message: one of its prototype, refused by structuredClone as the app's
    const failure = standIn(objectCreate(MediaErrorPrototype, {
      code: descriptor({ value: 4, enumerable: true }), // MEDIA_ERR_SRC_NOT_SUPPORTED
      message: descriptor({ value: target.failure, enumerable: true }),
    }) as MediaError);
    apply(weakMapSet, audioFailures, [element, failure]);
    const held = apply(mapGet, heldPlays, [element]) as HeldPlay[] | undefined;
    apply(mapDelete, heldPlays, [element]);
    apply(setDelete, audioElements, [element]);
    if (held) {
      for (let index = 0; index < held.length; index++) held[index].reject(new DOMExceptionClass(target.failure, 'NotSupportedError'));
    }
    setTimeout(() => {
      if (apply(weakMapGet, audioFailures, [element]) === failure) apply(dispatchEvent, element, [new EventClass('error')]);
    });
  };

  // `new Audio(src)` sets the src through the property, as in the app: the browser's sets the attribute
  const AudioConstructor = function Audio(src?: unknown) {
    if (!new.target) throw new TypeError('Constructor Audio requires \'new\'');
    const element = new NativeAudio();
    if (src !== undefined) loadSource(element, toText(src));
    return element;
  } as unknown as typeof Audio;
  AudioConstructor.prototype = AudioElementPrototype;
  // named and of the length the engine's is, whatever the bundler calls it
  defineProperty(AudioConstructor, 'name', { value: 'Audio', configurable: true });
  defineProperty(AudioConstructor, 'length', { value: 1, configurable: true });
  scope.Audio = AudioConstructor;
  Object.defineProperties(AudioElementPrototype, {
    src: {
      configurable: true,
      enumerable: true,
      get(this: HTMLAudioElement) {
        return (apply(weakMapGet, audioSources, [this]) as string | undefined) ?? '';
      },
      set(this: HTMLAudioElement, value: unknown) {
        loadSource(this, toText(value));
      },
    },
    error: {
      configurable: true,
      enumerable: true,
      get(this: HTMLAudioElement) {
        return (apply(weakMapGet, audioFailures, [this]) as MediaError | undefined) ?? apply(nativeError, this, []);
      },
    },
    networkState: {
      configurable: true,
      enumerable: true,
      get(this: HTMLAudioElement) {
        return apply(weakMapHas, audioFailures, [this]) ? 3 /* NETWORK_NO_SOURCE */ : apply(nativeNetworkState, this, []);
      },
    },
    // loading again loads the src again, a src the app wouldn't load fails again
    load: {
      configurable: true,
      writable: true,
      value: function load(this: HTMLAudioElement) {
        const src = apply(weakMapGet, audioSources, [this]) as string | undefined;
        if (src !== undefined) loadSource(this, src);
        else apply(nativeLoad, this, []);
      },
    },
    // as the src: the app's elements take no other attribute that loads
    setAttribute: {
      configurable: true,
      writable: true,
      value: function setAttribute(this: HTMLAudioElement, name: string, value: string) {
        if (apply(toLowerCase, toText(name), []) === 'src') loadSource(this, toText(value));
        else apply(nativeSetAttribute, this, [name, value]);
      },
    },
  });
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
      buttons: event.buttons,
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
  // the frame takes the pointer only over the content's windows, which have no menu
  scope.addEventListener('contextmenu', (event: MouseEvent) => event.preventDefault());
  // over this frame the page doesn't see the wheel either: passed back for other contents' DesktopEngine.input
  scope.addEventListener('wheel', (event: WheelEvent) => {
    send({
      type: 'input',
      kind: 'wheel',
      x: event.clientX,
      y: event.clientY,
      pointerId: 0,
      button: 0,
      buttons: event.buttons,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
    });
  }, { passive: true });
}

// MARK: Console

function format(values: unknown[]): string {
  let text = '';
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    let part: string | undefined;
    if (typeof value === 'string') {
      part = value;
    } else if (value instanceof ErrorClass) {
      part = `${value.name}: ${value.message}`;
    } else {
      try {
        part = typeof value === 'object' && value !== null ? stringify(value) : toText(value);
      } catch {
        part = toText(value);
      }
    }
    // as join() writes them: what JSON leaves out is nothing
    text += `${index > 0 ? ' ' : ''}${part ?? ''}`;
  }
  return text;
}

/**
 * The engine's crypto: getRandomValues and randomUUID, without the browser's `subtle`, which the app doesn't have; an
 * object of a class of its own as the engine's (there's no global for it). The browser checks the arrays and throws the
 * same DOMExceptions
 */
function installCrypto(): void {
  const browserCrypto = scope.crypto;
  const getRandomValues = browserCrypto.getRandomValues.bind(browserCrypto);
  class Crypto {
    getRandomValues(array: unknown): unknown {
      return getRandomValues(array as ArrayBufferView<ArrayBuffer>);
    }

    randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
      // browsers have randomUUID only in secure contexts
      const bytes = browserCrypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }
  Object.defineProperty(Crypto.prototype, Symbol.toStringTag, { value: 'Crypto', configurable: true });
  // named as the engine's, whatever the bundler calls it (structuredClone refuses "A Crypto")
  Object.defineProperty(Crypto, 'name', { value: 'Crypto', configurable: true });
  Object.defineProperty(scope, 'crypto', { value: new Crypto(), writable: true, configurable: true, enumerable: true });
}

/** A language as browsers give it, language-REGION, as the engine gives the system's: zh-Hans-CN is zh-CN */
function webLanguage(tag: string): string {
  const parts = tag.split('_').join('-').split('-');
  const language = parts[0].toLowerCase();
  let script = '';
  let region = '';
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.length === 1) break;
    if (i === 1 && part.length === 4) script = part.toLowerCase();
    else if (!region && (part.length === 2 || (part.length === 3 && !Number.isNaN(Number(part))))) region = part.toUpperCase();
  }
  if (language === 'zh' && !region) region = script === 'hant' ? 'TW' : 'CN';
  return region ? `${language}-${region}` : language;
}

/** The engine's navigator: what libraries read about the device, nothing of a browser's */
function installNavigator(locale: unknown): void {
  const browser = scope.navigator;
  const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DesktopEngine';
  const first = typeof locale === 'string' && locale ? locale : browser.language;
  const languages = Object.freeze([...new Set([first, ...browser.languages].map(webLanguage))]);
  const hardwareConcurrency = browser.hardwareConcurrency || 1;
  class Navigator {
    get userAgent() { return userAgent; }
    get appVersion() { return userAgent.slice(8); }
    get platform() { return 'MacIntel'; }
    get language() { return languages[0]; }
    get languages() { return languages; }
    get hardwareConcurrency() { return hardwareConcurrency; }
    get maxTouchPoints() { return 0; }
  }
  Object.defineProperty(Navigator.prototype, Symbol.toStringTag, { value: 'Navigator', configurable: true });
  Object.defineProperty(Navigator, 'name', { value: 'Navigator', configurable: true });
  Object.defineProperty(scope, 'navigator', { value: new Navigator(), writable: true, configurable: true, enumerable: true });
}

function installConsole(): void {
  const original = scope.console;
  const forward = (level: 'log' | 'info' | 'warn' | 'error' | 'debug') => (...values: unknown[]) => {
    apply(original[level], original, values);
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
    const items = objectValues(value);
    for (let index = 0; index < items.length; index++) deepFreeze(items[index]);
    freeze(value);
  }
  return value;
}

let parameters: Record<string, ParameterValue> = {};

/**
 * As the app does it when the parameters change: DesktopEngine.launchOptions becomes a new frozen object, with what the
 * one it had has and the new parameters
 */
function updateLaunchOptions(): void {
  const desktopEngine = scope.DesktopEngine as unknown as Record<string, unknown> | undefined;
  if (typeof desktopEngine !== 'object' || desktopEngine === null) return;
  const current = (desktopEngine.launchOptions ?? {}) as Record<string, unknown>;
  const updated: Record<string, unknown> = {};
  const keys = objectKeys(current);
  for (let index = 0; index < keys.length; index++) updated[keys[index]] = current[keys[index]];
  updated.parameters = parameters;
  freeze(updated);
  try {
    defineProperty(desktopEngine, 'launchOptions', descriptor({ value: updated, enumerable: true, configurable: true }));
  } catch {
    try {
      desktopEngine.launchOptions = updated;
    } catch {
      // the content made it read-only
    }
  }
}

function createGlobal(launch: LaunchMessage): Record<string, unknown> {
  parameters = deepFreeze({ ...((launch.options.parameters as Record<string, ParameterValue>) ?? {}) });
  // a frozen object, as the app's (a new one when the parameters change, see updateLaunchOptions)
  const options = deepFreeze({ ...launch.options, parameters });

  const fs = createFileSystem();
  const utils = {
    applyNew(constructor: unknown, args: unknown) {
      if (arguments.length !== 2) return null;
      if (typeof constructor !== 'function') throw new TypeError('applyNew needs a constructor');
      if (!args || typeof args !== 'object') throw new TypeError('applyNew needs an array of arguments');
      return Reflect.construct(constructor, Array.from(args as ArrayLike<unknown>));
    },
    setTimeout: timerFunctions.setTimeout,
    setInterval: timerFunctions.setInterval,
    clearTimeout: timerFunctions.clearTimeout,
    clearInterval: timerFunctions.clearInterval,
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

  // as the app's, bound functions of native ones
  for (const name of ['applyNew', 'base64Encode', 'base64Decode'] as const) bound(name, utils[name]);
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
    input,
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
  // a getter, as the app's polyfill has it
  const syncStorage = createSyncStorage();
  Object.defineProperty(desktopEngine, 'syncStorage', { get: () => syncStorage, enumerable: true, configurable: true });
  // as the app's polyfills: made the first time they're read, null when the constructor refuses (without the
  // permission); content may construct the one there is first (settleSingleton)
  for (const [key, make] of [['systemAudio', () => new SystemAudioImpl()], ['systemStatus', () => new SystemStatusImpl()], ['windows', () => new WindowsImpl()]] as const) {
    let made: Evented | null | undefined;
    Object.defineProperty(desktopEngine, key, {
      get: () => {
        if (made === undefined) {
          try {
            made = make();
          } catch {
            made = null;
          }
        }
        return made;
      },
      enumerable: true,
      configurable: true,
    });
  }
  // never set here: there are no dropped files (and no drops)
  Object.defineProperty(desktopEngine, 'files', { get: () => null, enumerable: true, configurable: true });
  Object.defineProperty(desktopEngine, 'fonts', { value: frameFonts().fonts, enumerable: true });
  // in the order the app's has its properties (Object.keys, for-in, JSON.stringify and structuredClone go by it)
  const ordered: Record<string, unknown> = {};
  for (const key of [...DESKTOP_ENGINE_ORDER, ...Object.keys(desktopEngine)]) {
    const descriptor = Object.getOwnPropertyDescriptor(desktopEngine, key);
    if (descriptor && !Object.prototype.hasOwnProperty.call(ordered, key)) Object.defineProperty(ordered, key, descriptor);
  }
  return ordered;
}

/** The order of the properties of the app's DesktopEngine */
const DESKTOP_ENGINE_ORDER = [
  'setTimeout', 'clearTimeout', 'base64Encode', 'clearInterval', 'base64Decode', 'applyNew', 'setInterval', 'preferredFramesPerSecond',
  'Canvas', 'WebGLRenderingContext', 'WebGL2RenderingContext', 'CanvasImage', 'Component', 'fs', 'files', 'fonts', 'Image', 'input',
  'ScreenManager', 'syncStorage', 'system', 'systemAudio', 'systemStatus', 'Video', 'Window', 'windows', 'apiVersion', 'launchOptions',
];

// MARK: Launch

// `performance` is a native object in the engine, refused as the runtime's other stand-ins are (see stand-ins.ts; the
// Storage class is the engine's global, see installStorage)
standIn(scope.performance);
const channels = createChannels({ send, namespaceChannels: () => state.launch?.namespaceChannels === true });
// the engine's structuredClone, MessageChannel and MessagePort: its messages come on the content's timers
const messaging = createMessaging({ setTimeout });

/** The content's timer functions, named and of the length of the engine's (bound functions of native ones) */
function bound<T extends (...args: never[]) => unknown>(name: string, action: T): T {
  Object.defineProperty(action, 'name', { value: `bound ${name}`, configurable: true });
  Object.defineProperty(action, 'length', { value: 0, configurable: true });
  return action;
}
/** FontFace, FontFaceSet and DesktopEngine.fonts, made once at launch */
let madeFonts: ReturnType<typeof createFrameFonts> | null = null;
const frameFonts = (): ReturnType<typeof createFrameFonts> => (madeFonts ??= createFrameFonts(fileBytes, setTimeout));

const timerFunctions = {
  setTimeout: bound('setTimeout', setTimeout),
  setInterval: bound('setInterval', setInterval),
  clearTimeout: bound('clearTimeout', (id: unknown) => clearTimer(id)),
  clearInterval: bound('clearInterval', (id: unknown) => clearTimer(id)),
  requestAnimationFrame: bound('requestAnimationFrame', requestAnimationFrame),
  cancelAnimationFrame: bound('cancelAnimationFrame', cancelAnimationFrame),
};

function launch(message: LaunchMessage): void {
  if (state.launch) return;
  state.launch = message;
  state.screens = message.screens;
  state.appearance = message.appearance;
  state.muted = message.muted;
  state.hostMaxFramesPerSecond = message.maxFramesPerSecond;
  if (hasPermission('window-positions')) appWindows = readAppWindows(message.appWindows);
  if (hasPermission('system-info')) pageStatus = readSystemStatus(message.systemStatus);
  loadPackage(message.files, message.code);
  installNetwork(scope);
  installStorage(scope);
  installAudio();
  if (hasPermission('audio')) installPointerInput();
  installCrypto();
  installNavigator(message.options.locale);
  // WebAssembly as JavaScript engines have it (the JS API), without what browsers add for their Response: the engine has no streaming
  // compilation, content compiles what it has read (WebAssembly.instantiate(await response.arrayBuffer()))
  for (const name of ['instantiateStreaming', 'compileStreaming']) reflectDelete(scope.WebAssembly, name);
  // createImageBitmap as the engine makes bitmaps, of the engine's canvases and images too
  Object.defineProperty(scope, 'createImageBitmap', {
    value: createImageBitmapFunction(scope.createImageBitmap.bind(scope), unwrap),
    writable: true, configurable: true, enumerable: true,
  });
  // the engine's structuredClone, MessageChannel, MessagePort and MessageEvent rather than the browser's, and its
  // BroadcastChannel, through the host (the browser's reaches nothing from an opaque origin); not enumerable, as the
  // engine's
  const { structuredClone, MessageChannel, MessagePort } = messaging;
  for (const [name, value] of Object.entries({ structuredClone, MessageChannel, MessagePort, BroadcastChannel: channels.BroadcastChannel })) {
    Object.defineProperty(scope, name, { value, writable: true, configurable: true, enumerable: false });
  }
  installMessageEvent(scope);
  // the engine's FontFace, FontFaceSet and FontFaceSetLoadEvent rather than the browser's (whose sources and set are the
  // frame document's); not enumerable, as the engine's
  const { FontFace, FontFaceSet, FontFaceSetLoadEvent } = frameFonts();
  for (const [name, value] of Object.entries({ FontFace, FontFaceSet, FontFaceSetLoadEvent })) {
    Object.defineProperty(scope, name, { value, writable: true, configurable: true, enumerable: false });
  }
  // the engine's Path2D, around the browser's (which the 2D contexts draw)
  Object.defineProperty(scope, 'Path2D', { value: createPath2D(scope.Path2D), writable: true, configurable: true, enumerable: true });
  installConsole();

  const desktopEngine = createGlobal(message);
  // as the app's, whose members aren't enumerable: Object.keys gives none, structuredClone an empty object
  const runtimeScope: Record<string, unknown> = {};
  for (const [name, value] of Object.entries({
    Window: WindowImpl, Component: ComponentImpl, Video: VideoImpl, Image: ImageImpl, Canvas: CanvasImpl, CanvasImage: CanvasImageImpl,
    ScreenManager: ScreenManagerImpl, System: SystemImpl, Input: InputImpl,
    // one each, as in the app: content may make it before DesktopEngine.systemAudio, .systemStatus or .windows does
    SystemAudio: named(SystemAudioImpl, 'SystemAudio'), SystemStatus: named(SystemStatusImpl, 'SystemStatus'), Windows: named(WindowsImpl, 'Windows'),
  })) {
    engineConstructor(value);
    Object.defineProperty(runtimeScope, name, { get: () => value });
  }
  // the app's singletons, made by DesktopEngine's globals: there's no second one
  for (const name of ['AnimationFrameManager', 'FileSystem', 'LocalStorage', 'SyncStorage', 'Network', 'Audio', 'Fonts']) {
    Object.defineProperty(runtimeScope, name, { value: undefined, writable: true, configurable: true });
  }
  const coreScope = Object.defineProperties({}, {
    Utils: { value: undefined, writable: true, configurable: true },
    Performance: { value: undefined, writable: true, configurable: true },
  });

  Object.assign(scope, {
    DesktopEngine: desktopEngine,
    DesktopEngineCore: coreScope,
    DesktopEngineRuntime: runtimeScope,
    ...timerFunctions,
    require: (id: string) => requireFrom('/', id, {}),
  });
  // the engine's global postMessage(name, message): 'host' reaches the app, here the page
  scope.postMessage = ((name: unknown, payload?: unknown) => {
    if (name === 'host') send({ type: 'host-message', message: parse(stringify(payload ?? null)) });
  }) as typeof scope.postMessage;
  // of the length the engine's is (and anonymous, as it is)
  Object.defineProperty(scope.postMessage, 'length', { value: 0, configurable: true });

  scope.addEventListener('error', (event) => report(event.error ?? event.message));
  // described by report, which never throws, even for a reason without a string form
  scope.addEventListener('unhandledrejection', (event) => report(event.reason, 'Unhandled promise rejection: '));

  startStats();
  guard(() => {
    contentFunction(message.code, `desktopengine:///${encodeURIComponent(message.name)}/index.js`)();
  });
  send({ type: 'launched' });
}

// MARK: The pointer

let hovered = list<ComponentImpl>();
let pressed: { chain: ComponentImpl[]; x: number; y: number; moved: boolean } | null = null;
let lastClick = { time: 0, x: 0, y: 0, target: null as ComponentImpl | null };

/** The components under a point of a window, the deepest first, up to the window */
function chainAt(win: WindowImpl, x: number, y: number): ComponentImpl[] {
  const element = document.elementFromPoint(x, y);
  let component: ComponentImpl | null = null;
  for (let node: Element | null = element; node && !component; node = node.parentElement) {
    component = (apply(weakMapGet, componentOf, [node]) as ComponentImpl | undefined) ?? null;
  }
  if (!component || component.rootWindow !== win) component = win;
  const chain = list<ComponentImpl>();
  for (let node: ComponentImpl | null = component; node; node = node.parent) chain[chain.length] = node;
  return chain;
}

/** As in the app: like the DOM's MouseEvent, with the button that went down or up and the ones held after */
function mousePayload(component: ComponentImpl, message: Extract<HostMessage, { type: 'pointer' }>, button = 0): Record<string, unknown> {
  return {
    ...component.localPoint(message.x, message.y),
    ctrlKey: message.ctrlKey,
    altKey: message.altKey,
    metaKey: message.metaKey,
    shiftKey: message.shiftKey,
    button,
    buttons: toNumber(message.buttons) || 0,
  };
}

function click(chain: ComponentImpl[], message: Extract<HostMessage, { type: 'pointer' }>): void {
  const time = now();
  const double = time - lastClick.time < 400 && hypot(message.x - lastClick.x, message.y - lastClick.y) < 5 && lastClick.target === chain[0];
  lastClick = { time: double ? 0 : time, x: message.x, y: message.y, target: chain[0] };
  for (let index = 0; index < chain.length; index++) {
    chain[index].emit(double ? 'dblclick' : 'click', mousePayload(chain[index], message));
  }
}

function pointer(message: Extract<HostMessage, { type: 'pointer' }>): void {
  const win = message.window ? windowById(message.window) : undefined;
  // each component told in turn, as the list was when the pointer moved
  const tell = (components: ComponentImpl[], name: string, button?: number, unless?: ComponentImpl[]) => {
    for (let index = 0; index < components.length; index++) {
      const component = components[index];
      if (!unless || !contains(unless, component)) component.emit(name, mousePayload(component, message, button));
    }
  };
  if (message.kind === 'leave' || !win) {
    tell(hovered, 'mouseleave');
    hovered = list();
    return;
  }
  const chain = chainAt(win, message.x, message.y);
  switch (message.kind) {
    case 'move': {
      tell(hovered, 'mouseleave', undefined, chain);
      tell(chain, 'mouseenter', undefined, hovered);
      hovered = chain;
      // while pressed, the components the press began on follow the pointer (mouseDragged goes up the views)
      const targets = pressed ? pressed.chain : chain;
      if (pressed && hypot(message.x - pressed.x, message.y - pressed.y) > 3) pressed.moved = true;
      tell(targets, 'mousemove');
      break;
    }
    case 'down':
      pressed = { chain, x: message.x, y: message.y, moved: false };
      tell(chain, 'mousedown', message.button);
      break;
    case 'up': {
      const press = pressed;
      pressed = null;
      tell(press?.chain ?? chain, 'mouseup', message.button);
      // only the primary button clicks
      if (press && !press.moved && message.button === 0) click(chain, message);
      break;
    }
    case 'click':
      click(chain, message);
      break;
    case 'wheel': {
      // the host sends it only over a widget's or companion's window, where it takes the mouse; up the components as
      // the views pass it on, with NSEvent's deltas
      const deltaX = toNumber(message.deltaX) || 0;
      const deltaY = toNumber(message.deltaY) || 0;
      for (let index = 0; index < chain.length; index++) chain[index].emit('wheel', { deltaX, deltaY, deltaZ: 0 });
      break;
    }
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
    case 'global-mouse':
      if (state.launch) globalMouse(message);
      break;
    case 'key-activity':
      if (state.launch?.keyActivity) input.emit('keyactivity', { count: max(1, floor(toNumber(message.count) || 0)) });
      break;
    case 'system-audio':
      pageSystemAudio(message);
      break;
    case 'app-windows':
      if (state.launch) updateAppWindows(message.windows);
      break;
    case 'system-status':
      if (state.launch) pageSystemStatus(message.reading);
      break;
    case 'cursor':
      document.documentElement.style.cursor = toText(message.cursor);
      break;
    case 'move-window':
      windowById(message.window)?.moveTo(message.x, message.y, message.dragging === true);
      break;
    case 'resize-window': {
      const finite = (value: unknown) => typeof value === 'number' && isFinite(value);
      if (!finite(message.x) || !finite(message.y) || !finite(message.width) || !finite(message.height)) break;
      windowById(message.window)?.resizeTo({ x: message.x, y: message.y, width: message.width, height: message.height });
      break;
    }
    case 'measure-corner': {
      const win = windowById(message.window);
      if (win) send({ type: 'window-corner', window: message.window, shape: windowCorner(win, message.body) });
      break;
    }
    case 'appearance':
      if (message.appearance === state.appearance) break;
      state.appearance = message.appearance;
      system.emit('appearancechange', { appearance: state.appearance });
      break;
    case 'parameters': {
      parameters = deepFreeze({ ...message.parameters });
      updateLaunchOptions();
      const handled = system.listens('parameterschange');
      if (handled) {
        const changed: string[] = [];
        for (let index = 0; index < message.changed.length; index++) changed[index] = message.changed[index];
        system.emit('parameterschange', { parameters, changed });
      }
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
      const wasSuspended = state.suspended;
      state.suspended = message.suspended;
      state.renderingPaused = message.renderingPaused;
      state.muted = message.muted;
      state.hostMaxFramesPerSecond = message.maxFramesPerSecond;
      const visible = !state.suspended && !state.renderingPaused;
      if (visible !== wasVisible) {
        const shown = allWindows();
        for (let index = 0; index < shown.length; index++) shown[index].visibilityChanged(visible);
      }
      const videos = allVideos();
      for (let index = 0; index < videos.length; index++) videos[index].suspend(state.suspended);
      applyAudio();
      // the suspension's reason noted from its start, `resume` once it's over (after the rest is handled)
      if (state.launch && (state.suspended || wasSuspended)) statusSuspended(state.suspended, readSuspendReason(message.suspendReason));
      break;
    }
    case 'broadcast':
      if (state.launch) channels.receive(message);
      break;
    case 'stop': {
      const made = allWindows();
      for (let index = 0; index < made.length; index++) made[index].destroy();
      const contexts = itemsOf(audioContexts);
      for (let index = 0; index < contexts.length; index++) ignoreFailure(contexts[index].context.close());
      break;
    }
  }
});

send({ type: 'ready' });
