// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// FontFace and DesktopEngine.fonts (a FontFaceSet) as the engine has them, on the browser's. The content can't see
// the frame's document or the browser's FontFace: its faces are its own objects, and each one that is loaded and in
// DesktopEngine.fonts has a face of the browser's in the frame's document.fonts, which the frame's canvases draw
// with. The sources load as in the app: package and defile:// files, blob: and data: URLs, installed fonts by name and
// bytes; not http(s) URLs. A font is checked as the app checks it (at most 64 MB, a TrueType, OpenType, WOFF or WOFF2
// file) before the browser reads it. Matching (for load and check) is the engine's CSS matching by style, then weight.

import { parseFont } from './canvas-api.ts';

/** The largest font, as in the app */
export const MAXIMUM_FONT_SIZE = 64 * 1024 * 1024;

const DOMExceptionClass = DOMException;
const EventClass = Event;
const EventTargetClass = EventTarget;
const PromiseClass = Promise;
const { addEventListener: addListener } = EventTarget.prototype;
const { apply } = Reflect;
const { defineProperty, freeze } = Object;
const { round, min, max } = Math;

// MARK: Descriptors

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** A family name as matching compares it: without the quotes of a CSS string; null when there's none */
export function familyName(value: string): string | null {
  const family = value.trim();
  const quoted = /^"((?:[^"\\]|\\.)*)"$|^'((?:[^'\\]|\\.)*)'$/.exec(family);
  const name = quoted ? (quoted[1] ?? quoted[2]).replace(/\\(.)/g, '$1') : family.replace(/\s+/g, ' ');
  return name || null;
}

/** `normal`, `bold`, a weight (1–1000) or a range of two: [lightest, heaviest] */
export function parseWeight(value: string): [number, number] | null {
  const words = value.trim().toLowerCase().split(/\s+/);
  if (words.length === 1 && words[0] === 'normal') return [400, 400];
  if (words.length === 1 && words[0] === 'bold') return [700, 700];
  if (words.length > 2 || !words.every((word) => NUMBER.test(word))) return null;
  const numbers = words.map(Number);
  if (!numbers.every((number) => number >= 1 && number <= 1000)) return null;
  return [round(min(...numbers)), round(max(...numbers))];
}

export type FaceStyle = 'normal' | 'italic' | 'oblique';

/** `normal`, `italic` or `oblique` with up to two angles */
export function parseStyle(value: string): FaceStyle | null {
  const words = value.trim().toLowerCase().split(/\s+/);
  if (words.length === 1 && words[0] === 'normal') return 'normal';
  if (words.length === 1 && words[0] === 'italic') return 'italic';
  if (words[0] !== 'oblique' || words.length > 3) return null;
  return words.slice(1).every((word) => /^[+-]?(?:\d+\.?\d*|\.\d+)deg$/.test(word)) ? 'oblique' : null;
}

const STRETCH_KEYWORDS = ['normal', 'ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed', 'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded'];
const isPercentage = (word: string): boolean => /^[+-]?(?:\d+\.?\d*|\.\d+)%$/.test(word);
const isOverride = (value: string): boolean => value.toLowerCase() === 'normal' || isPercentage(value);

const DEFAULTS = {
  style: 'normal', weight: 'normal', stretch: 'normal', unicodeRange: 'U+0-10FFFF', featureSettings: 'normal',
  variationSettings: 'normal', display: 'auto', ascentOverride: 'normal', descentOverride: 'normal', lineGapOverride: 'normal',
};
type Descriptors = typeof DEFAULTS;
type DescriptorName = keyof Descriptors;
const DESCRIPTOR_NAMES = Object.keys(DEFAULTS) as DescriptorName[];

