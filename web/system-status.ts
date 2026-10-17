// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// DesktopEngine.systemStatus on the web. A browser can't see the Mac: the page makes up one system status for all its
// contents (SystemStatusSimulation), a new reading about once a second, with values that move as a Mac's do, and lets
// the page set any of them (SystemStatusOverrides) to try a widget in every state. The frame reads the page's readings
// as the app's (readSystemStatus) and tells the content what changed as the app does (systemStatusChanges).

import type { MemoryPressure, NetworkInterface, SuspendReason, SystemStatusOverrides, SystemStatusReading, ThermalState } from './protocol.ts';

// taken before a content runs in the frame, whose realm this module shares: the page's readings are read whatever the
// content did to Array and Number
const { isArray } = Array;
const { isFinite } = Number;
const { setPrototypeOf } = Object;
const dateNow = Date.now;
/** An array without a prototype, filled by index: nothing the content put on Array.prototype is used */
const list = <T>(): T[] => setPrototypeOf([], null) as T[];

const THERMAL_STATES: readonly string[] = ['nominal', 'fair', 'serious', 'critical'];
const MEMORY_PRESSURES: readonly string[] = ['normal', 'warning', 'critical'];
const INTERFACES: readonly string[] = ['wifi', 'ethernet', 'cellular', 'other'];
const REASONS: readonly string[] = ['paused', 'displaysleep', 'sleep'];

const oneOf = <T extends string>(value: unknown, values: readonly string[], fallback: T): T => {
  for (let index = 0; index < values.length; index++) if (values[index] === value) return value as T;
  return fallback;
};
const finite = (value: unknown, fallback = 0): number => (typeof value === 'number' && isFinite(value) ? value : fallback);
const share = (value: unknown): number => {
  const number = finite(value);
  return number < 0 ? 0 : number > 1 ? 1 : number;
};
const bytes = (value: unknown): number => {
  const number = finite(value);
  return number < 0 ? 0 : number;
};
const finiteOrNull = (value: unknown): number | null => (typeof value === 'number' && isFinite(value) ? value : null);
const object = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? value as Record<string, unknown> : {});

/** Of two reasons for a suspension, the one `resume` tells: the Mac sleeping, else its displays, else a pause */
export function strongerReason(reason: SuspendReason, other: SuspendReason | null | undefined): SuspendReason {
  if (!other) return reason;
  let rank = 0;
  let otherRank = 0;
  for (let index = 0; index < REASONS.length; index++) {
    if (REASONS[index] === reason) rank = index;
    if (REASONS[index] === other) otherRank = index;
  }
  return otherRank > rank ? other : reason;
}

/** A reason of the page's message, 'paused' for anything else */
export function readSuspendReason(value: unknown): SuspendReason {
  return oneOf<SuspendReason>(value, REASONS, 'paused');
}

/** A reading of the page's messages as the frame takes it: every field of its type, in range; null for no reading */
export function readSystemStatus(value: unknown): SystemStatusReading | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const cpu = object(raw.cpu);
  const rawCores = isArray(cpu.cores) ? cpu.cores as unknown[] : [];
  const cores = list<{ usage: number; efficiency: boolean }>();
  for (let index = 0; index < rawCores.length && index < 256; index++) {
    const core = object(rawCores[index]);
    cores[index] = { usage: share(core.usage), efficiency: core.efficiency === true };
  }
  const memory = object(raw.memory);
  const network = object(raw.network);
  const online = network.online === true;
  const power = object(raw.power);
  const battery = typeof power.battery === 'object' && power.battery !== null ? power.battery as Record<string, unknown> : null;
  const disk = object(raw.disk);
  return {
    cpu: { usage: share(cpu.usage), cores },
    memory: {
      total: bytes(memory.total),
      used: bytes(memory.used),
      app: bytes(memory.app),
      wired: bytes(memory.wired),
      compressed: bytes(memory.compressed),
      cached: bytes(memory.cached),
      swapUsed: bytes(memory.swapUsed),
      pressure: oneOf<MemoryPressure>(memory.pressure, MEMORY_PRESSURES, 'normal'),
      swapping: memory.swapping === true,
    },
    network: {
      online,
      interface: online ? oneOf<NetworkInterface>(network.interface, INTERFACES, 'other') : null,
      expensive: online && network.expensive === true,
      receivedPerSecond: bytes(network.receivedPerSecond),
      sentPerSecond: bytes(network.sentPerSecond),
      received: bytes(network.received),
      sent: bytes(network.sent),
    },
    power: {
      source: power.source === 'battery' && battery ? 'battery' : 'ac',
      battery: battery && {
        level: share(battery.level),
        charging: battery.charging === true,
        full: battery.full === true,
        timeToEmpty: finiteOrNull(battery.timeToEmpty),
        timeToFull: finiteOrNull(battery.timeToFull),
      },
      adapterWatts: finiteOrNull(power.adapterWatts),
      systemWatts: finiteOrNull(power.systemWatts),
      lowPowerMode: power.lowPowerMode === true,
    },
    thermal: oneOf<ThermalState>(raw.thermal, THERMAL_STATES, 'nominal'),
    temperature: finiteOrNull(raw.temperature),
    disk: { total: bytes(disk.total), available: bytes(disk.available) },
    bootTime: finite(raw.bootTime),
  };
}

