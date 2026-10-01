// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// DesktopEngine.fs and require on the web: the package's files (read-only, sent by the host), and `defile://usr/` and
// `defile://temp/` kept in memory, so they're gone when the page closes. The same paths, errors and limits as the
// engine: `..` stays inside each root, 100 MB in each of usr and temp.

import { contentFunction } from './realm.ts';

const QUOTA = 100 * 1024 * 1024;
const encoder = new TextEncoder();

interface Entry {
  data: Uint8Array;
  mtime: number;
  birthtime: number;
}

class Location {
  readonly files = new Map<string, Entry>();
  readonly directories = new Set<string>(['']);
  readonly created = Date.now();

  constructor(
    readonly name: 'package' | 'usr' | 'temp',
    readonly readOnly: boolean,
  ) {}

  get size(): number {
    let total = 0;
    for (const entry of this.files.values()) total += entry.data.byteLength;
    return total;
  }
}

const locations = {
  package: new Location('package', true),
  usr: new Location('usr', false),
  temp: new Location('temp', false),
};

export class FileSystemError extends Error {
  code: string;
  syscall: string;
  path: string;
  errno: number;

  constructor(code: string, syscall: string, path: string) {
    const descriptions: Record<string, [number, string]> = {
      ENOENT: [-2, 'no such file or directory'],
      EEXIST: [-17, 'file already exists'],
      ENOTDIR: [-20, 'not a directory'],
      EISDIR: [-21, 'illegal operation on a directory'],
      ENOTEMPTY: [-66, 'directory not empty'],
      EACCES: [-13, 'permission denied'],
      EINVAL: [-22, 'invalid argument'],
      ENOSPC: [-28, 'no space left on device'],
    };
    const [errno, description] = descriptions[code] ?? [-1, code];
    super(`${code}: ${description}, ${syscall} '${path}'`);
    this.name = 'Error';
    this.code = code;
    this.syscall = syscall;
    this.path = path;
    this.errno = errno;
  }
}

/** Puts the package's files in place */
export function loadPackage(files: Record<string, ArrayBuffer>, code: string): void {
  const location = locations.package;
  for (const [path, data] of Object.entries(files)) {
    const parts = path.split('/').filter(Boolean);
    for (let index = 1; index < parts.length; index++) location.directories.add(parts.slice(0, index).join('/'));
    location.files.set(parts.join('/'), { data: new Uint8Array(data), mtime: location.created, birthtime: location.created });
  }
  location.files.set('index.js', { data: encoder.encode(code), mtime: location.created, birthtime: location.created });
}

/** A path's location and its normalized path there; null when it's no file path */
function resolve(path: unknown, syscall: string): { location: Location; path: string; given: string } {
  if (typeof path !== 'string') throw new TypeError('The "path" argument must be of type string');
  const given = path;
  if (/\0/.test(path)) throw new FileSystemError('EINVAL', syscall, given);
  let location: Location = locations.package;
  let rest = path;
  const match = /^defile:\/\/(usr|temp)(\/|$)/.exec(path);
  if (match) {
    location = locations[match[1] as 'usr' | 'temp'];
    rest = path.slice(match[0].length);
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new FileSystemError('EACCES', syscall, given);
  }
  const parts: string[] = [];
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new FileSystemError('EACCES', syscall, given);
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return { location, path: parts.join('/'), given };
}

const parentOf = (path: string): string => path.split('/').slice(0, -1).join('/');

function encode(data: unknown, encoding: string | null | undefined): Uint8Array {
  if (typeof data === 'string') return fromString(data, encoding ?? 'utf8');
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  throw new TypeError('The "data" argument must be a string, an ArrayBuffer or a view of one');
}

function fromString(text: string, encoding: string): Uint8Array {
  switch (encoding.toLowerCase()) {
    case 'utf8':
    case 'utf-8':
      return encoder.encode(text);
    case 'ascii':
    case 'latin1':
    case 'binary':
      return Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);
    case 'base64':
    case 'base64url': {
      const normal = text.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
      const binary = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4));
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
    case 'hex': {
      const bytes = new Uint8Array(Math.floor(text.length / 2));
      for (let index = 0; index < bytes.length; index++) bytes[index] = parseInt(text.substr(index * 2, 2), 16);
      return bytes;
    }
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le': {
      const bytes = new Uint8Array(text.length * 2);
      for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        bytes[index * 2] = code & 0xff;
        bytes[index * 2 + 1] = code >> 8;
      }
      return bytes;
    }
    default:
      throw new TypeError(`Unknown encoding: ${encoding}`);
  }
}

