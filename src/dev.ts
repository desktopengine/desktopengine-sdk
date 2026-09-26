// DesktopEngine SDK
// Copyright © 2024 senpng. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// `desktopengine dev`: serves the project to DesktopEngine and prints what the mini program logs.
//
// 1. builds the package and serves it on 127.0.0.1 with a random token
// 2. opens desktopengine://develop/connect?port=…&token=…, the app connects back with a WebSocket
// 3. sends `load`, the app downloads /package.zip and runs it with the launch options asked for
// 4. rebuilds and sends `load` again when a file changes
//
// The messages are described in docs/dev-protocol.md.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { WIDGET_SIZES, isOneOf } from './manifest.ts';
import type { Manifest, Parameter, Scalar, WidgetSize } from './manifest.ts';
import { buildProject } from './build.ts';
import { zipPackage } from './project.ts';
import { affectsPackage } from './files.ts';
import { acceptUpgrade } from './websocket.ts';
import type { WebSocketConnection } from './websocket.ts';

const LEVELS = ['desktop', 'floating'] as const;
const REBUILD_DELAY = 150;

export type WindowLevel = (typeof LEVELS)[number];

/** The `launch` of a `load` message, `DevelopSession.LaunchRequest` in the app. */
export interface LaunchRequest {
  size?: WidgetSize;
  level?: WindowLevel;
  /** 1-based index into the displays */
  display?: number;
  position?: { x: number; y: number };
  parameters?: Record<string, Scalar>;
}

/** Messages sent to the app. */
export type ServerMessage =
  | { type: 'load'; revision: number; url: string; launch: LaunchRequest }
  | { type: 'stop' }
  | { type: 'metrics'; enabled: boolean };

/** About a second of the running mini program, see docs/dev-protocol.md. */
export interface Metrics {
  type: 'metrics';
  state: 'running' | 'rendering-paused' | 'suspended';
  /** frames that showed something new, per second */
  fps: number;
  targetFps: number;
  /** milliseconds */
  frameTime: number;
  maxFrameTime: number;
  slowFrames: number;
  /** percent of a CPU core, the mini program's thread */
  cpu: number;
  /** per second */
  wakeUps: number;
  /** bytes of the JavaScript heap, not measured by Mac App Store builds of the app */
  jsMemory?: number;
  /** bytes the canvases hold to draw; missing from older apps */
  canvasMemory?: number;
}

/** Messages the app sends. */
export type AppMessage =
  | { type: 'hello'; app: string; apiVersion: number }
  | { type: 'loaded'; revision: number; id: string; name: string; version: string; contentType?: string; launchOptions?: Record<string, unknown> }
  | { type: 'load-failed'; revision: number; message: string }
  | { type: 'console'; level: 'log' | 'info' | 'warn' | 'error' | 'debug'; message: string }
  | { type: 'exception'; message: string; stack?: string }
  | { type: 'host'; message: unknown }
  | { type: 'stopped' }
  | Metrics;

export interface LaunchFlags {
  size?: string;
  level?: string;
  display?: string | number;
  position?: string;
  params?: string[];
}

