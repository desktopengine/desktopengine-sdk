// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import crypto from 'node:crypto';
import type { Duplex } from 'node:stream';

import type { Manifest } from '../src/manifest.ts';
import { WebDevServer, allowedByManifest, isLocalAddress, proxyPreviewRequest, webRuntimePath } from '../src/web-dev.ts';
import { WebSocketConnection, acceptKey, acceptUpgrade } from '../src/websocket.ts';

const manifest: Manifest = {
  id: 'com.example.web',
  name: 'Web',
  type: 'widget',
  version: '1.0.0',
  apiVersion: 1,
  widget: { sizes: ['small'] },
  permissions: ['network'],
  network: { domains: ['api.example.com', '*.tiles.example.org'] },
};

test('the web proxy reaches the domains of network.domains, as the engine does', () => {
  const allowed = (url: string, value: Manifest = manifest) => allowedByManifest(value, new URL(url));
  assert.equal(allowed('https://api.example.com/v1?q=1'), true);
  assert.equal(allowed('http://API.example.com./v1'), true);
  assert.equal(allowed('https://a.tiles.example.org/1.png'), true);
  assert.equal(allowed('https://a.b.tiles.example.org/1.png'), true);
  assert.equal(allowed('https://tiles.example.org/1.png'), false, '*. matches subdomains only');
  assert.equal(allowed('https://example.com/'), false);
  assert.equal(allowed('https://evil-api.example.com/'), false);
  assert.equal(allowed('ftp://api.example.com/'), false);
  assert.equal(allowed('https://127.0.0.1/'), false);
  assert.equal(allowed('https://[::1]/'), false);
  assert.equal(allowed('https://localhost/'), false);
  assert.equal(allowed('https://api.example.com/', { ...manifest, permissions: [] }), false, 'needs the permission');
});

test('the proxy refuses domains that resolve to the local network', () => {
  for (const address of ['127.0.0.1', '0:0:0:0:0:0:0:1', '0::1', '0:0::', 'FE80::1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd12::1', '::ffff:192.168.0.1', '::ffff:7f00:1', '::127.0.0.1', '64:ff9b::a9fe:a9fe', '64:ff9b::192.168.1.1', '2002:c0a8:101::1']) {
    assert.equal(isLocalAddress(address), true, address);
  }
  // fake-IP ranges of proxy software aren't
  for (const address of ['93.184.216.34', '198.18.0.5', 'fc00::5', '2606:4700::1111', '172.32.0.1', '64:ff9b::5db8:d822', '2002:5db8:d822::1']) {
    assert.equal(isLocalAddress(address), false, address);
  }
});

test('the proxy connects only to the address it checked', async (t) => {
  // the name resolves to the local network when the connection looks it up, whatever an earlier lookup said
  const original = dns.lookup;
  (dns as { lookup: unknown }).lookup = async () => [{ address: '127.0.0.1', family: 4 }];
  t.after(() => {
    (dns as { lookup: unknown }).lookup = original;
  });
  const reports: [string, number | string][] = [];
  const server = http.createServer((request, response) => {
    void proxyPreviewRequest(
      { permissions: ['network'], network: { domains: ['rebind.example'] } } as unknown as Manifest,
      new URL(request.url!, 'http://localhost'),
      request,
      response,
      (url, status) => reports.push([url, status]),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as { port: number };
  const answer = await fetch(`http://127.0.0.1:${port}/?url=${encodeURIComponent('http://rebind.example/')}`);
  assert.equal(answer.status, 403);
  assert.match(await answer.text(), /local network/);
  assert.match(String(reports[0]?.[1]), /local network/);
});

/** A WebSocket handshake with a server: the response's status, or the connection on 101 */
function handshake(url: string, protocols?: string): Promise<{ status: number; body: string; connection?: WebSocketConnection; protocol?: string }> {
  const key = crypto.randomBytes(16).toString('base64');
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13', ...(protocols ? { 'Sec-WebSocket-Protocol': protocols } : {}) },
    });
    request.on('upgrade', (response, socket: Duplex, head: Buffer) => {
      assert.equal(response.headers['sec-websocket-accept'], acceptKey(key));
      const protocol = response.headers['sec-websocket-protocol'];
      resolve({ status: 101, body: '', connection: new WebSocketConnection(socket, head, { client: true }), protocol: typeof protocol === 'string' ? protocol : undefined });
    });
    request.on('response', async (response) => {
      let body = '';
      for await (const chunk of response) body += String(chunk);
      resolve({ status: response.statusCode ?? 0, body });
    });
    request.on('error', reject);
    request.end();
  });
}

