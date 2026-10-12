# Other Apps' Windows

`DesktopEngine.windows` tells where other apps' windows are and which is in front, e.g. for a companion that walks on their title bars, jumps down when one is minimized and falls when one is dragged away. It needs the [`window-positions` permission](/reference/manifest#permissions) in the manifest and `"apiVersion": 6`:

```json
"apiVersion": 6,
"permissions": ["window-positions"]
```

```js
const windows = DesktopEngine.windows; // null without the permission

let list = windows ? windows.list() : [];
if (windows) windows.onchange = () => { list = windows.list(); };
```

`list()` gives the windows front to back, the first one in front of all the others:

```js
[
  { id: 4182, frame: { x: 120, y: 64, width: 900, height: 640 }, isActiveApp: true, isFullScreen: false, isFloating: false },
  { id: 391, frame: { x: 0, y: 33, width: 1728, height: 1084 }, isActiveApp: false, isFullScreen: false, isFloating: false },
]
```

| Field | |
| --- | --- |
| `id` | The same while the window exists, when it moves or comes to the front too; not across launches |
| `frame` | Where it is, in global points like `DesktopEngine.Window` and `Screen`: the origin is the top-left of the main display and y points down. The title bar is at the top of the frame |
| `isActiveApp` | It belongs to the app the user is using (the frontmost one), e.g. to prefer the window that has their attention |
| `isFullScreen` | It fills its display in a full screen Space |
| `isFloating` | It floats above normal windows: a panel, picture in picture, a window its app keeps on top. Floating windows come first in the list |

- Only the windows of the Spaces shown now, on every display, at least 40 points each way. Never your own windows (nor any of DesktopEngine's), the menu bar, the Dock or the desktop's icons. Minimized and hidden windows aren't listed, and a closing window leaves the list half way through its fade-out.
- Never what a window shows, its title or its app: the user allowed positions, nothing more.
- `change` comes when a window moves, resizes, opens, closes, is minimized or comes to the front, when another app becomes the active one and when another Space is shown. It has no payload: call `list()`. Changes that come faster than the content takes them are merged into one.
- While Mission Control is open the windows are shown scaled down: the list stays as it was until it closes.
- A window's animation (minimizing, going full screen) moves its frame through the animation, so a companion standing on it is carried along before it falls.
- Without the permission (not declared, or the user denied it) `DesktopEngine.windows` is `null`: plan for a companion that stays on the bottom of the screen. Check `DesktopEngine.apiVersion >= 6` too if the package also runs in apps with an older API.

## Pace and energy

The app watches the windows only while the content listens to `change`, about 10 times a second, and up to 60 times a second while the mouse button is down on a window (the user may be dragging or resizing it; then only that window is read again). While every content that listens is paused (its windows can't be seen, Pause All Content, the displays sleep), they're checked only once a second. Remove the listener (`windows.onchange = null`, `removeEventListener`, `destroy()`) when you don't need it; `list()` without a listener reads the windows once, when you call it.

Listen only while you need to keep up. A companion on the ground doesn't: it can call `visibleTopEdges()` when it decides whether to jump up, and when it's let go after a drag. It listens while it stands on a window or jumps onto one, to ride along and to fall when the window goes, and stops once it's back on the ground. While nothing listens, dragging windows around costs nothing at all. Reading without a listener asks the system each time, so read when you decide something, not every frame.

Don't redraw on every `change` by itself: keep the list and use it in your own animation, so a companion standing still on a window that doesn't move costs nothing.

## Standing on title bars

Your windows are above all others, so a companion standing on a title bar that a window in front covers would look like it stands on the front window. `visibleTopEdges()` gives only the parts of the top edges that nothing in front covers, front to back:

```js
const edges = windows.visibleTopEdges();
// [{ id: 4182, x: 120, y: 64, width: 900 }, { id: 391, x: 1020, y: 33, width: 708 }]
```

A window that a window in front cuts in two has two parts; full screen windows have none (their top is the display's). Then, each step of the animation:

- Standing on a window: find its part again by `id`, the one under the companion. When the window moved, move with it; when there's no such part any more (closed, minimized, covered, or the companion walked past its end), start falling.
- Falling: land on the highest part between where the feet were and where they are now, or on the bottom of the display's `visibleFrame`.

## On the web

The browser can't see the Mac's windows. `desktopengine dev --web` puts a pretend app window on the page for content with the permission: drag it by its title bar, resize it from its bottom right corner, close it with its red dot, and open more with New Window in the menu bar. Pressing the desktop makes no window the active app's. In the store's previews there are none: `list()` is empty.
