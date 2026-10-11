// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// What the engine's canvas contexts have: the web runtime gives content these and nothing more, so what runs in a
// preview runs in the app (a browser's contexts have more: ellipse, roundRect, filter, conic gradients, more
// compositing modes and colors, more WebGL extensions). The app's engine is what counts: these lists follow it, and
// types/desktop-engine.d.ts declares the same (test/web-dev.test.ts checks that they agree). Plain data, no DOM: the
// tests read it in Node.js.

/** The 2D context's properties that content sets and reads */
export const CONTEXT_2D_PROPERTIES = [
  'globalCompositeOperation', 'lineCap', 'lineJoin', 'textAlign', 'textBaseline', 'fillStyle', 'strokeStyle',
  'globalAlpha', 'lineWidth', 'miterLimit', 'font', 'imageSmoothingEnabled', 'lineDashOffset', 'shadowColor',
  'shadowBlur', 'shadowOffsetX', 'shadowOffsetY',
] as const;

/** The 2D context's read-only properties */
export const CONTEXT_2D_READONLY = ['canvas'] as const;

/** The 2D context's methods. isPointInPath is there but not implemented: it only warns */
export const CONTEXT_2D_METHODS = [
  'isContextLost', 'save', 'restore', 'resetCurrentState', 'rotate', 'translate', 'scale', 'transform', 'setTransform',
  'resetTransform', 'drawImage', 'fillRect', 'strokeRect', 'clearRect', 'getImageData', 'createImageData',
  'putImageData', 'createLinearGradient', 'createRadialGradient', 'createPattern', 'beginPath', 'closePath', 'fill',
  'stroke', 'moveTo', 'lineTo', 'rect', 'bezierCurveTo', 'quadraticCurveTo', 'arcTo', 'arc', 'measureText', 'fillText',
  'strokeText', 'clip', 'resetClip', 'getLineDash', 'setLineDash', 'isPointInPath',
] as const;

/** globalCompositeOperation's values; others are ignored */
export const COMPOSITE_OPERATIONS = [
  'source-over', 'lighter', 'lighten', 'darker', 'darken', 'destination-out', 'destination-over', 'source-atop', 'xor',
  'copy', 'source-in', 'destination-in', 'source-out', 'destination-atop',
] as const;

