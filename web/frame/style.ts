// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// Component styles: the engine lays components out with Yoga, the web with CSS flexbox. Every component is a flex
// container with Yoga's defaults (relative, border-box, hidden overflow, no minimum size from its content), and each
// style property maps to its CSS counterpart. Values read back as they were set; null when unset.

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

/** The base style of every component's element: Yoga's defaults in CSS */
export const BASE_CSS = 'display:flex;position:relative;box-sizing:border-box;overflow:hidden;min-width:0;min-height:0;flex-shrink:1;align-content:stretch;';

/** "10", 10, "10px" → "10px"; "50%" stays; anything else isn't a length */
export function cssLength(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? `${value}px` : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^-?\d*\.?\d+(px)?$/.test(text)) return `${parseFloat(text)}px`;
  if (/^-?\d*\.?\d+%$/.test(text)) return text;
  if (text === 'auto') return 'auto';
  return null;
}

/** #RGB(A), #RRGGBB(AA), rgb()/rgba(), names, or 0xRRGGBB numbers */
export function cssColor(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? `#${(value & 0xffffff).toString(16).padStart(6, '0')}` : null;
  return typeof value === 'string' ? value : null;
}

const kebab = (key: string): string => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** Applies one style property to an element; returns false for a value the engine would ignore */
export function applyStyle(element: HTMLElement, key: string, value: unknown): boolean {
  const style = element.style;
  if (value === null || value === undefined) {
    clearStyle(element, key);
    return true;
  }
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
    const keyword = String(value);
    if (!KEYWORDS[key].includes(keyword)) return false;
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
    const number = typeof value === 'number' ? value : parseFloat(String(value));
    if (!Number.isFinite(number)) return false;
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

function clearStyle(element: HTMLElement, key: string): void {
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
}

/** The style object components return: properties read back as stored, assignment merges, cssText for all */
export function createStyle(values: Map<string, StyleValue>, apply: (key: string, value: unknown) => void): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (key === 'cssText') return [...values].map(([name, value]) => `${kebab(name)}: ${value};`).join(' ');
      if (typeof key !== 'string') return undefined;
      return values.has(key) ? values.get(key) : STYLE_KEYS.includes(key) ? null : undefined;
    },
    set(_target, key, value) {
      if (key === 'cssText') {
        for (const name of [...values.keys()]) apply(name, null);
        for (const declaration of String(value).split(';')) {
          const [name, ...rest] = declaration.split(':');
          if (!name?.trim() || !rest.length) continue;
          const camel = name.trim().replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
          apply(camel, rest.join(':').trim());
        }
        return true;
      }
      if (typeof key === 'string') apply(key, value);
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
