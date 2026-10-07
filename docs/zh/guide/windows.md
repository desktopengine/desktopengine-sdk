# 窗口

内容的画面画在 `new DesktopEngine.Window({ type })` 创建的原生窗口里。

| type | 用途 |
| --- | --- |
| `desktop` | 壁纸：桌面层，在桌面图标之下，所有空间可见，也能收到鼠标移动 |
| `widget` | 贴在桌面上的小组件：桌面图标之上，无边框、背景透明，可拖动 |
| `overlay` | 浮于所有窗口之上：无边框、背景透明，所有空间和全屏应用上都可见，用于浮动小组件和桌面伙伴 |
| `panel` | 带标题栏的浮动面板 |
| `normal` | 普通窗口 |

`desktop`、`widget`、`overlay` 显示时不会激活 DesktopEngine，不会抢走用户当前应用的焦点。

内容能创建哪些窗口由它的类型决定，运行时强制执行：壁纸只能用 `desktop`；小组件和桌面伙伴只能用 `widget` 和 `overlay`（按用户选的位置，传入 `launchOptions.windowType` 即可）。其他类型，包括不写 `type` 的普通窗口，`new DesktopEngine.Window()` 会抛出错误。`desktopengine dev` 和「开发」菜单载入的内容也一样，发布前就能发现；没有清单的小程序不受限制。

窗口本身是透明的，样式不支持圆角：需要圆角时，在 Canvas 上画圆角矩形（见小组件模板）。窗口创建后会一直存在，直到调用 `destroy()`。

内容同时最多有 16 个窗口，再创建时 `new DesktopEngine.Window()` 会抛出错误，所以不用的窗口要 `destroy()`。`widget` 和 `overlay` 窗口不会盖住菜单栏，最多占一块显示器的一半：放得更高的会被移下来，更大的会被缩小（内容被裁掉）。要在整个屏幕上活动的桌面伙伴，用一个跟着它移动的小窗口。

## 鼠标

- `widget` 和 `overlay` 窗口按住任意位置就能拖动（系统原生拖动）：拖动时依次收到 `mousedown`、窗口的 `move` 和松手时的 `mouseup`，拖动过程中没有 `mousemove`；单击只收到 `click`，没有 `mousedown` / `mouseup`。
- 窗口的 `dragRegion` 限定按住哪些地方会拖动窗口，其余地方的按下和拖动交给组件（`mousedown`、按住时的 `mousemove`、`mouseup`），适合表盘、滑块这类控件；`null`（默认）是整个窗口，`[]` 是哪里都不拖动。
- 窗口拖到屏幕边缘松手后，大小不变，停在松手的位置，不过 macOS 仍会显示平铺的预览。把窗口的 `allowsTiling` 设为 `true`，macOS 就会把它平铺（例如占半屏），这时需要处理 `resize`。
- 窗口的 `hitRegion`（以窗口左上角为原点的矩形数组，单位点）限定只有这些地方响应鼠标，其余地方的点击、拖动和悬停都会穿透到下面的窗口；`null`（默认）是整个窗口。窗口透明的地方默认仍然会接住鼠标，不规则形状的桌面伙伴应随画面更新它（见 companion 模板）。
- `mouseenter`、`mousemove`、`mouseleave` 在窗口不是当前窗口时也会触发。
- 事件回调的参数是普通对象，`this` 是触发事件的对象；双击事件名是 `dbclick`。

## 键盘

内容拿不到键盘：打字总是交给用户正在用的应用，`keydown` / `keyup` 不会触发，只有 DesktopEngine 自带的内容能收到。请按鼠标操作来设计，需要用户输入文字的，用[选项](/zh/reference/manifest#选项-parameters)。

## 显示器和缩放

- `launchOptions.display` 是内容所在的显示器，`frame` 是整块屏幕，`visibleFrame` 去掉了菜单栏和程序坞。它在启动后不会变：`DesktopEngine.ScreenManager.screens` 里是每块显示器当前的 `bounds` 和 `visibleFrame`，它们变了（比如用户调整程序坞的大小、位置或把它隐藏）`ScreenManager` 会触发 `change`。沿着底边走的桌面伙伴这时重新读一次所在显示器的 `visibleFrame`。
- 窗口的 `devicePixelRatio` 是所在显示器的缩放比例。小组件、桌面伙伴被拖到缩放比例不同的显示器上（例如从 Retina 屏拖到 1x 的外接显示器），或者用户改了显示器的分辨率，它会改变并触发窗口的 `devicepixelratiochange` 事件，这时按新的值重设画布的 `width` / `height`、重画。
- 注意这里改 `width` / `height` 不会重置 2D 上下文的状态（浏览器会），缩放用 `setTransform(ratio, 0, 0, ratio, 0, 0)` 重设，不要再叠加一次 `scale()`（见 widget、companion 模板）。

完整的属性和事件见 [`Window`](/api/interfaces/DesktopEngine.Window)。
