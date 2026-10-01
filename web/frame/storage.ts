// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// localStorage and sessionStorage on the web: in memory (the frame's opaque origin has no storage of its own, and a
// preview keeps nothing), with the engine's quota of 5 × 1024 × 1024 UTF-16 code units and every item a property too.

const QUOTA = 5 * 1024 * 1024;

class StorageArea {
  private readonly items = new Map<string, string>();

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

const METHODS = new Set(['length', 'key', 'getItem', 'setItem', 'removeItem', 'clear']);

function createStorage(): Storage {
  const area = new StorageArea();
  return new Proxy(area, {
    get(target, key) {
      if (typeof key === 'symbol') return Reflect.get(target, key);
      if (METHODS.has(key)) {
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
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
  }) as unknown as Storage;
}

export function installStorage(scope: typeof globalThis): void {
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(scope, name, { value: createStorage(), configurable: true, enumerable: true });
  }
}
