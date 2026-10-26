# 清单（manifest.json）

`manifest.json` 放在项目（和小程序包）的根目录，描述内容是什么、需要什么。

```json
{
  "id": "com.example.day-progress",
  "name": { "en": "Day Progress", "zh-Hans": "今日进度" },
  "type": "widget",
  "version": "1.0.0",
  "apiVersion": 1,
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
| `type` | 是 | `wallpaper`（壁纸）、`widget`（小组件）、`companion`（桌面伙伴），见[类型](#类型) |
| `version` | 是 | 版本号，建议使用语义化版本，例如 `1.0.0` |
| `apiVersion` | | 需要的最低运行时 API 版本，见 [API 版本](#api-版本) |
| `author` | | 作者，显示在详情栏 |
| `description` | | 一两句话的介绍，可以翻译 |
| `icon`、`preview` | | 包内相对路径的图标和预览图 |
| `previewDark` | | 深色模式下的预览图，包内相对路径：给跟随系统外观的内容用，这时 `preview` 是浅色模式下的。没有它时两种外观都显示 `preview` |
| `widget.sizes` | | 小组件支持的尺寸，第一个是默认的：`small` 164×164、`medium` 344×164、`large` 344×344，以及自己的尺寸（API 8），见[小组件尺寸](#小组件尺寸)；缺省为 `small` |
| `widget.resize` | | 让用户或内容在一个范围内调整小组件的大小（API 8），见[小组件尺寸](#小组件尺寸) |
| `wallpaper.span` | | 为 `true` 时壁纸可以跨显示器，见[跨显示器](/zh/guide/wallpaper#跨显示器) |
| `permissions` | | 需要的权限，见[权限](#权限-permissions) |
| `network.domains` | 有 `network` 时必填 | 要连接的域名，见[网络](/zh/guide/network#域名) |
| `audio.volume` | | 有 `audio` 时：用户的音量从多少开始，0...1（API 9），见[声音](#声音-audio) |
| `parameters` | | 用户可调的选项，见[选项](#选项-parameters) |
| `converter` | | 由工具从别的东西做成的包：是哪个工具、从什么做成的，见[由工具生成](#由工具生成) |

`desktopengine validate` 按应用的规则检查清单，应用会拒绝导入不合规则的包。

## 类型

| `type` | 是什么 |
| --- | --- |
| `wallpaper` | 动态壁纸：铺满一块显示器（或者全部显示器，见 `wallpaper.span`），在所有窗口之下 |
| `widget` | 小组件：放在用户选的位置，贴在桌面上或浮于所有窗口之上，尺寸是 `widget.sizes` 里的 |
| `companion` | 桌面伙伴：角色、吉祥物、小车、小游戏……待在所有窗口之上，自己在屏幕上活动 |

`companion` 需要 `"apiVersion": 2`。API 版本为 1 的应用只认识它的旧名称 `pet`：清单里还写着 `pet` 的包在哪里都能用，应用把它当作 `companion`，`validate` 只给出警告。`launchOptions.type` 是清单里写的类型。

## 小组件尺寸

`widget.sizes` 列出用户在应用里可选的尺寸，第一个是默认的。应用按面积从小到大列出它们，与这里的顺序无关。除了预设尺寸，小组件还可以声明自己的尺寸，和预设尺寸混在一起（需要 `"apiVersion": 8`）：

```json
"widget": {
  "sizes": [
    { "id": "standard", "width": 440, "height": 196, "name": { "en": "Standard", "zh-Hans": "标准" } },
    { "id": "compact", "width": 300, "height": 133, "name": { "en": "Compact", "zh-Hans": "紧凑" } },
    "medium"
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `id` | 小写字母、数字和连字符，不能是预设尺寸的名字，不能重复：`launchOptions.size` 给的就是它 |
| `width`、`height` | 整数点，至少 32。没有上限：比所在显示器的可用区域大时，应用按原比例缩小（显示不全 1280×800 显示器时 `validate` 会给出警告） |
| `name` | 显示在应用的尺寸选择里，可以像 `name` 一样翻译 |

小组件保持用户选的尺寸，除非 `widget.resize` 允许改变（需要 `"apiVersion": 8`）：

```json
"widget": {
  "sizes": ["medium"],
  "resize": { "by": ["user"], "minWidth": 200, "minHeight": 120, "maxWidth": 800, "aspectRatio": "fixed" }
}
```

| 字段 | 说明 |
| --- | --- |
| `by` | 谁来调整：`user`，用户像调整普通窗口一样拖桌面上小组件的边和角；`content`，内容通过窗口的样式调整；或者两者都有 |
| `minWidth`、`minHeight` | 最小尺寸，整数点，缺省为 32 |
| `maxWidth`、`maxHeight` | 最大尺寸，缺省没有上限 |
| `aspectRatio` | `fixed`：宽高保持所选尺寸的比例 |

所选的尺寸是起始尺寸。应用会记住小组件最后的大小，下次按这个大小启动；重新选一个尺寸则从那个尺寸开始。窗口的表现见[小组件的大小](/zh/guide/windows#小组件的大小)。

## JSON Schema

在清单里加上 `$schema`，编辑器（例如 VS Code）就能补全和检查字段：

```json
{
  "$schema": "https://desktopengine.app/desktopengine-sdk/manifest.schema.json",
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

只对另一个选项的某些取值有意义的选项，可以用 `showWhen` 只在那时显示：`key` 是前面某个 `toggle` 或 `choice` 选项的 key，`values` 是它的哪些取值时显示这个选项。被隐藏的选项保留它的取值，仍然在 `DesktopEngine.launchOptions.parameters` 里。API 低于 8 的应用会显示所有选项。

```json
[
  { "key": "style", "title": "样式", "type": "choice", "default": "digital",
    "options": [{ "value": "digital", "title": "数字" }, { "value": "analog", "title": "指针" }] },
  { "key": "seconds", "title": "秒针", "type": "toggle", "default": true,
    "showWhen": { "key": "style", "values": ["analog"] } }
]
```

用户修改选项后，新的取值在 `DesktopEngine.launchOptions.parameters` 里。监听了 `parameterschange` 的内容会在运行中应用它们，见[选项改变时](/zh/guide/launch-options#选项改变时)；其他内容由应用重新启动（连续拖动滑块或输入时会合并成一次）。

## 权限（permissions）

| 权限 | 含义 |
| --- | --- |
| `network` | 连接 `network.domains` 里的域名 |
| `audio` | 播放声音 |
| `system-info` | Mac 的状况：CPU 和内存用量，以及 [`DesktopEngine.systemStatus`](/zh/guide/system-status)（处理器、内存、网络、电源、温度、磁盘） |
| `mouse` | 指针的位置和点击，在任何应用里（需要 `"apiVersion": 3`），见[跟随鼠标](/zh/guide/input) |
| `system-audio` | 其他应用在 Mac 上播放的声音整体和从低到高各个频带有多响，只有分析结果，从不给声音本身（需要 `"apiVersion": 6`）；有它的内容不能同时有 `network`，见[Mac 正在播放的声音](/zh/guide/audio#mac-正在播放的声音) |
| `window-positions` | 其他应用窗口的位置、大小和前后顺序，以及哪些属于正在用的应用；不包括它们的标题和窗口里显示的东西（需要 `"apiVersion": 6`），见[其他应用的窗口](/zh/guide/app-windows) |

写其他权限会报错：应用不认识的权限不列出、不询问，内容也得不到。应用在详情栏列出这些权限。`audio` 不询问：声明了就能发出声音，用户用它的静音开关（打开声音之前一直是静音）、音量和「所有内容静音」控制，见[音量和静音](/zh/guide/audio#音量和静音)。其余权限在用户第一次把内容添加到桌面时逐项询问，用户可以只允许一部分，之后也能在详情栏里随时更改（内容会重新启动）。没有声明权限的内容不会弹出询问。系统早于 macOS 14.2 的 Mac 上也不询问 `system-audio`：没有什么可听的，内容得到它，听到的是静音（`supported` 为 false）。

被拒绝的权限不会阻止内容运行：内容照常启动，只是对应的能力关闭，所以要为没有权限的情况做好降级。实际得到的权限在 `DesktopEngine.launchOptions.permissions` 里，每个只出现一次，应用里和网页预览里都是这样。应用详情栏里的预览不出声，也看不到其他应用的窗口，所以那里没有 `audio` 和 `window-positions`：

```js
const permissions = DesktopEngine.launchOptions?.permissions ?? [];
if (permissions.includes('network')) {
  refresh();
} else {
  showOfflineHint(); // 不要反复重试
}
```

声明 `network` 时要列出内容连接的域名；它只能连这些域名，询问权限时也会把它们列给用户看：

```json
"permissions": ["network"],
"network": { "domains": ["api.example.com", "*.tile.example.org"] }
```

由运行时强制执行的权限：`network`（没有它不能联网，有它也只能连列出的域名，见[网络](/zh/guide/network#域名)）、`audio`（没有它不能发出声音，见[音频](/zh/guide/audio)）、`system-info`（没有它 `DesktopEngine.systemStatus` 为 `null`）、`mouse`（没有它收不到 `DesktopEngine.input` 的鼠标事件）、`window-positions`（没有它 `DesktopEngine.windows` 为 `null`）和 `system-audio`（没有它 `DesktopEngine.systemAudio` 为 `null`）。同时声明 `system-audio` 和 `network` 是错误：`desktopengine validate` 会报出来，应用和商店也不接受这样的包。`desktopengine dev` 和「开发」菜单载入的内容由开发者自己运行，不询问，按和已安装内容相同的规则得到声明的全部权限（例如 `network` 同样只能连列出的域名）；没有声明的同样用不了。

## 声音（audio）

`audio.volume` 是用户为内容设置音量之前它播放的音量，0...1：比如对它来说偏响的内容可以写 `0.5`。没有它时音量从 1 开始。用户设的音量会替代它，内容从 [`DesktopEngine.audioSettings`](/zh/guide/audio#音量和静音) 读到其中之一。需要 `audio` 权限；不在 0...1 之内的数会报错。

```json
{
  "permissions": ["audio"],
  "audio": { "volume": 0.5 },
  "apiVersion": 9
}
```

API 较旧的应用会忽略它、在用户设置之前用满音量播放，所以没有 `"apiVersion": 9` 时 `validate` 只给警告。

## 由工具生成

从别的东西生成包的工具（比如从另一种格式转换的转换器）可以在 `converter` 里写明：之后工具或用户就能知道一个包是哪个工具的哪个版本、从什么做成的，例如用新版本重新生成。

```json
"converter": { "name": "example-convert", "version": "0.3.0", "source": { "type": "scene", "hash": "9f2c41…" } }
```

`name` 和 `version` 是不为空、也不只有空格的字符串，`source` 是一个对象，内容由工具自己定；`desktopengine validate` 会检查这些。应用不按它做任何事：`converter` 读不懂的包照样导入，当作没有它。从同一个来源重新生成包时，工具应该保持 `id` 不变，用户选的选项、内容的数据和它的位置才会留下，并给它更高的 `version`。

## API 版本

运行时有一个整数的 API 版本，新增 API 时递增，JavaScript 里是 `DesktopEngine.apiVersion`，当前的 SDK 对应的版本是 9（`desktopengine --help` 的第一行也会显示）。用到之后新增的 API 时，在清单的 `"apiVersion"` 写上它的版本，API 版本更低的应用会拒绝导入并提示用户更新；也可以不写，在运行时判断 `DesktopEngine.apiVersion` 后降级。

| 版本 | 新增 |
| --- | --- |
| 1 | 首个版本 |
| 2 | `companion` 类型，原名 `pet` |
| 3 | `DesktopEngine.input` 和 `mouse` 权限，见[跟随鼠标](/zh/guide/input) |
| 4 | `Image` 的 `size` 可以是 `fill`（拉伸）和 `none`（原始尺寸），`Video` 的 `objectFit` 可以是 `none`；每个鼠标键的 `mousedown` 和 `mouseup`，鼠标事件的参数里有 `button` 和 `buttons`，见[鼠标](/zh/guide/windows#鼠标)；`queueMicrotask`、`atob`、`btoa` 和 `crypto`（`getRandomValues`、`randomUUID`），见[全局对象](/zh/guide/runtime#全局对象)；`Video` 的 `currentTime`、`duration` 和 `paused` |
| 5 | 2D 画布的 `ellipse()`、`roundRect()`、`getTransform()`、`createConicGradient()`、`letterSpacing` 和 `wordSpacing`，`setTransform()` 可以传矩阵，混合模式（`multiply`…`luminosity`）、`TextMetrics` 的其余字段、`Path2D`、`isPointInPath` 和 `isPointInStroke`；`createImageBitmap` 和 `new ImageData()`；`structuredClone`、`MessageChannel`、`FileReader`、`CustomEvent` 和 `navigator`，见[全局对象](/zh/guide/runtime#全局对象) |
| 6 | `BroadcastChannel`，范围有 `package` 和 `namespace`，见[内容之间的消息](/zh/guide/messaging)；`DesktopEngine.systemAudio` 和 `system-audio` 权限，见[Mac 正在播放的声音](/zh/guide/audio#mac-正在播放的声音)；`DesktopEngine.windows`（`list()`、`visibleTopEdges()` 和 `change`）和 `window-positions` 权限，见[其他应用的窗口](/zh/guide/app-windows)；`Image` 还没加进组件时就加载 `src`，可以先等它的 `load` 再加进去 |
| 7 | `DesktopEngine.syncStorage`，跟着用户到其他 Mac 上的键和值，见[同步的存储](/zh/guide/storage#同步的存储-desktopengine-syncstorage) |
| 8 | 选项的 `showWhen`，只在另一个选项取某些值时显示，见[选项](#选项-parameters)；`DesktopEngine.systemStatus`：处理器、内存、网络、电源和电池、温度和磁盘，变化时有事件，内容暂停后有 `resume`，见[系统状态](/zh/guide/system-status)（`system-info` 权限）；小组件自己的尺寸和 `widget.resize`，用户或内容调整小组件的大小，小组件的窗口不再限制在半块显示器内，见[小组件尺寸](#小组件尺寸)；去掉了 `DesktopEngine.system.cpuUsage()` 和 `memoryUsage()`：处理器（`cpu.usage`）和内存（`memory.used`、`memory.total`）由 `DesktopEngine.systemStatus` 读取；指针停在小组件和桌面伙伴的窗口上时窗口收到 `wheel`，见[鼠标](/zh/guide/windows#鼠标) |
| 9 | `FontFace` 和 `DesktopEngine.fonts`：2D 画布用的内容自己的字体，来自包里的文件、`defile://`、`blob:` 和 `data:` 地址、已安装的字体或字节，见[字体](/zh/guide/fonts)；`Video` 和视频元素一样可以当画布的来源：WebGL 的 `texImage2D` / `texSubImage2D`（和 `texImage3D` / `texSubImage3D`）、`drawImage`、`createPattern` 和 `createImageBitmap` 取它这时显示的那一帧；它的 `videoWidth`、`videoHeight`、`readyState` 和 `loadedmetadata`、`loadeddata`、`canplay` 事件；画布在读它时它在窗口外也播放，从没进过窗口的视频有了 `src` 就加载，见[视频](/zh/guide/video)；循环播放的 `Video` 接着从头播放、不停顿，每遍播完不再发 `ended`，和循环播放的视频元素一样：所有包都是，不管它的 `apiVersion`，见[循环播放](/zh/guide/video#循环播放)；`DesktopEngine.audioSettings`：用户给内容设的静音和音量，以及清单的 `audio.volume`，见[音量和静音](/zh/guide/audio#音量和静音) |

版本 4 还按浏览器的样子改了一些 API：双击事件是 `dblclick`（原来是 `dbclick`），`click` 和 `dblclick` 的参数和鼠标事件一样是 `{ x, y, … }`（原来是 `{ position: { x, y } }`）。去掉了 WebGL 上下文的 `wxBindCanvasTexture` 和 `blBindCanvasTexture`、全局的 `mixin` 和 `promisify`，以及没有对应 API 的 `files`、`now-playing`、`window-positions` 权限（版本 6 随 `DesktopEngine.windows` 重新加入了 `window-positions`）。用到它们的内容改好后要写上 `"apiVersion": 4`。
