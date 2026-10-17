// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// A widget's sizes as the app gives them: the presets and the manifest's own sizes, `widget.resize`'s range and
// ratio, and where the widget's window may be on its display. The page (web/host) and the frame (web/frame) share it;
// the frame's parts run beside the content, so they use only what's taken here before it runs.

import type { Rect } from './protocol.ts';

const { min, max, floor, round, abs, SQRT2 } = Math;
const { isInteger, isFinite } = Number;

export interface Size {
  width: number;
  height: number;
}

/** The presets' points, as in WidgetKit */
export const PRESET_SIZES: Readonly<Record<string, Size>> = {
  small: { width: 164, height: 164 },
  medium: { width: 344, height: 164 },
  large: { width: 344, height: 344 },
};

/** The smallest width and height of a widget */
export const MIN_WIDGET_EDGE = 32;

/** Points inside a widget's edges that resize it, when the user may */
export const RESIZE_BAND = 6;

/** The API version that brought widget sizes of their own and widget.resize: widgets made for an earlier one keep the old rules */
export const SIZING_API_VERSION = 8;

/** How the widget's window is sized, as the app tells the engine (the launch's `widgetSizing`) */
export interface WidgetSizing {
  /** The size it has: the one picked, or the one the user or the content left it in */
  size: Size;
  minimum: Size;
  /** A dimension of 0: no limit */
  maximum: Size;
  byUser: boolean;
  byContent: boolean;
  /** The size whose ratio it keeps; 0 × 0: any ratio */
  aspectRatio: Size;
}

/** A size in `widget.sizes` the app can use: its id and points */
export interface DeclaredSize extends Size {
  id: string;
}

const isEdge = (value: unknown): value is number => typeof value === 'number' && isInteger(value) && value >= MIN_WIDGET_EDGE;

/** The sizes a manifest declares, in order and each once, the ones that aren't valid left out; small when there are none */
export function declaredSizes(manifest: { widget?: { sizes?: unknown } } | null | undefined): DeclaredSize[] {
  const sizes: DeclaredSize[] = [];
  const entries = manifest?.widget?.sizes;
  const list = Array.isArray(entries) ? entries : [];
  for (let index = 0; index < list.length; index++) {
    const entry = list[index] as unknown;
    let size: DeclaredSize | null = null;
    if (typeof entry === 'string' && Object.hasOwn(PRESET_SIZES, entry)) {
      size = { id: entry, ...PRESET_SIZES[entry] };
    } else if (entry && typeof entry === 'object') {
      const { id, width, height } = entry as Record<string, unknown>;
      if (typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && !Object.hasOwn(PRESET_SIZES, id) && isEdge(width) && isEdge(height)) {
        size = { id, width, height };
      }
    }
    if (size && !sizes.some((other) => other.id === size.id)) sizes.push(size);
  }
  return sizes.length ? sizes : [{ id: 'small', ...PRESET_SIZES.small }];
}

/**
 * How the widget is sized starting at `size` (one of `declaredSizes`), from the manifest's `widget.resize`, and the size
 * it was left in when it can be resized
 */
export function widgetSizing(manifest: { widget?: { sizes?: unknown; resize?: unknown } } | null | undefined, size: Size, leftIn?: Size | null): WidgetSizing {
  size = { width: size.width, height: size.height };
  const resize = manifest?.widget?.resize as Record<string, unknown> | undefined;
  const by = resize && Array.isArray(resize.by) ? resize.by : [];
  const byUser = by.includes('user');
  const byContent = by.includes('content');
  if (!byUser && !byContent) {
    return { size: { ...size }, minimum: { ...size }, maximum: { ...size }, byUser, byContent, aspectRatio: { width: 0, height: 0 } };
  }
  const limit = (value: unknown, fallback: number) => (isEdge(value) ? value : fallback);
  const sizing: WidgetSizing = {
    size: { ...size },
    minimum: { width: limit(resize!.minWidth, MIN_WIDGET_EDGE), height: limit(resize!.minHeight, MIN_WIDGET_EDGE) },
    maximum: { width: limit(resize!.maxWidth, 0), height: limit(resize!.maxHeight, 0) },
    byUser,
    byContent,
    aspectRatio: resize!.aspectRatio === 'fixed' ? { ...size } : { width: 0, height: 0 },
  };
  sizing.size = inRange(leftIn ?? size, sizing);
  return sizing;
}

