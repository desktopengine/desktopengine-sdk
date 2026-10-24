# API Reference

This reference is generated from the SDK's type declarations, `types/desktop-engine.d.ts`, which describe only the APIs the runtime really provides. `desktopengine create` copies the same declarations into a project's `types/`, for completion and type checking in editors. For how to use these APIs, see the [guide](/guide/getting-started).

## The global `DesktopEngine`

[`DesktopEngine`](/api/interfaces/DesktopEngine.DesktopEngineStatic) is where the runtime starts:

| Member | Description |
| --- | --- |
| [`launchOptions`](/api/interfaces/DesktopEngine.LaunchOptions) | Launch options: the display, position, option values, language and permissions, see [Launch Options](/guide/launch-options) |
| `apiVersion` | The runtime's API version, see [API versions](/reference/manifest#api-versions) |
| `preferredFramesPerSecond` | The frame rate the content wants, see [Frame rate](/guide/performance#frame-rate) |
| [`Window`](/api/interfaces/DesktopEngine.Window) | A native window, the root of the content, see [Windows](/guide/windows) |
| [`Canvas`](/api/interfaces/DesktopEngine.Canvas) | A canvas component: [2D](/api/interfaces/DesktopEngine.CanvasRenderingContext2D), [WebGL](/api/interfaces/DesktopEngine.WebGLRenderingContext) and [WebGL 2](/api/interfaces/DesktopEngine.WebGL2RenderingContext) |
| [`CanvasImage`](/api/interfaces/DesktopEngine.CanvasImage) | An image to draw on canvases |
| [`Component`](/api/interfaces/DesktopEngine.Component), [`Image`](/api/interfaces/DesktopEngine.Image), [`Video`](/api/interfaces/DesktopEngine.Video) | The other components of a window, styled with [`ComponentStyle`](/api/interfaces/DesktopEngine.ComponentStyle) |
| [`system`](/api/interfaces/DesktopEngine.System) | The system's appearance, CPU and memory usage |
| [`ScreenManager`](/api/interfaces/DesktopEngine.ScreenManager) | The displays |
| [`fs`](/api/interfaces/DesktopEngine.FileSystem) | Package files and the content's own files, see [Storage and Files](/guide/storage) |
| [`fonts`](/api/interfaces/FontFaceSet) | The content's own fonts for its canvases, see [Fonts](/guide/fonts) |
| [`input`](/api/interfaces/DesktopEngine.Input) | The mouse anywhere on screen, see [Following the Mouse](/guide/input) |
| [`systemAudio`](/api/interfaces/DesktopEngine.SystemAudio) | What other apps play on the Mac, analysed for music visualizers, see [What the Mac plays](/guide/audio#what-the-mac-plays) |
| [`windows`](/api/interfaces/DesktopEngine.Windows) | Where other apps' windows are, see [Other Apps' Windows](/guide/app-windows) |

All the types are in the [`DesktopEngine` namespace](/api/modules/DesktopEngine).

## Web standard APIs

The runtime also has these globals, which behave as in browsers; the differences are in their descriptions:

- Timers and frames: `setTimeout`, `setInterval`, `requestAnimationFrame`, [`performance`](/api/interfaces/DesktopEngine.Performance), [`console`](/api/interfaces/DesktopEngine.Console)
- Events: [`Event`](/api/interfaces/Event), [`EventTarget`](/api/interfaces/EventTarget), [`DOMException`](/api/interfaces/DOMException)
- Network: [`fetch`](/api/functions/fetch), [`Request`](/api/interfaces/Request), [`Response`](/api/interfaces/Response), [`Headers`](/api/interfaces/Headers), [`AbortController`](/api/interfaces/AbortController), [`WebSocket`](/api/interfaces/WebSocket), [`XMLHttpRequest`](/api/interfaces/XMLHttpRequest), see [Network](/guide/network)
- Data: [`Blob`](/api/interfaces/Blob), [`File`](/api/interfaces/File), [`FormData`](/api/interfaces/FormData), [`URL`](/api/interfaces/URL), [`URLSearchParams`](/api/interfaces/URLSearchParams), [`TextEncoder`](/api/interfaces/TextEncoder), [`TextDecoder`](/api/interfaces/TextDecoder), [`ReadableStream`](/api/interfaces/ReadableStream), see [Data](/guide/data)
- Messages: [`structuredClone`](/api/functions/structuredClone), [`MessageChannel`](/api/interfaces/MessageChannel), [`BroadcastChannel`](/api/interfaces/BroadcastChannel), see [Data](/guide/data) and [Messages Between Content](/guide/messaging)
- Storage: [`localStorage`, `sessionStorage`](/api/interfaces/Storage), see [Storage and Files](/guide/storage)
- Fonts: [`FontFace`](/api/interfaces/FontFace), [`FontFaceSet`](/api/interfaces/FontFaceSet), see [Fonts](/guide/fonts)
- Audio: [`Audio`](/api/interfaces/HTMLAudioElement), [`AudioContext`](/api/interfaces/AudioContext) and the audio nodes, see [Audio](/guide/audio)

See [all declarations](/api/globals) for the full list.
