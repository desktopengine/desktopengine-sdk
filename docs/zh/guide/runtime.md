# 运行时说明

内容运行在 JavaScriptCore 里，不是浏览器。类型声明（[API 参考](/zh/reference/api)）依据引擎源代码整理，只包含真实可用的 API。要点：

- 没有 DOM 和 Node.js：没有 `document`、`window`，网络见[网络](./network)，`localStorage` 和文件见[存储和文件](./storage)，声音见[音频](./audio)。运行时的模块是 CommonJS 的 `require()`；要用 `import` 请放进 `src/` 由 SDK 打包（见[项目和构建](./project)）。
- `DesktopEngine.system.cpuUsage()` / `memoryUsage()` 提供 CPU 和内存用量，需要 `system-info` 权限，没有时抛出错误。
- `DesktopEngine.input` 在整个屏幕上跟随鼠标，需要 `mouse` 权限，见[鼠标和打字](./input)。

## 全局对象

除了语言自带的（`Promise`、`Intl`、`WebAssembly` 等），内容还有这些浏览器里的全局对象：

- 计时：`setTimeout`、`setInterval`、`clearTimeout`、`clearInterval`、`requestAnimationFrame`、`cancelAnimationFrame`、`queueMicrotask` 和 `performance`。
- `console`、`globalThis` 和 `self`，以及加载 CommonJS 模块的 `require()`。
- `atob` 和 `btoa`；`crypto.getRandomValues()` 和 `crypto.randomUUID()`，用系统的密码学安全随机数（API 4）。
- `fetch`、`Headers`、`Request`、`Response`、`AbortController`、`WebSocket` 和 `XMLHttpRequest`，见[网络](./network)。
- `URL`、`URLSearchParams`、`TextEncoder`、`TextDecoder`、`Blob`、`File`、`FileReader`、`FormData` 和流，`structuredClone`、`MessageChannel`，见[数据](./data)。
- `DOMException`、`Event`、`CustomEvent` 和 `EventTarget`。
- `navigator`：`userAgent`（一台 Mac，不带 Safari 和 WebKit）、`platform`、`language` 和 `languages`（用户的首选语言）、`hardwareConcurrency` 和 `maxTouchPoints`（0），没有浏览器 navigator 的其他内容。
- `localStorage` 和 `sessionStorage`，见[存储和文件](./storage)。
- `Audio`、`AudioContext` 和其他 Web Audio 类，见[音频](./audio)。

## 画布

- Canvas 支持 2D、WebGL 1 和 WebGL 2（`getContext('webgl2')`，基于 ANGLE 的 OpenGL ES 3.0）。`texImage3D` / `texSubImage3D` 也接受图片、`ImageData` 和画布，各层在源图中自上而下排列（层间距由 `UNPACK_IMAGE_HEIGHT` 决定，默认等于 height）。Apple 芯片的 Mac 提供 `WEBGL_compressed_texture_astc`。
- 2D 上下文有网页的合成模式和混合模式（`multiply`、`screen`、`overlay` 等，API 5 起）、线性、径向和锥形渐变，`letterSpacing` / `wordSpacing`，`Path2D`（也能用 SVG 路径数据）和用于点击判断的 `isPointInPath` / `isPointInStroke`（API 5 起）；没有 `filter`、`fontKerning` 等其他文字设置。用 `lighten`、`darken`、混合模式，或会清掉画出部分以外画布的模式（`copy`、`source-in` 等）绘制时，要经过一个画布大小的图层：每次绘制约 0.25 ms CPU，用这些模式时尽量少调用几次。
- 和浏览器一样，WebGL 2 上下文不是 `instanceof WebGLRenderingContext`，要判断版本请用 `instanceof WebGL2RenderingContext`。
- Canvas 用 Metal 渲染，显卡不支持 Metal 的老 Mac 上所有 `getContext` 都返回 null、`CanvasImage` 加载失败，要检查返回值。
- 画布默认带透明通道（与 Web 一致），小组件和桌面伙伴的窗口是透明的，没画到的地方能看到桌面。
- 画布的绘图缓冲区（`width` × `height`）会拉伸到样式的大小，默认平滑缩放。像素画可以用小的缓冲区、按 1:1 绘制，再设样式 `imageRendering: 'pixelated'` 放大成清晰的方块（内置的像素猫就是这样画的）；`'crisp-edges'` 缩小时也不做平滑。
- 画布跟随显示器的缩放比例，见[显示器和缩放](./windows#显示器和缩放)。
- GPU 给一帧的工作最多几秒。画布超过这个时间（一次绘制量极大、着色器长时间循环）时，macOS 会重置 GPU，整个屏幕会卡住片刻。为了不让这种情况再次发生，这个画布的上下文会就此丢失：画布触发 `webglcontextlost`（2D 是 `contextlost`），保留最后显示的画面，之后不再绘制；上下文的 `isContextLost()` 返回 true。每帧的 GPU 工作要尽量少，大画布尤其如此。`shadowBlur` 很大的阴影会在较低分辨率下模糊，看起来没有区别。
- WebGL 的缓冲、纹理、着色器程序在调用 `gl.deleteXxx()` 或画布销毁时释放；JS 里不再引用它们不会删除它们（它们可能还绑定着）。不停创建资源的程序要自己 `delete`。

## 还没有的

- `crypto.subtle`、`BroadcastChannel`、Worker、`OffscreenCanvas`（不放进窗口的 `DesktopEngine.Canvas` 就能离屏使用）和 `createImageBitmap`；`location`。
- 读取系统的音频输出（音乐可视化）、IndexedDB。
- 运行时原生支持 ES 模块（目前通过 `src/` 打包解决）。

需要的功能可以在 [GitHub](https://github.com/desktopengine/desktopengine-sdk/issues) 上提出。
