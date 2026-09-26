# Runtime Notes

Content runs in JavaScriptCore, not in a browser. The type declarations (the [API reference](/api/)) are compiled from the engine's source, with only the APIs that really exist. The main points:

- There is no DOM and no Node.js: no `document` and no `localStorage`; see [Network](./network) for the network and [Audio](./audio) for sound. Modules in the runtime are CommonJS `require()`; to use `import`, put your code in `src/` and let the SDK bundle it (see [Projects and Builds](./project)).
- The file system can only read files in the package.
- `DesktopEngine.system.cpuUsage()` / `memoryUsage()` give CPU and memory usage; they need the `system-info` permission and throw without it.

## Canvas

- Canvases have 2D, WebGL 1 and WebGL 2 (`getContext('webgl2')`, OpenGL ES 3.0 on ANGLE). `texImage3D` / `texSubImage3D` also take images, `ImageData` and canvases, with the layers top to bottom in the source image (spaced by `UNPACK_IMAGE_HEIGHT`, the height by default). Macs with Apple silicon have `WEBGL_compressed_texture_astc`.
- Unlike in browsers, a WebGL 2 context isn't `instanceof WebGLRenderingContext`: check the version with `instanceof WebGL2RenderingContext`.
- Canvases render with Metal. On old Macs whose graphics don't support Metal, every `getContext` returns null and `CanvasImage` fails to load, so check what they return.
- Canvases have an alpha channel by default (as on the web). Widget and pet windows are transparent, so the desktop shows where nothing is drawn.
- A canvas's drawing buffer (`width` × `height`) is stretched to the size of its style, smoothly by default. For pixel art, draw 1:1 in a small buffer and set the style `imageRendering: 'pixelated'` (API 7) to scale it up into sharp squares (the built-in pixel cat is drawn this way); `'crisp-edges'` doesn't smooth when scaling down either.
- Canvases follow the scale of their display, see [Displays and scale](./windows#displays-and-scale).
- WebGL buffers, textures and shader programs are freed by `gl.deleteXxx()` or when the canvas is destroyed; dropping them in JavaScript doesn't delete them (they may still be bound). Programs that keep creating resources must `delete` them.

## Not there yet

- Signing, review and an online library: content is shared by importing a .zip or a folder for now.
- APIs for the `files`, `now-playing` and `window-positions` permissions.
- Reading the system's audio output (music visualizers), local storage.
- Native ES modules in the runtime (bundling `src/` covers them for now).

Ask for what you need on [GitHub](https://github.com/desktopengine/desktopengine-sdk/issues).