const next = <T extends unknown[]>(emitter: WebSocketConnection, event: 'message' | 'close') =>
  new Promise<T>((resolve) => emitter.once(event, (...args: unknown[]) => resolve(args as T)));

test('WebSockets speak both sides: text, binary messages over 64 KB, subprotocols and the close', async (t) => {
  const server = http.createServer();
  server.on('upgrade', (request, socket: Duplex, head: Buffer) => {
    const connection = acceptUpgrade(request, socket, head, String(request.headers['sec-websocket-protocol']).split(',')[0]);
    // an echo
    connection?.on('message', (data) => (data === 'bye' ? connection.close(4001, 'see you') : connection.send(data)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as { port: number };
  const { status, connection, protocol } = await handshake(`http://127.0.0.1:${port}/`, 'chat, json');
  assert.equal(status, 101);
  assert.equal(protocol, 'chat');
  const client = connection!;
  client.send('hello');
  assert.deepEqual(await next(client, 'message'), ['hello']);
  const big = crypto.randomBytes(70_000);
  client.send(big);
  const [echoed] = await next<[Buffer]>(client, 'message');
  assert.ok(Buffer.isBuffer(echoed) && echoed.equals(big));
  client.send('bye');
  assert.deepEqual(await next(client, 'close'), [4001, 'see you']);
});

test('a WebSocket closed without a code or without a close frame reads 1005 or 1006 on the other side', async (t) => {
  const pair = async () => {
    const accepted = new Promise<net.Socket>((resolve) => server.once('connection', resolve));
    const client = net.connect((server.address() as net.AddressInfo).port, '127.0.0.1');
    const serverSide = new WebSocketConnection(await accepted);
    return { serverSide, clientSide: new WebSocketConnection(client, undefined, { client: true }) };
  };
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  let { serverSide, clientSide } = await pair();
  let closed = next(clientSide, 'close');
  serverSide.close(1005);
  assert.deepEqual(await closed, [1005, '']);

  ({ serverSide, clientSide } = await pair());
  closed = next(clientSide, 'close');
  serverSide.destroy();
  assert.deepEqual(await closed, [1006, '']);

  ({ serverSide, clientSide } = await pair());
  closed = next(clientSide, 'close');
  serverSide.close(1006, 'gone');
  assert.deepEqual(await closed, [1000, 'gone'], 'a close frame can\'t say 1006');
});

test('the proxy\'s WebSockets reach network.domains only, and never the local network', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktopengine-sdk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, network: { domains: ['ws.example.com'] } }));
  fs.writeFileSync(path.join(dir, 'index.js'), '\n');
  const server = new WebDevServer({ projectDir: dir, watch: false });
  await server.start();
  t.after(() => server.stop());
  const reports: { url: string; status: number | string }[] = [];
  server.on('proxy', (entry) => reports.push(entry));
  const proxy = (target: string, token = server.proxyToken) => `http://127.0.0.1:${server.port}/proxy?token=${token}&url=${encodeURIComponent(target)}`;

  assert.equal((await handshake(proxy('wss://ws.example.com/', server.token))).status, 403, 'the proxy\'s token only');
  assert.equal((await handshake(`http://127.0.0.1:${server.port}/events?token=${server.token}`)).status, 403, 'WebSockets are the proxy\'s only');
  const undeclared = await handshake(proxy('wss://example.com/'));
  assert.equal(undeclared.status, 403);
  assert.match(undeclared.body, /network\.domains/);
  assert.equal((await handshake(proxy('https://ws.example.com/'))).status, 400, 'ws: or wss:');
  assert.equal((await handshake(proxy('wss://127.0.0.1/'))).status, 403);
  // a declared domain that resolves to the local network
  const original = dns.lookup;
  (dns as { lookup: unknown }).lookup = async () => [{ address: '127.0.0.1', family: 4 }];
  t.after(() => {
    (dns as { lookup: unknown }).lookup = original;
  });
  const local = await handshake(proxy('wss://ws.example.com/socket'));
  assert.equal(local.status, 403);
  assert.match(local.body, /local network/);
  assert.deepEqual(reports.at(-1), { url: 'wss://ws.example.com/socket', status: 'ws.example.com resolves to the local network' });
});

