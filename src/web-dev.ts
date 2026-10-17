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
//   /proxy?url=…     requests and WebSockets to the domains of network.domains: every method with its headers and
//                    body, where the store's preview proxy (and the review's) sends GET and HEAD only
//
// Every mini program on the store must run on the web (only a preview: the app's engine is what counts).

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';
import { buildProject } from './build.ts';
import { affectsPackage } from './files.ts';
import { WebSocketConnection, acceptKey, acceptUpgrade } from './websocket.ts';
import type { LaunchRequest } from './dev.ts';
import { declaredWidgetSizes, englishText, widgetSizesByArea, type Manifest } from './manifest.ts';

const REBUILD_DELAY = 150;
const PROXY_LIMIT = 20 * 1024 * 1024;
/** A proxied request, redirects included, ends after this; so does a WebSocket's handshake */
const PROXY_TIMEOUT = 30_000;
/** A proxied WebSocket closes after this much from the server, as the store's does: a preview doesn't stream forever */
const WEBSOCKET_LIMIT = 50 * 1024 * 1024;

export interface WebDevServerEvents {
  built: [info: { revision: number; manifest: Manifest; warnings: string[] }];
  'build-failed': [error: Error];
  log: [entry: { kind: 'console' | 'exception' | 'host-message'; level?: string; message: string; stack?: string }];
  /** `asked`: the browser asked before sending these headers, which the store's preview and the review refuse */
  proxy: [entry: { url: string; status: number | string; method?: string; asked?: string }];
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

/**
 * Whether an address is the computer's own or on its network, as the engine checks: loopback, private, link-local,
 * shared (CGNAT), multicast and reserved. 198.18.0.0/15 and fc00::/18 aren't: proxy software's fake-IP mode resolves
 * every domain there.
 */
export function isLocalAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128) || (a === 192 && b === 0);
  }
  if (!net.isIPv6(address)) return false;
  // however it's written (0:0:0:0:0:0:0:1 is ::1)
  const words = ipv6Words(address);
  // IPv6 addresses that carry an IPv4 one: mapped, compatible, NAT64 (64:ff9b::/96) and 6to4 (2002::/16)
  const embedded = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  const zeros = (count: number) => words.slice(0, count).every((word) => word === 0);
  if (zeros(5) && words[5] === 0xffff) return isLocalAddress(embedded(words[6], words[7]));
  if (zeros(6) && (words[6] || words[7] > 1)) return isLocalAddress(embedded(words[6], words[7]));
  if (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)) return isLocalAddress(embedded(words[6], words[7]));
  if (words[0] === 0x2002) return isLocalAddress(embedded(words[1], words[2]));
  // :: and ::1
  if (zeros(7) && words[7] <= 1) return true;
  const [first, second] = words;
  // fe80::/10 link-local, ff00::/8 multicast, fc00::/7 unique local except the fake-IP range fc00::/18
  if ((first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return true;
  if ((first & 0xfe00) === 0xfc00) return !(first === 0xfc00 && second < 0x4000);
  return false;
}

/** The eight 16-bit words of an IPv6 address */
function ipv6Words(address: string): number[] {
  let value = address.toLowerCase().split('%')[0];
  // a dotted IPv4 tail is two words
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    value = `${value.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = value.split('::');
  const parse = (part: string | undefined) => (part ? part.split(':').map((word) => parseInt(word, 16) || 0) : []);
  const front = parse(head);
  const back = parse(tail);
  return tail === undefined ? front : [...front, ...Array(8 - front.length - back.length).fill(0), ...back];
}

const REDIRECTS = 5;

class ProxyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The lookup of the proxy's connections: they connect only to an address that was checked, as the check is in the
 * lookup the connection itself uses, so the name can't resolve to something else between the check and the connection
 * (DNS rebinding)
 */
function checkedLookup(hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void): void {
  dns.lookup(hostname, { all: true }).then(
    (addresses) => {
      if (!addresses.length || addresses.some(({ address }) => isLocalAddress(address))) {
        callback(new ProxyError(403, `${hostname} resolves to the local network`));
      } else if (options.all) {
        callback(null, addresses);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    },
    (error: Error) => callback(error),
  );
}

/** The client for an http or https URL that names a domain */
function clientFor(target: URL): typeof http | typeof https {
  if (net.isIP(target.hostname.replace(/^\[|\]$/g, ''))) throw new ProxyError(403, 'an address, not a domain');
  const client = target.protocol === 'https:' ? https : target.protocol === 'http:' ? http : null;
  if (!client) throw new ProxyError(403, `${target.protocol} isn't http or https`);
  return client;
}

/** One request, connecting only to an address that was checked */
function requestOnce(target: URL, method: string, headers: http.OutgoingHttpHeaders, body: Buffer | null, deadline: number): Promise<http.IncomingMessage> {
  let client: typeof http | typeof https;
  try {
    client = clientFor(target);
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const outgoing = client.request(target, {
      method,
      // the body is passed on as it comes: no compression to undo
      headers: { ...headers, 'Accept-Encoding': 'identity', 'User-Agent': 'DesktopEngine-Preview/1', ...(body ? { 'Content-Length': String(body.length) } : {}) },
      timeout: Math.max(deadline - Date.now(), 1),
      lookup: checkedLookup,
    } as https.RequestOptions, resolve);
    outgoing.on('timeout', () => outgoing.destroy(new ProxyError(504, 'the server took too long')));
    outgoing.on('error', reject);
    outgoing.end(body ?? undefined);
  });
}

