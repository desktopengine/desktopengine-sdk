// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// localStorage and sessionStorage on the web: in memory (the frame's opaque origin has no storage of its own, and a
// preview keeps nothing), with the engine's quota of 5 × 1024 × 1024 UTF-16 code units and every item a property too.

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
