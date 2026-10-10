# Wallpapers

A `wallpaper` is one kind of wallpaper (the Dynamic kind), in the same grid as image and video wallpapers: it can go into categories and playlists, change with its playlist, and be set on a display with Set Wallpaper in the details pane. A display shows one wallpaper at a time, so a dynamic wallpaper replaces the image or video, and the other way around. Its options (parameters) are shown in the wallpaper's details pane.

```bash
desktopengine create wallpaper ~/Projects/waves
```

`launchOptions.display` is the display to draw on: fill its `frame` with a window of `type: 'desktop'` (a wallpaper can also [span displays](#spanning-displays)). For a canvas that fills the screen use `getContext('2d', { alpha: false })`: opaque layers composite with less power.

A wallpaper draws every frame, and the app pauses it when a full screen app covers it, on battery and so on, see [Pausing](./performance#pausing). Slow scenery doesn't need every frame: `DesktopEngine.preferredFramesPerSecond = 30` halves the thread's wake-ups.

## Drawing with WebGL or a rendering library

2D or 3D, and what to draw with, is up to the wallpaper. The default `wallpaper` template draws with Canvas 2D; `--renderer` picks a template drawn another way:

```bash
desktopengine create wallpaper ~/Projects/cube --renderer webgl    # WebGL 2: a lit, slowly turning cube, no npm packages
desktopengine create wallpaper ~/Projects/knot --renderer three    # three.js: a lit, slowly turning 3D knot
desktopengine create wallpaper ~/Projects/lights --renderer pixi   # PixiJS: soft 2D lights floating in layers
cd ~/Projects/lights && npm install && desktopengine dev .
```

The three.js and PixiJS templates declare the library in `package.json`, so run `npm install` after creating them; the build bundles it into `index.js` (about 1.2 MB for three.js and 1.7 MB for PixiJS unminified, less with `--minify`). Like the WebGL template, they have color, mouse parallax and appearance options.

### three.js

Use three.js (WebGL 2 only since r163) through the project's `src/three/`: `import * as THREE from './three'`. It first provides the browser global `window` that three.js reads (a stand-in pointing to the global object; `THREE.AudioListener` creates its audio context with `new window.AudioContext()`). `THREE.Audio` and `PositionalAudio` need the `audio` permission (see [Audio](./audio)).

Drawing needs nothing else: pass `DesktopEngine.Canvas` as the `canvas` of `WebGLRenderer`, and `setSize(width, height, false)` only sizes its drawing buffer.

### PixiJS

Use PixiJS 8 through the project's `src/pixi/`: `import * as PIXI from './pixi'`, not `import 'pixi.js'` directly. It first provides the browser globals PixiJS reads when it loads (`navigator`, `document` and a few more; stand-ins, not a DOM), connects canvases, images and file loading to DesktopEngine (`DOMAdapter`), and doesn't load the extensions that need the DOM (accessibility, DOM containers).

- What needs the DOM, such as `HTMLText`, doesn't work: draw text with `Text` or `BitmapText`.
- Paths such as `Assets.load('assets/a.png')` start at the package root. Loading `https://` assets needs the `network` permission (see [Network](./network)).
- For interaction with `eventMode` / `on('pointerdown')`, call `PIXI.bindPointerEvents(app)` to give the canvas's mouse events to PixiJS; see [Windows](./windows) for the events desktop windows don't get.

## Spanning displays

With more than one display, users can run a wallpaper across them, all of them or the ones they choose, as one picture laid over the displays the way they're arranged in System Settings › Displays. A wallpaper that can do it says so in `manifest.json`:

```json
"wallpaper": { "span": true }
```

The details pane then offers Span. One instance runs for the displays it spans: `launchOptions.display` is absent, and `launchOptions.displays` lists them, the main display first when it's among them. Make a `desktop` window filling each one's `frame`, and lay the drawing out in the coordinates they share, so it continues from one display to the next. Draw on these, not on every display in `DesktopEngine.ScreenManager.screens`: the displays the user left out show wallpapers of their own.

```ts
const options = DesktopEngine.launchOptions;
// on one display, or across several
const displays = options.displays ?? (options.display ? [options.display] : []);
// the whole picture: the box around the displays
const left = Math.min(...displays.map((display) => display.frame.x));
const top = Math.min(...displays.map((display) => display.frame.y));

for (const display of displays) {
  const { x, y, width, height } = display.frame;
  const win = new DesktopEngine.Window({ type: 'desktop', style: { left: x, top: y, width, height } });
  // this display shows the part of the picture that starts at (x - left, y - top)
}
```

- Displays are placed by their points, as arranged. When they differ in height or are offset, parts of the box aren't on any display; displays of different pixel densities don't line up exactly, the app doesn't know their physical sizes.
- The layout is up to the wallpaper. Scenery that stands on the ground can put the bottom edge of each column of displays (the ones stacked above and below each other) on the ground, as the built-in Horizon does: a display arranged a little higher than the one beside it then still shows its foreground, at the cost of a step at the seam, and stacked displays continue the scene upward.
- Each window has its own `devicePixelRatio`: size each canvas by its own window's.
- It's one instance, so time, random values and state are shared by all the displays. Mouse events come to the window under the pointer, in its coordinates: add the window's `left` and `top` for the shared ones.
- All the windows draw in the same `requestAnimationFrame`, at the refresh rate of one display. A window covered by a full screen app gets `hide`: skip drawing it until `show`.
- The app pauses the wallpaper only when every display pauses wallpapers (a full screen app on each of them, for example), and mutes it when any display mutes them.
- When a display is connected, disconnected or arranged differently, the app restarts the wallpaper with the new `displays`. A display connected later joins when the wallpaper spans all of them; a display it spans comes back into it when it's connected again.
- `desktopengine dev --span` runs it across all displays while developing. As the screen saver it runs on each display on its own, with `display`.

## Screen saver

In a wallpaper's details pane, users can choose Use as Screen Saver to run it as the macOS screen saver (on the lock screen too), with the same options as the wallpaper; image and video wallpapers can too. `launchOptions.screenSaver` is then present, and the content can adapt:

- The screen saver is loaded by the system's `legacyScreenSaver` process, where JavaScriptCore has **no JIT**: plain JavaScript runs about ten times slower or more. Do as much of each frame as you can on the GPU (in shaders); the built-in Horizon and Nebula spend only 1–3 ms of JavaScript per frame.
- The window fills `launchOptions.display.frame` with `type: 'desktop'` as usual; the app embeds it in the screen saver, scaled to fill.
- There are no mouse or keyboard events: any input ends the screen saver.
- When `launchOptions.screenSaver.preview` is `true`, it's the small preview in System Settings › Screen Saver: `win.devicePixelRatio` is lowered to 0.25 and the frame rate is limited to 30. Content that sizes its canvas by `devicePixelRatio` gets cheaper by itself; turn off expensive effects.
- The network still needs the `network` permission.

The Mac App Store version of DesktopEngine has no screen saver.
