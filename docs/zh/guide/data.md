# 数据：Blob、FormData、URL、文本编码和流

运行时有这些标准的全局对象，行为与浏览器一致：

- `Blob`、`File`：不可变的字节加 MIME 类型。`URL.createObjectURL(blob)` 生成 `blob:null/…` 地址，`fetch`、`XMLHttpRequest` 和 `CanvasImage`、`Image`、`Video` 的 `src` 都能加载它，所以 three.js 的 `GLTFLoader` 能读 GLB 里内嵌的贴图。和浏览器一样，地址在 `URL.revokeObjectURL()` 或内容停止前一直有效；撤销后已经加载的图片和视频不受影响。
- `FormData`：表单字段和文件，作为请求体时按 multipart/form-data 发送，`response.formData()` 也能解析；没有表单元素，`new FormData(form)` 会抛错。
- `URL`、`URLSearchParams`：按 WHATWG URL 标准解析。国际化域名转换成 Punycode，但没有完整的 UTS #46 映射表，个别特殊字符的域名结果可能和浏览器不同。
- `TextEncoder`、`TextDecoder`：UTF-8 和 UTF-16 与浏览器完全一致；`TextDecoder` 也支持编码标准里的旧编码（GBK、gb18030、Big5、Shift_JIS、EUC-JP、EUC-KR、windows-125x、ISO-8859-x、KOI8 等），由系统解码，个别字符和坏字节的替换方式可能和浏览器略有不同。`TextEncoderStream`、`TextDecoderStream` 用在流上。
- `FileReader`（API 5）：把 Blob 读成 ArrayBuffer、文本、data URL 或二进制字符串，带事件，给为它写的库用；`blob.text()`、`arrayBuffer()`、`bytes()` 更简单。
- `structuredClone()`（API 5）：和浏览器一样深拷贝数据，包括 Map、Set、日期、类型化数组、Blob、`ImageData` 和循环引用。函数、Promise 和引擎的对象（画布、窗口、`URL`、流等）抛出 `DataCloneError` DOMException。转移（transfer）的 `ArrayBuffer` 在 macOS 14.4 及以后会被分离，在更早的系统上仍然可用。引擎已经读过的缓冲区（交给过 WebGL、画布、`crypto`、文件系统、音频或 `systemAudio.getBands()`、`WebSocket` 或 `BroadcastChannel` 的，以及 `ImageData` 的像素）在 macOS 14.4 及以后转移后也仍然可用，网页预览里则会被分离。所以转移以后不要再用原来的缓冲区。
- `MessageChannel` 和 `MessagePort`（API 5）：两个端口都在内容里（没有 Worker），消息是 `structuredClone` 的副本，各自在单独的任务里送达，React 的调度器这类库就是这样用的。要发给其他内容，用 `BroadcastChannel`，见[内容之间的消息](./messaging)。
- 流：`ReadableStream`（包括字节流和 BYOB 读取、`for await` 遍历、`ReadableStream.from()`）、`WritableStream`、`TransformStream` 和两种排队策略，来自 [web-streams-polyfill](https://github.com/MattiasBuelens/web-streams-polyfill)。
- `MessageEvent`、`CloseEvent`、`ProgressEvent` 也是全局的，`Event`、`CustomEvent`、`EventTarget` 也是，全局对象还可以通过 `self` 访问（three.js 等库会用 `self.URL`）。

```js
// 边下载边解析按行分隔的 JSON
const response = await fetch('https://example.com/events.ndjson');
let buffer = '';
for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
  buffer += text;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) if (line) handle(JSON.parse(line));
}

// 上传文件和字段
const form = new FormData();
form.append('title', 'Screenshot');
form.append('file', new Blob([bytes], { type: 'image/png' }), 'shot.png');
await fetch('https://example.com/upload', { method: 'POST', body: form });
```
