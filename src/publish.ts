// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// Publishing to the DesktopEngine store: `desktopengine login` signs in with a device code (a short code confirmed in
// the browser), `publish` packs the project, uploads it as a new version of its item and optionally submits it for
// review or makes a test link. The token is kept in ~/.config/desktopengine/credentials.json (readable only by you).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { englishText, type Manifest } from './manifest.ts';
import { packProject } from './project.ts';
import { readZip } from './zip.ts';

export const DEFAULT_API = 'https://api.desktopengine.app';

/** The API to use: `--api`, then DESKTOPENGINE_API, then the store's */
export function apiBase(flag?: string): string {
  return (flag || process.env.DESKTOPENGINE_API || DEFAULT_API).replace(/\/+$/, '');
}

export function credentialsFile(): string {
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(config, 'desktopengine', 'credentials.json');
}

interface Credentials {
  [api: string]: { token: string; email?: string };
}

function readCredentials(): Credentials {
  try {
    return JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')) as Credentials;
  } catch {
    return {};
  }
}

function writeCredentials(credentials: Credentials): void {
  const file = credentialsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // a new file made readable only by its owner, then moved over the old one: the token is never in a file others can read
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(credentials, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}

/** The token for this API: DESKTOPENGINE_TOKEN (for CI), or the one `login` kept */
export function storedToken(api: string): string | undefined {
  return process.env.DESKTOPENGINE_TOKEN || readCredentials()[api]?.token;
}

export class APIError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function call<T>(api: string, method: string, route: string, { token, json, body, headers = {} }: { token?: string; json?: unknown; body?: Uint8Array; headers?: Record<string, string> } = {}): Promise<T> {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: {
      ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: json === undefined ? body : JSON.stringify(json),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // not JSON: the status says what happened
  }
  if (!response.ok) {
    const requestId = response.headers.get('X-Request-Id');
    const message = typeof data.error === 'string' ? data.error : `${response.status} ${response.statusText}`;
    throw new APIError(response.status, requestId ? `${message} (request ${requestId})` : message, data.details);
  }
  return data as T;
}

export interface LoginOptions {
  api: string;
  /** Shows the code and the address; opens the browser when it can */
  prompt: (code: string, url: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** Signs in with a device code and keeps the token */
export async function login({ api, prompt, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: LoginOptions): Promise<{ email: string }> {
  const start = await call<{ deviceCode: string; userCode: string; verificationUrlComplete: string; interval: number; expiresIn: number }>(api, 'POST', '/v1/auth/device', { json: {} });
  prompt(start.userCode, start.verificationUrlComplete);
  const deadline = Date.now() + start.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(start.interval * 1000);
    try {
      const result = await call<{ token: string; user: { email: string } }>(api, 'POST', '/v1/auth/token', { json: { deviceCode: start.deviceCode } });
      const credentials = readCredentials();
      credentials[api] = { token: result.token, email: result.user.email };
      writeCredentials(credentials);
      return { email: result.user.email };
    } catch (error) {
      if (error instanceof APIError && error.status === 400 && /authorization_pending/.test(JSON.stringify(error.details ?? '') + error.message)) continue;
      if (error instanceof APIError && error.status === 400) throw new Error('The code expired before it was confirmed, run desktopengine login again.');
      throw error;
    }
  }
  throw new Error('The code expired before it was confirmed, run desktopengine login again.');
}

export async function logout(api: string): Promise<boolean> {
  const credentials = readCredentials();
  const token = credentials[api]?.token;
  if (!token) return false;
  await call(api, 'POST', '/v1/auth/signout', { token, json: {} }).catch(() => undefined);
  delete credentials[api];
  writeCredentials(credentials);
  return true;
}

export interface PublishOptions {
  projectDir: string;
  api: string;
  /** What's new in this version: in English, or by locale (e.g. { en: '…', 'zh-Hans': '…' }), English being shown where there's no translation */
  notes?: string | Record<string, string>;
  networkPurpose?: string;
  submit?: boolean;
  testLink?: boolean;
  debug?: boolean;
  /** The store's category for it, e.g. clock; see the categories of the API */
  category?: string;
  /** Where the content comes from: original, licensed (with copyrightNote: from whom) or open (copyrightNote: the license) */
  copyright?: string;
  copyrightNote?: string;
  minify?: boolean;
  log?: (line: string) => void;
}

export interface PublishResult {
  id: string;
  version: string;
  status: string;
  warnings: string[];
  errors: string[];
  testLink?: string;
}

interface VersionSummary {
  version: string;
  status: string;
  report?: { errors?: string[]; warnings?: string[]; flags?: string[] } | null;
}

const UPLOAD_LIMIT = 95 * 1024 * 1024;

/** Packs the project and uploads it as a new version of its item, which is made the first time */
export async function publish({ projectDir, api, notes, networkPurpose, submit, testLink, debug, category, copyright, copyrightNote, minify = true, log = console.log }: PublishOptions): Promise<PublishResult> {
  const token = storedToken(api);
  if (!token) throw new Error('Sign in first: desktopengine login');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'desktopengine-publish-'));
  try {
    const { output } = await packProject({ packageDir: projectDir, outDir: out, minify });
    const zip = fs.readFileSync(output);
    const manifestEntry = readZip(zip).find((entry) => entry.name === 'manifest.json');
    if (!manifestEntry) throw new Error('The package has no manifest.json');
    const manifest = JSON.parse(manifestEntry.data.toString('utf8')) as Manifest;
    const { id, version } = manifest;

    // the item, claimed the first time; its English listing from the manifest when it has none
    const mine = await call<{ items: { id: string; title: string | null; versions: VersionSummary[] }[] }>(api, 'GET', '/v1/me/items', { token });
    let item = mine.items.find((entry) => entry.id === id);
    if (!item) {
      await call(api, 'POST', '/v1/items', { token, json: { kind: 'package', id } });
      log(`Claimed ${id}`);
      item = { id, title: null, versions: [] };
    }
    if (!item.title) {
      const names = typeof manifest.name === 'string' ? { en: manifest.name } : { en: englishText(manifest.name), ...manifest.name };
      const descriptions = typeof manifest.description === 'object' && manifest.description ? manifest.description : {};
      for (const [locale, title] of Object.entries(names)) {
        const description = locale === 'en' && typeof manifest.description === 'string' ? manifest.description : (descriptions as Record<string, string>)[locale];
        await call(api, 'PUT', `/v1/items/${encodeURIComponent(id)}/listing/${encodeURIComponent(locale)}`, { token, json: { title: String(title).slice(0, 60), description } });
      }
      log('Added the store listing from manifest.json; edit it in the creator console');
    }

    // a draft or rejected version with the same number is uploaded again
    const existing = item.versions.find((entry) => entry.version === version);
    const route = `/v1/items/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`;
    if (!existing) {
      await call(api, 'POST', `/v1/items/${encodeURIComponent(id)}/versions`, { token, json: { version, notes, networkPurpose } });
    } else if (!['draft', 'rejected'].includes(existing.status)) {
      throw new Error(`Version ${version} is ${existing.status} already: raise "version" in manifest.json`);
    } else if (notes !== undefined || networkPurpose !== undefined) {
      await call(api, 'PATCH', route, { token, json: { notes, networkPurpose } });
    }

    log(`Uploading ${id} ${version} (${Math.ceil(zip.length / 1024)} KB)…`);
    let summary: VersionSummary;
    try {
      if (zip.length <= UPLOAD_LIMIT) {
        summary = await call<VersionSummary>(api, 'PUT', `${route}/upload`, { token, body: zip, headers: { 'Content-Type': 'application/zip' } });
      } else {
        const start = await call<{ uploadId: string; partSize: number }>(api, 'POST', `${route}/uploads`, { token, json: {} });
        const parts: { partNumber: number; etag: string }[] = [];
        for (let offset = 0, part = 1; offset < zip.length; offset += start.partSize, part++) {
          const uploaded = await call<{ partNumber: number; etag: string }>(api, 'PUT', `${route}/uploads/${start.uploadId}/${part}`, { token, body: zip.subarray(offset, offset + start.partSize) });
          parts.push(uploaded);
        }
        summary = await call<VersionSummary>(api, 'POST', `${route}/uploads/${start.uploadId}/complete`, { token, json: { parts } });
      }
    } catch (error) {
      // 422: uploaded, but the checks found problems
      if (error instanceof APIError && error.status === 422) {
        const versions = await call<{ versions: VersionSummary[] }>(api, 'GET', `/v1/items/${encodeURIComponent(id)}/versions`, { token });
        summary = versions.versions.find((entry) => entry.version === version) ?? { version, status: 'draft', report: { errors: [error.message] } };
      } else {
        throw error;
      }
    }
    const errors = summary.report?.errors ?? [];
    const warnings = [...(summary.report?.warnings ?? []), ...(summary.report?.flags ?? [])];
    const result: PublishResult = { id, version, status: summary.status, warnings, errors };
    if (errors.length) return result;

    // the store's details; the first version can't be submitted without a category and where the content comes from
    if (category !== undefined || copyright !== undefined || copyrightNote !== undefined) {
      const details = { category, copyright, copyrightNote };
      const changed = await call<{ pending?: boolean }>(api, 'PATCH', `/v1/items/${encodeURIComponent(id)}/details`, { token, json: details });
      if (changed.pending) log('The store details change once they are reviewed');
    }

    if (testLink) {
      const link = await call<{ url: string }>(api, 'POST', `${route}/test-link`, { token, json: { debuggable: debug === true } });
      result.testLink = link.url;
    }
    if (submit) {
      const submitted = await call<VersionSummary>(api, 'POST', `${route}/submit`, { token, json: {} });
      result.status = submitted.status;
    }
    return result;
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}
