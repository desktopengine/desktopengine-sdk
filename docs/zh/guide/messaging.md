# 内容之间的消息

同时运行的内容可以用 `BroadcastChannel`（API 6）互相发消息：各块显示器上的同一个壁纸一起换场景，旁边的计时小组件结束一段专注时桌面伙伴伸个懒腰，专注时壁纸变暗。它就是网页的 `BroadcastChannel`，多了一个范围（scope），说明通道能到达谁。

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
| `namespace` | ID 的命名空间相同的所有包，`app.desktopengine.<命名空间>.<名称>`：同一位创作者的包 | 从商店安装的内容（商店核对过它的 ID） |

```ts
// 创作者的其他包，例如桌面伙伴听计时小组件的消息
const focus = new BroadcastChannel('focus', { scope: 'namespace' });
focus.postMessage({ state: 'break' });
```

- 从文件导入的包可以用任意 ID，所以不能用 `namespace` 通道：构造函数抛出 `SecurityError` DOMException。内容也会这样运行的话要处理它。
- 没有通往所有内容的通道：不同创作者的内容不能互相发消息。
- `desktopengine dev` 运行的内容，`package` 和 `namespace` 通道只和其他 `desktopengine dev` 运行的内容相通（两个终端里的两个项目可以互相通信，但不和已安装的内容通信）。这样发布之前就能试一套联动的包。它的 `namespace` 通道要求 ID 是商店的格式 `app.desktopengine.<命名空间>.<名称>`，和发布时一样；ID 是别的格式时构造函数抛出 `SecurityError`。
- App 里的实时预览（壁纸详情、小组件列表）不参与通信：它们的通道只在自己内部相通。消息不会让预览做出反应，预览也不会影响桌面上的内容。

## 消息的行为

和网页一样：

- 消息发给同一范围、同一名称的其他所有打开的通道，包括本内容里的，但不会回到发出它的通道，也不会发给本内容在发出之后才打开的通道。
- 消息是像 `structuredClone` 那样做的副本（对象、数组、`Map`、`Set`、`Date`、`ArrayBuffer` 和类型化数组、`Blob` 等，见[数据](./data)），不能转移所有权。函数、引擎的对象（画布、窗口等）和 `MessagePort` 会抛出 `DataCloneError`。
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

- 暂停的内容（壁纸被全屏 App 盖住等，见[性能和暂停规则](./performance)）照常收到消息，就像它的计时器照常运行。
- `close()` 关闭通道，之后再发送会抛出 `InvalidStateError`。没关闭的通道在内容运行期间一直接收消息。

## 限制

- 一条消息最多 1 MB：字符串和键名的每个字符算 2 字节，再加上其中的 `ArrayBuffer`。更大的抛出 `DataCloneError`。
- 一个内容在所有通道上每秒最多发 240 条消息、16 MB（一段时间发得少之后才能一次多发）；超过时 `postMessage` 抛出 `QuotaExceededError`。每帧发一条没有问题；大量数据请用别的方式共享。
- 内容来不及处理收到的消息时（它的线程长时间忙碌），排队的 1024 条之后的消息会被丢弃。

## 网页上

`desktopengine dev --web` 和商店的试用在页面上的内容之间同样运行 `BroadcastChannel`，范围、错误和限制都一样。

`BroadcastChannel` 及其选项见 API 参考。