export function toString(bytes: Uint8Array, encoding: string): string {
  switch (encoding.toLowerCase()) {
    case 'utf8':
    case 'utf-8':
      return new TextDecoder().decode(bytes);
    case 'ascii':
      return Array.from(bytes, (byte) => String.fromCharCode(byte & 0x7f)).join('');
    case 'latin1':
    case 'binary':
      return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    case 'base64':
    case 'base64url': {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const base64 = btoa(binary);
      return encoding === 'base64url' ? base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : base64;
    }
    case 'hex':
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le': {
      let text = '';
      for (let index = 0; index + 1 < bytes.length; index += 2) text += String.fromCharCode(bytes[index] | (bytes[index + 1] << 8));
      return text;
    }
    default:
      throw new TypeError(`Unknown encoding: ${encoding}`);
  }
}

function encodingOf(options: unknown): string | null {
  if (typeof options === 'string') return options;
  if (options && typeof options === 'object' && typeof (options as { encoding?: unknown }).encoding === 'string') return (options as { encoding: string }).encoding;
  return null;
}

class Stats {
  readonly size: number;
  readonly mode: number;
  readonly atimeMs: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;

  constructor(
    private readonly directory: boolean,
    size: number,
    mtime: number,
    birthtime: number,
    readOnly: boolean,
  ) {
    this.size = size;
    this.mode = directory ? (readOnly ? 0o40555 : 0o40755) : readOnly ? 0o100444 : 0o100644;
    this.atimeMs = mtime;
    this.mtimeMs = mtime;
    this.ctimeMs = mtime;
    this.birthtimeMs = birthtime;
  }

  isFile(): boolean {
    return !this.directory;
  }

  isDirectory(): boolean {
    return this.directory;
  }

  isSymbolicLink(): boolean {
    return false;
  }

  get atime(): Date {
    return new Date(this.atimeMs);
  }

  get mtime(): Date {
    return new Date(this.mtimeMs);
  }

  get ctime(): Date {
    return new Date(this.ctimeMs);
  }

  get birthtime(): Date {
    return new Date(this.birthtimeMs);
  }
}

function writable(target: { location: Location; given: string }, syscall: string): void {
  if (target.location.readOnly) throw new FileSystemError('EACCES', syscall, target.given);
}

function reserve(location: Location, change: number, syscall: string, given: string): void {
  if (change > 0 && location.size + change > QUOTA) throw new FileSystemError('ENOSPC', syscall, given);
}

