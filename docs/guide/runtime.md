# Runtime Notes

Content runs in JavaScriptCore, not in a browser. The type declarations (the [API reference](/api/)) are compiled from the engine's source, with only the APIs that really exist. The main points:

- There is no DOM and no Node.js: no `document`, no `window`; see [Network](./network) for the network, [Storage and Files](./storage) for `localStorage` and files, and [Audio](./audio) for sound. Modules in the runtime are CommonJS `require()`; to use `import`, put your code in `src/` and let the SDK bundle it (see [Projects and Builds](./project)).
- `DesktopEngine.system.cpuUsage()` / `memoryUsage()` give CPU and memory usage; they need the `system-info` permission and throw without it.
- `DesktopEngine.input` follows the mouse anywhere on screen with the `mouse` permission, see [Mouse and Typing](./input).

## Globals

Besides the language's own (`Promise`, `Intl`, `WebAssembly`…), content has these globals of browsers:

- Timing: `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `requestAnimationFrame`, `cancelAnimationFrame`, `queueMicrotask` and `performance`.
- `console`, `globalThis` and `self`, and `require()` for CommonJS modules.
- `atob` and `btoa`; `crypto.getRandomValues()` and `crypto.randomUUID()`, with the system's cryptographically strong random numbers (API 4).
- `fetch`, `Headers`, `Request`, `Response`, `AbortController`, `WebSocket` and `XMLHttpRequest`, see [Network](./network).
- `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `Blob`, `File`, `FileReader`, `FormData` and streams, `structuredClone`, `MessageChannel`, see [Data](./data).
- `DOMException`, `Event`, `CustomEvent` and `EventTarget`.
- `navigator`: `userAgent` (a Mac, without Safari or WebKit), `platform`, `language` and `languages` (the user's preferred languages), `hardwareConcurrency` and `maxTouchPoints` (0). Nothing else of a browser's navigator.
- `localStorage` and `sessionStorage`, see [Storage and Files](./storage).
- `Audio`, `AudioContext` and the other Web Audio classes, see [Audio](./audio).

## Canvas

- Canvases have 2D, WebGL 1 and WebGL 2 (`getContext('webgl2')`, OpenGL ES 3.0 on ANGLE). `texImage3D` / `texSubImage3D` also take images, `ImageData` and canvases, with the layers top to bottom in the source image (spaced by `UNPACK_IMAGE_HEIGHT`, the height by default). Macs with Apple silicon have `WEBGL_compressed_texture_astc`.
- The 2D context has the web's compositing and blend modes (`multiply`, `screen`, `overlay`… since API 5), linear, radial and conic gradients, and `letterSpacing` / `wordSpacing`; not `filter`, `fontKerning` or the other text settings. Drawing in `lighten`, `darken`, a blend mode, or a mode that clears the canvas outside what's drawn (`copy`, `source-in`…) goes through a layer the size of the canvas: about 0.25 ms of CPU a draw, so draw in them with few calls.
- As in browsers, a WebGL 2 context isn't `instanceof WebGLRenderingContext`: check the version with `instanceof WebGL2RenderingContext`.
- Canvases render with Metal. On old Macs whose graphics don't support Metal, every `getContext` returns null and `CanvasImage` fails to load, so check what they return.
- Canvases have an alpha channel by default (as on the web). Widget and companion windows are transparent, so the desktop shows where nothing is drawn.
- A canvas's drawing buffer (`width` × `height`) is stretched to the size of its style, smoothly by default. For pixel art, draw 1:1 in a small buffer and set the style `imageRendering: 'pixelated'` to scale it up into sharp squares (the built-in pixel cat is drawn this way); `'crisp-edges'` doesn't smooth when scaling down either.
- Canvases follow the scale of their display, see [Displays and scale](./windows#displays-and-scale).
- The GPU gives a frame's work a few seconds at most. When a canvas takes longer (a huge draw, a shader that loops for long), macOS resets the GPU, which freezes the whole screen for a moment. The canvas' context is lost then, for good, so that it can't happen again: the canvas fires `webglcontextlost` (`contextlost` for 2D), keeps what it last showed, and draws nothing more; the context's `isContextLost()` returns true. Keep each frame's GPU work small, especially on large canvases. Wide `shadowBlur` shadows are blurred at a lower resolution, which looks the same.
- WebGL buffers, textures and shader programs are freed by `gl.deleteXxx()` or when the canvas is destroyed; dropping them in JavaScript doesn't delete them (they may still be bound). Programs that keep creating resources must `delete` them.

## Not there yet

- `crypto.subtle`, `BroadcastChannel`, Workers, `OffscreenCanvas` (a `DesktopEngine.Canvas` that isn't in a window works off screen), `createImageBitmap` and `Path2D`; `location`.
- Reading the system's audio output (music visualizers), IndexedDB.
- Native ES modules in the runtime (bundling `src/` covers them for now).

Ask for what you need on [GitHub](https://github.com/desktopengine/desktopengine-sdk/issues).