/** What measureText's result has */
export const TEXT_METRICS = ['width', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent'] as const;

/**
 * The 2D context's state stack: a save beyond it is ignored (with a warning), as are the restores that would match
 * it
 */
export const STATE_STACK_SIZE = 16;

/**
 * The WebGL extensions the engine has for a WebGL 1 and a WebGL 2 context. The app offers the ones of them the Mac's
 * GPU has, the web the ones the browser has too; getExtension takes the exact name (browsers ignore case)
 */
export const WEBGL_EXTENSIONS: Record<1 | 2, readonly string[]> = {
  1: [
    'EXT_texture_filter_anisotropic', 'OES_texture_float', 'OES_texture_half_float', 'OES_texture_half_float_linear',
    'OES_standard_derivatives', 'OES_vertex_array_object', 'ANGLE_instanced_arrays', 'OES_element_index_uint',
    'WEBGL_compressed_texture_pvrtc', 'WEBGL_compressed_texture_astc', 'WEBGL_depth_texture', 'EXT_blend_minmax',
  ],
  2: [
    'EXT_texture_filter_anisotropic', 'WEBGL_compressed_texture_pvrtc', 'WEBGL_compressed_texture_astc',
    'OES_texture_float_linear', 'EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'EXT_float_blend',
    'EXT_texture_norm16', 'WEBGL_compressed_texture_s3tc', 'EXT_texture_compression_bptc',
    'EXT_texture_compression_rgtc', 'WEBGL_compressed_texture_etc',
  ],
};

/**
 * Names getExtension also answers to, with another extension's object: in WebGL 1, OES_texture_float_linear is
 * OES_texture_float's (linear filtering comes with float textures). They aren't in getSupportedExtensions
 */
export const WEBGL_EXTENSION_ALIASES: Record<1 | 2, Readonly<Record<string, string>>> = {
  1: { OES_texture_float_linear: 'OES_texture_float' },
  2: {},
};

// MARK: Colors

/**
 * The CSS named colors, and transparent, as the engine has them (rrggbbaa). mediumpurple and palevioletred are 3/255
 * off CSS's in one channel, there too
 */
const NAMED_COLORS = new Map((
  'aliceblue:f0f8ffff antiquewhite:faebd7ff aqua:00ffffff aquamarine:7fffd4ff azure:f0ffffff beige:f5f5dcff '
  + 'bisque:ffe4c4ff black:000000ff blanchedalmond:ffebcdff blue:0000ffff blueviolet:8a2be2ff brown:a52a2aff '
  + 'burlywood:deb887ff cadetblue:5f9ea0ff chartreuse:7fff00ff chocolate:d2691eff coral:ff7f50ff cornflowerblue:6495edff '
  + 'cornsilk:fff8dcff crimson:dc143cff cyan:00ffffff darkblue:00008bff darkcyan:008b8bff darkgoldenrod:b8860bff '
  + 'darkgray:a9a9a9ff darkgreen:006400ff darkgrey:a9a9a9ff darkkhaki:bdb76bff darkmagenta:8b008bff '
  + 'darkolivegreen:556b2fff darkorange:ff8c00ff darkorchid:9932ccff darkred:8b0000ff darksalmon:e9967aff '
  + 'darkseagreen:8fbc8fff darkslateblue:483d8bff darkslategray:2f4f4fff darkslategrey:2f4f4fff darkturquoise:00ced1ff '
  + 'darkviolet:9400d3ff deeppink:ff1493ff deepskyblue:00bfffff dimgray:696969ff dimgrey:696969ff dodgerblue:1e90ffff '
  + 'firebrick:b22222ff floralwhite:fffaf0ff forestgreen:228b22ff fuchsia:ff00ffff gainsboro:dcdcdcff '
  + 'ghostwhite:f8f8ffff gold:ffd700ff goldenrod:daa520ff gray:808080ff green:008000ff greenyellow:adff2fff '
  + 'grey:808080ff honeydew:f0fff0ff hotpink:ff69b4ff indianred:cd5c5cff indigo:4b0082ff ivory:fffff0ff khaki:f0e68cff '
  + 'lavender:e6e6faff lavenderblush:fff0f5ff lawngreen:7cfc00ff lemonchiffon:fffacdff lightblue:add8e6ff '
  + 'lightcoral:f08080ff lightcyan:e0ffffff lightgoldenrodyellow:fafad2ff lightgray:d3d3d3ff lightgreen:90ee90ff '
  + 'lightgrey:d3d3d3ff lightpink:ffb6c1ff lightsalmon:ffa07aff lightseagreen:20b2aaff lightskyblue:87cefaff '
  + 'lightslategray:778899ff lightslategrey:778899ff lightsteelblue:b0c4deff lightyellow:ffffe0ff lime:00ff00ff '
  + 'limegreen:32cd32ff linen:faf0e6ff magenta:ff00ffff maroon:800000ff mediumaquamarine:66cdaaff mediumblue:0000cdff '
  + 'mediumorchid:ba55d3ff mediumpurple:9370d8ff mediumseagreen:3cb371ff mediumslateblue:7b68eeff '
  + 'mediumspringgreen:00fa9aff mediumturquoise:48d1ccff mediumvioletred:c71585ff midnightblue:191970ff '
  + 'mintcream:f5fffaff mistyrose:ffe4e1ff moccasin:ffe4b5ff navajowhite:ffdeadff navy:000080ff oldlace:fdf5e6ff '
  + 'olive:808000ff olivedrab:6b8e23ff orange:ffa500ff orangered:ff4500ff orchid:da70d6ff palegoldenrod:eee8aaff '
  + 'palegreen:98fb98ff paleturquoise:afeeeeff palevioletred:d87093ff papayawhip:ffefd5ff peachpuff:ffdab9ff '
  + 'peru:cd853fff pink:ffc0cbff plum:dda0ddff powderblue:b0e0e6ff purple:800080ff rebeccapurple:663399ff red:ff0000ff '
  + 'rosybrown:bc8f8fff royalblue:4169e1ff saddlebrown:8b4513ff salmon:fa8072ff sandybrown:f4a460ff seagreen:2e8b57ff '
  + 'seashell:fff5eeff sienna:a0522dff silver:c0c0c0ff skyblue:87ceebff slateblue:6a5acdff slategray:708090ff '
  + 'slategrey:708090ff snow:fffafaff springgreen:00ff7fff steelblue:4682b4ff tan:d2b48cff teal:008080ff '
  + 'thistle:d8bfd8ff tomato:ff6347ff transparent:00000000 turquoise:40e0d0ff violet:ee82eeff wheat:f5deb3ff '
  + 'white:ffffffff whitesmoke:f5f5f5ff yellow:ffff00ff yellowgreen:9acd32ff'
).split(' ').map((entry) => entry.split(':') as [string, string]));

export const NAMED_COLOR_NAMES: readonly string[] = [...NAMED_COLORS.keys()];

/** Red, green, blue and alpha, 0–255 */
export type RGBA = [number, number, number, number];

const component = (value: number): number => Math.round(Math.min(Math.max(value, 0), 255));

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/;

interface Argument {
  value: number;
  percent: boolean;
  unit: string;
}

/** rgb() and hsl()'s arguments: comma separated (legacy), or separated by spaces with an optional "/ alpha" */
function colorArguments(text: string): Argument[] | null {
  const commas = text.includes(',');
  const parsed: Argument[] = [];
  let rest = text;
  for (;;) {
    rest = rest.trimStart();
    if (!rest) break;
    if (parsed.length > 0) {
      // a separator before every argument but the first
      if (commas) {
        if (rest[0] !== ',') return null;
        rest = rest.slice(1);
      } else if (rest[0] === '/') {
        if (parsed.length !== 3) return null;
        rest = rest.slice(1);
      } else if (parsed.length === 3) {
        // the alpha needs the slash
        return null;
      }
      rest = rest.trimStart();
    }
    if (parsed.length === 4) return null;
    const number = NUMBER.exec(rest);
    if (!number) return null;
    const value = Number(number[0]);
    if (!Number.isFinite(value)) return null;
    rest = rest.slice(number[0].length);
    let percent = false;
    let unit = '';
    if (rest[0] === '%') {
      percent = true;
      rest = rest.slice(1);
    } else {
      unit = /^[a-z]*/.exec(rest)![0];
      if (unit.length >= 8) return null;
      rest = rest.slice(unit.length);
    }
    parsed.push({ value, percent, unit });
  }
  return parsed;
}

const alphaOf = (argument: Argument | undefined): number => {
  if (!argument) return 1;
  const alpha = argument.percent ? argument.value / 100 : argument.value;
  return Math.min(Math.max(alpha, 0), 1);
};

function rgbColor(text: string): RGBA | null {
  const parsed = colorArguments(text);
  if (!parsed || (parsed.length !== 3 && parsed.length !== 4) || parsed.some((argument) => argument.unit)) return null;
  const [r, g, b] = parsed.map((argument) => (argument.percent ? (argument.value * 255) / 100 : argument.value));
  return [component(r), component(g), component(b), component(alphaOf(parsed[3]) * 255)];
}

function hueToRGB(m1: number, m2: number, h: number): number {
  if (h < 0) h += 1;
  if (h > 1) h -= 1;
  if (h * 6 < 1) return m1 + (m2 - m1) * h * 6;
  if (h * 2 < 1) return m2;
  if (h * 3 < 2) return m1 + (m2 - m1) * (2 / 3 - h) * 6;
  return m1;
}

function hslColor(text: string): RGBA | null {
  const parsed = colorArguments(text);
  if (!parsed || (parsed.length !== 3 && parsed.length !== 4)) return null;
  // hue: degrees, or an angle
  const [hue, saturation, lightness, alpha] = parsed;
  if (hue.percent) return null;
  const degrees = { '': 1, deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 }[hue.unit];
  if (degrees === undefined) return null;
  // saturation and lightness: percentages (plain numbers count as percentages too)
  if (saturation.unit || lightness.unit || alpha?.unit) return null;
  let h = ((hue.value * degrees) % 360) / 360;
  if (h < 0) h += 1;
  const s = Math.min(Math.max(saturation.value / 100, 0), 1);
  const l = Math.min(Math.max(lightness.value / 100, 0), 1);
  const m2 = l <= 0.5 ? l * (s + 1) : l + s - l * s;
  const m1 = l * 2 - m2;
  return [
    component(hueToRGB(m1, m2, h + 1 / 3) * 255),
    component(hueToRGB(m1, m2, h) * 255),
    component(hueToRGB(m1, m2, h - 1 / 3) * 255),
    component(alphaOf(alpha) * 255),
  ];
}

/** The arguments of `name(…)`, or null */
function functionArguments(text: string, names: string[]): string | null {
  for (const name of names) {
    if (text.startsWith(`${name}(`) && text.endsWith(')')) return text.slice(name.length + 1, -1);
  }
  return null;
}

/**
 * A color as the engine reads it: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` / `rgba()` and `hsl()` / `hsla()`
 * with commas or spaces, or a named color. Anything else (other types, `oklch()`, `color()`, `hwb()`, `currentcolor`,
 * system colors) is null: the app ignores it
 */
export function parseColor(value: unknown): RGBA | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text || text.length > 127) return null;
  if (text[0] === '#') {
    const hex = text.slice(1);
    if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/.test(hex)) return null;
    const step = hex.length <= 4 ? 1 : 2;
    const result: RGBA = [0, 0, 0, 255];
    for (let index = 0; index < hex.length / step; index++) {
      const digits = hex.slice(index * step, index * step + step);
      result[index] = step === 1 ? parseInt(digits, 16) * 17 : parseInt(digits, 16);
    }
    return result;
  }
  const rgb = functionArguments(text, ['rgb', 'rgba']);
  if (rgb !== null) return rgbColor(rgb);
  const hsl = functionArguments(text, ['hsl', 'hsla']);
  if (hsl !== null) return hslColor(hsl);
  const named = NAMED_COLORS.get(text);
  return named ? [0, 2, 4, 6].map((offset) => parseInt(named.slice(offset, offset + 2), 16)) as RGBA : null;
}

