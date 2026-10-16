// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// localStorage and sessionStorage on the web: in memory (the frame's opaque origin has no storage of its own, and a
// preview keeps nothing), with the engine's quota of 5 × 1024 × 1024 UTF-16 code units and every item a property too.
// DesktopEngine.syncStorage the same, with the app's limits for items that go to the user's other Macs; there are none
// here, so it never has a `change` event.

const QUOTA = 5 * 1024 * 1024;

let constructing = false;

class StorageArea {
  private readonly items = new Map<string, string>();

  constructor() {
    // as the engine's Storage: only localStorage and sessionStorage
    if (!constructing) throw new TypeError('Illegal constructor');
  }

  get length(): number {
    return this.items.size;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.items.get(String(key)) ?? null;
  }

  setItem(key: string, value: string): void {
    const name = String(key);
    const text = String(value);
    let used = 0;
    for (const [itemKey, itemValue] of this.items) if (itemKey !== name) used += itemKey.length + itemValue.length;
    if (used + name.length + text.length > QUOTA) {
      throw new DOMException(`Setting the value of '${name}' exceeded the quota.`, 'QuotaExceededError');
    }
    this.items.set(name, text);
  }

  removeItem(key: string): void {
    this.items.delete(String(key));
  }

  clear(): void {
    this.items.clear();
  }

  keys(): string[] {
    return [...this.items.keys()];
  }
}

Object.defineProperty(StorageArea, 'name', { value: 'Storage' });

const METHODS = new Set(['length', 'key', 'getItem', 'setItem', 'removeItem', 'clear']);

function createStorage(): object {
  constructing = true;
  const area = new StorageArea();
  constructing = false;
  /** The methods given, bound to the area: one for each, named as the method, as the app's are its class' own */
  const methods = new Map<string, { original: unknown; method: unknown }>();
  return new Proxy(area, {
    get(target, key) {
      if (typeof key === 'symbol') return Reflect.get(target, key);
      // as in the app, an item doesn't hide its class (whose name a refused postMessage gives)
      if (key === 'constructor') return StorageArea;
      if (METHODS.has(key)) {
        const value = Reflect.get(target, key);
        if (typeof value !== 'function') return value;
        let entry = methods.get(key);
        if (!entry || entry.original !== value) {
          const method = (value as (...args: unknown[]) => unknown).bind(target);
          Object.defineProperty(method, 'name', { value: (value as { name: unknown }).name, configurable: true });
          entry = { original: value, method };
          methods.set(key, entry);
        }
        return entry.method;
      }
      return target.getItem(key) ?? undefined;
    },
    set(target, key, value) {
      if (typeof key === 'symbol' || METHODS.has(key)) return false;
      target.setItem(key, value);
      return true;
    },
    deleteProperty(target, key) {
      if (typeof key === 'string') target.removeItem(key);
      return true;
    },
    has(target, key) {
      return typeof key === 'string' && (METHODS.has(key) || target.getItem(key) !== null);
    },
    ownKeys(target) {
      return target.keys();
    },
    getOwnPropertyDescriptor(target, key) {
      if (typeof key !== 'string') return undefined;
      const value = target.getItem(key);
      return value === null ? undefined : { value, enumerable: true, configurable: true, writable: true };
    },
  });
}

export function installStorage(scope: typeof globalThis): void {
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(scope, name, { value: createStorage(), configurable: true, enumerable: true });
  }
  // the engine's global Storage is their class, as in browsers: `localStorage instanceof Storage`, and structuredClone
  // and a BroadcastChannel refuse them and objects made from them as "A Storage"
  Object.defineProperty(scope, 'Storage', { value: StorageArea, writable: true, configurable: true, enumerable: false });
}

// MARK: DesktopEngine.syncStorage

