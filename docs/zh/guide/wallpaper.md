# 壁纸

`wallpaper` 类型是壁纸的一种（类型「动态」），和图片、视频壁纸在同一个网格里：可以放进分类、加入播放列表，由播放列表定时切换，用详情栏的「设为壁纸」设到某块显示器上。一块显示器同一时间只显示一张壁纸，设了动态壁纸就不再显示图片或视频，反之亦然。选项（parameters）显示在壁纸详情栏里。

```bash
desktopengine create wallpaper ~/Projects/waves
```

`launchOptions.display` 就是要画的显示器，用 `type: 'desktop'` 的窗口铺满它的 `frame`（壁纸也可以[跨显示器](#跨显示器)）；铺满屏幕的画布用 `getContext('2d', { alpha: false })`，不透明的图层合成更省电。

壁纸一直在按帧绘制，在全屏应用、使用电池等情况下会被应用暂停，见[暂停规则](./performance#暂停规则)。缓慢变化的画面不需要满帧，设 `DesktopEngine.preferredFramesPerSecond = 30`，线程的唤醒次数减半。

## 用 WebGL 或渲染引擎绘制

2D 还是 3D、用什么绘制，都由壁纸自己决定。`wallpaper` 的默认模板用 Canvas 2D 绘制，`--renderer` 选择其他绘制方式的模板：

```bash
desktopengine create wallpaper ~/Projects/cube --renderer webgl    # WebGL 2：带光照、缓慢转动的立方体，不依赖 npm 包
desktopengine create wallpaper ~/Projects/knot --renderer three    # three.js：带光照、缓慢转动的 3D 绳结
desktopengine create wallpaper ~/Projects/lights --renderer pixi   # PixiJS：分层漂浮的 2D 柔光
cd ~/Projects/lights && npm install && desktopengine dev .
```

three.js 和 PixiJS 模板用 `package.json` 声明引擎依赖，创建后先 `npm install`，构建时 esbuild 把引擎一起打进 `index.js`（未压缩时 three.js 约 1.2 MB、PixiJS 约 1.7 MB，`--minify` 可以再减小）。它们和 WebGL 模板一样有颜色、鼠标视差和外观选项。

### three.js

three.js（r163 起只支持 WebGL 2）要通过项目里的 `src/three/` 使用：`import * as THREE from './three'`。它先补上 three.js 读取的浏览器全局对象 `window`（只是指向全局对象的替身，`THREE.AudioListener` 用 `new window.AudioContext()` 创建音频上下文），用到 `THREE.Audio`、`PositionalAudio` 时要声明 `audio` 权限（见[音频](./audio)）。

绘制不需要别的适配：把 `DesktopEngine.Canvas` 作为 `canvas` 传给 `WebGLRenderer`，`setSize(width, height, false)` 只设置绘图缓冲区的大小。

### PixiJS

PixiJS 8 要通过项目里的 `src/pixi/` 使用：`import * as PIXI from './pixi'`，不要直接 `import 'pixi.js'`。它先补上 PixiJS 加载时就会读取的几个浏览器全局对象（`navigator`、`document` 等，只是替身，不是 DOM 实现），再把画布、图片、文件读取接到 DesktopEngine（`DOMAdapter`），并且不加载依赖 DOM 的扩展（无障碍、DOM 容器）。

- `HTMLText` 这类依赖 DOM 的功能不能用，文字用 `Text` 或 `BitmapText`。
- `Assets.load('assets/a.png')` 这类路径以包的根目录为起点；加载 `https://` 地址的资源要声明 `network` 权限（见[网络](./network)）。
- 需要 `eventMode` / `on('pointerdown')` 这类交互时调用 `PIXI.bindPointerEvents(app)`，把画布的鼠标事件交给 PixiJS；桌面窗口收不到的事件见[窗口](./windows)。

## 跨显示器

有多块显示器时，用户可以让一张壁纸跨所有显示器运行：像一整幅画，按「系统设置 › 显示器」里的排列铺在各块显示器上。能这样运行的壁纸要在 `manifest.json` 里声明：

```json
"wallpaper": { "span": true }
```

详情栏里就会出现「所有显示器（跨屏）」。这时所有显示器只运行一个实例：没有 `launchOptions.display`，`launchOptions.displays` 列出全部显示器，主显示器在前。给每块显示器建一个铺满它 `frame` 的 `desktop` 窗口，用它们共同的坐标布局画面，画面就能从一块显示器接到下一块：

```ts
const options = DesktopEngine.launchOptions;
// 一块显示器，或者全部显示器
const displays = options.displays ?? (options.display ? [options.display] : []);
// 整幅画：包住所有显示器的矩形
const left = Math.min(...displays.map((display) => display.frame.x));
const top = Math.min(...displays.map((display) => display.frame.y));

for (const display of displays) {
  const { x, y, width, height } = display.frame;
  const win = new DesktopEngine.Window({ type: 'desktop', style: { left: x, top: y, width, height } });
  // 这块显示器显示的是整幅画里从 (x - left, y - top) 开始的部分
}
```

- 显示器按排列、以点为单位摆放。高度不同或上下错开时，矩形里有些地方不在任何显示器上；像素密度不同的显示器接缝处不会严丝合缝，应用不知道它们的物理尺寸。
- 怎么布局由壁纸自己决定。立在地面上的景物可以把每一列显示器（上下叠放的算一列）的底边当作地面，内置的「地平线」就是这样：比旁边排列得稍高的显示器也能看到完整的前景，代价是接缝处有高低差；上下叠放的显示器则把画面向上延续。
- 每个窗口有自己的 `devicePixelRatio`，画布大小按各自窗口的算。
- 只有一个实例，时间、随机数和状态在所有显示器之间共享。鼠标事件发给指针下的窗口，坐标是窗口自己的：加上窗口的 `left`、`top` 就是共同坐标。
- 所有窗口在同一个 `requestAnimationFrame` 里绘制，帧率跟随其中一块显示器。被全屏应用挡住的窗口会收到 `hide`，在 `show` 之前可以不画它。
- 只有每块显示器都要暂停壁纸时（例如每块上都有全屏应用），应用才暂停它；任何一块要静音时就静音。
- 接上、拔掉显示器或改变排列时，应用会用新的 `displays` 重启壁纸。
- 开发时用 `desktopengine dev --span` 跨所有显示器运行。作为屏幕保护程序时，它在每块显示器上各自运行，拿到的是 `display`。

## 屏幕保护程序

用户可以在壁纸详情栏选「设为屏幕保护程序」，让壁纸作为 macOS 的屏幕保护程序运行（包括锁定屏幕），选项与壁纸共用；图片、视频壁纸也可以。这时 `launchOptions.screenSaver` 存在，内容可以据此调整：

- 屏幕保护程序由系统的 `legacyScreenSaver` 进程加载，那里 JavaScriptCore **没有 JIT**，纯 JavaScript 运算大约慢十几倍。每帧的工作尽量放在 GPU（着色器）里，内置的「地平线」「星云」每帧 JavaScript 只要 1～3 毫秒。
- 窗口和平时一样用 `type: 'desktop'` 铺满 `launchOptions.display.frame`，应用把它嵌进屏幕保护程序，按比例缩放铺满。
- 收不到鼠标和键盘事件：任何输入都会结束屏幕保护程序。
- `launchOptions.screenSaver.preview` 为 `true` 时是「系统设置 › 屏幕保护程序」里的小预览：`win.devicePixelRatio` 被降到 0.25、帧率限制为 30，按 `devicePixelRatio` 决定画布大小的内容自动变便宜，开销大的效果可以关掉。
- 联网同样需要声明 `network` 权限。

Mac App Store 版的 DesktopEngine 不提供屏幕保护程序。
