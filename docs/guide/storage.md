# Storage and Files

Content can keep data between launches, without asking for a permission:

- `localStorage` for small things such as settings and state: strings by key, as in browsers.
- `DesktopEngine.fs` for files: Node's file functions, on the content's own folder.
- `DesktopEngine.syncStorage` for what should follow the user to their other Macs, such as a to-do list: strings by key, like `localStorage` (API 7).

They belong to the content: every instance of it (e.g. the same wallpaper on two displays) shares them. They're kept when the content is updated, when it's removed from the desktop and put back, and deleted when it's uninstalled. Content run by `desktopengine dev` or the Develop menu has its own, apart from the installed copy's, also kept between runs.

## localStorage and sessionStorage

They work as in browsers: `getItem`, `setItem`, `removeItem`, `clear`, `key(index)`, `length`, and the items are properties too (`localStorage.theme = 'dark'`, `Object.keys(localStorage)`).

```js
const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
settings.lastOpened = Date.now();
localStorage.setItem('settings', JSON.stringify(settings));
```

- Values are strings: store objects with `JSON.stringify`.
- Up to 5 MB each (keys and values together, counted in UTF-16 code units, as in browsers); over that, `setItem` throws a `QuotaExceededError` DOMException.
- All the instances of the content see each other's changes right away. There's no `storage` event, so an instance that needs to notice them reads again, e.g. on a timer. For what belongs to one instance, such as a wallpaper's on each display, put [`DesktopEngine.launchOptions.instanceId`](./launch-options) in the key; those items stay until the content is uninstalled. A widget or companion removed from the desktop and put back is a new instance: keep what it should find again under keys of the content's own.
- `sessionStorage` is kept in memory while the content runs.

## Synced storage: `DesktopEngine.syncStorage`

`DesktopEngine.syncStorage` keeps strings by key like `localStorage` (`getItem`, `setItem`, `removeItem`, `clear`, `key(index)`, `length`), and the user's other Macs signed in to the same DesktopEngine account get them too. Declare `"apiVersion": 7` in [manifest.json](../reference/manifest#api-versions) to use it.

```js
const storage = DesktopEngine.syncStorage;

function addTodo(text) {
  const id = crypto.randomUUID();
  storage.setItem(`todo:${id}`, JSON.stringify({ text, done: false }));
}

function todos() {
  const list = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key.startsWith('todo:')) list.push({ id: key.slice(5), ...JSON.parse(storage.getItem(key)) });
  }
  return list;
}

// an item changed on another Mac
storage.addEventListener('change', (event) => {
  console.log(event.key, event.oldValue, event.newValue); // newValue is null when it was removed
  render(todos());
});
```

- Each key is synced on its own. When two Macs change the same key, the change made last wins; changes of different keys never get in each other's way. Keep items that change separately under keys of their own, as the to-dos above, rather than one big value: two Macs adding a to-do at the same time then both keep theirs.
- A `change` event comes for each item another Mac changed, not for the content's own changes (its instances on this Mac share the items and see them right away).
- Changes reach the other Macs within seconds, not right away. Don't use it for what changes every second, such as a timer's remaining time: keep that in `localStorage`, and sync what it ends with.
- When the user isn't signed in or doesn't sync the library, the items stay on this Mac, and go to the other Macs once they are. When the content is uninstalled from one Mac, they stay in the account, and are there again when it's installed again.
- Up to 1024 items, 1024 × 1024 UTF-16 code units of keys and values together, and 61,440 for a key and its value together as JSON writes them (a `"`, `\` or line break counts 2, another control character 6). Over that, `setItem` throws a `QuotaExceededError` DOMException.
- Lone surrogates in keys and values become U+FFFD, and keys are stored in Unicode's NFC form, so `'cafe\u0301'` and `'caf\u00e9'` are the same key. Items aren't properties: use `getItem` and `setItem`.
- Content run by `desktopengine dev` has its own, which stays on the Mac. In `desktopengine dev --web` and the store's preview, it's kept in memory.

## Files: `DesktopEngine.fs`

`DesktopEngine.fs` has the functions of Node's `fs/promises` and their `Sync` versions:

| Function | Does |
| --- | --- |
| `readFile(path, encoding?)` | Reads a file: an ArrayBuffer, or a string with an encoding (`'utf8'`, `'base64'`, `'hex'`…) |
| `writeFile(path, data, encoding?)` | Replaces a file with a string, an ArrayBuffer or a typed array; it's never left half written |
| `appendFile(path, data, encoding?)` | Adds to the end of a file |
| `mkdir(path, { recursive })` | Makes a directory, with `recursive` also its parents |
| `readdir(path)` | The names in a directory, sorted |
| `stat(path)` | `size`, `mtime`, `isFile()`, `isDirectory()`… |
| `access(path)`, `existsSync(path)` | Whether it exists |
| `rm(path, { recursive, force })`, `rmdir(path)`, `unlink(path)` | Remove |
| `rename(oldPath, newPath)`, `copyFile(src, dest)` | Move and copy |

Paths are taken literally (no percent-decoding) and can't reach anything else:

| Path | What |
| --- | --- |
| `data.json`, `./data.json`, `/data.json` | Files in the package, read-only |
| `defile://usr/…` | The content's own files, kept between launches |
| `defile://temp/…` | Temporary files, deleted when the content stops |

```js
const fs = DesktopEngine.fs;
const file = 'defile://usr/notes/today.json';

await fs.mkdir('defile://usr/notes', { recursive: true });
await fs.writeFile(file, JSON.stringify({ text: 'Buy milk' }));
const note = JSON.parse(await fs.readFile(file, 'utf8'));

try {
  await fs.unlink('defile://usr/old.txt');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
```

- The asynchronous functions run one at a time in order, off the JavaScript thread, so they don't hold up drawing; the `Sync` ones wait. Prefer the asynchronous ones for big files.
- Errors are Node's: `error.code` is `'ENOENT'` (no such file), `'EEXIST'`, `'ENOTDIR'`, `'EISDIR'`, `'ENOTEMPTY'`, `'EACCES'` (writing to the package, or a path outside of these places) or `'EINVAL'` (not a file path); `error.path` is the path given.
- The content's files can take up to 100 MB in `defile://usr/`, and as much again in `defile://temp/`. A write that would go over fails with `'ENOSPC'`, as when a disk is full; removing files makes room.
- Binary data is an `ArrayBuffer` instead of a Buffer. There are no file handles, streams or `watch`.
- `fetch`, `CanvasImage`, `Image`, `Video` and `Audio` load `defile://` files too. Those take URLs, so a name with spaces or `%` is percent-encoded there (`encodeURI`), unlike in `DesktopEngine.fs`.
