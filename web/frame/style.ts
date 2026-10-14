// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// Component styles: the engine lays components out with Yoga, the web with CSS flexbox. Every component is a flex
// container with Yoga's defaults (relative, border-box, hidden overflow, no minimum size from its content), and each
// style property maps to its CSS counterpart. Values are converted as in the app: a property holds a string or a
// number, read back as it was set (null when unset); anything else unsets it, as null does. A string or number the
// property can't use (`width: 'wide'`, `display: 'grid'`) is kept, and laid out as if unset. Reading a style never
// throws: what can't be read is left out.

import { arrayBufferByteLength, brand, call, isArray, typedArrayName } from './brands.ts';

export type StyleValue = string | number | null;

const LENGTHS = new Set([
  'left', 'top', 'right', 'bottom', 'start', 'end',
  'marginLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginStart', 'marginEnd',
  'paddingLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingStart', 'paddingEnd',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'flexBasis', 'gap', 'rowGap', 'columnGap',
]);

const KEYWORDS: Record<string, string[]> = {
  position: ['relative', 'absolute', 'static'],
  display: ['flex', 'none', 'contents'],
  overflow: ['visible', 'hidden', 'scroll'],
  direction: ['inherit', 'ltr', 'rtl'],
  flexDirection: ['column', 'column-reverse', 'row', 'row-reverse'],
  justifyContent: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
  alignContent: ['flex-start', 'center', 'flex-end', 'stretch', 'space-between', 'space-around', 'space-evenly'],
  alignItems: ['auto', 'flex-start', 'center', 'flex-end', 'stretch', 'baseline'],
  alignSelf: ['auto', 'flex-start', 'center', 'flex-end', 'stretch', 'baseline'],
  flexWrap: ['no-wrap', 'wrap', 'wrap-reverse'],
  boxSizing: ['border-box', 'content-box'],
  imageRendering: ['auto', 'pixelated', 'crisp-edges'],
};

const NUMBERS = new Set(['flex', 'flexGrow', 'flexShrink', 'aspectRatio', 'opacity']);

export const STYLE_KEYS = [...LENGTHS, ...Object.keys(KEYWORDS), ...NUMBERS, 'backgroundColor'];
const STYLE_NAMES = new Set(STYLE_KEYS);

/** The base style of every component's element: Yoga's defaults in CSS */
export const BASE_CSS = 'display:flex;position:relative;box-sizing:border-box;overflow:hidden;min-width:0;min-height:0;flex-shrink:1;align-content:stretch;';

/** A style property's value: a string or a number; null (unset) for anything else */
export const styleValue = (value: unknown): StyleValue => (typeof value === 'string' || typeof value === 'number' ? value : null);

/**
 * A whole style (the `style` option, `component.style = …`) as the app reads it: the style properties among the names
 * `for…in` lists (inherited ones too), each read once and converted by `styleValue`. A property that can't be read (its
 * getter or a Proxy trap throws) is left out, all of them when the names can't be listed. null for anything other than
 * an object, and for an array or typed array: the style stays as it is.
 */
export function readStyle(value: unknown): [string, StyleValue][] | null {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return null;
  if (isArray(value) || call(typedArrayName, value) !== undefined || brand(arrayBufferByteLength, value)) return null;
  const names: string[] = [];
  try {
    for (const name in value) names.push(name);
  } catch {
    return [];
  }
  const entries: [string, StyleValue][] = [];
  for (const name of names) {
    if (!STYLE_NAMES.has(name)) continue;
    let item: unknown;
    try {
      item = (value as Record<string, unknown>)[name];
    } catch {
      continue;
    }
    entries.push([name, styleValue(item)]);
  }
  return entries;
}

/** A number written out as the app reads it: whitespace around it, a sign, a fraction, an exponent (" 10 ", "+1e2", ".5"); NaN otherwise */
function numberFromString(text: string): number {
  return /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(text) ? parseFloat(text) : NaN;
}

/** Points, as the app reads lengths and flex factors: a number, or a string of one with an optional "px" after it; NaN otherwise */
export function stylePoints(value: StyleValue): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  return numberFromString(value.endsWith('px') ? value.slice(0, -2) : value);
}

/** The app lays these out in single precision: a number too big for it is infinite, i.e. unset */
const finite = (number: number): boolean => Number.isFinite(Math.fround(number));

/** 10, "10", "10px" → "10px"; "50%" → "50%"; null for anything else, the property's default (also "auto") */
export function cssLength(value: StyleValue): string | null {
  if (typeof value === 'string' && value.endsWith('%')) {
    const percent = numberFromString(value.slice(0, -1));
    return finite(percent) ? `${percent}%` : null;
  }
  const points = stylePoints(value);
  return finite(points) ? `${points}px` : null;
}

/** #RGB(A), #RRGGBB(AA), rgb()/rgba(), names, or 0xRRGGBB numbers */
export function cssColor(value: StyleValue): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? `#${(value & 0xffffff).toString(16).padStart(6, '0')}` : null;
  return typeof value === 'string' ? value : null;
}

/** Opacity as the app reads it: a number, or a string of one or of a percentage ("50%" is 0.5); NaN otherwise */
function opacityNumber(value: StyleValue): number {
  if (typeof value !== 'string') return typeof value === 'number' ? value : NaN;
  return value.endsWith('%') ? numberFromString(value.slice(0, -1)) / 100 : numberFromString(value);
}

