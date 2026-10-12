# Messages Between Content

Content that runs at the same time can talk with `BroadcastChannel` (API 6): the copies of a wallpaper on each display change scene together, a companion stretches when the timer widget beside it ends a focus session, a wallpaper dims while you focus. It's the web's `BroadcastChannel`, with a scope that says who a channel reaches.

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
| `namespace` | Every package whose id has the same namespace, `app.desktopengine.<namespace>.<name>`: the packages of one creator | Content installed from the store (whose id the store checked) |

```ts
// the creator's other packages, e.g. a companion listening to a timer widget
const focus = new BroadcastChannel('focus', { scope: 'namespace' });
focus.postMessage({ state: 'break' });
```

- A package imported from a file can take any id, so it can't use `namespace` channels: the constructor throws a `SecurityError` DOMException. Check for it if your content also runs that way.
- There's no channel to every content: content by different creators can't message each other.
- Content run by `desktopengine dev` shares `package` and `namespace` channels only with other content run by it (two projects in two terminals talk to each other, not to what's installed). So you can try a set of packages that work together before publishing them. Its `namespace` channels need an id of the store's form, `app.desktopengine.<namespace>.<name>`, as when you publish it; with any other id the constructor throws a `SecurityError`.
- Live previews in the app (a wallpaper's details, the widget gallery) take part in no messaging: their channels reach only each other. A message doesn't make a preview react, and a preview doesn't steer what's on the desktop.

## How messages behave

As on the web:

- A message goes to every other open channel of the same scope and name, in this content too, but never back to the channel that posted it, nor to a channel this content opens after posting it.
- It's a copy made like `structuredClone` (objects, arrays, `Map`, `Set`, `Date`, `ArrayBuffer` and typed arrays, `Blob`…, see [Data](./data)), without transferring. Functions, the engine's objects (canvases, windows…) and `MessagePort`s throw a `DataCloneError`.
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

- Content that's paused (its wallpaper covered by a full screen app, see [Performance and Pausing](./performance)) still gets messages, as its timers still run.
- `close()` stops a channel; posting on it throws an `InvalidStateError` afterwards. A channel that's open keeps receiving as long as the content runs.

## Limits

- A message takes at most 1 MB: 2 bytes for each character of its strings and keys, plus its `ArrayBuffer`s. A bigger one throws a `DataCloneError`.
- Content posts at most 240 messages and 16 MB a second over all its channels (more at once only after posting less for a while); past that `postMessage` throws a `QuotaExceededError`. A message every frame is fine; share bulk data in other ways.
- When content can't keep up with what it's sent (its thread is busy for long), the messages after its 1024 waiting ones are dropped.

## On the web

`desktopengine dev --web` and the store's try-on run `BroadcastChannel` the same way between the contents on the page, with the same scopes, errors and limits.

`BroadcastChannel` is in the API reference with its options.
