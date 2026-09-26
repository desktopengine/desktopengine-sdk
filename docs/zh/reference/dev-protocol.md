# `desktopengine dev` 协议

`desktopengine dev`（SDK 的 `src/dev.ts`）和 DesktopEngine 应用之间的通信约定。只有想自己实现开发工具（比如编辑器插件）时才需要读它，用 `desktopengine dev` 不需要。

## 为什么是应用去连命令行

应用运行在 App Sandbox 里，只能读用户在打开面板里选过的文件，读不了命令行给出的项目路径；但应用有 `network.client` 权限。所以由命令行在回环地址上提供服务，应用作为客户端连过来，把包下载到自己的容器里再运行。应用不需要新增 entitlement，也不监听任何端口。

## 建立连接

1. 命令行在 `127.0.0.1` 上监听一个端口（缺省随机），生成一次性的随机 `token`（48 个十六进制字符）。
2. 命令行执行 `open -g "desktopengine://develop/connect?port=<port>&token=<token>"`。
3. 应用（`Info.plist` 的 `CFBundleURLTypes` 注册了 `desktopengine` scheme）收到 URL：
   - 没有打开「开发」菜单时，询问是否打开；
   - 否则询问是否允许，可以勾选「不再询问」。
4. 应用连接 `ws://127.0.0.1:<port>/session?token=<token>`。同一个端口的旧连接会先断开。

命令行只接受带正确 `token` 的 HTTP 请求和 WebSocket 连接；应用只从 `127.0.0.1` 或 `localhost` 的同一端口下载包。

## 消息

WebSocket 上都是 UTF-8 的 JSON 文本消息，用 `type` 区分。

### 命令行 → 应用

| type | 字段 | 说明 |
| --- | --- | --- |
| `load` | `revision`、`url`、`launch` | 下载 `url`（`/package.zip?token=…`）并运行，替换正在运行的上一个版本。`revision` 从 1 递增，应用丢弃过期的下载和启动 |
| `stop` | | 停止小程序，连接保持 |
| `metrics` | `enabled` | 为 `true` 时应用在小程序运行期间约每秒发一条 `metrics`，`false` 停止；对之后重新载入的版本同样有效。`dev --perf` 在收到 `hello` 后、`load` 之前发送 |

`launch` 对应安装后的内容在详情栏里的选项，都可以省略：

| 字段 | 取值 |
| --- | --- |
| `size` | `small`、`medium`、`large`，只对小组件有效，不在 `widget.sizes` 里时用第一个 |
| `level` | `desktop`（贴在桌面上）或 `floating`（浮于所有窗口之上），缺省时桌面伙伴为 `floating`，其他为 `desktop` |
| `display` | 从 1 开始的显示器序号，缺省为主显示器 |
| `span` | 为 `true` 时壁纸跨所有显示器运行（`launchOptions.displays`），要求清单声明了 `wallpaper.span`；这时不看 `display` |
| `parameters` | `{ key: 值 }`，没有给出的选项用 manifest 里的 `default` |
| `position` | `{ x, y }`，缺省时沿用用户拖到的位置，再缺省时放在显示器右上角 |

应用用和安装后的内容相同的逻辑算出 `DesktopEngine.launchOptions`。

### 应用 → 命令行

| type | 字段 | 说明 |
| --- | --- | --- |
| `hello` | `app`、`apiVersion` | 连接后第一条消息：应用版本、`DesktopEngine.apiVersion`。命令行收到后发送 `load` |
| `loaded` | `revision`、`id`、`name`、`version`、`contentType`、`launchOptions` | 已经开始运行 |
| `load-failed` | `revision`、`message` | 下载、解包、清单检查或 `index.js` 执行失败 |
| `console` | `level`、`message` | `console.log/info/warn/error/debug`，参数已格式化并用空格连接 |
| `exception` | `message`、`stack` | 未捕获的异常，`stack` 可能没有 |
| `host` | `message` | 小程序调用了 `postMessage('host', message)`；`move` 会被记住，`close` 会停止小程序 |
| `stopped` | | 小程序停止了（收到 `stop`，或它自己发了 `close`） |
| `metrics` | `state`、`fps`、`targetFps`、`frameTime`、`maxFrameTime`、`slowFrames`、`cpu`、`wakeUps`、`jsMemory`、`canvasMemory` | 约一秒内的性能，见下表 |

`metrics` 的字段：

| 字段 | 说明 |
| --- | --- |
| `state` | `running`；`rendering-paused`（窗口都看不见，只停止绘制）；`suspended`（完全暂停，定时器每秒最多一次） |
| `fps` | 每秒真正画出新内容的帧数 |
| `targetFps` | 目标帧率：应用限制的帧率，显示器刷新率不是它的整数倍时是刷新率 |
| `frameTime`、`maxFrameTime` | 毫秒，从显示器刷新到这一帧做完的平均和最长时间，包括等小程序线程空下来 |
| `slowFrames` | 超过一帧时长（`1000 / targetFps` 毫秒）的帧数 |
| `cpu` | 小程序线程的 CPU 占用，100 是一个核心；不含音视频解码和 GPU |
| `wakeUps` | 小程序线程每秒被唤醒的次数 |
| `jsMemory` | 字节，JS 堆的容量加上对象在堆外占用的内存（ArrayBuffer 等）。来自 JavaScriptCore 的私有接口，Mac App Store 版应用不测、没有这个字段；约 5 秒测一次，是最近的值 |
| `canvasMemory` | 字节，画布占用的显存：绘图缓冲（含多重采样、深度和模板）、WebGL 内容创建的纹理、缓冲和 renderbuffer、画过的图片，按尺寸和格式累加，加上显示用的 IOSurface。约 5 秒测一次 |

除 `slowFrames`、`targetFps` 和两项内存外，数字保留一位小数。

## 断开

- 命令行退出（Ctrl-C）时先发 `stop` 再关闭连接；连接断开时应用也会停止这个小程序并删除下载的文件。
- 应用退出或断开后，命令行在下一次重新构建成功时再次打开连接 URL。
- 应用「开发」菜单里的「已连接 desktopengine dev」列出当前连接，可以逐个断开；「停止所有小程序」会断开全部连接。
