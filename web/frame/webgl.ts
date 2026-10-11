// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The engine's WebGL contexts on the web: the browser's, offering only the extensions the engine has
// (canvas-api.ts), so content doesn't come to need one the app doesn't give it, and with texImage2D and its kin
// taking the engine's Canvas and CanvasImage.

import { WEBGL_EXTENSIONS, WEBGL_EXTENSION_ALIASES } from './canvas-api.ts';

export function adaptWebGL(context: WebGLRenderingContext | WebGL2RenderingContext, version: 1 | 2, canvas: object, unwrap: (value: unknown) => unknown): void {
  Object.defineProperty(context, 'canvas', { get: () => canvas });
  for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D']) {
    const original = (context as unknown as Record<string, ((...args: unknown[]) => void) | undefined>)[name];
    if (!original) continue;
    (context as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => original.apply(context, args.map(unwrap));
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
        return extension;
      }
      return names.includes(text) ? getExtension(text) : null;
    },
  });
}
