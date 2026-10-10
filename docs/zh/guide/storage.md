# 存储和文件

内容可以在多次启动之间保存数据，不需要申请权限：

- `localStorage` 适合设置、状态这类小数据：按键存字符串，和浏览器一样。
- `DesktopEngine.fs` 用来读写文件：Node 的文件函数，作用在内容自己的文件夹上。

两者都属于内容本身：它的每个实例（例如同一个壁纸在两块显示器上）共用同一份。内容更新、从桌面移除再放回去时保留，卸载时删除。`desktopengine dev` 和「开发」菜单运行的内容有单独的一份，和已安装的那份分开，多次运行之间同样保留。在屏幕保护程序里，内容每次都从空的开始。

## localStorage 和 sessionStorage

用法和浏览器一样：`getItem`、`setItem`、`removeItem`、`clear`、`key(index)`、`length`，每一项也是属性（`localStorage.theme = 'dark'`、`Object.keys(localStorage)`）。

```js
const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
settings.lastOpened = Date.now();
localStorage.setItem('settings', JSON.stringify(settings));
```

- 值都是字符串，对象用 `JSON.stringify` 存。
- 各自最多 5 MB（键和值加起来，按 UTF-16 码元计，和浏览器一样），超出时 `setItem` 抛出 `QuotaExceededError` DOMException。
- 内容的各个实例立即能看到彼此的修改。没有 `storage` 事件，实例要知道别的实例改了什么，需要重新读取，例如定时读一次。只属于一个实例的数据（例如壁纸在每块显示器上各自的状态），把 [`DesktopEngine.launchOptions.instanceId`](./launch-options) 放进键名里；这些项一直保留到内容被卸载。从桌面移除再放回去的小组件、桌面伙伴是新的实例：要让它再找到的数据，用不带实例的键保存。
- `sessionStorage` 保存在内存里，内容运行期间有效。

## 文件：`DesktopEngine.fs`

`DesktopEngine.fs` 提供 Node 的 `fs/promises` 里的函数，以及它们的 `Sync` 版本：

| 函数 | 作用 |
| --- | --- |
| `readFile(path, encoding?)` | 读取文件：得到 ArrayBuffer，指定编码（`'utf8'`、`'base64'`、`'hex'`…）时得到字符串 |
| `writeFile(path, data, encoding?)` | 用字符串、ArrayBuffer 或类型化数组替换文件内容；文件不会只写了一半 |
| `appendFile(path, data, encoding?)` | 追加到文件末尾 |
| `mkdir(path, { recursive })` | 创建目录，`recursive` 时连同缺少的上级目录 |
| `readdir(path)` | 目录里的名称，已排序 |
| `stat(path)` | `size`、`mtime`、`isFile()`、`isDirectory()`… |
| `access(path)`、`existsSync(path)` | 是否存在 |
| `rm(path, { recursive, force })`、`rmdir(path)`、`unlink(path)` | 删除 |
| `rename(oldPath, newPath)`、`copyFile(src, dest)` | 移动和复制 |

路径按字面理解（不做百分号解码），只能访问下面这些位置：

| 路径 | 位置 |
| --- | --- |
| `data.json`、`./data.json`、`/data.json` | 包里的文件，只读 |
| `defile://usr/…` | 内容自己的文件，多次启动之间保留 |
| `defile://temp/…` | 临时文件，内容停止时删除 |

```js
const fs = DesktopEngine.fs;
const file = 'defile://usr/notes/today.json';

await fs.mkdir('defile://usr/notes', { recursive: true });
await fs.writeFile(file, JSON.stringify({ text: '买牛奶' }));
const note = JSON.parse(await fs.readFile(file, 'utf8'));

try {
  await fs.unlink('defile://usr/old.txt');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
```

- 异步函数按调用顺序逐个在 JavaScript 线程之外执行，不会卡住绘制；`Sync` 版本会等待完成。大文件优先用异步函数。
- 错误和 Node 一样：`error.code` 是 `'ENOENT'`（文件不存在）、`'EEXIST'`、`'ENOTDIR'`、`'EISDIR'`、`'ENOTEMPTY'`、`'EACCES'`（写包里的文件，或者路径在这些位置之外）或 `'EINVAL'`（不是文件路径）；`error.path` 是传入的路径。
- 内容的文件在 `defile://usr/` 里最多占 100 MB，`defile://temp/` 里另有同样多。超出的写入会以 `'ENOSPC'` 失败，和磁盘满了一样；删掉文件就能腾出空间。
- 二进制数据是 `ArrayBuffer`，不是 Buffer。没有文件句柄、流和 `watch`。
- `fetch`、`CanvasImage`、`Image`、`Video` 和 `Audio` 也能加载 `defile://` 文件。它们接受的是 URL，所以名称里的空格和 `%` 要做百分号编码（`encodeURI`），这一点和 `DesktopEngine.fs` 不同。
