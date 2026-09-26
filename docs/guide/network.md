# Network

The runtime has the standard `fetch` (with `Headers`, `Request`, `Response`, `AbortController`, `AbortSignal`) and `WebSocket` (API 4), and `XMLHttpRequest` (API 6, for libraries that still use it, such as howler.js). Reaching http(s) and ws(s) addresses needs the [`network` permission](/reference/manifest#permissions) in the manifest; without it `fetch` fails with a `TypeError`, `XMLHttpRequest` fires `error`, and `new WebSocket()` throws a `SecurityError`.

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

- Relative addresses (`data.json`, `./data.json`, `/data.json`) read files in the package, with no permission needed; a missing file is a 404 response. `data:` and `blob:` addresses work too.
- There is no CORS: every response can be read. Each mini program has cookies of its own, kept in memory only.
- Since API 6, `fetch` returns as soon as the headers arrive and the body is a stream (`response.body`, a `ReadableStream`) to read while it downloads; when nothing reads it, the download pauses after buffering about 1 MB. `text()`, `json()`, `arrayBuffer()`, `blob()` and `formData()` read the whole body. Like in browsers, `text()` always decodes UTF-8. The system buffers the first 512 bytes of `text/plain` responses (content sniffing) before handing them over, so services that push text piece by piece (server-sent events, say) should use `text/event-stream` or another type.
- Request bodies can be strings, bytes (`ArrayBuffer`, typed arrays), `Blob`, `FormData` (sent as multipart/form-data), `URLSearchParams` or `ReadableStream` (with `duplex: 'half'`, as in browsers; it's read to the end before sending, not streamed).
- WebSocket binary messages are `Blob`s by default, as in browsers (always `ArrayBuffer` before API 6); set `socket.binaryType = 'arraybuffer'` for `ArrayBuffer`. A message is at most 16 MB. A failed connection fires `error` then `close` (`code` 1006), and the `error` event has a non-standard `message` saying why.
- `XMLHttpRequest` is built on `fetch`, with the same rules. It's asynchronous only, `responseType` can be `''`, `'text'`, `'json'`, `'arraybuffer'` or `'blob'`, and `upload` fires no events.
- Remote images (the `src` of `CanvasImage` and `Image`) and videos need the `network` permission too.
- When content is removed or stopped, its requests and connections are cancelled, with no more callbacks.

Without the `network` permission (the user denied it) the content runs as usual: show that it's offline rather than retrying again and again.