/** How the engine gives a color back: `rgba(r,g,b,a)`, the alpha with three decimals */
export function formatColor([r, g, b, a]: RGBA): string {
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

// MARK: Fonts

export interface Font {
  italic: boolean;
  /** 1–1000 */
  weight: number;
  /** In pixels */
  size: number;
  /** The list of families as given, '' when there's none (the font keeps its family) */
  families: string;
}

/**
 * The CSS `font` shorthand as the engine reads it: style, weight and the words it ignores (variant, stretch) in any
 * order, a size in px or pt, an optional line height (ignored) and the families. Anything else (em, rem, %, size
 * keywords, system fonts like caption) is null: the app ignores it
 */
export function parseFont(value: unknown): Font | null {
  if (typeof value !== 'string') return null;
  let rest = value;
  let italic = false;
  let weight = 400;
  let size = 0;
  for (;;) {
    rest = rest.replace(/^\s+/, '');
    if (!rest) return null;
    const number = NUMBER.exec(rest);
    if (number) {
      const unit = /^[a-z]*/i.exec(rest.slice(number[0].length))![0].toLowerCase();
      const amount = Number(number[0]);
      rest = rest.slice(number[0].length + unit.length);
      if (unit === 'px' || unit === 'pt') {
        size = unit === 'pt' ? (amount * 4) / 3 : amount;
        break;
      }
      if (!unit && amount >= 1 && amount <= 1000 && Number.isInteger(amount)) {
        weight = amount;
        continue;
      }
      return null;
    }
    const word = /^\S+/.exec(rest)![0];
    rest = rest.slice(word.length);
    const lower = word.toLowerCase();
    if (lower === 'italic' || lower === 'oblique') italic = true;
    else if (lower === 'bold' || lower === 'bolder') weight = 700;
    else if (lower === 'lighter') weight = 300;
    else if (lower !== 'normal' && lower !== 'small-caps' && !lower.endsWith('condensed') && !lower.endsWith('expanded')) return null;
  }
  if (!(size > 0)) return null;
  // an optional line height
  rest = rest.replace(/^\s+/, '');
  if (rest[0] === '/') rest = rest.slice(1).replace(/^\s*\S*/, '');
  const families = rest.split(',').map((family) => family.replace(/^[\s"']+|[\s"']+$/g, '')).filter(Boolean);
  return { italic, weight, size, families: families.join(', ') };
}