/**
 * A body, up to PROXY_LIMIT bytes and the deadline: no more is read. A response that's too large is cut off; the page's
 * request (`request`) is read on until the deadline, so that it hears the 413
 */
function readLimited(incoming: http.IncomingMessage, deadline: number, request = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let tooLarge = false;
    const timer = setTimeout(() => incoming.destroy(new ProxyError(504, 'the server took too long')), Math.max(deadline - Date.now(), 1));
    incoming.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      length += chunk.length;
      if (length <= PROXY_LIMIT) {
        chunks.push(chunk);
      } else if (request) {
        // the timer goes on: an upload that doesn't end is cut off at the deadline
        tooLarge = true;
        reject(new ProxyError(413, 'the request is too large for the preview'));
      } else {
        incoming.destroy(new ProxyError(502, 'the response is too large for the preview'));
      }
    });
    incoming.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    incoming.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Headers of the page's request that aren't the content's to pass on: the browser's own, the connection's, cookies */
const HELD_REQUEST_HEADERS = /^(host|connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|cookie2?|origin|referer|accept-encoding|content-length|user-agent|priority|sec-.*)$/;
/**
 * Headers of the response that aren't passed back: the connection's, cookies, what the proxy sets itself, and the
 * cross-origin policies, which are the browser's (the app has none: same-site would keep the frame's images out)
 */
const HELD_RESPONSE_HEADERS = /^(connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|set-cookie2?|content-length|cache-control|access-control-.*|cross-origin-.*|timing-allow-origin)$/;

export interface PreviewProxyOptions {
  /**
   * Every method but CONNECT and TRACE, with the request's headers (cookies aside) and a body of at most 20 MB, and the
   * response's headers for the content to read, as in the app: `dev --web`'s proxy, on the developer's computer.
   * Without it, as the store's preview proxy and the review's: GET and HEAD only, with only Accept passed on
   */
  anyMethod?: boolean;
}

/**
 * The preview proxy of `dev --web` (and the review node's web check): `?url=`, to the domains of the manifest's
 * network.domains that don't resolve to the local network, following redirects that stay there, without cookies or
 * credentials either way, at most 20 MB. GET and HEAD only, but with `anyMethod`. `report` hears every request's URL,
 * its status or error and its method; with `anyMethod`, also the browser's question before a request with headers
 * that a simple request can't have (`asked`, their names, and 204), which the store's preview and the review refuse.
 */
