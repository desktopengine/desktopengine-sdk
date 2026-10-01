// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { createProject } from '../src/project.ts';
import { readZip } from '../src/zip.ts';
import { credentialsFile, login, logout, publish, storedToken } from '../src/publish.ts';

interface Request {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

type Reply = { status?: number; json?: unknown };

/** A store API that answers with `handler` and remembers the requests */
async function mockAPI(t: test.TestContext, handler: (request: Request) => Reply): Promise<{ api: string; requests: Request[] }> {
  const requests: Request[] = [];
  const server = http.createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const request = { method: incoming.method ?? 'GET', url: incoming.url ?? '/', headers: incoming.headers, body: Buffer.concat(chunks) };
      requests.push(request);
      const reply = handler(request);
      response.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json', 'X-Request-Id': 'test-request' });
      response.end(reply.json === undefined ? '' : JSON.stringify(reply.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { api: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

/** Credentials go to a folder of the test's own */
function isolateConfig(t: test.TestContext): void {
  const saved = { config: process.env.XDG_CONFIG_HOME, token: process.env.DESKTOPENGINE_TOKEN };
  process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'desktopengine-config-'));
  delete process.env.DESKTOPENGINE_TOKEN;
  t.after(() => {
    if (saved.config === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.config;
    if (saved.token !== undefined) process.env.DESKTOPENGINE_TOKEN = saved.token;
  });
}

test('login waits for the code to be confirmed and keeps the token for that API only', async (t) => {
  isolateConfig(t);
  let polls = 0;
  const { api } = await mockAPI(t, (request) => {
    if (request.url === '/v1/auth/device') {
      return { json: { deviceCode: 'device', userCode: 'ABCD-EFGH', verificationUrlComplete: 'http://store.test/device?code=ABCD-EFGH', interval: 1, expiresIn: 60 } };
    }
    if (request.url === '/v1/auth/token') {
      assert.deepEqual(JSON.parse(request.body.toString()), { deviceCode: 'device' });
      polls++;
      return polls < 3 ? { status: 400, json: { error: 'authorization_pending' } } : { json: { token: 'de_secret', user: { email: 'creator@example.com' } } };
    }
    if (request.url === '/v1/auth/signout') return { status: 204 };
    return { status: 404, json: { error: 'not found' } };
  });

  let shown = '';
  const result = await login({ api, prompt: (code) => { shown = code; }, sleep: async () => {} });
  assert.equal(shown, 'ABCD-EFGH');
  assert.equal(result.email, 'creator@example.com');
  assert.equal(polls, 3);
  assert.equal(storedToken(api), 'de_secret');
  assert.equal(storedToken('http://other.test'), undefined);
  assert.equal(fs.statSync(credentialsFile()).mode & 0o777, 0o600, 'only the user can read the token');

  assert.equal(await logout(api), true);
  assert.equal(storedToken(api), undefined);
  assert.equal(await logout(api), false);
});

test('login gives up when the code expires', async (t) => {
  isolateConfig(t);
  const { api } = await mockAPI(t, (request) =>
    request.url === '/v1/auth/device'
      ? { json: { deviceCode: 'device', userCode: 'ABCD-EFGH', verificationUrlComplete: 'http://store.test/device', interval: 1, expiresIn: 60 } }
      : { status: 400, json: { error: 'expired_token' } },
  );
  await assert.rejects(login({ api, prompt: () => {}, sleep: async () => {} }), /expired/);
});

function makeProject(): string {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'desktopengine-publish-')), 'clock');
  createProject({ type: 'widget', targetDir: dir, id: 'app.desktopengine.acme.clock', name: 'Clock' });
  return dir;
}

test('publish claims the item, uploads the package and submits it', async (t) => {
  isolateConfig(t);
  process.env.DESKTOPENGINE_TOKEN = 'de_ci';
  const project = makeProject();
  const { api, requests } = await mockAPI(t, (request) => {
    assert.equal(request.headers.authorization, 'Bearer de_ci');
    const route = `${request.method} ${request.url}`;
    if (route === 'GET /v1/me/items') return { json: { items: [] } };
    if (route === 'POST /v1/items') return { status: 201, json: { id: 'app.desktopengine.acme.clock' } };
    if (request.method === 'PUT' && request.url.startsWith('/v1/items/app.desktopengine.acme.clock/listing/')) return { json: {} };
    if (route === 'POST /v1/items/app.desktopengine.acme.clock/versions') return { status: 201, json: { version: '1.0.0', status: 'draft' } };
    if (route === 'PUT /v1/items/app.desktopengine.acme.clock/versions/1.0.0/upload') {
      return { json: { version: '1.0.0', status: 'draft', report: { errors: [], warnings: ['a warning'], flags: [] } } };
    }
    if (route === 'PATCH /v1/items/app.desktopengine.acme.clock/details') return { json: { ok: true, pending: false } };
    if (route === 'POST /v1/items/app.desktopengine.acme.clock/versions/1.0.0/test-link') return { status: 201, json: { url: 'desktopengine://install?test=1' } };
    if (route === 'POST /v1/items/app.desktopengine.acme.clock/versions/1.0.0/submit') return { json: { version: '1.0.0', status: 'queued' } };
    return { status: 404, json: { error: `unexpected ${route}` } };
  });

  const result = await publish({ projectDir: project, api, notes: 'first', submit: true, testLink: true, category: 'clock', copyright: 'original', log: () => {} });
  assert.deepEqual(result, { id: 'app.desktopengine.acme.clock', version: '1.0.0', status: 'queued', warnings: ['a warning'], errors: [], testLink: 'desktopengine://install?test=1' });

  const claim = requests.find((request) => request.method === 'POST' && request.url === '/v1/items')!;
  assert.deepEqual(JSON.parse(claim.body.toString()), { kind: 'package', id: 'app.desktopengine.acme.clock' });
  // the listing comes from the manifest's name and description, every language it has
  const listings = requests.filter((request) => request.url.includes('/listing/')).map((request) => request.url.split('/').pop());
  assert.ok(listings.includes('en'));
  const version = requests.find((request) => request.url === '/v1/items/app.desktopengine.acme.clock/versions')!;
  assert.equal(JSON.parse(version.body.toString()).notes, 'first');
  // the upload is the packed zip, with the built index.js and not the sources
  const upload = requests.find((request) => request.url.endsWith('/upload'))!;
  assert.equal(upload.headers['content-type'], 'application/zip');
  const names = readZip(upload.body).map((entry) => entry.name);
  assert.ok(names.includes('manifest.json') && names.includes('index.js'));
  assert.ok(!names.some((name) => name.startsWith('src/')));
  // the store details go before submitting
  const details = requests.findIndex((request) => request.url.endsWith('/details'));
  assert.deepEqual(JSON.parse(requests[details].body.toString()), { category: 'clock', copyright: 'original' });
  assert.ok(details < requests.findIndex((request) => request.url.endsWith('/submit')));
  const link = requests.find((request) => request.url.endsWith('/test-link'))!;
  assert.deepEqual(JSON.parse(link.body.toString()), { debuggable: false });
});

test('publish stops when the checks find problems, and reuses a rejected version', async (t) => {
  isolateConfig(t);
  process.env.DESKTOPENGINE_TOKEN = 'de_ci';
  const project = makeProject();
  const { api, requests } = await mockAPI(t, (request) => {
    const route = `${request.method} ${request.url}`;
    if (route === 'GET /v1/me/items') {
      return { json: { items: [{ id: 'app.desktopengine.acme.clock', title: 'Clock', versions: [{ version: '1.0.0', status: 'rejected' }] }] } };
    }
    if (route === 'PATCH /v1/items/app.desktopengine.acme.clock/versions/1.0.0') return { json: {} };
    if (route === 'PUT /v1/items/app.desktopengine.acme.clock/versions/1.0.0/upload') return { status: 422, json: { error: 'the package has problems' } };
    if (route === 'GET /v1/items/app.desktopengine.acme.clock/versions') {
      return { json: { versions: [{ version: '1.0.0', status: 'draft', report: { errors: ['index.js is missing'], warnings: [] } }] } };
    }
    return { status: 404, json: { error: `unexpected ${route}` } };
  });

  const result = await publish({ projectDir: project, api, notes: 'fixed', submit: true, log: () => {} });
  assert.deepEqual(result.errors, ['index.js is missing']);
  assert.equal(result.status, 'draft');
  assert.ok(!requests.some((request) => request.url.endsWith('/submit')), 'nothing with errors is submitted');
  assert.ok(!requests.some((request) => request.method === 'POST' && request.url.endsWith('/versions')), 'the rejected version is uploaded again');
  assert.ok(!requests.some((request) => request.url.includes('/listing/')), 'an item with a listing keeps it');
});

test('publish refuses a version that is already in review', async (t) => {
  isolateConfig(t);
  process.env.DESKTOPENGINE_TOKEN = 'de_ci';
  const project = makeProject();
  const { api } = await mockAPI(t, () => ({ json: { items: [{ id: 'app.desktopengine.acme.clock', title: 'Clock', versions: [{ version: '1.0.0', status: 'in_review' }] }] } }));
  await assert.rejects(publish({ projectDir: project, api, log: () => {} }), /in_review already: raise "version"/);
});

test('publish needs a token', async (t) => {
  isolateConfig(t);
  await assert.rejects(publish({ projectDir: makeProject(), api: 'http://127.0.0.1:9', log: () => {} }), /desktopengine login/);
});
