# 运行时说明

内容运行在 JavaScriptCore 里，不是浏览器。类型声明（[API 参考](/zh/reference/api)）依据引擎源代码整理，只包含真实可用的 API。要点：

- 没有 DOM 和 Node.js：没有 `document`、`localStorage`，网络见[网络](./network)，声音见[音频](./audio)。运行时的模块是 CommonJS 的 `require()`；要用 `import` 请放进 `src/` 由 SDK 打包（见[项目和构建](./project)）。
- 文件系统只支持读取包内文件。
- `DesktopEngine.system.cpuUsage()` / `memoryUsage()` 提供 CPU 和内存用量，需要 `system-info` 权限，没有时抛出错误。

## 画布

- Canvas 支持 2D、WebGL 1 和 WebGL 2（`getContext('webgl2')`，基于 ANGLE 的 OpenGL ES 3.0）。`texImage3D` / `texSubImage3D` 也接受图片、`ImageData` 和画布，各层在源图中自上而下排列（层间距由 `UNPACK_IMAGE_HEIGHT` 决定，默认等于 height）。Apple 芯片的 Mac 提供 `WEBGL_compressed_texture_astc`。
- 和浏览器不同，WebGL 2 上下文不是 `instanceof WebGLRenderingContext`，要判断版本请用 `instanceof WebGL2RenderingContext`。
- Canvas 用 Metal 渲染，显卡不支持 Metal 的老 Mac 上所有 `getContext` 都返回 null、`CanvasImage` 加载失败，要检查返回值。
- 画布默认带透明通道（与 Web 一致），小组件和桌面伙伴的窗口是透明的，没画到的地方能看到桌面。
- 画布的绘图缓冲区（`width` × `height`）会拉伸到样式的大小，默认平滑缩放。像素画可以用小的缓冲区、按 1:1 绘制，再设样式 `imageRendering: 'pixelated'`（API 7）放大成清晰的方块（内置的像素猫就是这样画的）；`'crisp-edges'` 缩小时也不做平滑。
- 画布跟随显示器的缩放比例，见[显示器和缩放](./windows#显示器和缩放)。
- WebGL 的缓冲、纹理、着色器程序在调用 `gl.deleteXxx()` 或画布销毁时释放；JS 里不再引用它们不会删除它们（它们可能还绑定着）。不停创建资源的程序要自己 `delete`。

## 还没有的

- 签名、上传审核和在线内容库：目前通过导入 .zip 或文件夹分发。
- `files`、`now-playing`、`window-positions` 权限对应的 API。
- 读取系统的音频输出（音乐可视化）、本地存储。
- 运行时原生支持 ES 模块（目前通过 `src/` 打包解决）。

需要的功能可以在 [GitHub](https://github.com/desktopengine/desktopengine-sdk/issues) 上提出。
