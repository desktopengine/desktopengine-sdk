# API 概览

运行时的 API 写在 SDK 的类型声明 `types/desktop-engine.d.ts` 里，只包含运行时真正注入的 API。完整的 [API 参考](/api/)由它生成，是英文的。`desktopengine create` 会把同一份声明复制到项目的 `types/` 下，编辑器据此补全和检查类型。怎样使用这些 API，见[指南](/zh/guide/getting-started)。

## 全局的 `DesktopEngine`

[`DesktopEngine`](/api/interfaces/DesktopEngine.DesktopEngineStatic) 是运行时的入口：

| 成员 | 说明 |
| --- | --- |
| [`launchOptions`](/api/interfaces/DesktopEngine.LaunchOptions) | 启动参数：显示器、位置、选项取值、语言、权限，见[启动参数](/zh/guide/launch-options) |
| `apiVersion` | 运行时的 API 版本，见 [API 版本](/zh/reference/manifest#api-版本) |
| `preferredFramesPerSecond` | 内容想要的帧率，见[帧率](/zh/guide/performance#帧率) |
| [`Window`](/api/interfaces/DesktopEngine.Window) | 原生窗口，内容的根，见[窗口](/zh/guide/windows) |
| [`Canvas`](/api/interfaces/DesktopEngine.Canvas) | 画布组件：[2D](/api/interfaces/DesktopEngine.CanvasRenderingContext2D)、[WebGL](/api/interfaces/DesktopEngine.WebGLRenderingContext) 和 [WebGL 2](/api/interfaces/DesktopEngine.WebGL2RenderingContext) |
| [`CanvasImage`](/api/interfaces/DesktopEngine.CanvasImage) | 画到画布上的图片 |
| [`Component`](/api/interfaces/DesktopEngine.Component)、[`Image`](/api/interfaces/DesktopEngine.Image)、[`Video`](/api/interfaces/DesktopEngine.Video) | 窗口里的其他组件，样式见 [`ComponentStyle`](/api/interfaces/DesktopEngine.ComponentStyle) |
| [`system`](/api/interfaces/DesktopEngine.System) | 系统外观、CPU 和内存用量 |
| [`ScreenManager`](/api/interfaces/DesktopEngine.ScreenManager) | 显示器 |
| [`fs`](/api/interfaces/DesktopEngine.FileSystem) | 包内文件和内容自己的文件，见[存储和文件](/zh/guide/storage) |

所有类型都在 [`DesktopEngine` 命名空间](/api/modules/DesktopEngine)里。

## Web 标准 API

运行时还提供这些全局对象，行为与浏览器一致，差别写在各自的说明里：

- 计时和帧：`setTimeout`、`setInterval`、`requestAnimationFrame`、[`performance`](/api/interfaces/DesktopEngine.Performance)、[`console`](/api/interfaces/DesktopEngine.Console)
- 事件：[`Event`](/api/interfaces/Event)、[`EventTarget`](/api/interfaces/EventTarget)、[`DOMException`](/api/interfaces/DOMException)
- 网络：[`fetch`](/api/functions/fetch)、[`Request`](/api/interfaces/Request)、[`Response`](/api/interfaces/Response)、[`Headers`](/api/interfaces/Headers)、[`AbortController`](/api/interfaces/AbortController)、[`WebSocket`](/api/interfaces/WebSocket)、[`XMLHttpRequest`](/api/interfaces/XMLHttpRequest)，见[网络](/zh/guide/network)
- 数据：[`Blob`](/api/interfaces/Blob)、[`File`](/api/interfaces/File)、[`FormData`](/api/interfaces/FormData)、[`URL`](/api/interfaces/URL)、[`URLSearchParams`](/api/interfaces/URLSearchParams)、[`TextEncoder`](/api/interfaces/TextEncoder)、[`TextDecoder`](/api/interfaces/TextDecoder)、[`ReadableStream`](/api/interfaces/ReadableStream)，见[数据](/zh/guide/data)
- 存储：[`localStorage`、`sessionStorage`](/api/interfaces/Storage)，见[存储和文件](/zh/guide/storage)
- 音频：[`Audio`](/api/interfaces/HTMLAudioElement)、[`AudioContext`](/api/interfaces/AudioContext) 和各种音频节点，见[音频](/zh/guide/audio)

完整的列表见[全部声明](/api/globals)。
