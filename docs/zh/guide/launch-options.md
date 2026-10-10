# 启动参数

应用启动内容时，会在 `index.js` 执行前注入只读的 `DesktopEngine.launchOptions`：

```js
const options = DesktopEngine.launchOptions || {};
options.windowType;   // 'widget'（贴在桌面上）或 'overlay'（浮于窗口之上），传给 new DesktopEngine.Window({ type })
options.width;        // 小组件宽度（点），与所选尺寸对应
options.height;
options.position;     // { x, y }：用户上次拖到的位置；没有时小组件由应用算好默认位置，伙伴自己决定
options.display;      // { id, name, frame, visibleFrame, scale }
options.displays;     // 壁纸跨显示器时代替 display，列出跨的那几块显示器，见壁纸
options.parameters;   // 选项的取值
options.locale;       // 用户的首选语言，例如 'zh-Hans-CN'
options.permissions;  // 用户允许的权限，例如 ['audio', 'network']；被拒绝的不在其中
options.screenSaver;  // 作为屏幕保护程序运行时为 { preview }，否则没有
```

坐标与 `DesktopEngine.Window` 的样式一致：以主显示器左上角为原点，y 向下。完整的字段见 [`LaunchOptions`](/api/interfaces/DesktopEngine.LaunchOptions)。

- `parameters` 是[选项](/zh/reference/manifest#选项-parameters)的取值，见[选项改变时](#选项改变时)。
- `permissions` 见[权限](/zh/reference/manifest#权限-permissions)，`displays` 见[跨显示器](./wallpaper#跨显示器)，`screenSaver` 见[屏幕保护程序](./wallpaper#屏幕保护程序)。
- 在开发时用 `desktopengine dev --size / --level / --display / --span / --param / --position` 模拟这些值，见[命令行](/zh/reference/cli#dev)。

## 选项改变时

用户修改选项后，应用会用新的取值重新启动内容。监听 `DesktopEngine.system` 的 `parameterschange`，内容就会继续运行：自己应用新的取值，其余的保持原样，比如计时器剩下的时间、桌面伙伴走到的位置。

```js
const system = DesktopEngine.system;
let accent = DesktopEngine.launchOptions.parameters?.accent ?? '#0A84FF';
system.onparameterschange = (event) => {
  accent = event.parameters.accent ?? '#0A84FF';
  draw();
};
```

- 在内容启动时就设好监听：用户每次修改选项，应用都会检查有没有监听。
- `event.parameters` 是全部取值，`event.changed` 是变了的键；`DesktopEngine.launchOptions.parameters` 也是新的取值。
- 拖动滑块时一秒会触发好几次：立即重绘，但重建场景这类耗时的工作等取值不再变化再做。

## 与应用通信

```js
win.onmove = (payload) => postMessage('host', { type: 'move', x: payload.x, y: payload.y });
postMessage('host', { type: 'close' }); // 把自己从桌面移除
```

应用会记住 `move` 上报的位置，下次启动时通过 `options.position` 传回；用户把内容移除后在同一个显示器上重新添加，也会放回那里。

## 外观

`DesktopEngine.system.appearance` 是系统当前的外观，`'light'` 或 `'dark'`；用户在系统设置里切换（或「自动」按时间切换）时触发 `appearancechange`：

```js
const system = DesktopEngine.system;
let dark = system.appearance === 'dark';
system.onappearancechange = (event) => {
  dark = event.appearance === 'dark';
  draw();
};
```

「外观」选项建议提供 `auto`（跟随系统）并作为默认值，见小组件和壁纸模板。壁纸一直在按帧绘制，每帧读取 `appearance` 并渐变到目标配色即可，不必监听事件。
