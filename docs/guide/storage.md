# Storage and Files

Content can keep data between launches, without asking for a permission:

- `localStorage` for small things such as settings and state: strings by key, as in browsers.
- `DesktopEngine.fs` for files: Node's file functions, on the content's own folder.

Both belong to the content: every instance of it (e.g. the same widget twice on the desktop) shares them. They're kept when the content is updated and deleted when it's uninstalled. Content run by `desktopengine dev` or the Develop menu has its own, apart from the installed copy's, also kept between runs. In the screen saver, content starts with empty ones every time.

## localStorage and sessionStorage

They work as in browsers: `getItem`, `setItem`, `removeItem`, `clear`, `key(index)`, `length`, and the items are properties too (`localStorage.theme = 'dark'`, `Object.keys(localStorage)`).

```js
const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
settings.lastOpened = Date.now();
localStorage.setItem('settings', JSON.stringify(settings));
```

- Values are strings: store objects with `JSON.stringify`.
- Up to 5 MB each (keys and values together, counted in UTF-16 code units, as in browsers); over that, `setItem` throws a `QuotaExceededError` DOMException.
- All the instances of the content see each other's changes right away. There's no `storage` event, so an instance that needs to notice them reads again, e.g. on a timer. For what belongs to one instance, put [`DesktopEngine.launchOptions.instanceId`](./launch-options) in the key; those items stay after the instance is removed from the desktop, until the content is uninstalled.
- `sessionStorage` is kept in memory while the content runs.

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
- Binary data is an `ArrayBuffer` instead of a Buffer. There are no file handles, streams or `watch`.
- `fetch`, `CanvasImage`, `Image`, `Video` and `Audio` load `defile://` files too. Those take URLs, so a name with spaces or `%` is percent-encoded there (`encodeURI`), unlike in `DesktopEngine.fs`.