const kebab = (key: string): string => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** What applyStyle sets of an element's inline style (an element's CSSStyleDeclaration) */
export interface InlineStyle {
  setProperty(property: string, value: string): void;
  removeProperty(property: string): string;
  position: string; display: string; overflow: string; boxSizing: string; direction: string; flex: string;
  flexShrink: string; flexWrap: string; alignSelf: string; alignItems: string; aspectRatio: string; opacity: string;
  minWidth: string; minHeight: string; imageRendering: string; backgroundColor: string;
}

/**
 * Applies one style property to an element: null, or a value the property can't use, gives the property its default
 * (as the app lays it out). Returns whether the value was used.
 */
export function applyStyle(element: { readonly style: InlineStyle }, key: string, value: StyleValue): boolean {
  const style = element.style;
  // a value CSS refuses (a negative width) leaves the default rather than the one before
  clearStyle(element, key);
  if (value === null) return true;
  if (LENGTHS.has(key)) {
    const length = cssLength(value);
    if (length === null) return false;
    if (key === 'start' || key === 'end') style.setProperty(key === 'start' ? 'inset-inline-start' : 'inset-inline-end', length);
    else if (key === 'marginStart' || key === 'marginEnd') style.setProperty(key === 'marginStart' ? 'margin-inline-start' : 'margin-inline-end', length);
    else if (key === 'paddingStart' || key === 'paddingEnd') style.setProperty(key === 'paddingStart' ? 'padding-inline-start' : 'padding-inline-end', length);
    else style.setProperty(kebab(key), length);
    return true;
  }
  if (key in KEYWORDS) {
    if (typeof value !== 'string' || !KEYWORDS[key].includes(value)) return false;
    const keyword = value;
    if (key === 'flexWrap') style.flexWrap = keyword === 'no-wrap' ? 'nowrap' : keyword;
    else if (key === 'overflow') style.overflow = keyword === 'scroll' ? 'auto' : keyword;
    else if (key === 'alignSelf' && keyword === 'auto') style.alignSelf = 'auto';
    else if (key === 'alignItems' && keyword === 'auto') style.alignItems = 'normal';
    else if (key === 'direction') style.direction = keyword === 'inherit' ? '' : keyword;
    else if (key === 'imageRendering') style.imageRendering = keyword === 'crisp-edges' ? 'pixelated' : keyword;
    else style.setProperty(kebab(key), keyword);
    return true;
  }
  if (NUMBERS.has(key)) {
    const number = key === 'opacity' ? opacityNumber(value) : stylePoints(value);
    if (!finite(number)) return false;
    if (key === 'flex') {
      // Yoga's flex: positive grows from a zero basis, 0 is fixed, negative shrinks
      style.flex = number > 0 ? `${number} 1 0%` : number === 0 ? '0 0 auto' : `0 ${-number} auto`;
    } else if (key === 'aspectRatio') {
      style.aspectRatio = String(number);
    } else if (key === 'opacity') {
      style.opacity = String(Math.min(Math.max(number, 0), 1));
    } else {
      style.setProperty(kebab(key), String(number));
    }
    return true;
  }
  if (key === 'backgroundColor') {
    const color = cssColor(value);
    if (color === null) return false;
    style.backgroundColor = color;
    return true;
  }
  return false;
}

function clearStyle(element: { readonly style: InlineStyle }, key: string): void {
  const style = element.style;
  const property = ({
    start: 'inset-inline-start', end: 'inset-inline-end', marginStart: 'margin-inline-start', marginEnd: 'margin-inline-end',
    paddingStart: 'padding-inline-start', paddingEnd: 'padding-inline-end',
  } as Record<string, string>)[key] ?? kebab(key);
  style.removeProperty(property);
  // back to Yoga's default, not CSS's
  if (key === 'position') style.position = 'relative';
  if (key === 'display') style.display = 'flex';
  if (key === 'overflow') style.overflow = 'hidden';
  if (key === 'boxSizing') style.boxSizing = 'border-box';
  if (key === 'flexShrink' || key === 'flex') style.flexShrink = '1';
  if (key === 'minWidth') style.minWidth = '0';
  if (key === 'minHeight') style.minHeight = '0';
}

/** The style object components return: properties read back as stored, assignment merges, cssText for all */
export function createStyle(values: Map<string, StyleValue>, apply: (key: string, value: StyleValue) => void): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (key === 'cssText') return [...values].map(([name, value]) => `${kebab(name)}: ${value};`).join(' ');
      if (typeof key !== 'string') return undefined;
      return values.has(key) ? values.get(key) : STYLE_KEYS.includes(key) ? null : undefined;
    },
    set(_target, key, value) {
      if (key === 'cssText') {
        // anything other than a string clears the style, as in the app
        const text = typeof value === 'string' ? value : '';
        for (const name of [...values.keys()]) apply(name, null);
        for (const declaration of text.split(';')) {
          const [name, ...rest] = declaration.split(':');
          if (!name?.trim() || !rest.length) continue;
          const camel = name.trim().replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
          apply(camel, rest.join(':').trim());
        }
        return true;
      }
      if (typeof key === 'string') apply(key, styleValue(value));
      return true;
    },
    has(_target, key) {
      return typeof key === 'string' && (values.has(key) || STYLE_KEYS.includes(key) || key === 'cssText');
    },
    ownKeys() {
      return [...values.keys()];
    },
    getOwnPropertyDescriptor(_target, key) {
      return typeof key === 'string' && values.has(key) ? { value: values.get(key), enumerable: true, configurable: true, writable: true } : undefined;
    },
  });
}
