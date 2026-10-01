// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import type { Manifest } from '../src/manifest.ts';
import { WebDevServer, allowedByManifest, isLocalAddress, proxyPreviewRequest, webRuntimePath } from '../src/web-dev.ts';

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
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd12::1', '::ffff:192.168.0.1', '::ffff:7f00:1', '::127.0.0.1', '64:ff9b::a9fe:a9fe', '64:ff9b::192.168.1.1', '2002:c0a8:101::1']) {
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

  const build = (await (await get('/package')).json()) as { revision: number; manifest: Manifest; code: string; files: string[]; launch: unknown };
  assert.equal(build.revision, 1);
  assert.equal(build.manifest.id, manifest.id);
  assert.equal(build.code, 'console.log("hi");\n');
  assert.deepEqual(build.launch, { size: 'small' });
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
