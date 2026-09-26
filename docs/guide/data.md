# Data: Blob, FormData, URL, Text Encoding and Streams

There are these standard globals, which behave as in browsers:

- `Blob`, `File`: immutable bytes with a MIME type. `URL.createObjectURL(blob)` makes a `blob:null/…` address that `fetch`, `XMLHttpRequest` and the `src` of `CanvasImage`, `Image` and `Video` can load, so three.js's `GLTFLoader` reads the textures embedded in a GLB. As in browsers, the address is valid until `URL.revokeObjectURL()` or until the content stops; images and videos already loaded aren't affected by revoking it.
- `FormData`: form fields and files, sent as multipart/form-data as a request body; `response.formData()` parses it too. There are no form elements, so `new FormData(form)` throws.
- `URL`, `URLSearchParams`: parsed by the WHATWG URL standard. International domain names are converted to Punycode, but without the full UTS #46 mapping table, so domains with a few special characters may come out differently from browsers.
- `TextEncoder`, `TextDecoder`: UTF-8 and UTF-16 are exactly as in browsers. `TextDecoder` also has the legacy encodings of the Encoding standard (GBK, gb18030, Big5, Shift_JIS, EUC-JP, EUC-KR, windows-125x, ISO-8859-x, KOI8 and more), decoded by the system, where a few characters and the replacement of bad bytes may differ slightly from browsers. `TextEncoderStream` and `TextDecoderStream` work on streams.
- Streams: `ReadableStream` (byte streams and BYOB readers, `for await`, `ReadableStream.from()` included), `WritableStream`, `TransformStream` and the two queuing strategies, from [web-streams-polyfill](https://github.com/MattiasBuelens/web-streams-polyfill).
- `MessageEvent`, `CloseEvent` and `ProgressEvent` are global too, as are `Event` and `EventTarget`, and the global object is also `self` (three.js and other libraries use `self.URL`).

```js
// Parse newline-delimited JSON while it downloads
const response = await fetch('https://example.com/events.ndjson');
let buffer = '';
for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
  buffer += text;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) if (line) handle(JSON.parse(line));
}

// Upload a file and a field
const form = new FormData();
form.append('title', 'Screenshot');
form.append('file', new Blob([bytes], { type: 'image/png' }), 'shot.png');
await fetch('https://example.com/upload', { method: 'POST', body: form });
```
