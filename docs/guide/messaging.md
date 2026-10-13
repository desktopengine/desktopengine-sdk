# Messages Between Content

Content that runs at the same time can talk with `BroadcastChannel` (API 6): the copies of a wallpaper on each display change scene together, your companion stretches when your timer widget beside it ends a focus session, your wallpaper dims while the user focuses. It's the web's `BroadcastChannel`, with a scope that says who a channel reaches.

It needs no permission. Put `"apiVersion": 6` in the manifest, or check `DesktopEngine.apiVersion >= 6` before using it if the package also runs in apps with an older API.

```ts
// every running instance of this package
const channel = new BroadcastChannel('scene');
channel.onmessage = (event) => showScene(event.data.scene);
channel.postMessage({ scene: 'night' });
```

## Scopes

| Scope | Reaches | Who can use it |
| --- | --- | --- |
| `package` (the default) | Every running instance of the same package, e.g. the copies of a wallpaper on each display | All content |
| `namespace` | Every package whose id has the same namespace, `app.desktopengine.<namespace>.<name>`: the packages of one creator | Content installed from the store (whose id the store checked), and content run by `desktopengine dev` or the Develop menu with an id of that form |

```ts
// every package of this creator, e.g. a companion listening to a timer widget
const focus = new BroadcastChannel('focus', { scope: 'namespace' });
focus.postMessage({ state: 'break' });
```

- A package imported from a file can take any id, so it can't use `namespace` channels: the constructor throws a `SecurityError` DOMException. Catch it if your content may also run that way.
- No channel reaches all content: content by different creators can't message each other.
- Content run by `desktopengine dev` or the Develop menu shares `package` and `namespace` channels only with other content run that way (two projects in two terminals talk to each other, not to what's installed), so you can try a set of packages that work together before publishing them. Its `namespace` channels need an id of the store's form, `app.desktopengine.<namespace>.<name>`, as when you publish it; with any other id the constructor throws a `SecurityError`.
- Live previews in the app (in the details pane of a wallpaper, widget or companion) are cut off from other content: a preview's channels reach only other channels in that same preview, so a message doesn't make a preview react, and a preview doesn't steer what's on the desktop.

## How messages behave

- As on the web, a message goes to every other open channel of the same scope and name, in this content too, but never back to the channel that posted it, nor to a channel this content opens after posting it.
- It's a copy made like `structuredClone` (objects, arrays, `Map`, `Set`, `Date`, `ArrayBuffer` and typed arrays, `Blob`…, see [Data](./data)), without transferring. Functions, the engine's objects (canvases, windows, screens, the result of `measureText`, `localStorage`…) and `MessagePort`s throw a `DataCloneError`: send the values you need instead, e.g. `{ bounds: screen.bounds, visibleFrame: screen.visibleFrame }`, or `JSON.parse(JSON.stringify(screen))` for all of them. Don't spread a screen or the result of `measureText`: in the app `{ ...screen }` and `Object.assign({}, screen)` give an empty object.
- It arrives in a task of its own. Messages from one channel arrive in the order they were posted; there's no order between different senders.
- Nothing is kept: content that isn't running, or has no channel of that name open, doesn't get it. To learn what's there when you start, ask on the channel and let the others answer:

```ts
const channel = new BroadcastChannel('focus', { scope: 'namespace' });
channel.onmessage = ({ data }) => {
  if (data.type === 'hello') channel.postMessage({ type: 'state', running: timer.running });
  if (data.type === 'state') apply(data);
};
channel.postMessage({ type: 'hello' });
```

- Content that's paused (its wallpaper covered by a full screen app, see [Performance and Pausing](./performance)) still gets messages right away: they don't wait like its timers, which run at most once a second while it's paused.
- Only a channel with a listener for messages gets them: `onmessage` or `onmessageerror`, or a `message` or `messageerror` listener added with the channel's `addEventListener` (one added with `EventTarget.prototype.addEventListener.call(channel, …)` doesn't count). Such a channel keeps receiving until you close it, so close the ones you're done with. As in browsers, a channel without one can be collected once your code no longer refers to it, and that closes it: `new BroadcastChannel('scene').postMessage(data)` leaves nothing behind.
- `close()` stops a channel; posting on it throws an `InvalidStateError` afterwards.

## Limits

- A message takes at most 1 MB, measured on the JSON-like text it's sent as: 2 bytes for each character, so strings and keys count, but so do numbers' digits, every array element's index, quotes, commas and escapes. The bytes of its `ArrayBuffer`s (a typed array counts its whole buffer, once), `Blob`s and `ImageData` are added. A bigger message throws a `DataCloneError`.
- Send many numbers in a typed array: 30,000 numbers like `i / 7` take about 1.4 MB in an array, and 0.23 MB in a `Float64Array`.
- Content posts at most 240 messages and 16 MB a second over all its channels (more at once only after posting less for a while); past that `postMessage` throws a `QuotaExceededError`. A message every frame is fine; share bulk data in other ways.
- When content can't keep up with what it's sent (its thread is busy for long), what comes for it while 1024 messages or 64 MB wait is dropped.

## On the web

`desktopengine dev --web` and the store's previews run `BroadcastChannel` the same way between the content on the page, with the same scopes and the same limits on posting. `dev --web` runs only your project, so its channels reach only its own; to try packages that talk to each other, run each with `desktopengine dev` in the app. A message is copied, measured and refused exactly as in the app, which isn't always as the browser's own `structuredClone` would (the app refuses an `ImageBitmap`, for one). Only the app drops messages for content that can't keep up.

`BroadcastChannel` is in the API reference with its options.