const sync = {
  readFileSync(path: unknown, options?: unknown): ArrayBuffer | string {
    const target = resolve(path, 'open');
    if (target.location.directories.has(target.path)) throw new FileSystemError('EISDIR', 'read', target.given);
    const entry = target.location.files.get(target.path);
    if (!entry) throw new FileSystemError('ENOENT', 'open', target.given);
    const encoding = encodingOf(options);
    return encoding ? toString(entry.data, encoding) : entry.data.slice().buffer;
  },

  writeFileSync(path: unknown, data: unknown, options?: unknown): void {
    const target = resolve(path, 'open');
    writable(target, 'open');
    if (target.location.directories.has(target.path)) throw new FileSystemError('EISDIR', 'open', target.given);
    if (!target.location.directories.has(parentOf(target.path))) throw new FileSystemError('ENOENT', 'open', target.given);
    const bytes = encode(data, encodingOf(options));
    const previous = target.location.files.get(target.path);
    reserve(target.location, bytes.byteLength - (previous?.data.byteLength ?? 0), 'write', target.given);
    target.location.files.set(target.path, { data: bytes, mtime: Date.now(), birthtime: previous?.birthtime ?? Date.now() });
  },

  appendFileSync(path: unknown, data: unknown, options?: unknown): void {
    const target = resolve(path, 'open');
    writable(target, 'open');
    const previous = target.location.files.get(target.path);
    const bytes = encode(data, encodingOf(options));
    if (!previous) return sync.writeFileSync(path, bytes);
    reserve(target.location, bytes.byteLength, 'write', target.given);
    const joined = new Uint8Array(previous.data.byteLength + bytes.byteLength);
    joined.set(previous.data);
    joined.set(bytes, previous.data.byteLength);
    target.location.files.set(target.path, { data: joined, mtime: Date.now(), birthtime: previous.birthtime });
  },

  mkdirSync(path: unknown, options?: { recursive?: boolean }): void {
    const target = resolve(path, 'mkdir');
    writable(target, 'mkdir');
    const { location } = target;
    if (location.files.has(target.path)) throw new FileSystemError('EEXIST', 'mkdir', target.given);
    if (location.directories.has(target.path)) {
      if (options?.recursive) return;
      throw new FileSystemError('EEXIST', 'mkdir', target.given);
    }
    const parts = target.path.split('/');
    if (!options?.recursive && !location.directories.has(parentOf(target.path))) throw new FileSystemError('ENOENT', 'mkdir', target.given);
    for (let index = 1; index <= parts.length; index++) {
      const partial = parts.slice(0, index).join('/');
      if (location.files.has(partial)) throw new FileSystemError('ENOTDIR', 'mkdir', target.given);
      location.directories.add(partial);
    }
  },

  readdirSync(path: unknown): string[] {
    const target = resolve(path, 'scandir');
    const { location } = target;
    if (location.files.has(target.path)) throw new FileSystemError('ENOTDIR', 'scandir', target.given);
    if (!location.directories.has(target.path)) throw new FileSystemError('ENOENT', 'scandir', target.given);
    const prefix = target.path ? `${target.path}/` : '';
    const names = new Set<string>();
    for (const candidate of [...location.files.keys(), ...location.directories]) {
      if (candidate && candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes('/')) names.add(candidate.slice(prefix.length));
    }
    return [...names].filter(Boolean).sort();
  },

  statSync(path: unknown): Stats {
    const target = resolve(path, 'stat');
    const { location } = target;
    if (location.directories.has(target.path)) return new Stats(true, 64, location.created, location.created, location.readOnly);
    const entry = location.files.get(target.path);
    if (!entry) throw new FileSystemError('ENOENT', 'stat', target.given);
    return new Stats(false, entry.data.byteLength, entry.mtime, entry.birthtime, location.readOnly);
  },

  accessSync(path: unknown): void {
    sync.statSync(path);
  },

  existsSync(path: unknown): boolean {
    try {
      sync.statSync(path);
      return true;
    } catch {
      return false;
    }
  },

  rmSync(path: unknown, options?: { recursive?: boolean; force?: boolean }): void {
    const target = resolve(path, 'rm');
    writable(target, 'rm');
    const { location } = target;
    if (location.files.delete(target.path)) return;
    if (!location.directories.has(target.path) || !target.path) {
      if (options?.force && target.path) return;
      throw new FileSystemError(target.path ? 'ENOENT' : 'EACCES', 'rm', target.given);
    }
    if (!options?.recursive) throw new FileSystemError('EISDIR', 'rm', target.given);
    const prefix = `${target.path}/`;
    for (const file of [...location.files.keys()]) if (file.startsWith(prefix)) location.files.delete(file);
    for (const directory of [...location.directories]) if (directory === target.path || directory.startsWith(prefix)) location.directories.delete(directory);
  },

  rmdirSync(path: unknown): void {
    const target = resolve(path, 'rmdir');
    writable(target, 'rmdir');
    if (!target.location.directories.has(target.path)) throw new FileSystemError(target.location.files.has(target.path) ? 'ENOTDIR' : 'ENOENT', 'rmdir', target.given);
    if (sync.readdirSync(path).length) throw new FileSystemError('ENOTEMPTY', 'rmdir', target.given);
    target.location.directories.delete(target.path);
  },

  unlinkSync(path: unknown): void {
    const target = resolve(path, 'unlink');
    writable(target, 'unlink');
    if (target.location.directories.has(target.path)) throw new FileSystemError('EISDIR', 'unlink', target.given);
    if (!target.location.files.delete(target.path)) throw new FileSystemError('ENOENT', 'unlink', target.given);
  },

  renameSync(oldPath: unknown, newPath: unknown): void {
    const from = resolve(oldPath, 'rename');
    const to = resolve(newPath, 'rename');
    writable(from, 'rename');
    writable(to, 'rename');
    if (!to.location.directories.has(parentOf(to.path))) throw new FileSystemError('ENOENT', 'rename', from.given);
    const entry = from.location.files.get(from.path);
    if (entry) {
      if (to.location.directories.has(to.path)) throw new FileSystemError('EISDIR', 'rename', from.given);
      if (from.location !== to.location) reserve(to.location, entry.data.byteLength, 'rename', to.given);
      from.location.files.delete(from.path);
      to.location.files.set(to.path, entry);
      return;
    }
    if (!from.location.directories.has(from.path) || !from.path) throw new FileSystemError('ENOENT', 'rename', from.given);
    if (from.location !== to.location) throw new FileSystemError('EINVAL', 'rename', from.given);
    const prefix = `${from.path}/`;
    const move = (path: string): string => to.path + path.slice(from.path.length);
    for (const file of [...from.location.files.keys()]) {
      if (file.startsWith(prefix)) {
        from.location.files.set(move(file), from.location.files.get(file)!);
        from.location.files.delete(file);
      }
    }
    for (const directory of [...from.location.directories]) {
      if (directory === from.path || directory.startsWith(prefix)) {
        from.location.directories.delete(directory);
        from.location.directories.add(move(directory));
      }
    }
  },

  copyFileSync(src: unknown, dest: unknown): void {
    const data = sync.readFileSync(src) as ArrayBuffer;
    sync.writeFileSync(dest, data);
  },
};

