// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// createImageBitmap as the engine makes bitmaps: the arguments read and checked as the engine reads them, the source
// decoded by the browser (a Blob turned as its orientation says, as the engine does), then cropped, resized and
// flipped here, the crop transparent where it's outside the source. Browsers differ from the engine there: WebKit
// keeps a crop inside the source and takes a large resizeWidth as a small one.

import { IMAGE_BITMAP_MAX_PIXELS, IMAGE_BITMAP_MAX_SIZE } from './canvas-api.ts';

type BrowserCreateImageBitmap = (image: ImageBitmapSource, options?: ImageBitmapOptions) => Promise<ImageBitmap>;

/** One of the values an option takes, the first when it's not given */
function choice<T extends string>(options: Record<string, unknown>, name: string, values: readonly T[]): T {
  const value = options[name];
  if (value === undefined) return values[0];
  const text = String(value);
  if (!(values as readonly string[]).includes(text)) throw new TypeError(`createImageBitmap: '${text}' isn't a valid ${name}`);
  return text as T;
}

/** resizeWidth or resizeHeight: an unsigned long that must be in range and not 0; 0 when it's not given */
function size(options: Record<string, unknown>, name: string): number {
  const value = options[name];
  if (value === undefined) return 0;
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number < 0 || number > 4294967295) throw new TypeError(`createImageBitmap: ${name} is out of range`);
  if (number === 0) throw new DOMException(`createImageBitmap: ${name} must not be 0`, 'InvalidStateError');
  return number;
}

function allowed(width: number, height: number): boolean {
  return width <= IMAGE_BITMAP_MAX_SIZE && height <= IMAGE_BITMAP_MAX_SIZE && width * height <= IMAGE_BITMAP_MAX_PIXELS;
}

const tooLarge = (): DOMException => new DOMException('createImageBitmap: the bitmap is too large', 'InvalidStateError');

/**
 * The engine's createImageBitmap(image, options) or (image, sx, sy, sw, sh, options), made with the browser's: an
 * engine drawable (`unwrap` gives the browser's element), ImageData, an ImageBitmap or a Blob of an image file
 */
export function createImageBitmapFunction(
  browserCreateImageBitmap: BrowserCreateImageBitmap,
  unwrap: (value: unknown) => unknown,
): (...args: unknown[]) => Promise<ImageBitmap> {
  const createImageBitmap = async function createImageBitmap(...args: unknown[]): Promise<ImageBitmap> {
    if (args.length < 1) throw new TypeError('createImageBitmap: 1 argument required, but only 0 present');
    if (args.length === 3 || args.length === 4) {
      throw new TypeError('createImageBitmap takes an image, or an image and a rectangle (sx, sy, sw, sh)');
    }
    const crop = args.length >= 5;
    const rect = crop
      ? args.slice(1, 5).map((value) => {
          const number = Math.trunc(Number(value));
          return Number.isFinite(number) ? number : 0;
        })
      : [0, 0, 0, 0];
    if (crop && (rect[2] === 0 || rect[3] === 0)) {
      throw new RangeError('createImageBitmap: the width and height of the rectangle must not be 0');
    }
    let options = crop ? args[5] : args[1];
    if (options === undefined || options === null) {
      options = {};
    } else if (typeof options !== 'object' && typeof options !== 'function') {
      throw new TypeError('createImageBitmap: the options must be an object');
    }
    const settings = options as Record<string, unknown>;
    const orientation = choice(settings, 'imageOrientation', ['from-image', 'flipY', 'none'] as const);
    const premultiply = choice(settings, 'premultiplyAlpha', ['default', 'premultiply', 'none'] as const);
    choice(settings, 'colorSpaceConversion', ['default', 'none'] as const);
    const quality = choice(settings, 'resizeQuality', ['low', 'pixelated', 'medium', 'high'] as const);
    const resizeWidth = size(settings, 'resizeWidth');
    const resizeHeight = size(settings, 'resizeHeight');

    // the whole source: the rest is done here
    const source = await browserCreateImageBitmap(unwrap(args[0]) as ImageBitmapSource);
    let kept = false;
    try {
      let [sx, sy, sw, sh] = crop ? rect : [0, 0, source.width, source.height];
      // a negative size is the rectangle on the other side of the point
      if (sw < 0) [sx, sw] = [sx + sw, -sw];
      if (sh < 0) [sy, sh] = [sy + sh, -sh];
      if (crop && !allowed(sw, sh)) throw tooLarge();
      // the size given, the one not given keeping the proportions
      let width = resizeWidth;
      let height = resizeHeight;
      if (width > 0 && height <= 0) height = Math.ceil((sh * width) / Math.max(sw, 1));
      else if (height > 0 && width <= 0) width = Math.ceil((sw * height) / Math.max(sh, 1));
      if (!(width > 0 && height > 0)) [width, height] = [sw, sh];
      if (!allowed(width, height)) throw tooLarge();

      const flip = orientation === 'flipY';
      if (!crop && width === sw && height === sh && !flip && premultiply !== 'none') {
        kept = true;
        return source;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new DOMException("createImageBitmap: the bitmap couldn't be made", 'InvalidStateError');
      context.imageSmoothingEnabled = quality !== 'pixelated';
      context.imageSmoothingQuality = 'high';
      if (flip) {
        context.translate(0, height);
        context.scale(1, -1);
      }
      // the part of the rectangle outside the source stays transparent: what's inside is drawn where it goes (WebKit
      // draws nothing at all for a rectangle that's partly outside)
      const left = Math.max(sx, 0);
      const top = Math.max(sy, 0);
      const right = Math.min(sx + sw, source.width);
      const bottom = Math.min(sy + sh, source.height);
      if (left < right && top < bottom) {
        const scaleX = width / sw;
        const scaleY = height / sh;
        context.drawImage(source, left, top, right - left, bottom - top,
          (left - sx) * scaleX, (top - sy) * scaleY, (right - left) * scaleX, (bottom - top) * scaleY);
      }
      const bitmap = await browserCreateImageBitmap(canvas, premultiply === 'none' ? { premultiplyAlpha: 'none' } : undefined);
      // the canvas' memory goes now rather than when it's collected
      canvas.width = 0;
      canvas.height = 0;
      return bitmap;
    } finally {
      if (!kept) source.close();
    }
  };
  // named and of the length the engine's is, whatever the bundler calls it ("The function createImageBitmap can't be cloned")
  Object.defineProperty(createImageBitmap, 'name', { value: 'createImageBitmap', configurable: true });
  Object.defineProperty(createImageBitmap, 'length', { value: 1, configurable: true });
  return createImageBitmap;
}