/** Turns command line options into the `launch` of a `load` message. */
export function launchRequest(manifest: Manifest, options: LaunchFlags = {}): { launch: LaunchRequest; warnings: string[] } {
  const launch: LaunchRequest = {};
  const warnings: string[] = [];

  if (options.size !== undefined) {
    if (!isOneOf(WIDGET_SIZES, options.size)) {
      throw new Error(`--size must be one of ${WIDGET_SIZES.join(', ')}`);
    }
    const declared = manifest.widget?.sizes;
    const sizes = Array.isArray(declared) && declared.length > 0 ? declared : ['small'];
    if (manifest.type !== 'widget') {
      warnings.push('Only widgets use --size');
    } else if (!sizes.includes(options.size)) {
      warnings.push(`manifest.json doesn't declare the size ${options.size}, the app uses ${sizes[0]}`);
    }
    launch.size = options.size;
  }

  if (options.level !== undefined) {
    if (!isOneOf(LEVELS, options.level)) {
      throw new Error(`--level must be one of ${LEVELS.join(', ')}`);
    }
    launch.level = options.level;
  }

  if (options.display !== undefined) {
    const display = Number(options.display);
    if (!Number.isInteger(display) || display < 1) {
      throw new Error('--display must be a display number, starting at 1');
    }
    launch.display = display;
  }

  if (options.position !== undefined) {
    const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(options.position));
    if (!match) {
      throw new Error('--position is x,y, e.g. --position 100,80');
    }
    launch.position = { x: Number(match[1]), y: Number(match[2]) };
  }

  const params = options.params ?? [];
  if (params.length > 0) {
    const declared = new Map((Array.isArray(manifest.parameters) ? manifest.parameters : []).map((parameter) => [parameter.key, parameter]));
    const parameters: Record<string, Scalar> = {};
    for (const param of params) {
      const index = param.indexOf('=');
      if (index <= 0) {
        throw new Error(`--param is key=value (it is "${param}")`);
      }
      const key = param.slice(0, index);
      const parameter = declared.get(key);
      if (!parameter) {
        throw new Error(`manifest.json declares no parameter "${key}"`);
      }
      parameters[key] = parameterValue(parameter, param.slice(index + 1));
    }
    launch.parameters = parameters;
  }

  return { launch, warnings };
}

/** Reads a `--param` value the way the parameter's control would produce it. */
export function parameterValue(parameter: Parameter, raw: string): Scalar {
  switch (parameter.type) {
    case 'toggle':
      if (raw === 'true' || raw === '1' || raw === 'on') return true;
      if (raw === 'false' || raw === '0' || raw === 'off') return false;
      throw new Error(`The parameter "${parameter.key}" is a toggle: true or false`);
    case 'number': {
      const value = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(value)) {
        throw new Error(`The parameter "${parameter.key}" must be a number`);
      }
      return value;
    }
    case 'color':
      if (!/^#[0-9A-Fa-f]{6}$/.test(raw)) {
        throw new Error(`The parameter "${parameter.key}" must be a color like #RRGGBB`);
      }
      return raw;
    case 'choice': {
      const options = Array.isArray(parameter.options) ? parameter.options : [];
      const option = options.find((candidate) => String(candidate.value) === raw);
      if (!option) {
        throw new Error(`The parameter "${parameter.key}" must be one of ${options.map((candidate) => String(candidate.value)).join(', ')}`);
      }
      return option.value;
    }
    default:
      return raw;
  }
}

export interface DevServerEvents {
  /** serving, `url` is what opens the app */
  ready: [info: { port: number; url: string }];
  built: [info: { revision: number; manifest: Manifest; warnings: string[] }];
  'build-failed': [error: Error];
  connected: [hello: Extract<AppMessage, { type: 'hello' }>];
  disconnected: [];
  /** every message from the app */
  app: [message: AppMessage];
}

export interface DevServerOptions {
  projectDir: string;
  launch?: LaunchRequest;
  /** `0` picks a free port */
  port?: number;
  watch?: boolean;
  /** asks the app for `metrics` messages */
  metrics?: boolean;
}

export class DevServer extends EventEmitter<DevServerEvents> {
  readonly projectDir: string;
  readonly launch: LaunchRequest;
  readonly token = crypto.randomBytes(24).toString('hex');
  port: number;
  revision = 0;
  manifest: Manifest | null = null;

  private readonly watch: boolean;
  private readonly metrics: boolean;
  private zip: Buffer | null = null;
  private client: WebSocketConnection | null = null;
  private server: http.Server | null = null;
  private watcher: fs.FSWatcher | null = null;
  private rebuildTimer: NodeJS.Timeout | undefined;
  private building: Promise<void> | null = null;
  private needsRebuild = false;

  constructor({ projectDir, launch = {}, port = 0, watch = true, metrics = false }: DevServerOptions) {
    super();
    this.projectDir = projectDir;
    this.launch = launch;
    this.port = port;
    this.watch = watch;
    this.metrics = metrics;
  }

