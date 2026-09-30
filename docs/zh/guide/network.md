# 网络

运行时提供标准的 `fetch`（连同 `Headers`、`Request`、`Response`、`AbortController`、`AbortSignal`）和 `WebSocket`，以及 `XMLHttpRequest`（给还在用它的库，比如 howler.js）。访问 http(s) 和 ws(s) 地址需要在清单里声明 [`network` 权限](/zh/reference/manifest#权限-permissions)，否则 `fetch` 以 `TypeError` 失败，`XMLHttpRequest` 触发 `error`，`new WebSocket()` 抛出 `SecurityError`。

```js
async function loadWeather(city) {
  const response = await fetch(`https://api.example.com/weather?city=${city}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const socket = new WebSocket('wss://stream.example.com/ticker');
socket.onmessage = (event) => update(JSON.parse(event.data));
socket.onclose = (event) => setTimeout(reconnect, 5000);
```

- 互联网上的地址必须用 `https://` 和 `wss://`：普通的 `http://` 和 `ws://` 会像断网一样失败（macOS 的 App 传输安全）。`localhost`、IP 地址和 `*.local` 名称仍然可以用 http，方便连接本机或局域网里的开发服务器。
- 相对地址（`data.json`、`./data.json`、`/data.json`）读取包内文件，不需要权限，文件不存在时是 404 响应；`data:` 和 `blob:` 地址也可以用。
- 没有 CORS 限制，任何响应都能读取。每个小程序有自己的 Cookie，只保存在内存里。
- `fetch` 收到响应头就返回，响应体是流（`response.body`，一个 `ReadableStream`），边下载边读；没人读的时候，缓冲约 1 MB 后暂停下载。`text()`、`json()`、`arrayBuffer()`、`blob()`、`formData()` 读完整个响应体。`text()` 与浏览器一样总是按 UTF-8 解码。系统会先缓冲 `text/plain` 响应的前 512 字节（内容嗅探）再交出来，要逐段推送文字（比如 server-sent events）的服务应该用 `text/event-stream` 等其他类型。
- 请求体可以是字符串、字节（`ArrayBuffer`、`TypedArray`）、`Blob`、`FormData`（按 multipart/form-data 发送）、`URLSearchParams` 或 `ReadableStream`（要像浏览器一样加 `duplex: 'half'`；会先读完再发送，不是边读边传）。
- WebSocket 的二进制消息默认是 `Blob`，和浏览器一样；设 `socket.binaryType = 'arraybuffer'` 改成 `ArrayBuffer`。单条消息最大 16 MB。连接失败时依次触发 `error` 和 `close`（`code` 为 1006），`error` 事件带有非标准的 `message` 说明原因。
- `XMLHttpRequest` 建在 `fetch` 之上，规则相同；只支持异步，`responseType` 可以是 `''`、`'text'`、`'json'`、`'arraybuffer'`、`'blob'`，`upload` 不触发事件。
- 远程图片（`CanvasImage`、`Image` 的 `src`）和视频同样需要 `network` 权限。
- 内容被移除或停止时，进行中的请求和连接会被取消，不会再有回调。

没有 `network` 权限（用户拒绝了）时内容照常运行，要显示离线状态，不要反复重试。
