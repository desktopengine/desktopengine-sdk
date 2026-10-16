# 存储和文件

内容可以在多次启动之间保存数据，不需要申请权限：

- `localStorage` 适合设置、状态这类小数据：按键存字符串，和浏览器一样。
- `DesktopEngine.fs` 用来读写文件：Node 的文件函数，作用在内容自己的文件夹上。
- `DesktopEngine.syncStorage` 存要跟着用户到其他 Mac 上的数据，例如待办清单：按键存字符串，和 `localStorage` 一样（API 7）。

它们都属于内容本身：它的每个实例（例如同一个壁纸在两块显示器上）共用同一份。内容更新、从桌面移除再放回去时保留，卸载时删除。`desktopengine dev` 和「开发」菜单运行的内容有单独的一份，和已安装的那份分开，多次运行之间同样保留。

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

## 同步的存储：`DesktopEngine.syncStorage`

`DesktopEngine.syncStorage` 和 `localStorage` 一样按键存字符串（`getItem`、`setItem`、`removeItem`、`clear`、`key(index)`、`length`），用户登录同一个 DesktopEngine 账户的其他 Mac 也会拿到。要用它，在 [manifest.json](../reference/manifest#api-版本) 里声明 `"apiVersion": 7`。

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

// 另一台 Mac 改了某一项
storage.addEventListener('change', (event) => {
  console.log(event.key, event.oldValue, event.newValue); // 删除时 newValue 是 null
  render(todos());
});
```

- 每个键单独同步。两台 Mac 改了同一个键时，后改的那个生效；不同的键互不影响。各自变化的数据放在各自的键下，像上面的待办那样，不要合成一个大值：这样两台 Mac 同时各加一条待办，两条都会保留。
- 另一台 Mac 改了几项，就有几个 `change` 事件；内容自己的修改没有（它在这台 Mac 上的各个实例共用这些项，立即就能看到）。
- 修改在几秒内到达其他 Mac，不是立即。不要用它存每秒都在变的东西，例如计时器剩下的时间：这些放在 `localStorage` 里，只同步最后的结果。
- 用户没有登录、或者没有同步资源库时，这些项留在这台 Mac 上，等登录、打开同步后再到其他 Mac。内容从一台 Mac 上卸载后，这些项仍然留在账户里，重新安装时还在。
- 最多 1024 项；键和值加起来最多 1024 × 1024 个 UTF-16 码元；一个键和它的值加起来，按 JSON 写出来的长度最多 61,440（`"`、`\` 和换行算 2 个，其他控制字符算 6 个）。超出时 `setItem` 抛出 `QuotaExceededError` DOMException。
- 键和值里落单的代理项会变成 U+FFFD；键按 Unicode 的 NFC 形式保存，所以 `'cafe\u0301'` 和 `'caf\u00e9'` 是同一个键。各项不是属性：用 `getItem` 和 `setItem`。
- `desktopengine dev` 运行的内容有单独的一份，只留在这台 Mac 上。`desktopengine dev --web` 和商店的试用预览里，它保存在内存里。

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