  /** `desktopengine://` URL that makes the app connect to this server. */
  get connectURL(): string {
    return `desktopengine://develop/connect?port=${this.port}&token=${this.token}`;
  }

  get isConnected(): boolean {
    return Boolean(this.client?.isOpen);
  }

  async start(): Promise<void> {
    await this.rebuild();

    const server = http.createServer((request, response) => this.handleRequest(request, response));
    server.on('upgrade', (request: http.IncomingMessage, socket: Duplex, head: Buffer) => this.handleUpgrade(request, socket, head));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.port = (server.address() as { port: number }).port;

    if (this.watch) {
      this.watcher = fs.watch(this.projectDir, { recursive: true }, (_event, filename) => {
        if (filename && !affectsPackage(String(filename))) return;
        this.scheduleRebuild();
      });
    }
    this.emit('ready', { port: this.port, url: this.connectURL });
  }

  /** Stops the mini program in the app and the server. */
  async stop(): Promise<void> {
    clearTimeout(this.rebuildTimer);
    this.watcher?.close();
    this.watcher = null;
    if (this.client) {
      this.send({ type: 'stop' });
      this.client.close(1001, 'desktopengine dev stopped');
    }
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private scheduleRebuild(): void {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuild().catch(() => {});
    }, REBUILD_DELAY);
  }

  /** Builds the package; a change during a build builds once more afterwards. */
  async rebuild(): Promise<void> {
    if (this.building) {
      this.needsRebuild = true;
      return this.building;
    }
    this.building = (async () => {
      try {
        do {
          this.needsRebuild = false;
          await this.buildOnce();
        } while (this.needsRebuild);
      } finally {
        this.building = null;
      }
    })();
    return this.building;
  }

  private async buildOnce(): Promise<void> {
    let built;
    try {
      built = await buildProject({ projectDir: this.projectDir, mode: 'development' });
    } catch (error) {
      this.emit('build-failed', error as Error);
      return;
    }
    this.zip = zipPackage(built.packageDir, built.files);
    this.manifest = built.manifest;
    this.revision += 1;
    this.emit('built', { revision: this.revision, manifest: built.manifest, warnings: built.warnings });
    this.sendLoad();
  }

  private send(message: ServerMessage): void {
    this.client?.send(message);
  }

  private sendLoad(): void {
    if (!this.isConnected || !this.zip) return;
    this.send({
      type: 'load',
      revision: this.revision,
      url: `http://127.0.0.1:${this.port}/package.zip?token=${this.token}&revision=${this.revision}`,
      launch: this.launch,
    });
  }

  private isAuthorized(url: URL): boolean {
    const token = Buffer.from(url.searchParams.get('token') ?? '');
    const expected = Buffer.from(this.token);
    return token.length === expected.length && crypto.timingSafeEqual(token, expected);
  }

  private handleRequest(request: http.IncomingMessage, response: http.ServerResponse): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!this.isAuthorized(url)) {
      response.writeHead(403).end();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/package.zip' && this.zip) {
      response.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': this.zip.length,
        'Cache-Control': 'no-store',
      });
      response.end(this.zip);
      return;
    }
    response.writeHead(404).end();
  }

  private handleUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/session' || !this.isAuthorized(url)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const connection = acceptUpgrade(request, socket, head);
    if (!connection) return;

    // one app at a time, the newest connection wins
    this.client?.close(1000, 'replaced');
    this.client = connection;

    connection.on('message', (data) => {
      let message: AppMessage;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'hello') {
        this.emit('connected', message);
        // apps that don't know `metrics` ignore it
        if (this.metrics) this.send({ type: 'metrics', enabled: true });
        this.sendLoad();
      }
      this.emit('app', message);
    });
    connection.on('close', () => {
      if (this.client === connection) {
        this.client = null;
        this.emit('disconnected');
      }
    });
  }
}

/** Opens a URL with Launch Services, in the background. */
export function openURL(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('open', ['-g', url], (error) => (error ? reject(error) : resolve()));
  });
}