/** UTF-16 code units of the keys and values together */
const SYNC_QUOTA = 1024 * 1024;
const SYNC_MAXIMUM_KEYS = 1024;
/** Of a key and its value together, as JSON writes them (`jsonLength`) */
const SYNC_MAXIMUM_ITEM = 60 * 1024;

/** The length of the string in JSON, without its quotes */
function jsonLength(text: string): number {
  let length = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x0c || code === 0x0a || code === 0x0d || code === 0x09) length += 2;
    else if (code < 0x20) length += 6;
    else length += 1;
  }
  return length;
}

/** Lone surrogates as U+FFFD, as the app does: items go to the cloud as JSON */
function wellFormed(text: string): string {
  if (!/[\uD800-\uDFFF]/.test(text)) return text;
  let result = '';
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += text[index] + text[index + 1];
        index++;
        continue;
      }
    }
    result += code >= 0xd800 && code <= 0xdfff ? '\uFFFD' : text[index];
  }
  return result;
}

/** A key as it's stored: well formed and in NFC, as the app does (keys equal in Unicode are one item) */
function syncKey(key: unknown): string {
  return wellFormed(String(key)).normalize('NFC');
}

function requireSyncArguments(count: number, name: string, args: IArguments): void {
  if (args.length < count) {
    throw new TypeError(`Failed to execute '${name}' on 'SyncStorage': ${count} argument${count > 1 ? 's' : ''} required, but only ${args.length} present.`);
  }
}

/** DesktopEngine.syncStorage, the only one: an EventTarget with the methods of a Storage, items aren't properties */
export function createSyncStorage(): object {
  const items = new WeakMap<object, Map<string, string>>();
  const itemsOf = (storage: unknown): Map<string, string> => {
    const map = typeof storage === 'object' && storage !== null ? items.get(storage) : undefined;
    if (!map) throw new TypeError('Illegal invocation');
    return map;
  };
  let constructing = true;

  class SyncStorage extends EventTarget {
    constructor() {
      if (!constructing) throw new TypeError('Illegal constructor');
      super();
      (this as unknown as { onchange: unknown }).onchange = null;
    }

    get length(): number {
      return itemsOf(this).size;
    }

    key(index: number): string | null {
      requireSyncArguments(1, 'key', arguments);
      return [...itemsOf(this).keys()][Number(index) >>> 0] ?? null;
    }

    getItem(key: string): string | null {
      requireSyncArguments(1, 'getItem', arguments);
      return itemsOf(this).get(syncKey(key)) ?? null;
    }

    setItem(key: string, value: string): void {
      requireSyncArguments(2, 'setItem', arguments);
      const map = itemsOf(this);
      const name = syncKey(key);
      const text = wellFormed(String(value));
      let used = 0;
      for (const [itemKey, itemValue] of map) if (itemKey !== name) used += itemKey.length + itemValue.length;
      let problem: string | undefined;
      if (used + name.length + text.length > SYNC_QUOTA) problem = `Setting the value of '${name}' exceeded the quota.`;
      else if (!map.has(name) && map.size >= SYNC_MAXIMUM_KEYS) problem = `Setting '${name}' exceeded the maximum number of items.`;
      else if (jsonLength(name) + jsonLength(text) > SYNC_MAXIMUM_ITEM) problem = `The key and value of '${name}' are too long.`;
      if (problem) throw new DOMException(`Failed to execute 'setItem' on 'SyncStorage': ${problem}`, 'QuotaExceededError');
      map.set(name, text);
    }

    removeItem(key: string): void {
      requireSyncArguments(1, 'removeItem', arguments);
      itemsOf(this).delete(syncKey(key));
    }

    clear(): void {
      itemsOf(this).clear();
    }

    get [Symbol.toStringTag](): string {
      return 'SyncStorage';
    }
  }
  Object.defineProperty(SyncStorage, 'name', { value: 'SyncStorage' });

  const storage = new SyncStorage();
  constructing = false;
  items.set(storage, new Map());
  return storage;
}