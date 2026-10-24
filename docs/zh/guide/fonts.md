# 字体

2D 画布用 Mac 上安装的字体绘制文字（`system-ui`、`Helvetica`、`"Avenir Next"`…）。要用自己的字体，比如时钟的像素字体、标题的展示字体，内容用 `FontFace` 加载它，再加进 `DesktopEngine.fonts`，和网页用 `document.fonts` 一样（API 9）。使用前在 [manifest.json](../reference/manifest#api-版本) 里声明 `"apiVersion": 9`。

```js
const face = new FontFace('Pixel', 'url(fonts/pixel.woff2)');
DesktopEngine.fonts.add(face);
await face.load();

context.font = '32px Pixel, monospace';
context.fillText('12:30', 20, 60);
```

这些字体属于内容自己：它的画布按字体族找到它们，先于同名的已安装字体；其他内容和应用都看不到。内容停止后它们就没有了，每次启动重新加载。

## 来源

第二个参数是 CSS 的 `src` 列表，用第一个能加载的来源：

- `url(fonts/pixel.ttf)`：包里的文件，路径和 `require` 一样（`fonts/a.ttf`、`./fonts/a.ttf`、`/fonts/a.ttf` 是同一个文件）。带空格的路径要加引号：`url("fonts/My Font.otf")`。
- `url(defile://usr/fonts/a.ttf)`：内容保存的文件，见[存储和文件](./storage)。
- `URL.createObjectURL()` 得到的 `url(blob:…)`，以及 `url(data:font/woff2;base64,…)`。
- `local("Avenir Next Condensed")`：已安装的字体，按全名或 PostScript 名。

`format()` 里没有 `truetype`、`opentype`、`woff`、`woff2`、`collection` 之一的来源会被跳过，和浏览器跳过读不了的格式一样：

```js
new FontFace('Title', 'url(fonts/title.woff2) format("woff2"), url(fonts/title.ttf) format("truetype")');
```

也可以直接给字体的字节：`ArrayBuffer`、类型化数组或 `DataView`（立即复制）。字体不从 http(s) 地址加载：有 `network` 权限时先 fetch 文件（见[网络](./network)），再把字节交给 `FontFace`：

```js
const response = await fetch('https://fonts.example.com/display.woff2');
const face = new FontFace('Display', await response.arrayBuffer());
DesktopEngine.fonts.add(face);
await face.loaded;
```

支持 TrueType（`.ttf`）、OpenType（`.otf`）、WOFF 和 WOFF2，以及字体集（`.ttc`，用其中第一个字体），每个最大 64 MB。

## 加载

用 `src` 列表建的字体在 `load()` 之前是 `"unloaded"`；`load()` 开始加载并返回 `face.loaded`，状态变成 `"loaded"` 时它以这个字体兑现。用字节建的字体自己开始加载（在当前任务之后，此前状态是 `"loading"`）。`face.loaded` 失败时是一个 `DOMException`：

- `"SyntaxError"`：字体族、某个描述符或 `src` 列表无效（字体立即变成 `"error"`），或者字节不是字体。
- `"NetworkError"`：没有来源能加载：文件不存在或不是字体，或者是 http(s) 地址。消息里写着最后一个来源失败的原因。

`DesktopEngine.fonts.load(font)` 加载集合里被一个 CSS 字体选中的字体（它的每个字体族中有字体的，各选一个），`check(font)` 判断它们是否已加载。两者都接受画布的 `font` 写法，必须写字体族：

```js
await DesktopEngine.fonts.load('bold 24px Pixel');
DesktopEngine.fonts.check('bold 24px Pixel'); // true
DesktopEngine.fonts.check('24px Helvetica');  // true：没有选中集合里的字体，已安装的字体总是在的
```

字体加载完并且在 `DesktopEngine.fonts` 里才会被用来绘制，在那之前画布用 `font` 里的下一个字体族（或原来的字体）。和浏览器不同，在 `font` 里写这个字体族不会开始加载它。画布的 `font` 写了这个字体族的话，字体一加载完就用它绘制，不用重新设置 `font`：时钟可以从第一帧开始画，字体到了再换过去。用 `DesktopEngine.fonts.delete(face)`（或 `clear()`）移除字体，就不再用它绘制。

这个集合和网页的 `document.fonts` 一样：`add`、`delete`、`clear`、`has`、`size`、`forEach` 和 `for…of`；有字体在加载时 `status` 是 `"loading"`；都加载完时 `ready` 兑现；`loading`、`loadingdone` 和 `loadingerror` 事件（`FontFaceSetLoadEvent`，字体在 `fontfaces` 里）告诉开始和结束。

## 同一字体族的多个字体

几个字体可以属于同一个字体族，用 `style` 和 `weight` 描述符区分。画布像 CSS 一样选字体：先按样式（italic 退到 oblique，再到 normal；normal 退到 oblique，再到 italic），再按 CSS 规则中最接近的字重（400 先找 500 以内更重的，再找更轻的；大于 500 先找更重的）。

```js
const faces = [
  new FontFace('Serif Text', 'url(fonts/text-regular.otf)'),
  new FontFace('Serif Text', 'url(fonts/text-bold.otf)', { weight: 'bold' }),
  new FontFace('Serif Text', 'url(fonts/text-italic.otf)', { style: 'italic' }),
];
for (const face of faces) DesktopEngine.fonts.add(face);
await Promise.all(faces.map((face) => face.load()));

context.font = 'italic 18px "Serif Text"';
```

- 可变字体可以写字重范围 `{ weight: '100 900' }`：它的字重轴跟着要求的字重，限制在范围内。只写一个字重时（默认 400），就按那个字重绘制。
- 字体族没有斜体字体时，正体字体会倾斜后用于斜体文字。较细的字体不会被加粗。
- 字体里没有的字符用系统字体绘制。
- `stretch`、`unicodeRange`、`featureSettings`、`variationSettings`、`display` 以及 `ascentOverride`、`descentOverride`、`lineGapOverride` 描述符会保留在字体上，但不生效。

描述符在建好字体后也可以改（`face.weight = '600'`）；无效的值会抛出 `"SyntaxError"` DOMException。

## 网页预览

`desktopengine dev --web` 和商店的预览用浏览器的字体实现同一套 API：来源和应用里一样加载、一样检查，加载完并且在 `DesktopEngine.fonts` 里的字体交给浏览器。浏览器会把较细的字体加粗，应用不会。