/** What each descriptor accepts; only style and weight take part in matching, as in the app */
const CHECKS: Record<DescriptorName, (value: string) => boolean> = {
  style: (value) => parseStyle(value) !== null,
  weight: (value) => parseWeight(value) !== null,
  stretch: (value) => {
    const words = value.toLowerCase().split(/\s+/);
    return (words.length === 1 && STRETCH_KEYWORDS.includes(words[0])) || (words.length <= 2 && words.every(isPercentage));
  },
  unicodeRange: (value) => value.split(',').every((range) => /^u\+[0-9a-f?]{1,6}(?:-[0-9a-f]{1,6})?$/i.test(range.trim())),
  featureSettings: (value) => value.length > 0,
  variationSettings: (value) => value.length > 0,
  display: (value) => ['auto', 'block', 'swap', 'fallback', 'optional'].includes(value.toLowerCase()),
  ascentOverride: isOverride,
  descentOverride: isOverride,
  lineGapOverride: isOverride,
};

/** A descriptor's value as given, trimmed; null when it isn't valid */
function checkedDescriptor(name: DescriptorName, value: unknown): string | null {
  const text = String(value).trim();
  return CHECKS[name](text) ? text : null;
}

// MARK: Sources

export type FontSource = { url: string } | { local: string };

const FORMATS = ['truetype', 'opentype', 'woff', 'woff2', 'collection', 'truetype-variations', 'opentype-variations', 'woff-variations', 'woff2-variations'];
const QUOTED = String.raw`"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'`;
const URL_SOURCE = new RegExp(String.raw`^url\(\s*(?:${QUOTED}|([^"'()\s]*))\s*\)\s*`, 'i');
const LOCAL_SOURCE = new RegExp(String.raw`^local\(\s*(?:${QUOTED}|([^"'()]*?))\s*\)\s*`, 'i');
const HINT = /^(format|tech)\(\s*([^)]*?)\s*\)\s*/i;
const unescape = (text: string): string => text.replace(/\\(.)/g, '$1');