test('dev --web\'s proxy sends every method, the review\'s GET and HEAD only', async (t) => {
  // the review node's proxy: no options
  const review = http.createServer((request, response) => {
    void proxyPreviewRequest(manifest, new URL(request.url!, 'http://localhost'), request, response);
  });
  await new Promise<void>((resolve) => review.listen(0, '127.0.0.1', resolve));
  t.after(() => review.close());
  const reviewProxy = `http://127.0.0.1:${(review.address() as { port: number }).port}/?url=${encodeURIComponent('https://api.example.com/v1')}`;
  const refused = await fetch(reviewProxy, { method: 'POST', body: '{}' });
  assert.equal(refused.status, 405);
  assert.match(await refused.text(), /GET and HEAD/);
  assert.equal((await fetch(reviewProxy, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } })).status, 405);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktopengine-sdk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'index.js'), '\n');
  const server = new WebDevServer({ projectDir: dir, watch: false });
  await server.start();
  t.after(() => server.stop());
  const reports: { url: string; status: number | string; method?: string }[] = [];
  server.on('proxy', (entry) => reports.push(entry));
  const proxy = (target: string) => `http://127.0.0.1:${server.port}/proxy?token=${server.proxyToken}&url=${encodeURIComponent(target)}`;
  assert.match(await (await fetch(`http://127.0.0.1:${server.port}/?token=${server.token}`)).text(), /proxySendsAnyMethod: true/);

  // the browser's question before a request with another method or headers
  const preflight = await fetch(proxy('https://api.example.com/v1'), {
    method: 'OPTIONS',
    headers: { 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'PUT');
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'authorization,content-type');
  // headers the review refuses: the terminal says so
  assert.deepEqual(reports.at(-1), { url: 'https://api.example.com/v1', status: 204, method: 'PUT', asked: 'authorization,content-type' });
  const reported = reports.length;
  await fetch(proxy('https://api.example.com/v1'), { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'DELETE' } });
  assert.equal(reports.length, reported, 'a method alone is reported with its request');

  const undeclared = await fetch(proxy('https://example.com/'), { method: 'POST', body: 'x' });
  assert.equal(undeclared.status, 403);
  assert.deepEqual(reports.at(-1), { url: 'https://example.com/', status: 'not in network.domains', method: 'POST' });
  const trace = await new Promise<number>((resolve, reject) => {
    http.request(proxy('https://api.example.com/v1'), { method: 'TRACE' }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    }).on('error', reject).end();
  });
  assert.equal(trace, 405);
  // read before anything is sent: no more than 20 MB
  const large = await fetch(proxy('https://api.example.com/upload'), { method: 'PUT', body: new Uint8Array(20 * 1024 * 1024 + 1) });
  assert.equal(large.status, 413);
  // a declared domain that resolves to the local network
  const original = dns.lookup;
  (dns as { lookup: unknown }).lookup = async () => [{ address: '127.0.0.1', family: 4 }];
  t.after(() => {
    (dns as { lookup: unknown }).lookup = original;
  });
  const local = await fetch(proxy('https://api.example.com/v1'), { method: 'DELETE' });
  assert.equal(local.status, 403);
  assert.match(await local.text(), /local network/);
});

