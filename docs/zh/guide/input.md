# 跟随鼠标

窗口自己的事件（`mousemove`、`click` 等）只在指针位于窗口上时触发。`DesktopEngine.input` 在整个屏幕上跟随鼠标，包括指针在别的应用上时，例如做一个眼睛跟着指针转的桌面伙伴。它需要清单里的 [`mouse` 权限](/zh/reference/manifest#权限-permissions)和 `"apiVersion": 3`：

```json
"apiVersion": 3,
"permissions": ["mouse"]
```

```js
const input = DesktopEngine.input;

input.onmousemove = ({ x, y }) => lookAt(x, y);
input.onmousedown = ({ x, y, button }) => blink(); // button：0 主键，1 中键，2 副键
input.onmouseup = () => {};
input.onwheel = ({ deltaX, deltaY }) => spin(deltaY);

// 指针现在的位置，不用等它移动
const start = input.pointer; // { x, y }，没有权限时为 null
```

坐标是全局的，和 `DesktopEngine.Window`、`Screen` 一样：原点在主显示器的左上角，y 向下。减去窗口的位置就是窗口里的点。

- 这些事件只是旁观：指针照常交给它下面的东西，不会从别的应用那里拿走任何事件。
- 移动和滚轮来得比内容处理得快时会合并：取最新的位置、增量相加。不要靠数事件来算距离，用位置。
- 只有内容在监听其中某个事件时，应用才会跟踪鼠标。不再需要时移除监听（`input.onmousemove = null`、`removeEventListener`、`destroy()`）。
- 没有权限（没有声明，或者用户拒绝了）时 `pointer` 为 `null`，事件也不会来：要考虑伙伴不跟随指针的情况。
- 如果包也要在 API 版本更低的应用里运行，使用前先判断 `DesktopEngine.apiVersion >= 3`。

## 在网页上

在 `desktopengine dev --web` 和商店的预览里，指针在页面上的桌面范围内时，内容会收到这些鼠标事件；指针在盖住桌面的页面窗口上时也一样。
