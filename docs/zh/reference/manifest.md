# 清单（manifest.json）

`manifest.json` 放在项目（和小程序包）的根目录，描述内容是什么、需要什么。

```json
{
  "id": "com.example.day-progress",
  "name": { "en": "Day Progress", "zh-Hans": "今日进度" },
  "type": "widget",
  "version": "1.0.0",
  "apiVersion": 2,
  "author": "Example",
  "icon": "assets/icon.png",
  "widget": { "sizes": ["small", "medium"] },
  "parameters": [
    { "key": "accent", "title": "强调色", "type": "color", "default": "#0A84FF" }
  ]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 反向域名形式的唯一标识符，只能包含字母、数字、点和连字符，例如 `com.example.clock` |
| `name` | 是 | 显示在资源库里的名称，可以翻译，见[多语言](#多语言) |
| `type` | 是 | `wallpaper`（壁纸）、`widget`（小组件）、`pet`（桌面伙伴） |
| `version` | 是 | 版本号，建议使用语义化版本，例如 `1.0.0` |
| `apiVersion` | | 需要的最低运行时 API 版本，见 [API 版本](#api-版本) |
| `author` | | 作者，显示在详情栏 |
| `description` | | 一两句话的介绍，可以翻译 |
| `icon`、`preview` | | 包内相对路径的图标和预览图 |
| `widget.sizes` | | 小组件支持的尺寸：`small` 164×164、`medium` 344×164、`large` 344×344，缺省为 `small` |
| `permissions` | | 需要的权限，见[权限](#权限-permissions) |
| `parameters` | | 用户可调的选项，见[选项](#选项-parameters) |

`desktopengine validate` 按应用的规则检查清单，应用会拒绝导入不合规则的包。

## JSON Schema

在清单里加上 `$schema`，编辑器（例如 VS Code）就能补全和检查字段：

```json
{
  "$schema": "https://desktopengine.github.io/desktopengine-sdk/manifest.schema.json",
  "id": "com.example.day-progress"
}
```

同一份 Schema 也在 npm 包的 `schema/manifest.schema.json` 里。

## 多语言

`name`、`description`、选项的 `title` 和 `options[].title` 可以是一个字符串，也可以按语言给出翻译，应用按用户的首选语言挑选，都不匹配时用 `en`：

```json
"name": { "en": "Day Progress", "zh-Hans": "今日进度" }
```

语言代码与 macOS 一致，例如 `en`、`zh-Hans`、`zh-Hant`、`ja`，`zh-CN` 这样带地区的也能匹配。画在画布上的文字由代码自己翻译，按 `DesktopEngine.launchOptions.locale` 挑选。

## 选项（parameters）

开发者只声明有哪些选项，应用在详情栏里统一画成系统表单，不需要自己做设置界面。

```json
{ "key": "accent", "title": "强调色", "type": "color", "default": "#0A84FF" }
```

| type | 控件 | default |
| --- | --- | --- |
| `toggle` | 开关 | 布尔值 |
| `number` | 同时有 `min` 和 `max` 时为滑块（`step` 为步长），否则为数字输入框 | 数字 |
| `text` | 文本框 | 字符串 |
| `color` | 颜色选择器 | `#RRGGBB` |
| `choice` | 弹出菜单，`options` 为 `[{ "value": …, "title": "…" }]` | 某个 `value` |

用户修改选项后，应用会重新启动这个实例（连续拖动滑块或输入时会合并成一次），新的取值在 `DesktopEngine.launchOptions.parameters` 里。

## 权限（permissions）

| 权限 | 含义 |
| --- | --- |
| `network` | 连接互联网 |
| `files` | 读取用户选择的文件 |
| `audio` | 播放声音 |
| `system-info` | CPU、内存、网络用量 |
| `now-playing` | 正在播放的音乐 |
| `window-positions` | 其他应用窗口的位置 |

应用在详情栏列出这些权限。`audio` 不询问：声明了就能发出声音，用户用音量和「所有内容静音」控制。其余权限在用户第一次把内容添加到桌面时逐项询问，用户可以只允许一部分，之后也能在详情栏里随时更改（内容会重新启动）；内置内容不询问。没有声明权限的内容不会弹出询问。

被拒绝的权限不会阻止内容运行：内容照常启动，只是对应的能力关闭，所以要为没有权限的情况做好降级。实际得到的权限在 `DesktopEngine.launchOptions.permissions` 里：

```js
const permissions = DesktopEngine.launchOptions?.permissions ?? [];
if (permissions.includes('network')) {
  refresh();
} else {
  showOfflineHint(); // 不要反复重试
}
```

由运行时强制执行的权限：`network`（没有它不能联网，见[网络](/zh/guide/network)）、`audio`（没有它不能发出声音，见[音频](/zh/guide/audio)）、`system-info`（没有它 `cpuUsage()` / `memoryUsage()` 抛出错误）。`files`、`now-playing`、`window-positions` 目前还没有对应的 API，声明的作用是让用户知情。`desktopengine dev` 和「开发」菜单载入的内容由开发者自己运行，不询问，得到声明的全部权限；没有声明的同样用不了。

## API 版本

运行时有一个整数的 API 版本，新增 API 时递增，JavaScript 里是 `DesktopEngine.apiVersion`，当前的 SDK 对应的版本是 9（`desktopengine --help` 的第一行也会显示）。用到新 API 时在清单里写上 `"apiVersion": 9`，低版本的应用会拒绝导入并提示用户更新；也可以不写，在运行时判断 `DesktopEngine.apiVersion` 后降级。

| 版本 | 新增 |
| --- | --- |
| 1 | 首个版本 |
| 2 | `DesktopEngine.system.appearance` 和 `appearancechange` 事件（跟随系统深浅色，见[外观](/zh/guide/launch-options#外观)） |
| 3 | Canvas 2D 的 `resetTransform()`；颜色支持 `#rgba`、`#rrggbbaa` 和 `rgb(255 0 0 / 50%)` 这类空格写法，无效颜色被忽略；WebGL 的 `getContextAttributes()` 返回实际的属性 |
| 4 | `fetch`、`Headers`、`Request`、`Response`、`AbortController`、`AbortSignal`、`WebSocket`、`DOMException`（见[网络](/zh/guide/network)）；`network` 权限开始生效 |
| 5 | `Audio`（`HTMLAudioElement`）和 Web Audio：`AudioContext`、`OfflineAudioContext`、各种音频节点、`AudioParam`、`AudioBuffer`（见[音频](/zh/guide/audio)）；全局的 `Event`、`EventTarget`；`audio` 权限开始生效，没有它视频也是静音的 |
| 6 | 流式响应体（`Response.body`）和 Streams API、`Blob`、`File`、`URL.createObjectURL`、`FormData`、`URL`、`URLSearchParams`、`TextEncoder`、`TextDecoder`（见[数据](/zh/guide/data)）；`XMLHttpRequest`、`ProgressEvent`、`MessageEvent`、`CloseEvent`、`self`；WebSocket 的 `binaryType` 默认是 `"blob"` |
| 7 | 画布样式 `imageRendering`：`'pixelated'`、`'crisp-edges'` 放大时保持像素清晰（见[运行时说明](/zh/guide/runtime)） |
| 8 | 窗口的 `devicepixelratiochange` 事件：窗口换到缩放比例不同的显示器后 `devicePixelRatio` 随之改变（见[运行时说明](/zh/guide/runtime)） |
| 9 | `DesktopEngine.preferredFramesPerSecond`：内容自己想要的帧率（见[暂停规则](/zh/guide/performance#暂停规则)） |
