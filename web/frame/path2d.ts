// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The path methods as the engine takes their arguments, for the 2D context and Path2D, and the engine's Path2D: an
// object of its own around the browser's, as the engine's takes numbers (anything else is 0) and does nothing when an
// argument is missing, where a browser converts and throws.

/** A number argument as the engine reads it */
export const num = (value: unknown): number => (typeof value === 'number' ? value : value === true ? 1 : 0);

export const PATH_METHODS = [
  'moveTo', 'lineTo', 'rect', 'bezierCurveTo', 'quadraticCurveTo', 'arcTo', 'arc', 'ellipse', 'roundRect', 'closePath',
] as const;
export type PathMethod = (typeof PATH_METHODS)[number];

/** Calls a path method of the browser's context or Path2D with the arguments as the engine takes them */
export function callPath(target: CanvasPath, method: PathMethod, args: unknown[]): void {
  const count = args.length;
  const n = args.map(num);
  switch (method) {
    case 'moveTo':
      if (count >= 2) target.moveTo(n[0], n[1]);
      break;
    case 'lineTo':
      if (count >= 2) target.lineTo(n[0], n[1]);
      break;
    case 'rect':
      if (count >= 4) target.rect(n[0], n[1], n[2], n[3]);
      break;
    case 'bezierCurveTo':
      if (count >= 6) target.bezierCurveTo(n[0], n[1], n[2], n[3], n[4], n[5]);
      break;
    case 'quadraticCurveTo':
      if (count >= 4) target.quadraticCurveTo(n[0], n[1], n[2], n[3]);
      break;
    case 'arcTo':
      if (count >= 5) target.arcTo(n[0], n[1], n[2], n[3], n[4]);
      break;
    case 'arc':
      if (count >= 5) target.arc(n[0], n[1], n[2], n[3], n[4], Boolean(args[5]));
      break;
    case 'ellipse':
      if (count >= 7) target.ellipse(n[0], n[1], n[2], n[3], n[4], n[5], n[6], Boolean(args[7]));
      break;
    case 'roundRect': {
      if (count < 4) return;
      // a radius is a number or an { x, y }, their parts read as numbers
      const corner = (radius: unknown): number | DOMPointInit => {
        if ((typeof radius !== 'object' || radius === null) && typeof radius !== 'function') return num(radius);
        const point = radius as { x?: unknown; y?: unknown };
        return { x: num(point.x), y: num(point.y) };
      };
      const radii = args[4];
      target.roundRect(n[0], n[1], n[2], n[3], Array.isArray(radii) ? radii.map(corner) : corner(radii));
      break;
    }
    case 'closePath':
      target.closePath();
      break;
  }
}

/** What setTransform and addPath read of a matrix (DOMMatrix2DInit) */
const MATRIX_2D = ['a', 'b', 'c', 'd', 'e', 'f', 'm11', 'm12', 'm21', 'm22', 'm41', 'm42'] as const;

/** A matrix argument, its values read as numbers; undefined for none (the identity) */
export function matrixArgument(value: unknown, method: string): DOMMatrix2DInit | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' && typeof value !== 'function') throw new TypeError(`${method} takes a matrix { a, b, c, d, e, f }`);
  const matrix: Record<string, number> = {};
  for (const key of MATRIX_2D) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) matrix[key] = num(item);
  }
  return matrix;
}

/** The browser's Path2D of the engine's ones given to content */
const natives = new WeakMap<object, Path2D>();

/** The browser's Path2D of one of content's, undefined for another value */
export const nativePath = (value: unknown): Path2D | undefined =>
  (typeof value === 'object' && value !== null ? natives.get(value) : undefined);

/** The global Path2D for content, around the browser's */
export function createPath2D(BrowserPath2D: typeof Path2D): new (path?: unknown) => object {
  const prototype = Object.create(Object.prototype, { [Symbol.toStringTag]: { value: 'Path2D' } }) as Record<string, unknown>;
  for (const method of PATH_METHODS) {
    Object.defineProperty(prototype, method, {
      writable: true,
      value: function (this: object, ...args: unknown[]): void {
        const native = natives.get(this);
        if (native) callPath(native, method, args);
      },
    });
  }
  Object.defineProperty(prototype, 'addPath', {
    writable: true,
    value: function addPath(this: object, path: unknown, transform?: unknown): void {
      const native = natives.get(this);
      const other = nativePath(path);
      if (!other) throw new TypeError('addPath needs a Path2D');
      native?.addPath(other, matrixArgument(transform, 'addPath'));
    },
  });
  // a function, as the engine's: `new Path2D()`, `new Path2D(path)` (a copy) or `new Path2D(svgPathData)`
  const Path2DClass = function Path2D(this: unknown, path?: unknown): object {
    if (!new.target) throw new TypeError("Constructor Path2D requires 'new'");
    const other = nativePath(path);
    const native = other ? new BrowserPath2D(other) : typeof path === 'string' ? new BrowserPath2D(path) : new BrowserPath2D();
    const value = Object.create(prototype) as object;
    natives.set(value, native);
    return value;
  } as unknown as new (path?: unknown) => object;
  Object.defineProperty(Path2DClass, Symbol.hasInstance, { value: (value: unknown) => nativePath(value) !== undefined });
  // named as the engine's, whatever the bundler calls it ("The function Path2D can't be cloned")
  Object.defineProperty(Path2DClass, 'name', { value: 'Path2D', configurable: true });
  return Path2DClass;
}
