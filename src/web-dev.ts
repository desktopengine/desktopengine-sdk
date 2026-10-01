// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// `desktopengine dev --web`: runs the project in the browser with the web runtime the DesktopEngine store uses for
// its previews, on a page that looks like a Mac desktop. The server, on 127.0.0.1 with a random token:
//
//   /                the desktop page
//   /desktop.js      the web runtime (WebDesktop)
//   /package         the build: manifest, index.js and the list of the other files; /files/<path> serves them
//   /events          server-sent events: `revision` after every rebuild, so the page runs the new build
//   /log             the page posts what the content logs, printed in the terminal
//   /proxy?url=…     GET requests to the domains of network.domains, as the store's preview proxy does
//
// Every mini program on the store must run on the web (only a preview: the app's engine is what counts).

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { buildProject } from './build.ts';
import { affectsPackage } from './files.ts';
import type { LaunchRequest } from './dev.ts';
import type { Manifest } from './manifest.ts';

const REBUILD_DELAY = 150;
const PROXY_LIMIT = 20 * 1024 * 1024;

export interface WebDevServerEvents {
  built: [info: { revision: number; manifest: Manifest; warnings: string[] }];
  'build-failed': [error: Error];
  log: [entry: { kind: 'console' | 'exception' | 'host-message'; level?: string; message: string; stack?: string }];
  proxy: [entry: { url: string; status: number | string }];
}

export interface WebDevServerOptions {
  projectDir: string;
  launch?: LaunchRequest;
  port?: number;
  watch?: boolean;
}

/** The web runtime, next to this file once built (dist/web) or in the SDK's dist from its sources */
export function webRuntimePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, 'web', 'desktop.js'), path.join(here, '..', 'dist', 'web', 'desktop.js')];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('The web runtime isn\'t built: run npm run build in the SDK');
  return found;
}

/** The default browser, in front: unlike the app, the page is what the developer looks at */
export function openInBrowser(url: string): Promise<void> {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  return new Promise((resolve, reject) => {
    execFile(command as string, args as string[], (error) => (error ? reject(error) : resolve()));
  });
}

/** Whether a URL is one of the manifest's network domains, the engine's rule */
export function allowedByManifest(manifest: Manifest, url: URL): boolean {
  if (!(manifest.permissions ?? []).includes('network')) return false;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.includes(':') || /^[0-9][0-9a-fx]*$/.test(host.split('.').pop() ?? '')) return false;
  return (manifest.network?.domains ?? []).some((pattern) => {
    const normalized = pattern.toLowerCase();
    if (normalized.startsWith('*.')) return host.length > normalized.length - 1 && host.endsWith(normalized.slice(1));
    return host === normalized;
  });
}

export class WebDevServer extends EventEmitter<WebDevServerEvents> {
  readonly projectDir: string;
  readonly launch: LaunchRequest;
  readonly token = crypto.randomBytes(18).toString('hex');
  port: number;
  revision = 0;
  private build: { packageDir: string; manifest: Manifest; files: string[] } | null = null;
  private server: http.Server | null = null;
  private watcher: fs.FSWatcher | null = null;
  private readonly watch: boolean;
  private rebuildTimer: NodeJS.Timeout | undefined;
  private building: Promise<void> | null = null;
  private needsRebuild = false;
  private readonly eventStreams = new Set<http.ServerResponse>();

