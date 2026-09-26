// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateManifest, API_VERSION } from '../src/manifest.ts';
import type { Manifest } from '../src/manifest.ts';
import { readZip } from '../src/zip.ts';
import { packProject } from '../src/project.ts';
import { buildProject, isBundledProject } from '../src/build.ts';
import { DevServer, launchRequest } from '../src/dev.ts';
import type { ServerMessage } from '../src/dev.ts';
import { acceptKey } from '../src/websocket.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'desktopengine-sdk-'));
}

function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
}

const widgetManifest: Manifest = {
  id: 'com.example.bundled',
  name: '打包',
  type: 'widget',
  version: '1.2.0',
  apiVersion: 1,
  icon: 'assets/icon.png',
  widget: { sizes: ['small', 'medium'] },
  parameters: [
    { key: 'accent', title: '强调色', type: 'color', default: '#0A84FF' },
    { key: 'count', title: '数量', type: 'number', default: 3 },
    { key: 'dark', title: '深色', type: 'toggle', default: false },
    { key: 'unit', title: '单位', type: 'choice', options: [{ value: 'c', title: '摄氏' }, { value: 1, title: '一' }], default: 'c' },
  ],
};

/** A TypeScript project that imports a local module and an npm package. */
function bundledProject(): string {
  const dir = tempDir();
  writeFiles(dir, {
    'manifest.json': JSON.stringify(widgetManifest),
    'assets/icon.png': 'png',
    'package.json': '{"private":true}',
    'src/index.ts': [
      "import { greet } from './greet';",
      "import pad from 'left-pad-lite';",
      'const options: { name?: string } = {};',
      "globalThis.result = pad(greet(options?.name ?? 'world'), 14);",
    ].join('\n'),
    'src/greet.ts': 'export const greet = (name: string): string => `hello ${name}`;\n',
    'node_modules/left-pad-lite/package.json': JSON.stringify({ name: 'left-pad-lite', module: 'index.mjs', main: 'index.cjs' }),
    'node_modules/left-pad-lite/index.mjs': "export default (text, length) => text.padStart(length, '.');\n",
    'node_modules/left-pad-lite/index.cjs': "module.exports = () => 'wrong entry';\n",
  });
  return dir;
}

test('apiVersion must be a positive integer, newer ones are a warning', () => {
  const base = { id: 'a.b', name: 'n', type: 'wallpaper', version: '1.0.0', icon: 'i.png' };
  assert.deepEqual(validateManifest({ ...base, apiVersion: API_VERSION }).errors, []);
  assert.ok(validateManifest({ ...base, apiVersion: 0 }).errors.some((message) => message.includes('apiVersion')));
  assert.ok(validateManifest({ ...base, apiVersion: '1' }).errors.some((message) => message.includes('apiVersion')));
  const newer = validateManifest({ ...base, apiVersion: API_VERSION + 1 });
  assert.deepEqual(newer.errors, []);
  assert.ok(newer.warnings.some((message) => message.includes('apiVersion')));
});

test('build asks for npm install when a dependency isn\'t installed', async () => {
  const dir = bundledProject();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ private: true, dependencies: { 'left-pad-lite': '1.0.0', three: '^0.186.1' } }));
  await assert.rejects(buildProject({ projectDir: dir }), /three isn't installed: run npm install in /);
});

test('build bundles src/ into one global script with the assets', async () => {
  const dir = bundledProject();
  assert.ok(isBundledProject(dir));

  const { packageDir, files, bundled } = await buildProject({ projectDir: dir });
  assert.ok(bundled);
  assert.equal(packageDir, path.join(dir, 'dist', 'package'));
  assert.deepEqual(files, ['assets/icon.png', 'index.js', 'manifest.json']);

  const script = fs.readFileSync(path.join(packageDir, 'index.js'), 'utf8');
  // no module syntax left, the engine evaluates it as a script
  assert.doesNotMatch(script, /^\s*(import|export)\s/m);
  assert.doesNotMatch(script, /sourceMappingURL/);
  const context = vm.createContext({});
  vm.runInContext(script, context);
  assert.equal(context.result, '...hello world');
});

test('a project without src/ is packed as it is', async () => {
  const dir = tempDir();
  writeFiles(dir, {
    'manifest.json': JSON.stringify(widgetManifest),
    'assets/icon.png': 'png',
    'index.js': "require('./lib/clock.js');\n",
    'lib/clock.js': 'module.exports = 1;\n',
  });
  assert.ok(!isBundledProject(dir));
  const { packageDir, files, bundled } = await buildProject({ projectDir: dir });
  assert.ok(!bundled);
  assert.equal(packageDir, dir);
  assert.deepEqual(files, ['assets/icon.png', 'index.js', 'lib/clock.js', 'manifest.json']);
  // untouched: the engine's require() loads lib/clock.js at run time
  assert.equal(fs.readFileSync(path.join(packageDir, 'index.js'), 'utf8'), "require('./lib/clock.js');\n");
});