/** DesktopEngine.fs: the Sync functions, and promises that run one at a time in order, as the engine's do */
export function createFileSystem(): Record<string, unknown> {
  const fs: Record<string, unknown> = { ...sync, Stats };
  let queue: Promise<unknown> = Promise.resolve();
  for (const [name, method] of Object.entries(sync)) {
    const asyncName = name.replace(/Sync$/, '');
    if (asyncName === 'exists') continue;
    fs[asyncName] = (...args: unknown[]) => {
      const run = queue.then(() => (method as (...values: unknown[]) => unknown)(...args));
      queue = run.catch(() => undefined);
      return run.then((value) => (asyncName === 'access' ? undefined : value));
    };
  }
  Object.defineProperty(fs.Stats, 'prototype', { value: Stats.prototype });
  return fs;
}

// MARK: Media

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  heic: 'image/heic', avif: 'image/avif', bmp: 'image/bmp', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
  webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg',
  json: 'application/json', txt: 'text/plain', js: 'text/javascript', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};

export function mimeType(path: string): string {
  return MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

const objectURLs = new Map<string, { url: string; data: Uint8Array }>();

/** A blob: URL for a file of the package or of usr / temp, so images and videos load it; null when there's none */
export function fileURL(path: string): string | null {
  let target;
  try {
    target = resolve(decodeURIComponent(path.replace(/[?#].*$/, '')), 'open');
  } catch {
    return null;
  }
  const entry = target.location.files.get(target.path);
  if (!entry) return null;
  const key = `${target.location.name}:${target.path}`;
  const cached = objectURLs.get(key);
  if (cached && cached.data === entry.data) return cached.url;
  if (cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(new Blob([entry.data as BlobPart], { type: mimeType(target.path) }));
  objectURLs.set(key, { url, data: entry.data });
  return url;
}

/** The bytes of a file, for fetch of a package path */
export function fileBytes(path: string): Uint8Array | null {
  try {
    const target = resolve(decodeURIComponent(path.replace(/[?#].*$/, '')), 'open');
    return target.location.files.get(target.path)?.data ?? null;
  } catch {
    return null;
  }
}

// MARK: require

interface Module {
  id: string;
  filePath: string;
  ext: 'js' | 'json';
  exports: unknown;
  loaded: boolean;
  dirPath: string;
  load(): unknown;
  require(id: string): unknown;
}

const modules = new Map<string, Module>();

function moduleNotFound(id: string): Error {
  const error = new Error(`Cannot find module '${id}'`) as Error & { code: string };
  error.code = 'MODULE_NOT_FOUND';
  return error;
}

/** CommonJS for the package's files: relative to the module asking, `.js` may be left out, `.json` works too */
export function requireFrom(directory: string, id: string, globals: Record<string, unknown>): unknown {
  if (typeof id !== 'string') throw new TypeError('The module id must be a string');
  const base = id.startsWith('/') ? id : `${directory}/${id}`;
  const candidates = [base, `${base}.js`, `${base}.json`, `${base}/index.js`];
  let found: string | null = null;
  for (const candidate of candidates) {
    try {
      const target = resolve(candidate, 'open');
      if (target.location === locations.package && target.location.files.has(target.path)) {
        found = target.path;
        break;
      }
    } catch {
      // not a path in the package
    }
  }
  if (found === null) throw moduleNotFound(id);
  const cached = modules.get(found);
  if (cached) return cached.exports;
  const ext = found.endsWith('.json') ? 'json' : 'js';
  const module: Module = {
    id: `/${found.replace(/\.js$/, '')}`,
    filePath: `/${found}`,
    ext,
    exports: {},
    loaded: false,
    dirPath: `/${parentOf(found)}`,
    load() {
      const text = toString(locations.package.files.get(found!)!.data, 'utf8');
      if (ext === 'json') {
        module.exports = JSON.parse(text);
      } else {
        const local = (next: string) => requireFrom(module.dirPath, next, globals);
        const names = Object.keys(globals);
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const run = contentFunction(text, `desktopengine:///${found}`, ['module', 'exports', 'require', ...names]);
        run(module, module.exports, local, ...names.map((name) => globals[name]));
      }
      module.loaded = true;
      return module.exports;
    },
    require(next: string) {
      return requireFrom(module.dirPath, next, globals);
    },
  };
  // cached before it runs: a cycle gets the exports as they are then
  modules.set(found, module);
  try {
    return module.load();
  } catch (error) {
    modules.delete(found);
    throw error;
  }
}
