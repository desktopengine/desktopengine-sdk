# 启动参数

应用启动内容时，会在 `index.js` 执行前注入只读的 `DesktopEngine.launchOptions`：

```js
const options = DesktopEngine.launchOptions || {};
options.windowType;   // 'widget'（贴在桌面上）或 'overlay'（浮于窗口之上），传给 new DesktopEngine.Window({ type })
options.width;        // 小组件宽度（点），与所选尺寸对应
options.height;
options.position;     // { x, y }：用户上次拖到的位置，或应用算好的默认位置
options.display;      // { id, name, frame, visibleFrame, scale }
options.parameters;   // 选项的取值
options.locale;       // 用户的首选语言，例如 'zh-Hans-CN'
options.permissions;  // 用户允许的权限，例如 ['audio', 'network']；被拒绝的不在其中
options.screenSaver;  // 作为屏幕保护程序运行时为 { preview }，否则没有
```

坐标与 `DesktopEngine.Window` 的样式一致：以主显示器左上角为原点，y 向下。完整的字段见 [`LaunchOptions`](/api/interfaces/DesktopEngine.LaunchOptions)。

- `parameters` 是[选项](/reference/manifest#选项-parameters)的取值，用户改了选项后内容会重新启动。
- `permissions` 见[权限](/reference/manifest#权限-permissions)，`screenSaver` 见[屏幕保护程序](./wallpaper#屏幕保护程序)。
- 在开发时用 `desktopengine dev --size / --level / --display / --param / --position` 模拟这些值，见[命令行](/reference/cli#dev)。

## 与应用通信

```js
win.onmove = (payload) => postMessage('host', { type: 'move', x: payload.x, y: payload.y });
postMessage('host', { type: 'close' }); // 把自己从桌面移除
```

应用会记住 `move` 上报的位置，下次启动时通过 `options.position` 传回。

## 外观

`DesktopEngine.system.appearance` 是系统当前的外观，`'light'` 或 `'dark'`；用户在系统设置里切换（或「自动」按时间切换）时触发 `appearancechange`（API 2）：

```js
const system = DesktopEngine.system;
let dark = system.appearance === 'dark';
system.onappearancechange = (event) => {
  dark = event.appearance === 'dark';
  draw();
};
```

「外观」选项建议提供 `auto`（跟随系统）并作为默认值，见小组件和壁纸模板。壁纸一直在按帧绘制，每帧读取 `appearance` 并渐变到目标配色即可，不必监听事件。