/** The sources of a CSS `src` list the engine may load, in order; null when it isn't one */
export function parseSources(text: string): FontSource[] | null {
  let rest = text.trim();
  if (!rest) return null;
  const sources: FontSource[] = [];
  for (;;) {
    let match = URL_SOURCE.exec(rest);
    if (match) {
      const url = unescape(match[1] ?? match[2] ?? match[3]);
      rest = rest.slice(match[0].length);
      let supported = true;
      let hint;
      while ((hint = HINT.exec(rest))) {
        rest = rest.slice(hint[0].length);
        if (hint[1].toLowerCase() !== 'format') continue;
        const formats = hint[2].split(',').map((format) => format.trim().replace(/^["']|["']$/g, '').toLowerCase());
        supported = formats.some((format) => FORMATS.includes(format));
      }
      if (!url) return null;
      if (supported) sources.push({ url });
    } else if ((match = LOCAL_SOURCE.exec(rest))) {
      const name = unescape(match[1] ?? match[2] ?? match[3]).trim();
      if (!name) return null;
      rest = rest.slice(match[0].length);
      sources.push({ local: name });
    } else {
      return null;
    }
    if (!rest) return sources;
    if (rest[0] !== ',') return null;
    rest = rest.slice(1).trim();
  }
}

/** Whether the bytes start like a font the app reads: TrueType, OpenType (CFF), a collection, WOFF or WOFF2 */
export function looksLikeFont(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  return tag === '\0\x01\0\0' || tag === 'OTTO' || tag === 'true' || tag === 'ttcf' || tag === 'wOFF' || tag === 'wOF2';
}

const megabytes = (size: number): string => `it's ${(size / 1048576).toFixed(1)} MB, a font can be at most ${MAXIMUM_FONT_SIZE / 1048576} MB`;

/** Why the bytes aren't a font the app reads, null when they may be */
export function fontDataProblem(bytes: Uint8Array): string | null {
  if (bytes.length > MAXIMUM_FONT_SIZE) return megabytes(bytes.length);
  if (!looksLikeFont(bytes)) return "it isn't a TrueType, OpenType, WOFF or WOFF2 font";
  return null;
}

const describe = (source: string): string => (source.length > 64 ? `${source.slice(0, 64)}…` : source);

/** The bytes of a data: URL, base64 or percent-encoded; null when it isn't one */
export function dataURLBytes(url: string): Uint8Array | null {
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const header = url.slice(5, comma).toLowerCase();
  const payload = url.slice(comma + 1);
  if (header.endsWith(';base64')) {
    let text: string;
    try {
      text = atob(decodeURIComponent(payload).replace(/[^A-Za-z0-9+/=]/g, ''));
    } catch {
      return null;
    }
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
    return bytes;
  }
  const encoded = new TextEncoder().encode(payload);
  const bytes: number[] = [];
  const isHex = (code: number): boolean => (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === 37 && index + 2 < encoded.length && isHex(encoded[index + 1]) && isHex(encoded[index + 2])) {
      bytes.push(parseInt(String.fromCharCode(encoded[index + 1], encoded[index + 2]), 16));
      index += 2;
    } else {
      bytes.push(encoded[index]);
    }
  }
  return Uint8Array.from(bytes);
}

// MARK: Matching

export interface MatchedFace {
  family: string;
  minimumWeight: number;
  maximumWeight: number;
  style: FaceStyle;
}

/**
 * How far a face's weights are from the one asked for, in CSS's order (lower is better): the weights in its range
 * first; then, for 400–500, the heavier ones up to 500, the lighter ones, the heavier ones; for less, the lighter ones,
 * then the heavier ones; for more, the heavier ones, then the lighter ones; the closest first in each
 */
function weightRank(weight: number, minimum: number, maximum: number): number {
  if (minimum <= weight && weight <= maximum) return 0;
  if (weight >= 400 && weight <= 500) {
    if (minimum > weight && minimum <= 500) return 1000 + (minimum - weight);
    if (maximum < weight) return 2000 + (weight - maximum);
    return 3000 + (minimum - weight);
  }
  if (weight < 400) return maximum < weight ? 1000 + (weight - maximum) : 2000 + (minimum - weight);
  return minimum > weight ? 1000 + (minimum - weight) : 2000 + (weight - maximum);
}

/**
 * The face CSS matching picks of a family's faces (names compare without case) for a style and a weight, as the engine
 * picks it: style first (italic falls back to oblique, then normal; normal to oblique, then italic), then the weight,
 * the last of equal ones. Null when the family has none.
 */
export function matchFace<T extends MatchedFace>(faces: readonly T[], family: string, italic: boolean, weight: number): T | null {
  const lower = family.toLowerCase();
  const candidates = faces.filter((face) => face.family.toLowerCase() === lower);
  const order: FaceStyle[] = italic ? ['italic', 'oblique', 'normal'] : ['normal', 'oblique', 'italic'];
  for (const style of order) {
    let best: T | null = null;
    let bestRank = Infinity;
    for (const face of candidates) {
      if (face.style !== style) continue;
      const rank = weightRank(weight, face.minimumWeight, face.maximumWeight);
      if (rank <= bestRank) {
        best = face;
        bestRank = rank;
      }
    }
    if (best) return best;
  }
  return null;
}

// MARK: The classes

/** A face of the browser's, as far as the runtime uses it */
export interface NativeFontFace {
  family: string;
  weight: string;
  style: string;
}

/** What the fonts need of the frame */
export interface FontHost {
  /** The bytes of a package or defile:// file, null when there's none */
  fileBytes(path: string): Uint8Array | null;
  /** The bytes of a blob: URL, null when there's none */
  blobBytes(url: string): Promise<Uint8Array | null>;
  /** The browser's face of the bytes or of an installed font (`local("name")`), loaded; rejects when it can't be */
  loadNative(family: string, source: Uint8Array | string, descriptors: { weight: string; style: string }): Promise<NativeFontFace>;
  /** Puts the face in the frame's document.fonts, or takes it out */
  addNative(face: NativeFontFace): void;
  deleteNative(face: NativeFontFace): void;
  /** A task later */
  queueTask(callback: () => void): void;
}

interface LoadError {
  name: string;
  message: string;
}

/** The content's FontFace, FontFaceSet and FontFaceSetLoadEvent, and the set that's DesktopEngine.fonts */
export function createFonts(host: FontHost) {
  const kCreate = Symbol('create');
  /** What the set hears about its faces */
  let statusChanged: ((face: FontFace, status: string) => void) | null = null;
  let changed: ((face: FontFace) => void) | null = null;
  /** The browser's face of each loaded face */
  const natives = new WeakMap<FontFace, NativeFontFace>();
  /** What matching reads of each face */
  const matching = new WeakMap<FontFace, MatchedFace>();

  const syntaxError = (message: string): DOMException => new DOMExceptionClass(message, 'SyntaxError');

  /** The first source that loads, its native face; the last failure when none does */
  async function loadSources(family: string, sources: FontSource[], descriptors: { weight: string; style: string }): Promise<NativeFontFace> {
    let failure: LoadError = { name: 'NetworkError', message: 'The font face has no source this engine loads' };
    for (const source of sources) {
      if ('local' in source) {
        try {
          return await host.loadNative(family, `local(${JSON.stringify(source.local)})`, descriptors);
        } catch {
          failure = { name: 'NetworkError', message: `Can't load the font local(${describe(source.local)}): no installed font has that name` };
        }
        continue;
      }
      const { url } = source;
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase();
      let why: string | null = null;
      let bytes: Uint8Array | null = null;
      if (scheme === 'http' || scheme === 'https') {
        why = "fonts aren't loaded from the network, fetch() the file and give the FontFace its bytes";
      } else if (scheme === 'data') {
        if (url.length > (MAXIMUM_FONT_SIZE / 3) * 4 + 1024) why = `a font can be at most ${MAXIMUM_FONT_SIZE / 1048576} MB`;
        else if (!(bytes = dataURLBytes(url))) why = "it isn't a data: URL";
      } else if (scheme === 'blob') {
        if (!(bytes = await host.blobBytes(url).catch(() => null))) why = "there's no such blob URL";
      } else if (scheme && scheme !== 'defile') {
        why = "the file doesn't exist";
      } else if (!(bytes = host.fileBytes(url))) {
        why = "the file doesn't exist";
      }
      if (bytes) why = fontDataProblem(bytes);
      if (bytes && !why) {
        try {
          return await host.loadNative(family, bytes, descriptors);
        } catch {
          why = "the font can't be read";
        }
      }
      failure = { name: 'NetworkError', message: `Can't load the font ${describe(url)}: ${why}` };
    }
    throw failure;
  }

  async function loadBytes(family: string, bytes: Uint8Array, descriptors: { weight: string; style: string }): Promise<NativeFontFace> {
    let why = fontDataProblem(bytes);
    if (!why) {
      try {
        return await host.loadNative(family, bytes, descriptors);
      } catch {
        why = "the font can't be read";
      }
    }
    throw { name: 'SyntaxError', message: `Can't load the font data: ${why}` } satisfies LoadError;
  }

  /** Bytes of their own: what the content does with its buffer afterwards doesn't change the font */
  function bytesOf(source: unknown): Uint8Array | null {
    if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
    if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
    return null;
  }

  class FontFace {
    #family: string;
    #descriptors: Descriptors = { ...DEFAULTS };
    #status: 'unloaded' | 'loading' | 'loaded' | 'error' = 'unloaded';
    #sources: FontSource[] | null = null;
    #loaded: Promise<FontFace>;
    #resolve!: (face: FontFace) => void;
    #reject!: (error: unknown) => void;

    constructor(family: string, source: string | ArrayBuffer | ArrayBufferView, descriptors: Partial<Descriptors> | null = {}) {
      if (arguments.length < 2) {
        throw new TypeError(`Failed to construct 'FontFace': 2 arguments required, but only ${arguments.length} present.`);
      }
      if (descriptors !== undefined && descriptors !== null && typeof descriptors !== 'object' && typeof descriptors !== 'function') {
        throw new TypeError("Failed to construct 'FontFace': The provided value is not of type 'FontFaceDescriptors'.");
      }
      this.#loaded = new PromiseClass<FontFace>((resolve, reject) => {
        this.#resolve = resolve;
        this.#reject = reject;
      });
      // a face that failed is no unhandled rejection: who loads it sees the error
      this.#loaded.catch(() => {});

      const bytes = typeof source === 'string' ? null : bytesOf(source);
      this.#family = String(family);
      let failure = familyName(this.#family) === null ? `'${this.#family}' isn't a font family name.` : null;
      for (const name of DESCRIPTOR_NAMES) {
        const value = descriptors?.[name];
        if (value === undefined) continue;
        const checked = checkedDescriptor(name, value);
        if (checked === null) failure ??= `'${value}' isn't a valid value for ${name}.`;
        else this.#descriptors[name] = checked;
      }
      if (!bytes) {
        this.#sources = parseSources(String(source));
        if (!this.#sources) failure ??= `'${String(source)}' isn't a valid font source.`;
      }
      this.#update();

      if (failure) {
        this.#fail({ name: 'SyntaxError', message: `Failed to construct 'FontFace': ${failure}` });
      } else if (bytes) {
        this.#setStatus('loading');
        // as in the app, the bytes are read after this task
        host.queueTask(() => this.#settle(loadBytes(this.#nativeFamily, bytes, this.#nativeDescriptors)));
      }
    }

    get family(): string { return this.#family; }
    set family(value: string) {
      const family = String(value);
      if (familyName(family) === null) throw syntaxError(`Failed to set the 'family' property on 'FontFace': '${family}' isn't a font family name.`);
      this.#family = family;
      this.#update();
    }

    get style(): string { return this.#descriptors.style; }
    set style(value: string) { this.#setDescriptor('style', value); }
    get weight(): string { return this.#descriptors.weight; }
    set weight(value: string) { this.#setDescriptor('weight', value); }
    get stretch(): string { return this.#descriptors.stretch; }
    set stretch(value: string) { this.#setDescriptor('stretch', value); }
    get unicodeRange(): string { return this.#descriptors.unicodeRange; }
    set unicodeRange(value: string) { this.#setDescriptor('unicodeRange', value); }
    get featureSettings(): string { return this.#descriptors.featureSettings; }
    set featureSettings(value: string) { this.#setDescriptor('featureSettings', value); }
    get variationSettings(): string { return this.#descriptors.variationSettings; }
    set variationSettings(value: string) { this.#setDescriptor('variationSettings', value); }
    get display(): string { return this.#descriptors.display; }
    set display(value: string) { this.#setDescriptor('display', value); }
    get ascentOverride(): string { return this.#descriptors.ascentOverride; }
    set ascentOverride(value: string) { this.#setDescriptor('ascentOverride', value); }
    get descentOverride(): string { return this.#descriptors.descentOverride; }
    set descentOverride(value: string) { this.#setDescriptor('descentOverride', value); }
    get lineGapOverride(): string { return this.#descriptors.lineGapOverride; }
    set lineGapOverride(value: string) { this.#setDescriptor('lineGapOverride', value); }

    get status(): string { return this.#status; }
    get loaded(): Promise<FontFace> { return this.#loaded; }

    load(): Promise<FontFace> {
      if (this.#status !== 'unloaded') return this.#loaded;
      this.#setStatus('loading');
      this.#settle(loadSources(this.#nativeFamily, this.#sources!, this.#nativeDescriptors));
      return this.#loaded;
    }

    get #nativeFamily(): string {
      return familyName(this.#family) ?? '';
    }

    get #nativeDescriptors(): { weight: string; style: string } {
      return { weight: this.#descriptors.weight, style: this.#descriptors.style };
    }

    #setDescriptor(name: DescriptorName, value: unknown): void {
      const checked = checkedDescriptor(name, value);
      if (checked === null) throw syntaxError(`Failed to set the '${name}' property on 'FontFace': '${value}' isn't a valid value.`);
      this.#descriptors[name] = checked;
      if (name === 'weight' || name === 'style') this.#update();
    }

    /** What matching reads, and the browser's face of it */
    #update(): void {
      const [minimumWeight, maximumWeight] = parseWeight(this.#descriptors.weight)!;
      matching.set(this, { family: this.#nativeFamily, minimumWeight, maximumWeight, style: parseStyle(this.#descriptors.style)! });
      const native = natives.get(this);
      if (native) {
        native.family = this.#nativeFamily;
        native.weight = this.#descriptors.weight;
        native.style = this.#descriptors.style;
      }
      changed?.(this);
    }

    #setStatus(status: 'loading' | 'loaded' | 'error'): void {
      this.#status = status;
      statusChanged?.(this, status);
    }

    #fail(error: LoadError): void {
      this.#setStatus('error');
      this.#reject(new DOMExceptionClass(error.message, error.name));
    }

    #settle(loading: Promise<NativeFontFace>): void {
      loading.then((native) => {
        natives.set(this, native);
        // the descriptors as they are now, should they have changed while it loaded
        this.#update();
        this.#setStatus('loaded');
        this.#resolve(this);
      }, (error: LoadError) => this.#fail(error));
    }
  }
  defineProperty(FontFace, 'name', { value: 'FontFace', configurable: true });
  defineProperty(FontFace.prototype, Symbol.toStringTag, { value: 'FontFace', configurable: true });

  class FontFaceSetLoadEvent extends EventClass {
    #fontfaces: readonly FontFace[];

    constructor(type: string, init: { fontfaces?: Iterable<FontFace>; cancelable?: boolean } = {}) {
      if (arguments.length === 0) {
        throw new TypeError("Failed to construct 'FontFaceSetLoadEvent': 1 argument required, but only 0 present.");
      }
      super(type, init);
      const fontfaces: FontFace[] = init?.fontfaces === undefined ? [] : Array.from(init.fontfaces);
      for (const face of fontfaces) {
        if (!(face instanceof FontFace)) {
          throw new TypeError("Failed to construct 'FontFaceSetLoadEvent': The provided value is not of type 'FontFace'.");
        }
      }
      this.#fontfaces = freeze(fontfaces);
    }

    get fontfaces(): readonly FontFace[] { return this.#fontfaces; }
  }
  defineProperty(FontFaceSetLoadEvent, 'name', { value: 'FontFaceSetLoadEvent', configurable: true });
  defineProperty(FontFaceSetLoadEvent.prototype, Symbol.toStringTag, { value: 'FontFaceSetLoadEvent', configurable: true });

  type Handler = ((event: Event) => unknown) | { handleEvent(event: Event): unknown } | null;

  class FontFaceSet extends EventTargetClass {
    #faces = new Set<FontFace>();
    #status: 'loading' | 'loaded' = 'loaded';
    #ready: Promise<FontFaceSet>;
    #resolveReady: ((set: FontFaceSet) => void) | null = null;
    // what's loading, and what loaded and failed since the set began loading
    #loading = new Set<FontFace>();
    #loadedFonts: FontFace[] = [];
    #failedFonts: FontFace[] = [];
    #handlers: Record<string, Handler> = { loading: null, loadingdone: null, loadingerror: null };

    constructor(token?: symbol) {
      if (token !== kCreate) throw new TypeError('Illegal constructor');
      super();
      this.#ready = PromiseClass.resolve(this);
      // the handlers are called first, as the engine's EventTarget calls them
      for (const type of ['loading', 'loadingdone', 'loadingerror']) {
        apply(addListener, this, [type, (event: Event) => {
          const handler = this.#handlers[type];
          if (typeof handler === 'function') apply(handler, this, [event]);
          else if (handler && typeof handler.handleEvent === 'function') handler.handleEvent(event);
        }, true]);
      }
      statusChanged = (face, status) => this.#faceStatusChanged(face, status);
      changed = (face) => {
        if (this.#faces.has(face)) this.#placeNative(face);
      };
    }

    get onloading(): Handler { return this.#handlers.loading; }
    set onloading(handler: Handler) { this.#handlers.loading = handlerOf(handler); }
    get onloadingdone(): Handler { return this.#handlers.loadingdone; }
    set onloadingdone(handler: Handler) { this.#handlers.loadingdone = handlerOf(handler); }
    get onloadingerror(): Handler { return this.#handlers.loadingerror; }
    set onloadingerror(handler: Handler) { this.#handlers.loadingerror = handlerOf(handler); }

    get size(): number { return this.#faces.size; }
    get status(): string { return this.#status; }
    get ready(): Promise<FontFaceSet> { return this.#ready; }

    add(font: FontFace): this {
      if (!(font instanceof FontFace)) {
        throw new TypeError("Failed to execute 'add' on 'FontFaceSet': parameter 1 is not of type 'FontFace'.");
      }
      if (this.#faces.has(font)) return this;
      this.#faces.add(font);
      this.#placeNative(font);
      if (font.status === 'loading') this.#faceStatusChanged(font, 'loading');
      return this;
    }

    delete(font: FontFace): boolean {
      if (!(font instanceof FontFace) || !this.#faces.has(font)) return false;
      this.#remove(font);
      this.#settle();
      return true;
    }

    clear(): void {
      for (const font of [...this.#faces]) this.#remove(font);
      this.#settle();
    }

    has(font: FontFace): boolean {
      return this.#faces.has(font);
    }

    forEach(callback: (font: FontFace, key: FontFace, set: FontFaceSet) => void, thisArg?: unknown): void {
      if (typeof callback !== 'function') {
        throw new TypeError("Failed to execute 'forEach' on 'FontFaceSet': The callback provided as parameter 1 is not a function.");
      }
      for (const font of this.#faces) callback.call(thisArg, font, font, this);
    }

    values(): SetIterator<FontFace> { return this.#faces.values(); }
    keys(): SetIterator<FontFace> { return this.#faces.values(); }
    entries(): SetIterator<[FontFace, FontFace]> { return this.#faces.entries(); }
    [Symbol.iterator](): SetIterator<FontFace> { return this.#faces.values(); }

    /** Loads the faces of the set the font picks, one for each of its families that has some */
    load(font: string, _text = ' '): Promise<FontFace[]> {
      let faces: FontFace[];
      try {
        faces = this.#matching(font, 'load');
      } catch (error) {
        return PromiseClass.reject(error);
      }
      return PromiseClass.all(faces.map((face) => face.load())).then(() => faces);
    }

    /** Whether the faces of the set the font picks are loaded (true when it picks none: installed fonts are) */
    check(font: string, _text = ' '): boolean {
      return this.#matching(font, 'check').every((face) => face.status === 'loaded');
    }

    #matching(font: string, method: string): FontFace[] {
      const parsed = parseFont(String(font));
      if (!parsed || !parsed.families) throw syntaxError(`Failed to execute '${method}' on 'FontFaceSet': Could not resolve '${font}' as a font.`);
      const faces = [...this.#faces];
      const described = faces.map((face) => ({ face, ...matching.get(face)! }));
      const picked: FontFace[] = [];
      for (const family of parsed.families.split(', ')) {
        const match = matchFace(described, family, parsed.italic, parsed.weight);
        if (match && !picked.includes(match.face)) picked.push(match.face);
      }
      return picked;
    }

    /** The browser's face is in document.fonts while the face is loaded and in the set */
    #placeNative(font: FontFace): void {
      const native = natives.get(font);
      if (native && this.#faces.has(font)) host.addNative(native);
    }

    #remove(font: FontFace): void {
      this.#faces.delete(font);
      this.#loading.delete(font);
      this.#loadedFonts = this.#loadedFonts.filter((face) => face !== font);
      this.#failedFonts = this.#failedFonts.filter((face) => face !== font);
      const native = natives.get(font);
      if (native) host.deleteNative(native);
    }

    #faceStatusChanged(face: FontFace, status: string): void {
      if (!this.#faces.has(face)) return;
      if (status === 'loaded') this.#placeNative(face);
      if (status === 'loading') {
        if (this.#loading.has(face)) return;
        this.#loading.add(face);
        if (this.#loading.size === 1 && this.#status !== 'loading') this.#switchToLoading();
      } else if (this.#loading.delete(face)) {
        (status === 'loaded' ? this.#loadedFonts : this.#failedFonts).push(face);
        this.#settle();
      }
    }

    #switchToLoading(): void {
      this.#status = 'loading';
      if (!this.#resolveReady) {
        this.#ready = new PromiseClass((resolve) => { this.#resolveReady = resolve; });
      }
      host.queueTask(() => this.dispatchEvent(new FontFaceSetLoadEvent('loading')));
    }

    /** Done loading when nothing is: `ready` resolves, then come the events */
    #settle(): void {
      if (this.#loading.size || this.#status !== 'loading') return;
      this.#status = 'loaded';
      const loaded = this.#loadedFonts, failed = this.#failedFonts;
      this.#loadedFonts = [];
      this.#failedFonts = [];
      const resolve = this.#resolveReady;
      this.#resolveReady = null;
      resolve?.(this);
      host.queueTask(() => {
        this.dispatchEvent(new FontFaceSetLoadEvent('loadingdone', { fontfaces: loaded }));
        if (failed.length) this.dispatchEvent(new FontFaceSetLoadEvent('loadingerror', { fontfaces: failed }));
      });
    }
  }
  defineProperty(FontFaceSet, 'name', { value: 'FontFaceSet', configurable: true });
  defineProperty(FontFaceSet.prototype, Symbol.toStringTag, { value: 'FontFaceSet', configurable: true });

  function handlerOf(value: unknown): Handler {
    return typeof value === 'function' || (value !== null && typeof value === 'object') ? (value as Handler) : null;
  }

  const fonts = new FontFaceSet(kCreate);
  return { FontFace, FontFaceSet, FontFaceSetLoadEvent, fonts };
}

// MARK: The frame's

/** The browser's FontFace and document.fonts, as far as they're used here */
type BrowserFontFaceClass = new (family: string, source: string | ArrayBuffer | ArrayBufferView, descriptors: { weight: string; style: string }) => NativeFontFace & { load(): Promise<NativeFontFace> };
interface BrowserFontSet {
  add(face: NativeFontFace): unknown;
  delete(face: NativeFontFace): unknown;
}
const browser = globalThis as unknown as { FontFace?: BrowserFontFaceClass; document?: { fonts?: BrowserFontSet } };

/** The browser's, taken before the content runs; absent where there's no document (the tests' node) */
const BrowserFontFace = typeof browser.FontFace === 'function' ? browser.FontFace : undefined;
const browserFonts = typeof browser.document === 'object' && browser.document ? browser.document.fonts : undefined;
const browserFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;
const setAdd = browserFonts ? browserFonts.add : undefined;
const setDelete = browserFonts ? browserFonts.delete : undefined;

/** The fonts of the frame: the browser's faces in its document.fonts */
export function createFrameFonts(fileBytes: (path: string) => Uint8Array | null, setTimeout: (callback: () => void, delay: number) => unknown) {
  return createFonts({
    fileBytes,
    async blobBytes(url) {
      if (!browserFetch) return null;
      const response = await browserFetch(url);
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    },
    async loadNative(family, source, descriptors) {
      if (!BrowserFontFace) throw new TypeError('no FontFace');
      const face = new BrowserFontFace(family, typeof source === 'string' ? source : (source as Uint8Array<ArrayBuffer>), descriptors);
      return face.load();
    },
    addNative(face) {
      if (browserFonts && setAdd) apply(setAdd, browserFonts, [face]);
    },
    deleteNative(face) {
      if (browserFonts && setDelete) apply(setDelete, browserFonts, [face]);
    },
    queueTask: (callback) => setTimeout(callback, 0),
  });
}
