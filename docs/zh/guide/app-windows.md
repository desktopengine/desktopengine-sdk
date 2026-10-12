# 其它应用的窗口

`DesktopEngine.windows` 告诉内容其它应用的窗口在哪里、哪个在前面，例如做一个在窗口标题栏上走的桌面伙伴：窗口最小化时跳下来，窗口被拖走时掉下来。它需要清单里的 [`window-positions` 权限](/zh/reference/manifest#权限-permissions)和 `"apiVersion": 6`：

```json
"apiVersion": 6,
"permissions": ["window-positions"]
```

```js
const windows = DesktopEngine.windows; // 没有权限时为 null

let list = windows ? windows.list() : [];
if (windows) windows.onchange = () => { list = windows.list(); };
```

`list()` 按从前到后的顺序给出窗口，第一个在其它所有窗口前面：

```js
[
  { id: 4182, frame: { x: 120, y: 64, width: 900, height: 640 }, isActiveApp: true, isFullScreen: false, isFloating: false },
  { id: 391, frame: { x: 0, y: 33, width: 1728, height: 1084 }, isActiveApp: false, isFullScreen: false, isFloating: false },
]
```

| 字段 | |
| --- | --- |
| `id` | 窗口存在期间不变，移动、到前面来也不变；每次启动不同 |
| `frame` | 位置，和 `DesktopEngine.Window`、`Screen` 一样是全局坐标（点）：原点在主显示器左上角，y 向下。标题栏在 frame 的顶部 |
| `isActiveApp` | 属于用户正在用的应用（最前面的那个），例如优先站在用户正看着的窗口上 |
| `isFullScreen` | 在全屏桌面空间里占满它的显示器 |
| `isFloating` | 浮在普通窗口上面：面板、画中画、应用保持置顶的窗口。浮动窗口排在列表前面 |

- 只有每个显示器上当前显示的桌面空间里的窗口，宽和高都至少 40 点。不包括你自己的窗口（以及 DesktopEngine 的任何窗口）、菜单栏、程序坞和桌面图标。最小化和隐藏的窗口不列出，正在关闭的窗口淡出到一半就离开列表。
- 不包括窗口里显示的内容、它的标题和它属于哪个应用：用户允许的只是位置。
- 窗口移动、改变大小、打开、关闭、最小化、到前面来，别的应用成为当前应用，或者切换了桌面空间时触发 `change`。它不带数据：调用 `list()` 读取。来得比内容处理得快的变化会合并成一次。
- 打开调度中心时窗口显示为缩小的样子：列表保持原样，直到它关闭。
- 窗口的动画（最小化、进入全屏）期间 frame 跟着动画变化，所以站在上面的伙伴会先被带着走，然后才掉下来。
- 没有权限时（没有声明，或者用户拒绝了）`DesktopEngine.windows` 为 `null`：为这种情况准备好，比如伙伴只在屏幕底部活动。如果包也要在 API 更旧的应用里运行，也要先判断 `DesktopEngine.apiVersion >= 6`。

## 频率和能耗

只有内容监听 `change` 时应用才会查看窗口，大约每秒 10 次；在某个窗口上按着鼠标键时（用户可能在拖动或缩放它），每秒最多 60 次，这时只重新读这个窗口。所有在监听的内容都被暂停时（它的窗口看不见、暂停所有内容、显示器休眠），每秒只查看一次。不需要时移除监听（`windows.onchange = null`、`removeEventListener`、`destroy()`）；没有监听时调用 `list()` 会在调用时读取一次。

只在需要跟上的时候监听。伙伴在地面上时不需要：决定要不要跳上去时、被拖动后松手时调用一次 `visibleTopEdges()` 就够了。站在窗口上或正跳向窗口时才监听，好跟着窗口走、窗口没了就掉下来，回到地面就停止监听。没有内容监听时，用户拖动窗口完全没有开销。没有监听时每次读取都要询问系统，所以在要做决定时读，不要每帧都读。

不要每次 `change` 都单独重绘：保存列表，在自己的动画里使用，这样伙伴站在一个不动的窗口上不动时就没有开销。

## 站在标题栏上

你的窗口在所有窗口之上，所以伙伴站在一个被前面窗口挡住的标题栏上，看起来就像站在前面那个窗口上。`visibleTopEdges()` 只给出顶边没被前面窗口挡住的部分，按从前到后的顺序：

```js
const edges = windows.visibleTopEdges();
// [{ id: 4182, x: 120, y: 64, width: 900 }, { id: 391, x: 1020, y: 33, width: 708 }]
```

被前面窗口截成两段的顶边有两个部分；全屏窗口没有（它的顶边就是屏幕的顶边）。然后在动画的每一步：

- 站在窗口上：按 `id` 重新找到它在伙伴脚下的那一段。窗口移动了就跟着移动；找不到了（关闭、最小化、被挡住，或者伙伴走过了头），就开始下落。
- 下落：落在上一步脚的位置和现在脚的位置之间最高的那一段上，或者显示器 `visibleFrame` 的底部。

## 在网页上

浏览器看不到 Mac 的窗口。`desktopengine dev --web` 会给有这个权限的内容在页面上放一个假的应用窗口：拖标题栏移动它，拖右下角改变大小，点红色圆点关闭，用菜单栏的 New Window 再开几个。按一下桌面，就没有窗口属于当前应用。商店的预览里没有这些窗口：`list()` 是空的。