  constructor({ projectDir, launch = {}, port = 0, watch = true }: WebDevServerOptions) {
    super();
    this.projectDir = projectDir;
    this.launch = launch;
    this.port = port;
    this.watch = watch;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/?token=${this.token}`;
  }

  async start(): Promise<void> {
    await this.rebuild();
    const server = http.createServer((request, response) => {
      this.handle(request, response).catch((error: Error) => {
        if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end(error.message);
      });
    });
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
        clearTimeout(this.rebuildTimer);
        this.rebuildTimer = setTimeout(() => this.rebuild().catch(() => undefined), REBUILD_DELAY);
      });
    }
  }

  async stop(): Promise<void> {
    clearTimeout(this.rebuildTimer);
    this.watcher?.close();
    for (const stream of this.eventStreams) stream.end();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async rebuild(): Promise<void> {
    if (this.building) {
      this.needsRebuild = true;
      return this.building;
    }
    this.building = (async () => {
      try {
        do {
          this.needsRebuild = false;
          try {
            const built = await buildProject({ projectDir: this.projectDir, mode: 'development' });
            this.build = { packageDir: built.packageDir, manifest: built.manifest, files: built.files };
            this.revision += 1;
            this.emit('built', { revision: this.revision, manifest: built.manifest, warnings: built.warnings });
            for (const stream of this.eventStreams) stream.write(`event: revision\ndata: ${this.revision}\n\n`);
          } catch (error) {
            this.emit('build-failed', error as Error);
          }
        } while (this.needsRebuild);
      } finally {
        this.building = null;
      }
    })();
    return this.building;
  }

  private authorized(url: URL): boolean {
    const token = Buffer.from(url.searchParams.get('token') ?? '');
    const expected = Buffer.from(this.token);
    return token.length === expected.length && crypto.timingSafeEqual(token, expected);
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    // the proxy is called by the sandboxed frame, whose opaque origin needs CORS
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    if (!this.authorized(url)) {
      response.writeHead(403, cors).end();
      return;
    }
    const send = (status: number, type: string, body: string | Buffer): void => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...cors }).end(body);
    };
    if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', desktopPage(this.token));
    if (url.pathname === '/desktop.js') return send(200, 'text/javascript; charset=utf-8', fs.readFileSync(webRuntimePath()));
    if (url.pathname === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      response.write(`event: revision\ndata: ${this.revision}\n\n`);
      this.eventStreams.add(response);
      request.on('close', () => this.eventStreams.delete(response));
      return;
    }
    const build = this.build;
    if (url.pathname === '/package') {
      if (!build) return send(503, 'application/json', JSON.stringify({ error: 'the build failed, see the terminal' }));
      const code = fs.readFileSync(path.join(build.packageDir, 'index.js'), 'utf8');
      return send(200, 'application/json', JSON.stringify({
        revision: this.revision,
        manifest: build.manifest,
        code,
        files: build.files.filter((file) => file !== 'index.js'),
        launch: this.launch,
      }));
    }
    if (url.pathname.startsWith('/files/') && build) {
      const relative = decodeURIComponent(url.pathname.slice('/files/'.length));
      if (!build.files.includes(relative)) return send(404, 'text/plain', 'not found');
      return send(200, 'application/octet-stream', fs.readFileSync(path.join(build.packageDir, relative)));
    }
    if (url.pathname === '/log' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      try {
        const entry = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        this.emit('log', {
          kind: entry.kind,
          level: entry.level,
          message: String(entry.message ?? ''),
          stack: entry.stack ? String(entry.stack) : undefined,
        });
      } catch {
        // not one of the page's
      }
      return send(204, 'text/plain', '');
    }
    if (url.pathname === '/proxy') return this.proxy(url, request, response, cors);
    send(404, 'text/plain', 'not found');
  }

  /** GET only, no cookies or credentials either way, to the manifest's domains, at most PROXY_LIMIT */
  private async proxy(url: URL, request: http.IncomingMessage, response: http.ServerResponse, cors: Record<string, string>): Promise<void> {
    const manifest = this.build?.manifest;
    let target: URL;
    try {
      target = new URL(url.searchParams.get('url') ?? '');
    } catch {
      response.writeHead(400, cors).end('bad url');
      return;
    }
    if (!manifest || !allowedByManifest(manifest, target)) {
      this.emit('proxy', { url: target.href, status: 'not in network.domains' });
      response.writeHead(403, cors).end('not in network.domains');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, cors).end('only GET');
      return;
    }
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers: { Accept: String(request.headers.accept ?? '*/*'), 'User-Agent': 'DesktopEngine-Preview/1' },
        redirect: 'follow',
      });
      // a redirect may only end on an allowed domain too
      if (!allowedByManifest(manifest, new URL(upstream.url))) {
        response.writeHead(403, cors).end('redirected out of network.domains');
        return;
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      if (body.length > PROXY_LIMIT) {
        response.writeHead(502, cors).end('the response is too large for the preview');
        return;
      }
      this.emit('proxy', { url: target.href, status: upstream.status });
      response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-store', ...cors });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      this.emit('proxy', { url: target.href, status: (error as Error).message });
      response.writeHead(502, cors).end((error as Error).message);
    }
  }
}

/** A Mac desktop: a wallpaper, the menu bar, the Dock, and the project on it */
function desktopPage(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DesktopEngine web preview</title>
<style>
  :root { color-scheme: light dark; --bar: rgba(246, 246, 246, 0.72); --text: #1d1d1f; --dock: rgba(255, 255, 255, 0.32);
    --wallpaper: radial-gradient(120% 90% at 20% 10%, #f6d6c4 0%, #d9cfef 45%, #b9cdf2 100%); }
  :root[data-appearance="dark"] { --bar: rgba(30, 30, 34, 0.62); --text: #f5f5f7; --dock: rgba(60, 60, 66, 0.4);
    --wallpaper: radial-gradient(120% 90% at 20% 10%, #343b6c 0%, #1d1b3c 50%, #0b0d1f 100%); }
  html, body { margin: 0; height: 100%; overflow: hidden; font: 13px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; color: var(--text); }
  #desktop { position: fixed; inset: 0; background: var(--wallpaper); }
  #menubar { position: fixed; z-index: 10; top: 0; left: 0; right: 0; height: 24px; display: flex; align-items: center; gap: 16px;
    padding: 0 12px; background: var(--bar); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
  #menubar b { font-weight: 700; }
  #menubar button, #menubar select { font: inherit; color: inherit; background: none; border: 0; padding: 2px 6px; border-radius: 4px; cursor: default; }
  #menubar button:hover, #menubar select:hover { background: rgba(127, 127, 127, 0.25); }
  #menubar .spacer { flex: 1; }
  #dock { position: fixed; z-index: 10; bottom: 6px; left: 50%; transform: translateX(-50%); width: 360px; height: 58px; border-radius: 18px;
    background: var(--dock); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.18); pointer-events: none; }
  #banner { position: fixed; z-index: 11; top: 32px; right: 12px; max-width: 420px; padding: 10px 12px; border-radius: 10px; background: #b3261e; color: #fff;
    white-space: pre-wrap; font: 12px ui-monospace, Menlo, monospace; display: none; }
</style>
</head>
<body>
<div id="desktop"></div>
<div id="menubar">
  <b id="name">DesktopEngine</b><span id="status" style="opacity:.6"></span>
  <span class="spacer"></span>
  <select id="size" title="Widget size" hidden></select>
  <button id="appearance" title="Light or dark">◐</button>
  <button id="sound" title="Sound">🔇</button>
  <button id="restart" title="Start again">↻</button>
</div>
<div id="dock"></div>
<div id="banner"></div>
<script type="module">
import { WebDesktop } from './desktop.js?token=${token}';
const token = ${JSON.stringify(token)};
const api = (route) => route + (route.includes('?') ? '&' : '?') + 'token=' + token;
const root = document.documentElement;
let appearance = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
root.dataset.appearance = appearance;
const desktop = new WebDesktop(document.getElementById('desktop'), {
  insets: { top: 24, bottom: 70 },
  proxy: location.origin + api('/proxy'),
  appearance,
  muted: true,
});
// for the browser's console
window.desktop = desktop;
const log = (entry) => fetch(api('/log'), { method: 'POST', body: JSON.stringify(entry) }).catch(() => {});
const banner = document.getElementById('banner');
let content = null;
let size;

async function run() {
  const response = await fetch(api('/package'));
  if (!response.ok) { document.getElementById('status').textContent = 'the build failed, see the terminal'; return; }
  const build = await response.json();
  const files = {};
  await Promise.all(build.files.map(async (file) => {
    const data = await fetch(api('/files/' + file.split('/').map(encodeURIComponent).join('/')));
    files[file] = await data.arrayBuffer();
  }));
  const name = typeof build.manifest.name === 'string' ? build.manifest.name : (build.manifest.name.en ?? Object.values(build.manifest.name)[0]);
  document.getElementById('name').textContent = name;
  document.title = name + ' · DesktopEngine web preview';
  const sizes = build.manifest.widget?.sizes ?? [];
  const select = document.getElementById('size');
  select.hidden = build.manifest.type !== 'widget' || sizes.length < 2;
  select.innerHTML = sizes.map((value) => '<option>' + value + '</option>').join('');
  size = size ?? build.launch?.size ?? sizes[0];
  select.value = size;
  const spec = {
    name, code: build.code, files, manifest: build.manifest,
    parameters: build.launch?.parameters, size, level: build.launch?.level, position: build.launch?.position,
    span: build.launch?.span,
  };
  banner.style.display = 'none';
  if (content) { content.restart(spec); return; }
  content = desktop.launch(spec);
  content.on('console', ({ level, message }) => log({ kind: 'console', level, message }));
  content.on('exception', ({ message, stack }) => {
    log({ kind: 'exception', message, stack });
    banner.textContent = message;
    banner.style.display = 'block';
  });
  content.on('host-message', (message) => log({ kind: 'host-message', message: JSON.stringify(message) }));
  content.on('stats', ({ framesPerSecond }) => { document.getElementById('status').textContent = framesPerSecond + ' fps'; });
}

document.getElementById('size').onchange = (event) => { size = event.target.value; run(); };
document.getElementById('appearance').onclick = () => {
  appearance = appearance === 'light' ? 'dark' : 'light';
  root.dataset.appearance = appearance;
  desktop.setAppearance(appearance);
};
let muted = true;
document.getElementById('sound').onclick = (event) => {
  muted = !muted;
  event.target.textContent = muted ? '🔇' : '🔊';
  desktop.setMuted(muted);
};
document.getElementById('restart').onclick = () => content?.restart();
let revision = 0;
new EventSource(api('/events')).addEventListener('revision', (event) => {
  const next = Number(event.data);
  if (next !== revision) { revision = next; run(); }
});
</script>
</body>
</html>`;
}