export async function proxyPreviewRequest(
  manifest: Manifest | null,
  url: URL,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  report: (url: string, status: number | string, method: string, asked?: string) => void = () => undefined,
  { anyMethod = false }: PreviewProxyOptions = {},
): Promise<void> {
  // the sandboxed frame has an opaque origin
  const cors = { 'Access-Control-Allow-Origin': '*' };
  let method = request.method ?? 'GET';
  const fail = (status: number, message: string, target?: string): void => {
    if (target) report(target, message, method);
    response.writeHead(status, { 'Content-Type': 'text/plain', ...cors }).end(message);
  };
  // the browser asks first before other methods and headers
  if (anyMethod && method === 'OPTIONS' && request.headers['access-control-request-method']) {
    const asked = String(request.headers['access-control-request-headers'] ?? '');
    try {
      if (asked) report(new URL(url.searchParams.get('url') ?? '').href, 204, String(request.headers['access-control-request-method']), asked);
    } catch {
      // a bad URL is reported with its request
    }
    response.writeHead(204, {
      ...cors,
      'Access-Control-Allow-Methods': String(request.headers['access-control-request-method']),
      'Access-Control-Allow-Headers': String(request.headers['access-control-request-headers'] ?? ''),
      'Access-Control-Max-Age': '600',
    }).end();
    return;
  }
  let target: URL;
  try {
    target = new URL(url.searchParams.get('url') ?? '');
  } catch {
    return fail(400, 'bad url');
  }
  if (anyMethod ? /^(CONNECT|TRACE|TRACK)$/i.test(method) : method !== 'GET' && method !== 'HEAD') {
    return fail(405, anyMethod ? `the preview doesn't send ${method}` : 'the preview only sends GET and HEAD', target.href);
  }
  const deadline = Date.now() + PROXY_TIMEOUT;
  try {
    let headers: http.OutgoingHttpHeaders = { Accept: String(request.headers.accept ?? '*/*') };
    let body: Buffer | null = null;
    if (anyMethod) {
      headers = Object.fromEntries(Object.entries(request.headers).filter(([name, value]) => value !== undefined && !HELD_REQUEST_HEADERS.test(name)));
      if (method !== 'GET' && method !== 'HEAD') body = await readLimited(request, deadline, true);
    }
    for (let hop = 0; ; hop++) {
      if (!manifest || !allowedByManifest(manifest, target)) return fail(403, 'not in network.domains', target.href);
      const upstream = await requestOnce(target, method, headers, body, deadline);
      const location = upstream.headers.location;
      const status = upstream.statusCode ?? 502;
      if (status >= 300 && status < 400 && location) {
        upstream.resume();
        if (hop >= REDIRECTS) return fail(508, 'too many redirects', target.href);
        const next = new URL(location, target);
        // as fetch does: credentials stay with their site, and a 303, or a 301 or 302 after a POST, goes on as a GET
        if (next.origin !== target.origin) delete headers.authorization;
        if ((status === 303 && method !== 'HEAD') || ((status === 301 || status === 302) && method === 'POST')) {
          method = 'GET';
          body = null;
          delete headers['content-type'];
        }
        target = next;
        continue;
      }
      if (Number(upstream.headers['content-length']) > PROXY_LIMIT) {
        upstream.destroy();
        return fail(502, 'the response is too large for the preview', target.href);
      }
      const content = method === 'HEAD' ? Buffer.alloc(0) : await readLimited(upstream, deadline);
      report(target.href, status, method);
      const passed = anyMethod
        ? {
            'content-type': 'application/octet-stream',
            ...Object.fromEntries(Object.entries(upstream.headers).filter(([name, value]) => value !== undefined && !HELD_RESPONSE_HEADERS.test(name))),
            // a HEAD's length is the server's; the others' is the body's, which Node sets
            ...(method === 'HEAD' && upstream.headers['content-length'] ? { 'content-length': upstream.headers['content-length'] } : {}),
            'access-control-expose-headers': '*',
          }
        : { 'Content-Type': upstream.headers['content-type'] ?? 'application/octet-stream' };
      response.writeHead(status, { ...passed, 'Cache-Control': 'no-store', ...cors });
      response.end(method === 'HEAD' ? undefined : content);
      return;
    }
  } catch (error) {
    fail(error instanceof ProxyError ? error.status : 502, (error as Error).message, target.href);
  }
}

/**
 * A WebSocket's handshake with the content's server (`target` is its http or https URL), offering the subprotocols the
 * page's WebSocket offered and no extensions, connecting only to an address that was checked. Redirects aren't
 * followed, as WebSockets don't
 */