/** A size in the range, of the ratio when it's fixed: the biggest of that ratio inside `size`; a point off counts as it */
export function inRange(size: Size, sizing: WidgetSizing): Size {
  const minimum = { width: max(sizing.minimum.width, 1), height: max(sizing.minimum.height, 1) };
  const maximum = {
    width: sizing.maximum.width > 0 ? sizing.maximum.width : Infinity,
    height: sizing.maximum.height > 0 ? sizing.maximum.height : Infinity,
  };
  const ratio = sizing.aspectRatio;
  if (ratio.width > 0 && ratio.height > 0) {
    const r = ratio.width / ratio.height;
    const matches = abs(size.width - size.height * r) <= 1;
    let width = matches ? size.width : min(size.width, size.height * r);
    width = max(max(minimum.width, minimum.height * r), min(width, min(maximum.width, maximum.height * r)));
    if (matches && abs(width - size.width) <= 1) return { width: size.width, height: size.height };
    return { width: round(width), height: round(width / r) };
  }
  return {
    width: max(minimum.width, min(size.width, maximum.width)),
    height: max(minimum.height, min(size.height, maximum.height)),
  };
}

/**
 * A widget's size made to fit an area, as its window is kept there: scaled down in its shape, or, when `sizing` lets it
 * be resized without keeping its ratio, each edge kept to the area, then to the smallest size it may have
 */
export function fitted(size: Size, area: Rect, sizing?: WidgetSizing | null): Size {
  if (size.width <= 0 || size.height <= 0) return { width: size.width, height: size.height };
  if (sizing && (sizing.byUser || sizing.byContent) && (sizing.aspectRatio.width <= 0 || sizing.aspectRatio.height <= 0)) {
    return {
      width: max(min(size.width, floor(area.width)), sizing.minimum.width),
      height: max(min(size.height, floor(area.height)), sizing.minimum.height),
    };
  }
  const scale = min(1, area.width / size.width, area.height / size.height);
  return scale < 1 ? { width: floor(size.width * scale), height: floor(size.height * scale) } : { width: size.width, height: size.height };
}

/** How far a window reaches past where it takes the mouse on its left, right and bottom */
export interface Margins {
  left: number;
  right: number;
  bottom: number;
}

/** How far a window of `size` reaches past the bounds of its hit region; none without one, or with one that's empty */
export function hitMargins(hitRegion: readonly Rect[] | null, size: Size): Margins {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  if (hitRegion) {
    for (let index = 0; index < hitRegion.length; index++) {
      // the part inside the window
      const rect = hitRegion[index];
      const x0 = max(rect.x, 0);
      const y0 = max(rect.y, 0);
      const x1 = min(rect.x + rect.width, size.width);
      const y1 = min(rect.y + rect.height, size.height);
      if (x1 <= x0 || y1 <= y0) continue;
      left = min(left, x0);
      top = min(top, y0);
      right = max(right, x1);
      bottom = max(bottom, y1);
    }
  }
  if (right <= left || bottom <= top) return { left: 0, right: 0, bottom: 0 };
  return { left, right: size.width - right, bottom: size.height - bottom };
}

/**
 * Where the widget's window is for the frame its style or the user gives it: `size` (the user's) unless the content
 * may resize it, the content's in the range otherwise; scaled down to fit the visible frame of its display, and inside
 * it, its top left corner kept where it can be. With a hit region, only where it takes the mouse is kept inside on the
 * left, the right and the bottom, what's round it may be off (a shadow); the window's top stays below the menu bar.
 */
export function widgetFrame(frame: Rect, sizing: WidgetSizing, size: Size, visible: Rect, hitRegion: readonly Rect[] | null = null): Rect {
  const wanted = sizing.byContent ? inRange(frame, sizing) : size;
  const { width, height } = fitted(wanted, visible, sizing);
  const margins = hitMargins(hitRegion, { width, height });
  return {
    x: max(visible.x - margins.left, min(frame.x, visible.x + visible.width - width + margins.right)),
    y: max(visible.y, min(frame.y, visible.y + visible.height - height + margins.bottom)),
    width,
    height,
  };
}

