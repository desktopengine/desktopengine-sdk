# 数据：Blob、FormData、URL、文本编码和流

运行时有这些标准的全局对象，行为与浏览器一致：

- `Blob`、`File`：不可变的字节加 MIME 类型。`URL.createObjectURL(blob)` 生成 `blob:null/…` 地址，`fetch`、`XMLHttpRequest` 和 `CanvasImage`、`Image`、`Video` 的 `src` 都能加载它，所以 three.js 的 `GLTFLoader` 能读 GLB 里内嵌的贴图。和浏览器一样，地址在 `URL.revokeObjectURL()` 或内容停止前一直有效；撤销后已经加载的图片和视频不受影响。
- `FormData`：表单字段和文件，作为请求体时按 multipart/form-data 发送，`response.formData()` 也能解析；没有表单元素，`new FormData(form)` 会抛错。
- `URL`、`URLSearchParams`：按 WHATWG URL 标准解析。国际化域名转换成 Punycode，但没有完整的 UTS #46 映射表，个别特殊字符的域名结果可能和浏览器不同。
- `TextEncoder`、`TextDecoder`：UTF-8 和 UTF-16 与浏览器完全一致；`TextDecoder` 也支持编码标准里的旧编码（GBK、gb18030、Big5、Shift_JIS、EUC-JP、EUC-KR、windows-125x、ISO-8859-x、KOI8 等），由系统解码，个别字符和坏字节的替换方式可能和浏览器略有不同。`TextEncoderStream`、`TextDecoderStream` 用在流上。
- 流：`ReadableStream`（包括字节流和 BYOB 读取、`for await` 遍历、`ReadableStream.from()`）、`WritableStream`、`TransformStream` 和两种排队策略，来自 [web-streams-polyfill](https://github.com/MattiasBuelens/web-streams-polyfill)。
- `MessageEvent`、`CloseEvent`、`ProgressEvent` 也是全局的，`Event`、`EventTarget` 也是，全局对象还可以通过 `self` 访问（three.js 等库会用 `self.URL`）。

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
