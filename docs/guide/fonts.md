# Fonts

2D canvases draw text in the fonts installed on the Mac (`system-ui`, `Helvetica`, `"Avenir Next"`…). For a font of its own, a pixel font for a clock or a display face for a title, content loads it with `FontFace` and adds it to `DesktopEngine.fonts`, as a web page does with `document.fonts` (API 9). Declare `"apiVersion": 9` in [manifest.json](../reference/manifest#api-versions) to use them.

```js
const face = new FontFace('Pixel', 'url(fonts/pixel.woff2)');
DesktopEngine.fonts.add(face);
await face.load();

context.font = '32px Pixel, monospace';
context.fillText('12:30', 20, 60);
```

The fonts belong to the content: its canvases find them by family, before an installed font of the same name, and other content and apps never see them. They're gone when the content stops; load them again at each launch.

## Sources

The second argument is a CSS `src` list, the first source that loads is used:

- `url(fonts/pixel.ttf)`: a file of the package, a path as `require` takes it (`fonts/a.ttf`, `./fonts/a.ttf` and `/fonts/a.ttf` are the same file). Quote a path with spaces: `url("fonts/My Font.otf")`.
- `url(defile://usr/fonts/a.ttf)`: a file the content saved, see [Storage and Files](./storage).
- `url(blob:…)` from `URL.createObjectURL()`, and `url(data:font/woff2;base64,…)`.
- `local("Avenir Next Condensed")`: an installed font, by its full or PostScript name.

A source with a `format()` that names none of `truetype`, `opentype`, `woff`, `woff2` and `collection` is skipped, as browsers skip what they can't read:

```js
new FontFace('Title', 'url(fonts/title.woff2) format("woff2"), url(fonts/title.ttf) format("truetype")');
```

Or give the font's bytes, an `ArrayBuffer`, a typed array or a `DataView` (copied right away). Fonts aren't loaded from http(s) URLs: fetch the file, with the `network` permission ([Network](./network)), and give the bytes:

```js
const response = await fetch('https://fonts.example.com/display.woff2');
const face = new FontFace('Display', await response.arrayBuffer());
DesktopEngine.fonts.add(face);
await face.loaded;
```

TrueType (`.ttf`), OpenType (`.otf`), WOFF and WOFF2 files load, and collections (`.ttc`, their first font), up to 64 MB each.

## Loading

A face made from a `src` list is `"unloaded"` until `load()`, which starts loading it and returns `face.loaded`: a promise of the face once its status is `"loaded"`. A face made from bytes starts loading by itself (after the current task: its status is `"loading"` until then). `face.loaded` rejects with a `DOMException`:

- `"SyntaxError"`: the family, a descriptor or the `src` list isn't valid (the face is `"error"` right away), or the bytes aren't a font.
- `"NetworkError"`: no source loaded, a file that isn't there or isn't a font, or an http(s) URL. The message says why, for the last source tried.

`DesktopEngine.fonts.load(font)` loads the faces of the set a CSS font picks, one for each of its families that has some, and `check(font)` tells whether they're loaded. Both take the `font` of a canvas, which must name families:

```js
await DesktopEngine.fonts.load('bold 24px Pixel');
DesktopEngine.fonts.check('bold 24px Pixel'); // true
DesktopEngine.fonts.check('24px Helvetica');  // true: no face of the set is picked, installed fonts are always there
```

A face draws once it's loaded and in `DesktopEngine.fonts`: until then the canvas draws with the next family of its `font` (or the font it had). Unlike browsers, naming the family in `font` doesn't start loading the face. A canvas whose `font` names the family draws with it as soon as it loads, without setting `font` again, so a clock can draw from the first frame and switch to its font when it's there. Remove a face with `DesktopEngine.fonts.delete(face)` (or `clear()`) to stop drawing with it.

The set works as `document.fonts` does on the web: `add`, `delete`, `clear`, `has`, `size`, `forEach` and `for…of`; `status` is `"loading"` while some of its faces are; `ready` resolves when none is; the `loading`, `loadingdone` and `loadingerror` events (`FontFaceSetLoadEvent`, with the faces in `fontfaces`) tell when they start and finish.

## Faces of a family

Several faces can share a family, set apart by their `style` and `weight` descriptors. The canvas picks the face as CSS does: by style first (italic falls back to oblique, then to normal; normal to oblique, then to italic), then by the weight closest in CSS's order (for 400, the weights up to 500 first, then the lighter ones; for more than 500, the heavier ones first).

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

- A variable font takes a range of weights, `{ weight: '100 900' }`: its weight axis follows the weight asked for, within the range. With one weight (the default, 400), it's drawn at that weight.
- An upright face is slanted for italic text when the family has no italic face. A lighter face isn't made bold.
- Characters the font doesn't have are drawn with a system font.
- `stretch`, `unicodeRange`, `featureSettings`, `variationSettings`, `display` and the `ascentOverride`, `descentOverride` and `lineGapOverride` descriptors are kept on the face but not applied.

The descriptors can be changed after the face is made (`face.weight = '600'`); a value that isn't valid throws a `"SyntaxError"` DOMException.

## In the web preview

`desktopengine dev --web` and the store's preview run the same API on the browser's fonts: the sources load as in the app, with its checks, and each face that is loaded and in `DesktopEngine.fonts` goes to the browser's. Browsers make up bold for a lighter face, where the app doesn't.