function connectWebSocket(target: URL, protocols: string | undefined, deadline: number): Promise<{ socket: Duplex; head: Buffer; protocol?: string }> {
  let client: typeof http | typeof https;
  try {
    client = clientFor(target);
  } catch (error) {
    return Promise.reject(error);
  }
  const key = crypto.randomBytes(16).toString('base64');
  return new Promise((resolve, reject) => {
    const outgoing = client.request(target, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        'User-Agent': 'DesktopEngine-Preview/1',
        ...(protocols ? { 'Sec-WebSocket-Protocol': protocols } : {}),
      },
      timeout: Math.max(deadline - Date.now(), 1),
      lookup: checkedLookup,
    } as https.RequestOptions);
    outgoing.on('upgrade', (response, socket: Duplex & { setTimeout?: (timeout: number) => void }, head: Buffer) => {
      socket.setTimeout?.(0);
      if (response.headers['sec-websocket-accept'] !== acceptKey(key) || response.headers['sec-websocket-extensions']) {
        socket.destroy();
        reject(new ProxyError(502, 'the server\'s WebSocket handshake is wrong'));
        return;
      }
      const protocol = response.headers['sec-websocket-protocol'];
      resolve({ socket, head, protocol: typeof protocol === 'string' ? protocol : undefined });
    });
    outgoing.on('response', (response) => {
      response.resume();
      reject(new ProxyError(502, `the server didn't accept the WebSocket (${response.statusCode})`));
    });
    outgoing.on('timeout', () => outgoing.destroy(new ProxyError(504, 'the server took too long')));
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/**
 * The preview proxy's WebSockets, as the store's: an `upgrade` request to `?url=ws://…` or `wss://…` connects to the
 * domains of the manifest's network.domains that don't resolve to the local network, offering the page's
 * subprotocols, and passes text and binary messages on as they come, and the close; it closes after 50 MB from the
 * server. `report` hears the URL and 101, or the error. The `dev --web` server and the review node's web check call
 * it from their HTTP server's `upgrade` event.
 */
export async function proxyPreviewWebSocket(
  manifest: Manifest | null,
  url: URL,
  request: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  report: (url: string, status: number | string) => void = () => undefined,
): Promise<void> {
  // the browser may leave during the handshake with the server
  socket.on('error', () => socket.destroy());
  const refuse = (status: number, message: string, target?: string): void => {
    if (target) report(target, message);
    const body = Buffer.from(message, 'utf8');
    socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? 'Error'}\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n${message}`);
  };
  let target: URL;
  try {
    target = new URL(url.searchParams.get('url') ?? '');
  } catch {
    return refuse(400, 'bad url');
  }
  if (target.protocol !== 'ws:' && target.protocol !== 'wss:') return refuse(400, 'not a ws or wss URL', target.href);
  const server = new URL(target.href);
  server.protocol = target.protocol === 'wss:' ? 'https:' : 'http:';
  if (!manifest || !allowedByManifest(manifest, server)) return refuse(403, 'not in network.domains', target.href);
  if (String(request.headers.upgrade ?? '').toLowerCase() !== 'websocket') return refuse(400, 'not a WebSocket handshake', target.href);
  let upstream: Awaited<ReturnType<typeof connectWebSocket>>;
  try {
    upstream = await connectWebSocket(server, request.headers['sec-websocket-protocol'], Date.now() + PROXY_TIMEOUT);
  } catch (error) {
    return refuse(error instanceof ProxyError ? error.status : 502, (error as Error).message, target.href);
  }
  if (socket.destroyed) {
    upstream.socket.destroy();
    return;
  }
  const page = acceptUpgrade(request, socket, head, upstream.protocol);
  if (!page) {
    upstream.socket.destroy();
    return;
  }
  report(target.href, 101);
  const remote = new WebSocketConnection(upstream.socket, upstream.head, { client: true });
  let received = 0;
  remote.on('message', (data) => {
    received += typeof data === 'string' ? Buffer.byteLength(data) : data.length;
    if (received > WEBSOCKET_LIMIT) {
      page.close(1009, 'the preview received too much');
      remote.close(1000);
      return;
    }
    page.send(data);
  });
  page.on('message', (data) => remote.send(data));
  // an abnormal closure stays one: a close frame would make it a clean 1000
  const pass = (to: WebSocketConnection) => (code: number, reason: string) => (code === 1006 || code === 1015 ? to.destroy() : to.close(code, reason));
  remote.on('close', pass(page));
  page.on('close', pass(remote));
}

export class WebDevServer extends EventEmitter<WebDevServerEvents> {
  readonly projectDir: string;
  readonly launch: LaunchRequest;
  readonly token = crypto.randomBytes(18).toString('hex');
  /** Only for the proxy: the frame gets it, and its content can't use it to read the project or write to the terminal */
  readonly proxyToken = crypto.randomBytes(18).toString('hex');
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
  /** The proxy's WebSockets, closed when the server stops */
  private readonly sockets = new Set<Duplex>();

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
    server.on('upgrade', (request: http.IncomingMessage, socket: Duplex, head: Buffer) => this.upgrade(request, socket, head));
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
    for (const socket of this.sockets) socket.destroy();
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
    const expected = Buffer.from(url.pathname === '/proxy' ? this.proxyToken : this.token);
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
    if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', desktopPage(this.token, this.proxyToken));
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
      const sizes = build.manifest.type === 'widget' ? declaredWidgetSizes(build.manifest) : [];
      return send(200, 'application/json', JSON.stringify({
        revision: this.revision,
        manifest: build.manifest,
        code,
        files: build.files.filter((file) => file !== 'index.js'),
        launch: this.launch,
        // the sizes to pick from, as the app lists them: smallest first; presets by their names, sizes of its own by theirs.
        // The default is still the first the manifest declares
        sizes: widgetSizesByArea(sizes).map((size) => ({ id: size.id, name: size.name ? englishText(size.name) : size.id })),
        defaultSize: sizes[0]?.id,
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
    if (url.pathname === '/proxy') return this.proxy(url, request, response);
    send(404, 'text/plain', 'not found');
  }

  private async proxy(url: URL, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const manifest = this.build?.manifest;
    await proxyPreviewRequest(manifest ?? null, url, request, response, (target, status, method, asked) => this.emit('proxy', { url: target, status, method, ...(asked ? { asked } : {}) }), { anyMethod: true });
  }

  /** WebSockets: the proxy's only */
  private upgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/proxy' || !this.authorized(url)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    void proxyPreviewWebSocket(this.build?.manifest ?? null, url, request, socket, head, (target, status) => this.emit('proxy', { url: target, status }));
  }
}

/** A Mac desktop: a wallpaper, the menu bar, the Dock, and the project on it */
function desktopPage(token: string, proxyToken: string): string {
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
  #status-panel { position: fixed; z-index: 12; top: 30px; right: 12px; width: 240px; padding: 10px 12px; border-radius: 10px; display: grid; gap: 6px;
    font-size: 12px; background: var(--bar); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25); }
  #status-panel[hidden] { display: none; }
  #status-panel label, #status-panel .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  #status-panel label.check { justify-content: flex-start; }
  #status-panel select, #status-panel button { font: inherit; color: inherit; }
  #status-panel .readout { opacity: 0.6; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<div id="desktop"></div>
<div id="menubar">
  <b id="name">DesktopEngine</b><span id="status" style="opacity:.6"></span>
  <span class="spacer"></span>
  <button id="new-window" title="Open a pretend app window, for DesktopEngine.windows" hidden>New Window</button>
  <select id="size" title="Widget size" hidden></select>
  <button id="appearance" title="Light or dark">◐</button>
  <button id="sound" title="Sound">🔇</button>
  <button id="music" title="What systemAudio hears: a made-up signal, or an audio file you choose" hidden>♫</button>
  <input id="music-file" type="file" accept="audio/*,video/*" hidden>
  <button id="system-status" title="What systemStatus shows: set the Mac's state, or let it sleep for a moment" hidden>⚡&#xFE0E;</button>
  <button id="restart" title="Start again">↻</button>
</div>
<div id="status-panel" hidden>
  <label>Thermal state <select id="st-thermal"><option>nominal</option><option>fair</option><option>serious</option><option>critical</option></select></label>
  <label>Network <select id="st-network"><option value="wifi">Wi-Fi</option><option value="ethernet">Ethernet</option><option value="cellular">Cellular</option><option value="other">Other</option><option value="offline">Offline</option></select></label>
  <label class="check"><input type="checkbox" id="st-expensive"> Expensive connection</label>
  <label>Memory pressure <select id="st-pressure"><option>normal</option><option>warning</option><option>critical</option></select></label>
  <label class="check"><input type="checkbox" id="st-swapping"> Swapping</label>
  <label>Power <select id="st-power"><option value="battery">On battery</option><option value="ac">Plugged in</option><option value="full">Plugged in, full</option><option value="none">No battery</option></select></label>
  <label class="check"><input type="checkbox" id="st-low-battery"> Low battery</label>
  <label class="check"><input type="checkbox" id="st-low-power"> Low Power Mode</label>
  <label class="check"><input type="checkbox" id="st-watts"> Power draw unknown</label>
  <label class="check"><input type="checkbox" id="st-temperature"> Temperature unknown</label>
  <div class="row"><select id="st-reason" title="Why the content is suspended: what resume tells"><option value="sleep">The Mac sleeps</option><option value="displaysleep">The displays sleep</option><option value="paused">Content paused</option></select><button id="st-suspend">Suspend 5 s</button></div>
  <div class="row"><span class="readout" id="st-readout"></span><button id="st-reset" title="Back to the made-up values">Reset</button></div>
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
  proxy: location.origin + '/proxy?token=' + ${JSON.stringify(proxyToken)},
  // this proxy sends every method, the store's GET and HEAD only
  proxySendsAnyMethod: true,
  appearance,
  muted: true,
  // pretend app windows for DesktopEngine.windows: one opens for content with the window-positions permission
  appWindows: [],
});
// for the browser's console
window.desktop = desktop;
const log = (entry) => fetch(api('/log'), { method: 'POST', body: JSON.stringify(entry) }).catch(() => {});
const banner = document.getElementById('banner');
let content = null;
let size;
let openedWindow = false;
let toldNoSystemAudio = false;

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
  const sizes = build.sizes;
  const select = document.getElementById('size');
  select.hidden = sizes.length < 2;
  select.replaceChildren(...sizes.map((entry) => {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    return option;
  }));
  size = size ?? build.launch?.size ?? build.defaultSize;
  select.value = size;
  const permissions = build.manifest.permissions ?? [];
  const seesWindows = permissions.includes('window-positions');
  document.getElementById('new-window').hidden = !seesWindows;
  if (seesWindows && !openedWindow) {
    openedWindow = true;
    desktop.addAppWindow();
  }
  const spec = {
    name, code: build.code, files, manifest: build.manifest,
    parameters: build.launch?.parameters, size, level: build.launch?.level, position: build.launch?.position,
    span: build.launch?.span,
    // the developer's copy, as desktopengine dev runs it in the app
    officialId: false,
  };
  banner.style.display = 'none';
  if (content) {
    content.restart(spec);
  } else {
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
  // the system status controls for content that reads it
  statusButton.hidden = !permissions.includes('system-info');
  if (statusButton.hidden) statusPanel.hidden = true;
  // the ♫ button while the content hears something: with network too, it doesn't
  const hears = content.systemAudio !== 'none';
  if (!hears && player.src) stopMusic();
  music.hidden = !hears;
  if (permissions.includes('system-audio') && !hears && !toldNoSystemAudio) {
    toldNoSystemAudio = true;
    // the same words as the app's desktopengine dev
    const message = '"system-audio" is off because the content also has "network"';
    console.warn(message);
    log({ kind: 'console', level: 'warn', message });
  }
}

document.getElementById('new-window').onclick = () => desktop.addAppWindow();
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
// DesktopEngine.systemAudio hears a made-up signal like music, or a file chosen here, played on the page
const music = document.getElementById('music');
const musicFile = document.getElementById('music-file');
const player = new Audio();
player.loop = true;
const showMusic = () => {
  music.textContent = player.src ? (player.paused ? '♫ ▶' : '♫ ❚❚') : '♫';
  music.title = player.src ? (player.paused ? 'Play the file systemAudio hears' : 'Back to the made-up signal') : 'Choose an audio file for systemAudio to hear (it hears a made-up signal like music now)';
};
showMusic();
// back to the made-up signal, the file gone
const stopMusic = () => {
  player.pause();
  desktop.setSystemAudioSource(null);
  if (player.src) URL.revokeObjectURL(player.src);
  player.removeAttribute('src');
  player.load();
  showMusic();
};
// a file the browser can't play goes, so the next click chooses another; a play the browser held back until a click
// keeps it for the next one, the content hearing the made-up signal meanwhile
const playFailed = () => (player.error ? stopMusic() : desktop.setSystemAudioSource(null));
music.onclick = () => {
  if (!player.src) { musicFile.click(); return; }
  if (player.paused) {
    // in the click: browsers start the page's sound only after one
    desktop.setSystemAudioSource(player);
    player.play().catch(playFailed).finally(showMusic);
  } else {
    stopMusic();
  }
};
musicFile.onchange = () => {
  const file = musicFile.files?.[0];
  musicFile.value = '';
  if (!file) return;
  player.src = URL.createObjectURL(file);
  // started at once when the browser still counts the click that opened the chooser, otherwise with the next click
  desktop.setSystemAudioSource(player);
  player.play().catch(playFailed).finally(showMusic);
};
player.onplay = player.onpause = showMusic;
// one that stops playing midway too
player.onerror = () => { if (player.getAttribute('src')) stopMusic(); };
// DesktopEngine.systemStatus shows a made-up Mac: any of it can be set here, and the content suspended for a moment
const statusButton = document.getElementById('system-status');
const statusPanel = document.getElementById('status-panel');
const statusField = (id) => document.getElementById('st-' + id);
const showStatus = () => {
  const status = desktop.systemStatus;
  const battery = status.power.battery;
  const watts = status.power.systemWatts;
  const temperature = status.temperature;
  statusField('readout').textContent = 'CPU ' + Math.round(status.cpu.usage * 100) + '%'
    + (temperature === null ? '' : ' · ' + Math.round(temperature) + ' °C')
    + (battery ? ' · battery ' + Math.round(battery.level * 100) + '%' : '') + (watts === null ? '' : ' · ' + watts.toFixed(1) + ' W');
  statusField('low-battery').disabled = statusField('power').value === 'none';
  statusField('expensive').disabled = statusField('network').value === 'offline';
};
const applyStatus = () => {
  const network = statusField('network').value;
  desktop.setSystemStatus({
    thermal: statusField('thermal').value,
    online: network !== 'offline',
    networkInterface: network === 'offline' ? undefined : network,
    expensive: statusField('expensive').checked,
    memoryPressure: statusField('pressure').value,
    swapping: statusField('swapping').checked,
    power: statusField('power').value,
    batteryLevel: statusField('low-battery').checked ? 0.08 : undefined,
    lowPowerMode: statusField('low-power').checked,
    systemWatts: statusField('watts').checked ? null : undefined,
    temperature: statusField('temperature').checked ? null : undefined,
  });
  showStatus();
};
for (const id of ['thermal', 'network', 'expensive', 'pressure', 'swapping', 'power', 'low-battery', 'low-power', 'watts', 'temperature']) statusField(id).onchange = applyStatus;
statusButton.onclick = () => {
  statusPanel.hidden = !statusPanel.hidden;
  if (!statusPanel.hidden) showStatus();
};
statusField('reset').onclick = () => {
  desktop.resetSystemStatus();
  for (const [id, value] of [['thermal', 'nominal'], ['network', 'wifi'], ['pressure', 'normal'], ['power', 'battery']]) statusField(id).value = value;
  for (const id of ['expensive', 'swapping', 'low-battery', 'low-power', 'watts', 'temperature']) statusField(id).checked = false;
  showStatus();
};
statusField('suspend').onclick = async () => {
  const button = statusField('suspend');
  button.disabled = true;
  button.textContent = 'Suspended…';
  await desktop.simulateSuspension(statusField('reason').value, 5000);
  button.disabled = false;
  button.textContent = 'Suspend 5 s';
};
setInterval(() => { if (!statusPanel.hidden) showStatus(); }, 1000);
let revision = 0;
new EventSource(api('/events')).addEventListener('revision', (event) => {
  const next = Number(event.data);
  if (next !== revision) { revision = next; run(); }
});
</script>
</body>
</html>`;
}
