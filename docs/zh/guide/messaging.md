# 内容之间的消息

同时运行的内容可以用 `BroadcastChannel`（API 6）互相发消息：各块显示器上的同一个壁纸一起换场景；你的计时小组件结束一段专注时，你的桌面伙伴在旁边伸个懒腰；用户专注期间，你的壁纸变暗。它就是网页的 `BroadcastChannel`，多了一个范围（scope），说明通道能到达谁。

它不需要权限。在清单里写上 `"apiVersion": 6`；或者，如果包也要在 API 版本更低的应用里运行，就不写，在使用前判断 `DesktopEngine.apiVersion >= 6`。

```ts
// 这个包正在运行的所有实例
const channel = new BroadcastChannel('scene');
channel.onmessage = (event) => showScene(event.data.scene);
channel.postMessage({ scene: 'night' });
```

## 范围

| 范围 | 到达 | 谁能用 |
| --- | --- | --- |
| `package`（默认） | 同一个包正在运行的所有实例，例如每块显示器上的同一个壁纸 | 所有内容 |
| `namespace` | id 的命名空间相同的所有包，`app.desktopengine.<命名空间>.<名称>`：同一位创作者的包 | 从商店安装的内容（商店核对过它的 id），以及用 `desktopengine dev` 或「开发」菜单运行、id 是这种格式的内容 |

```ts
// 这位创作者的所有包，例如桌面伙伴听计时小组件的消息
const focus = new BroadcastChannel('focus', { scope: 'namespace' });
focus.postMessage({ state: 'break' });
```

- 从文件导入的包可以随意填写 id，所以不能用 `namespace` 通道：构造函数会抛出 `SecurityError` DOMException。如果你的内容也可能这样运行，要捕获这个异常。
- 没有通往所有内容的通道：不同创作者的内容不能互相发消息。
- 用 `desktopengine dev` 或「开发」菜单运行的内容，`package` 和 `namespace` 通道只和同样这样运行的内容相通（两个终端里的两个项目可以互相通信，但不和已安装的内容通信），所以发布之前就能试一套联动的包。它的 `namespace` 通道要求 id 是商店的格式 `app.desktopengine.<命名空间>.<名称>`，和发布时一样；id 是别的格式时构造函数会抛出 `SecurityError`。
- 应用里的实时预览（壁纸、小组件和桌面伙伴详情栏里的预览）和其他内容隔开：一个预览的通道只和同一个预览里的其他通道相通，所以消息不会让预览做出反应，预览也不会影响桌面上的内容。

## 消息的行为

- 和网页一样，消息发给同一范围、同一名称的其他所有打开的通道，包括本内容里的，但不会回到发出它的通道，也不会发给本内容在发出之后才打开的通道。
- 消息是像 `structuredClone` 那样做的副本（对象、数组、`Map`、`Set`、`Date`、`ArrayBuffer` 和类型化数组、`Blob` 等，见[数据](./data)），不能转移所有权。函数、引擎的对象（画布、窗口、屏幕、`measureText` 的结果、`localStorage` 等）和 `MessagePort` 会抛出 `DataCloneError`：请改为发送需要的值，例如 `{ bounds: screen.bounds, visibleFrame: screen.visibleFrame }`，要全部的值可以用 `JSON.parse(JSON.stringify(screen))`。不要展开屏幕或 `measureText` 的结果：在应用里 `{ ...screen }` 和 `Object.assign({}, screen)` 得到的是空对象。
- 每条消息在单独的任务里送达。同一个通道发出的消息按发送顺序到达；不同发送方之间没有顺序。
- 不保存消息：没在运行、或者没有打开这个名称的通道的内容收不到。想在启动时知道现在的状态，可以在通道上问一声，让别的内容回答：

```ts
const channel = new BroadcastChannel('focus', { scope: 'namespace' });
channel.onmessage = ({ data }) => {
  if (data.type === 'hello') channel.postMessage({ type: 'state', running: timer.running });
  if (data.type === 'state') apply(data);
};
channel.postMessage({ type: 'hello' });
```

- 暂停的内容（壁纸被全屏应用盖住等，见[性能和暂停规则](./performance)）照样马上收到消息，不像它的计时器那样在暂停时每秒最多运行一次。
- 只有带消息监听器的通道才会收到消息：设了 `onmessage` 或 `onmessageerror`，或者用通道的 `addEventListener` 加了 `message` 或 `messageerror` 监听器（用 `EventTarget.prototype.addEventListener.call(channel, …)` 加的不算）。这样的通道会一直接收，直到你关闭它，所以用完的通道要关闭。和浏览器一样，没有监听器的通道在你的代码不再引用它之后可能被回收，回收就等于关闭：`new BroadcastChannel('scene').postMessage(data)` 不会留下什么。
- `close()` 关闭通道，之后再发送会抛出 `InvalidStateError`。

## 限制

- 一条消息最多 1 MB，按发送时的类似 JSON 的文本计算：每个字符算 2 字节，所以除了字符串和键名，数字的每一位、数组每个元素的下标、引号、逗号和转义也都算在内。再加上其中 `ArrayBuffer` 的字节数（类型化数组按它的整个 buffer 算，同一个只算一次）、`Blob` 和 `ImageData` 的字节数。更大的抛出 `DataCloneError`。
- 大量数字请放进类型化数组发送：30,000 个像 `i / 7` 这样的数，放在数组里约 1.4 MB，放在 `Float64Array` 里是 0.23 MB。
- 一个内容在所有通道上每秒最多发 240 条消息、16 MB（之前一段时间发得少，才能一下子多发一些）；超过时 `postMessage` 抛出 `QuotaExceededError`。每帧发一条没有问题；大量数据请用别的方式共享。
- 内容来不及处理收到的消息时（它的线程长时间忙碌），排队的消息达到 1024 条或 64 MB 后，再来的会被丢弃。

## 在网页上

在 `desktopengine dev --web` 和商店的预览里，页面上的内容之间同样可以用 `BroadcastChannel`，范围和发送限制都一样。`dev --web` 只运行你的这一个项目，所以它的通道只能连到它自己；要试几个互相通信的包，用 `desktopengine dev` 在应用里分别运行它们。消息怎么复制、大小怎么算、拒绝哪些对象，都和应用里完全相同，不一定和浏览器自己的 `structuredClone` 一样（例如应用拒绝 `ImageBitmap`）。只有应用会丢弃积压的消息，网页上不会。

`BroadcastChannel` 及其选项见 API 参考。