/** The edges a point (in points from a window's top left) is on, within the band that resizes it; null inside */
export interface Edges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

export function edgesAt(x: number, y: number, size: Size): Edges | null {
  if (x < 0 || y < 0 || x >= size.width || y >= size.height) return null;
  const edges = { left: x < RESIZE_BAND, right: x >= size.width - RESIZE_BAND, top: y < RESIZE_BAND, bottom: y >= size.height - RESIZE_BAND };
  return edges.left || edges.right || edges.top || edges.bottom ? edges : null;
}

/** The cursor for resizing by those edges, as the system shows it */
export function resizeCursor(edges: Edges): string {
  if ((edges.left && edges.top) || (edges.right && edges.bottom)) return 'nwse-resize';
  if ((edges.right && edges.top) || (edges.left && edges.bottom)) return 'nesw-resize';
  return edges.left || edges.right ? 'ew-resize' : 'ns-resize';
}

/**
 * The frame of a window resized by dragging `edges` by (dx, dy) from `origin`: the opposite edges stay, it stays in
 * the range and of the ratio when that's fixed, and inside the visible frame of its display
 */
export function resizedFrame(origin: Rect, edges: Edges, dx: number, dy: number, sizing: WidgetSizing, visible: Rect): Rect {
  const horizontal = edges.left || edges.right;
  const vertical = edges.top || edges.bottom;
  // the room each way from the edges that stay
  const room = {
    width: edges.left ? origin.x + origin.width - visible.x : visible.x + visible.width - origin.x,
    height: edges.top ? origin.y + origin.height - visible.y : visible.y + visible.height - origin.y,
  };
  const bounded: WidgetSizing = {
    ...sizing,
    maximum: {
      width: sizing.maximum.width > 0 ? min(sizing.maximum.width, room.width) : room.width,
      height: sizing.maximum.height > 0 ? min(sizing.maximum.height, room.height) : room.height,
    },
  };
  let width = horizontal ? origin.width + (edges.right ? dx : -dx) : origin.width;
  let height = vertical ? origin.height + (edges.bottom ? dy : -dy) : origin.height;
  const ratio = sizing.aspectRatio;
  if (ratio.width > 0 && ratio.height > 0) {
    const r = ratio.width / ratio.height;
    // the edge dragged leads; from a corner, the way it moved most
    if (horizontal && (!vertical || abs(width - origin.width) >= abs(height - origin.height) * r)) height = width / r;
    else width = height * r;
    const size = inRange({ width: max(width, 1), height: max(height, 1) }, bounded);
    width = round(size.width);
    height = round(size.height);
  } else {
    const size = inRange({ width, height }, bounded);
    width = round(size.width);
    height = round(size.height);
  }
  return {
    x: edges.left ? origin.x + origin.width - width : origin.x,
    y: edges.top ? origin.y + origin.height - height : origin.y,
    width,
    height,
  };
}

/**
 * The shape a widget draws at the bottom right corner of its body, which the resize hint follows: how far in from the
 * body's right and bottom edges it starts, in points, and the radius of its rounded corner
 */
export interface CornerShape {
  right: number;
  bottom: number;
  radius: number;
}

/** Points of the body's corner that are measured, at most: room for the biggest corner the hint follows and a margin */
export const CORNER_MEASURE = 96;

/** The rounded corners the hint follows, at most: a bigger one would make it a long arc */
export const MAX_HINT_RADIUS = 40;

/**
 * Measures the corner as the app does, from `count` × `count` pixels of it (`scale` to a point) of which `opaque` says
 * whether the one `left` and `up` from the corner is: the first opaque pixel along the top row and the left column of
 * the square are the shape's right and bottom edges, and along the diagonal from where they meet, its rounded corner,
 * whose arc is r (√2 - 1) from it. Null when something is clear all along.
 */