/**
 * The events beside `change` a new reading brings, as the app fires them, in this order: powerchange (the source, the
 * battery there or not, charging, full, Low Power Mode), thermalchange, networkchange (online, the interface,
 * expensive), memorypressurechange
 */
export function systemStatusChanges(previous: SystemStatusReading, next: SystemStatusReading): string[] {
  const changes = list<string>();
  const was = previous.power;
  const now = next.power;
  if (was.source !== now.source || (was.battery === null) !== (now.battery === null) || was.battery?.charging !== now.battery?.charging
    || was.battery?.full !== now.battery?.full || was.lowPowerMode !== now.lowPowerMode) changes[changes.length] = 'powerchange';
  if (previous.thermal !== next.thermal) changes[changes.length] = 'thermalchange';
  if (previous.network.online !== next.network.online || previous.network.interface !== next.network.interface
    || previous.network.expensive !== next.network.expensive) changes[changes.length] = 'networkchange';
  if (previous.memory.pressure !== next.memory.pressure) changes[changes.length] = 'memorypressurechange';
  return changes;
}

// MARK: The page's simulation

const GIB = 1024 ** 3;
/** Memory comes in pages */
const PAGE = 16384;
const pages = (size: number): number => Math.round(size / PAGE) * PAGE;
/** A Mac with 2 efficiency cores and 8 performance cores, 16 GB of memory and a 1 TB disk */
const EFFICIENCY_CORES = 2;
const PERFORMANCE_CORES = 8;
const MEMORY = 16 * GIB;
/** To a gigabyte (10^9 bytes), as the app tells it */
const DISK = 995_000_000_000;
/** What the power adapter gives a MacBook */
const ADAPTER_WATTS = 96;
/** How long macOS takes to estimate the time to empty or to full after the power source changes, ms (shortened) */
const ESTIMATING = 15_000;
/** The processor's temperature, °C: idle, and what all of the processor at work adds */
const IDLE_TEMPERATURE = 44;
const WORKING_TEMPERATURE = 52;
/** How quickly the temperature follows the work: about this many seconds to get most of the way */
const HEATING = 6;
/** At least this hot while macOS says the heat slows the Mac down */
const THROTTLED_TEMPERATURE: Record<string, number> = { serious: 94, critical: 102 };

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/**
 * One made-up system status for all of a page's contents: a reading on each `sample()`, moving with the time since the
 * last one, under the page's overrides
 */
export class SystemStatusSimulation {
  overrides: SystemStatusOverrides = {};
  private readonly bootTime: number;
  private readonly phases: number[];
  private last: SystemStatusReading | null = null;
  private lastTime = 0;
  /** A burst of work on some performance cores, and of traffic: ticks left and how strong */
  private cpuBurst = { ticks: 0, strength: 0, cores: 0 };
  private trafficBurst = { ticks: 0, received: 0, sent: 0 };
  private received = 18_400_000_000 + Math.round(Math.random() * 4_000_000_000);
  private sent = 2_100_000_000 + Math.round(Math.random() * 600_000_000);
  private available = 312_400_000_000 + Math.round(Math.random() * 2_000_000_000);
  private level = 0.76;
  /** The processor's temperature, °C, following the work */
  private heat = IDLE_TEMPERATURE + 6;
  private source: 'battery' | 'ac' = 'battery';
  /** When the power source last changed (performance.now()), for the estimates: long ago at first */
  private sourceChanged = -Infinity;