test('development builds inline a source map', async () => {
  const dir = bundledProject();
  await buildProject({ projectDir: dir, mode: 'development' });
  const script = fs.readFileSync(path.join(dir, 'dist', 'package', 'index.js'), 'utf8');
  assert.match(script, /sourceMappingURL=data:application\/json/);
});

test('build errors carry the location', async () => {
  const dir = bundledProject();
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), "import './missing';\n");
  await assert.rejects(buildProject({ projectDir: dir }), /Build failed[\s\S]*missing/);
});

test('a root index.js next to src/ is refused', async () => {
  const dir = bundledProject();
  fs.writeFileSync(path.join(dir, 'index.js'), '');
  await assert.rejects(buildProject({ projectDir: dir }), /delete the index\.js at the root/);
});

test('pack zips the built package of a bundled project', async () => {
  const dir = bundledProject();
  const { output } = await packProject({ packageDir: dir });
  assert.equal(path.basename(output), 'com.example.bundled-1.2.0.zip');
  const names = readZip(fs.readFileSync(output)).map((entry) => entry.name);
  assert.deepEqual(names, ['assets/icon.png', 'index.js', 'manifest.json']);
});

test('the CLI builds a bundled project', () => {
  const dir = bundledProject();
  const result = spawnSync(process.execPath, [CLI, 'build', dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'dist', 'package', 'index.js')));
});

test('launchRequest turns flags into launch options', () => {
  const { launch, warnings } = launchRequest(widgetManifest, {
    size: 'large',
    level: 'floating',
    display: '2',
    position: '10, -20.5',
    params: ['accent=#FF0000', 'count=7', 'dark=true', 'unit=1'],
  });
  assert.deepEqual(launch, {
    size: 'large',
    level: 'floating',
    display: 2,
    position: { x: 10, y: -20.5 },
    parameters: { accent: '#FF0000', count: 7, dark: true, unit: 1 },
  });
  assert.ok(warnings.some((message) => message.includes('large')));

  assert.throws(() => launchRequest(widgetManifest, { size: 'huge' }), /--size/);
  assert.throws(() => launchRequest(widgetManifest, { display: '0' }), /--display/);
  assert.throws(() => launchRequest(widgetManifest, { params: ['missing=1'] }), /declares no parameter/);
  assert.throws(() => launchRequest(widgetManifest, { params: ['count=abc'] }), /must be a number/);
  assert.throws(() => launchRequest(widgetManifest, { params: ['unit=f'] }), /must be one of/);
});

test('acceptKey matches the RFC 6455 example', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('dev serves the package to the app and relays its messages', async (t) => {
  if (typeof WebSocket !== 'function') {
    t.skip('this Node.js has no WebSocket client');
    return;
  }
  const dir = bundledProject();
  const server = new DevServer({ projectDir: dir, launch: { size: 'medium' }, watch: true, metrics: true });
  await server.start();
  t.after(() => server.stop());

  const base = `127.0.0.1:${server.port}`;

  // without the token nothing is served
  assert.equal((await fetch(`http://${base}/package.zip`)).status, 403);
  await assert.rejects(new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://${base}/session?token=wrong`);
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('refused'));
  }), /refused/);

  // what the app does
  const socket = new WebSocket(`ws://${base}/session?token=${server.token}`);
  const received: ServerMessage[] = [];
  let notify: (() => void) | null = null;
  socket.onmessage = (event) => {
    received.push(JSON.parse(String(event.data)));
    notify?.();
  };
  const next = async <T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> => {
    for (;;) {
      const index = received.findIndex((message) => message.type === type);
      if (index >= 0) return received.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      await new Promise<void>((resolve) => { notify = resolve; });
    }
  };
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('could not connect'));
  });
  const connected = once(server, 'connected');
  socket.send(JSON.stringify({ type: 'hello', app: '1.0', apiVersion: 1 }));
  await connected;

  // --perf
  assert.deepEqual(await next('metrics'), { type: 'metrics', enabled: true });

  const load = await next('load');
  assert.equal(load.revision, 1);
  assert.deepEqual(load.launch, { size: 'medium' });
  const response = await fetch(load.url);
  assert.equal(response.status, 200);
  const names = readZip(Buffer.from(await response.arrayBuffer())).map((entry) => entry.name);
  assert.ok(names.includes('index.js'));

  const relayed = once(server, 'app');
  socket.send(JSON.stringify({ type: 'console', level: 'log', message: '你好' }));
  const [message] = await relayed;
  assert.deepEqual(message, { type: 'console', level: 'log', message: '你好' });

  // a saved file builds again and reloads
  fs.writeFileSync(path.join(dir, 'src', 'greet.ts'), 'export const greet = (name: string): string => `hi ${name}`;\n');
  const reload = await next('load');
  assert.equal(reload.revision, 2);

  const disconnected = once(server, 'disconnected');
  const stopping = next('stop');
  await server.stop();
  await stopping;
  await disconnected;
  socket.close();
});