test('dev --web serves the desktop page, the build, its files and the logs', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktopengine-sdk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'index.js'), 'console.log("hi");\n');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'data.bin'), Buffer.from([1, 2, 3]));

  const server = new WebDevServer({ projectDir: dir, watch: false, launch: { size: 'small' } });
  await server.start();
  t.after(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  const get = (route: string, token = server.token) => fetch(`${base}${route}${route.includes('?') ? '&' : '?'}token=${token}`);

  assert.equal((await get('/', 'wrong')).status, 403);
  assert.equal((await fetch(`${base}/package`)).status, 403);
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /import \{ WebDesktop \} from '\.\/desktop\.js\?token=/);

  const build = (await (await get('/package')).json()) as {
    revision: number; manifest: Manifest; code: string; files: string[]; launch: unknown; sizes: unknown; defaultSize: unknown;
  };
  assert.equal(build.revision, 1);
  assert.equal(build.manifest.id, manifest.id);
  assert.equal(build.code, 'console.log("hi");\n');
  assert.deepEqual(build.launch, { size: 'small' });
  assert.deepEqual(build.sizes, [{ id: 'small', name: 'small' }]);
  assert.equal(build.defaultSize, 'small');
  assert.ok(build.files.includes('assets/data.bin'));
  assert.ok(!build.files.includes('index.js'));
  assert.deepEqual([...new Uint8Array(await (await get('/files/assets/data.bin')).arrayBuffer())], [1, 2, 3]);
  assert.equal((await get('/files/..%2Fmanifest.json')).status, 404);

  const logged = new Promise((resolve) => server.once('log', resolve));
  await fetch(`${base}/log?token=${server.token}`, { method: 'POST', body: JSON.stringify({ kind: 'exception', message: 'Error: boom', stack: 'at desktopengine:///Web/index.js:1:1' }) });
  assert.deepEqual(await logged, { kind: 'exception', level: undefined, message: 'Error: boom', stack: 'at desktopengine:///Web/index.js:1:1' });

  // the frame's token is the proxy's only: its content can't read the project or write to the terminal
  assert.match(await (await get('/')).text(), new RegExp(`/proxy\\?token=' \\+ "${server.proxyToken}"`));
  assert.equal((await get('/package', server.proxyToken)).status, 403);
  assert.equal((await get('/log', server.proxyToken)).status, 403);
  const undeclared = `/proxy?url=${encodeURIComponent('https://example.com/')}`;
  assert.equal((await get(undeclared)).status, 403, 'the page token is not the proxy token');
  const denied = await get(undeclared, server.proxyToken);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), '*', 'the sandboxed frame reads the answer');
  assert.match(await denied.text(), /network\.domains|not declared|isn't/i);
  assert.equal((await get(`/proxy?url=${encodeURIComponent('https://127.0.0.1/')}`, server.proxyToken)).status, 403);

  // the page hears of every build
  const events = await get('/events');
  const reader = events.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const until = async (pattern: RegExp) => {
    while (!pattern.test(text)) text += decoder.decode((await reader.read()).value);
  };
  await until(/data: 1\n\n/);
  fs.writeFileSync(path.join(dir, 'index.js'), 'console.log("again");\n');
  await server.rebuild();
  await until(/data: 2\n\n/);
  await reader.cancel();
  assert.equal(((await (await get('/package')).json()) as { code: string }).code, 'console.log("again");\n');

  // the size picker lists sizes smallest first, as the app does; the default stays the first the manifest declares
  const compact = { id: 'compact', width: 300, height: 133, name: { en: 'Compact', 'zh-Hans': '紧凑' } };
  const tall = { id: 'tall', width: 164, height: 344, name: 'Tall' };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, apiVersion: 8, widget: { sizes: ['large', tall, compact, 'medium', 'small'] } }));
  await server.rebuild();
  const sized = (await (await get('/package')).json()) as { sizes: unknown; defaultSize: unknown };
  assert.deepEqual(sized.sizes, [
    { id: 'small', name: 'small' }, { id: 'compact', name: 'Compact' }, { id: 'tall', name: 'Tall' }, { id: 'medium', name: 'medium' }, { id: 'large', name: 'large' },
  ]);
  assert.equal(sized.defaultSize, 'large');
});

test('the web runtime is built next to the command line', { skip: !fs.existsSync(path.join(import.meta.dirname, '..', 'dist', 'web', 'desktop.js')) && 'npm run build first' }, () => {
  const source = fs.readFileSync(webRuntimePath(), 'utf8');
  assert.match(source, /export\s*\{[^}]*WebDesktop/);
});

test('content on the web sees the engine\'s globals, not the host\'s', async () => {
  const { contentFunction } = await import('../web/frame/realm.ts');
  const run = (code: string, parameters: string[] = [], ...args: unknown[]) => contentFunction(code, 'desktopengine:///test/index.js', parameters)(...args);
  // Node's own globals stand in for the browser's here
  assert.equal(run('return typeof process'), 'undefined');
  assert.equal(run('return typeof globalThis.process'), 'undefined');
  assert.equal(run('return "process" in self'), false);
  assert.equal(run('"use strict"; return [typeof Math, typeof setTimeout, typeof fetch, this === globalThis, self === globalThis].join()'), 'object,function,function,true,true');
  // stand-ins a library installs stay the content's
  assert.equal(run('globalThis.process ??= { stand: "in" }; return process.stand'), 'in');
  assert.equal(typeof (process as unknown as Record<string, unknown>).stand, 'undefined');
  assert.equal(run('leaked = 1; return globalThis.leaked'), 1);
  assert.equal((globalThis as Record<string, unknown>).leaked, undefined);
  // parameters (require, module, exports) win over the scope
  assert.equal(run('return module.id + exports', ['module', 'exports'], { id: 'm' }, 'e'), 'me');
});