  constructor() {
    // up three days and some hours, to the minute as the app tells it
    this.bootTime = Math.round((Date.now() - (3 * 24 + 7 + Math.random() * 5) * 3600_000) / 60_000) * 60_000;
    this.phases = [];
    for (let index = 0; index < EFFICIENCY_CORES + PERFORMANCE_CORES; index++) {
      this.phases.push(Math.random() * Math.PI * 2);
    }
  }

  /** The last reading, or a first one */
  get current(): SystemStatusReading {
    return this.last ?? this.sample();
  }

  /** A reading of now: the last one if it's from the last moment (several contents asking at once), else a new one */
  fresh(time = performance.now()): SystemStatusReading {
    return this.last && time - this.lastTime < 250 ? this.last : this.sample(time);
  }

  /** A new reading, moved on by the time since the last one */
  sample(time = performance.now()): SystemStatusReading {
    const seconds = this.last ? clamp((time - this.lastTime) / 1000, 0, 3600) : 1;
    this.lastTime = time;
    const overrides = this.overrides;
    const t = time / 1000;

    // the processor: efficiency cores busy with the background, performance cores mostly idle, with bursts
    if (this.cpuBurst.ticks > 0) this.cpuBurst.ticks -= 1;
    else if (Math.random() < 0.05) this.cpuBurst = { ticks: 2 + Math.floor(Math.random() * 5), strength: 0.4 + Math.random() * 0.55, cores: 1 + Math.floor(Math.random() * PERFORMANCE_CORES) };
    const cores: { usage: number; efficiency: boolean }[] = [];
    let total = 0;
    for (let index = 0; index < EFFICIENCY_CORES + PERFORMANCE_CORES; index++) {
      const efficiency = index < EFFICIENCY_CORES;
      const wave = Math.sin(t / (efficiency ? 9 : 13) + this.phases[index]);
      let usage = efficiency ? 0.32 + 0.14 * wave + 0.1 * Math.random() : 0.05 + 0.04 * wave + 0.05 * Math.random();
      if (!efficiency && this.cpuBurst.ticks > 0 && index - EFFICIENCY_CORES < this.cpuBurst.cores) usage += this.cpuBurst.strength * (0.8 + 0.2 * Math.random());
      usage = clamp(usage, 0, 1);
      cores.push({ usage, efficiency });
      total += usage;
    }
    const cpuUsage = total / cores.length;

    // memory, as Activity Monitor's Memory tab shows it
    const pressure = overrides.memoryPressure ?? 'normal';
    const squeeze = pressure === 'critical' ? 2 : pressure === 'warning' ? 1 : 0;
    const app = pages(([7.1, 10.4, 11.6][squeeze] + 0.5 * Math.sin(t / 40) + 0.08 * Math.random()) * GIB);
    const wired = pages((2.2 + 0.1 * Math.sin(t / 70)) * GIB);
    const compressed = pages(([0.8, 2.4, 3.1][squeeze] + 0.1 * Math.sin(t / 55)) * GIB);
    const cached = pages(Math.max(0.2, Math.min([4.2, 0.9, 0.3][squeeze] + 0.3 * Math.sin(t / 33), (MEMORY - app - wired - compressed) / GIB - 0.1)) * GIB);

    // the network: a trickle, with bursts (a download, a video)
    const online = overrides.online ?? true;
    if (this.trafficBurst.ticks > 0) this.trafficBurst.ticks -= 1;
    else if (Math.random() < 0.06) this.trafficBurst = { ticks: 3 + Math.floor(Math.random() * 8), received: 1e6 + Math.random() * 11e6, sent: 5e4 + Math.random() * 4.5e5 };
    const burst = this.trafficBurst.ticks > 0;
    const receivedPerSecond = online ? Math.round((burst ? this.trafficBurst.received * (0.7 + 0.3 * Math.random()) : 2e3 + Math.random() * 38e3)) : 0;
    const sentPerSecond = online ? Math.round((burst ? this.trafficBurst.sent * (0.7 + 0.3 * Math.random()) : 1e3 + Math.random() * 9e3)) : 0;
    this.received += Math.round(receivedPerSecond * seconds);
    this.sent += Math.round(sentPerSecond * seconds);

    // power: a MacBook on battery by default
    const mode = overrides.power ?? 'battery';
    const source = mode === 'battery' ? 'battery' : 'ac';
    if (source !== this.source) {
      this.source = source;
      this.sourceChanged = time;
    }
    const estimating = time - this.sourceChanged < ESTIMATING;
    const drainPerHour = 0.08 + 0.2 * cpuUsage;
    const chargePerHour = 0.9;
    if (mode === 'battery') this.level = Math.max(0.03, this.level - drainPerHour * seconds / 3600);
    else if (mode === 'ac') this.level = Math.min(1, this.level + chargePerHour * seconds / 3600);
    else if (mode === 'full') this.level = 1;
    // in whole percent, as macOS gives it
    const level = overrides.batteryLevel === undefined ? Math.round(this.level * 100) / 100 : clamp(overrides.batteryLevel, 0, 1);
    const charging = mode === 'ac' && level < 1;
    const battery = mode === 'none' ? null : {
      level,
      charging,
      full: mode === 'full' || (mode === 'ac' && !charging),
      timeToEmpty: mode === 'battery' && !estimating ? Math.round(level / drainPerHour * 60) : null,
      timeToFull: charging && !estimating ? Math.max(1, Math.round((1 - level) / chargePerHour * 60)) : null,
    };
    const drawn = clamp(4.5 + 24 * cpuUsage + (charging ? 8 : 0) + 1.5 * Math.random(), 5, 30);
    const systemWatts = overrides.systemWatts === undefined ? Math.round(drawn * 10) / 10 : overrides.systemWatts;

    // the processor's temperature: heats up with the work and cools down after, never at once
    const thermal = overrides.thermal ?? 'nominal';
    const target = Math.max(IDLE_TEMPERATURE + WORKING_TEMPERATURE * Math.min(1, cpuUsage * 1.6), THROTTLED_TEMPERATURE[thermal] ?? 0);
    this.heat += (target - this.heat) * (1 - Math.exp(-seconds / HEATING));
    const temperature = overrides.temperature === undefined ? Math.round((this.heat + 0.4 * (Math.random() - 0.5)) * 10) / 10 : overrides.temperature;

    // the disk: a little written and deleted all the time
    this.available = clamp(this.available + Math.round((Math.random() - 0.52) * 40_000_000 * seconds), 0, DISK);

    this.last = {
      cpu: { usage: cpuUsage, cores },
      memory: { total: MEMORY, used: app + wired + compressed, app, wired, compressed, cached, swapUsed: pages([0.3, 2.1, 6.4][squeeze] * GIB), pressure, swapping: overrides.swapping ?? false },
      network: {
        online,
        interface: online ? overrides.networkInterface ?? 'wifi' : null,
        expensive: online && (overrides.expensive ?? false),
        receivedPerSecond,
        sentPerSecond,
        received: this.received,
        sent: this.sent,
      },
      power: {
        source,
        battery,
        adapterWatts: source === 'ac' && battery ? ADAPTER_WATTS : null,
        systemWatts,
        lowPowerMode: overrides.lowPowerMode ?? false,
      },
      thermal,
      temperature,
      disk: { total: DISK, available: this.available },
      bootTime: this.bootTime,
    };
    return this.last;
  }
}

/** A reading for a frame whose page sent none (a page of an older SDK) */
export function restingSystemStatus(): SystemStatusReading {
  const cores = list<{ usage: number; efficiency: boolean }>();
  for (let index = 0; index < EFFICIENCY_CORES + PERFORMANCE_CORES; index++) {
    const efficiency = index < EFFICIENCY_CORES;
    cores[index] = { usage: efficiency ? 0.3 : 0.05, efficiency };
  }
  return {
    cpu: { usage: 0.1, cores },
    memory: { total: MEMORY, used: 10 * GIB, app: 7 * GIB, wired: 2 * GIB, compressed: GIB, cached: 4 * GIB, swapUsed: 0, pressure: 'normal', swapping: false },
    network: { online: true, interface: 'wifi', expensive: false, receivedPerSecond: 0, sentPerSecond: 0, received: 0, sent: 0 },
    power: { source: 'ac', battery: null, adapterWatts: null, systemWatts: null, lowPowerMode: false },
    thermal: 'nominal',
    temperature: null,
    disk: { total: DISK, available: 300_000_000_000 },
    // a day ago, to the minute
    bootTime: dateNow() - 86_400_000 - (dateNow() % 60_000),
  };
}
