// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The engine's WebGL contexts on the web: the browser's, offering only the extensions the engine has
// (canvas-api.ts), so content doesn't come to need one the app doesn't give it, and with texImage2D and its kin
// taking the engine's Canvas and CanvasImage.

import { WEBGL_EXTENSIONS, WEBGL_EXTENSION_ALIASES } from './canvas-api.ts';
import { isStandIn, standIn } from './stand-ins.ts';

const { apply } = Reflect;

/**
 * The contexts' methods that make objects: what they make (a texture, a buffer, a uniform's location, a WebGL 2 query)
 * is a native object in the engine, which structuredClone and BroadcastChannel refuse
 */
const MAKERS = [
  'createBuffer', 'createFramebuffer', 'createProgram', 'createRenderbuffer', 'createShader', 'createTexture', 'getUniformLocation',
  'getActiveAttrib', 'getActiveUniform', 'getShaderPrecisionFormat', 'createQuery', 'createSampler', 'createTransformFeedback',
  'createVertexArray', 'fenceSync', 'getTransformFeedbackVarying',
];

/** The object's method `name`, made to note what it makes as a stand-in for a native object (see stand-ins.ts) */
function noteMade(object: object, name: string, original: (...args: unknown[]) => unknown): void {
  const method = {
    [name](...args: unknown[]): unknown {
      const made = original.apply(object, args);
      if (typeof made === 'object' && made !== null) standIn(made);
      return made;
    },
  }[name];
  Object.defineProperty(method, 'length', { value: original.length, configurable: true });
  Object.defineProperty(object, name, { value: method, writable: true, configurable: true });
}

/** The engine's extension objects are native ones, and what they make (OES_vertex_array_object's vertex arrays) too */
function noteExtension(extension: unknown): void {
  if (typeof extension !== 'object' || extension === null || isStandIn(extension)) return;
  standIn(extension);
  const prototype = Object.getPrototypeOf(extension) as object | null;
  for (const name of prototype ? Object.getOwnPropertyNames(prototype) : []) {
    const original = (extension as Record<string, unknown>)[name];
    if (name.startsWith('create') && typeof original === 'function') noteMade(extension, name, original as (...args: unknown[]) => unknown);
  }
}

/** What `unwrap` gives for a video whose size isn't known yet: an upload of it is INVALID_VALUE, as in WebKit */
export const NO_VIDEO = Object.freeze({ video: 'none' });
/** What `unwrap` gives for a video with no frame right now (its first, or it's reloading): an upload does nothing */
export const NO_FRAME = Object.freeze({ video: 'no frame' });

export function adaptWebGL(context: WebGLRenderingContext | WebGL2RenderingContext, version: 1 | 2, canvas: object, unwrap: (value: unknown) => unknown): void {
  Object.defineProperty(context, 'canvas', { get: () => canvas });
  const texImage2D = context.texImage2D;
  for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D']) {
    const original = (context as unknown as Record<string, ((...args: unknown[]) => void) | undefined>)[name];
    if (!original) continue;
    (context as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      const unwrapped = args.map(unwrap);
      const source = unwrapped[unwrapped.length - 1];
      if (source === NO_FRAME) return;
      if (source === NO_VIDEO) {
        // a negative level is INVALID_VALUE whatever is bound
        apply(texImage2D, context, [context.TEXTURE_2D, -1, context.RGBA, 1, 1, 0, context.RGBA, context.UNSIGNED_BYTE, null]);
        return;
      }
      original.apply(context, unwrapped);
    };
  }
  for (const name of MAKERS) {
    const original = (context as unknown as Record<string, unknown>)[name];
    if (typeof original === 'function') noteMade(context, name, original as (...args: unknown[]) => unknown);
  }

  const names = WEBGL_EXTENSIONS[version];
  const aliases = WEBGL_EXTENSION_ALIASES[version];
  const supported = context.getSupportedExtensions.bind(context);
  const getExtension = context.getExtension.bind(context);
  Object.assign(context, {
    getSupportedExtensions: () => {
      const available = supported() ?? [];
      return names.filter((name) => available.includes(name));
    },
    getExtension: function (name: unknown) {
      if (arguments.length < 1) return undefined;
      const text = String(name);
      const target = aliases[text];
      if (target) {
        const extension = getExtension(target);
        // a browser has the alias as an extension of its own: what it allows comes with it
        if (extension) getExtension(text);
        noteExtension(extension);
        return extension;
      }
      const extension = names.includes(text) ? getExtension(text) : null;
      noteExtension(extension);
      return extension;
    },
  });
}