export function measureCorner(opaque: (left: number, up: number) => boolean, count: number, scale: number): CornerShape | null {
  let right = -1;
  let bottom = -1;
  let diagonal = -1;
  for (let left = 0; left < count; left++) {
    if (opaque(left, count - 1)) {
      right = left;
      break;
    }
  }
  for (let up = 0; up < count; up++) {
    if (opaque(count - 1, up)) {
      bottom = up;
      break;
    }
  }
  if (right < 0 || bottom < 0) return null;
  for (let step = 0; right + step < count && bottom + step < count; step++) {
    if (opaque(right + step, bottom + step)) {
      diagonal = step;
      break;
    }
  }
  if (diagonal < 0) return null;
  return { right: right / scale, bottom: bottom / scale, radius: (diagonal * SQRT2) / scale / (SQRT2 - 1) };
}

/**
 * A window's corner as its frame measured it, as the host can trust it: within the part measured and the corners the
 * hint follows, so the hint stays at the widget's corner whatever the frame says
 */
export function sanitizeCorner(value: unknown): CornerShape | null {
  const shape = value as Partial<CornerShape> | null;
  const within = (number: unknown, limit: number) => (typeof number === 'number' && isFinite(number) ? min(max(number, 0), limit) : null);
  const right = within(shape?.right, CORNER_MEASURE);
  const bottom = within(shape?.bottom, CORNER_MEASURE);
  const radius = within(shape?.radius, MAX_HINT_RADIUS);
  return right === null || bottom === null || radius === null ? null : { right, bottom, radius };
}

/**
 * The resize hint, as the app draws it: a thick stroke of glass with round ends, `HINT_WIDTH` wide and `HINT_LENGTH`
 * long, `HINT_GAP` from the body's edges, with room around it for its nudge
 */
export const HINT_WIDTH = 5;
const HINT_LENGTH = 24;
export const HINT_GAP = 4;
export const HINT_PADDING = 6;

/**
 * The resize hint around a corner of `radius`, outside it (or inside it, when outside it wouldn't be seen): a stretch of
 * an arc around the corner's, centered on its diagonal; around a tight corner, whose quarter arc is shorter than the
 * hint, the whole quarter and straight arms along the edges. `path` is the stroke's center line as an SVG path in a box
 * of `width` × `height` (y going down), and `corner` where the body's corner is in it.
 */
export function resizeHintShape(radius: number, outside: boolean): { path: string; width: number; height: number; corner: { x: number; y: number } } {
  radius = max(0, min(radius, MAX_HINT_RADIUS));
  const offset = HINT_GAP + HINT_WIDTH / 2;
  // the arc's center, `inset` in from the body's corner along each axis, and its radius
  let inset = radius;
  let arc = radius + offset;
  if (!outside) {
    inset = max(radius, 3 + offset);
    arc = inset - offset;
  }
  const quarter = (arc * Math.PI) / 2;
  const arm = max(0, (HINT_LENGTH - quarter) / 2);
  const half = arm > 0 ? Math.PI / 4 : HINT_LENGTH / arc / 2;
  const from = Math.PI / 4 - half;
  const to = Math.PI / 4 + half;
  // from the arc's center, y going down: the arc runs from the right edge's side to the bottom edge's
  const start = { x: arc * Math.cos(from), y: arc * Math.sin(from) };
  const end = { x: arc * Math.cos(to), y: arc * Math.sin(to) };
  const box = { left: end.x - arm, top: start.y - arm, right: start.x, bottom: end.y };
  const pad = HINT_PADDING + HINT_WIDTH / 2;
  const cx = pad - box.left;
  const cy = pad - box.top;
  const n = (value: number) => +value.toFixed(2);
  const path = `M${n(cx + start.x)} ${n(cy + start.y - arm)}` + (arm > 0 ? `V${n(cy + start.y)}` : '')
    + `A${n(arc)} ${n(arc)} 0 0 1 ${n(cx + end.x)} ${n(cy + end.y)}` + (arm > 0 ? `H${n(cx + end.x - arm)}` : '');
  return {
    path,
    width: n(box.right - box.left + 2 * pad),
    height: n(box.bottom - box.top + 2 * pad),
    corner: { x: cx + inset, y: cy + inset },
  };
}
