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
  { id: 391, frame: { x: 0, y: 120, width: 1728, height: 997 }, isActiveApp: false, isFullScreen: false, isFloating: false },
]
```

| Field | |
| --- | --- |
| `id` | The same while the window exists, also when it moves or comes to the front; a window that's closed and opened again, or whose app is relaunched, gets a new one |
| `frame` | Where it is, in global points like `DesktopEngine.Window` and `Screen`: the origin is the top-left of the main display and y points down. The title bar is at the top of the frame |
| `isActiveApp` | It belongs to the app the user is using (the frontmost one), e.g. to prefer the window that has their attention |
| `isFullScreen` | It fills its display in a full screen Space, alone or beside another window in Split View |
| `isFloating` | It floats above normal windows: a panel, picture in picture, a window its app keeps on top. Floating windows come first in the list |

- Only the windows of the Spaces shown now, on every display, at least 40 points each way. Never your own windows (nor any of DesktopEngine's), the menu bar, the Dock or the desktop's icons. Minimized and hidden windows aren't listed, and a closing window leaves the list once it's half faded, about a tenth of a second after it closes.
- Never what a window shows, its title or its app: the user allowed positions, nothing more.
- `change` comes when a window moves, resizes, opens, closes, is minimized or comes to the front, when another app becomes the active one and when another Space is shown. It has no payload: call `list()`. Changes that come faster than the content takes them are merged into one. It comes only when the windows changed: adding a listener (or removing it and adding it again) doesn't fire it.
- While Mission Control is open the windows are shown scaled down: until it closes, `list()` and `visibleTopEdges()` give the list from before it opened, whether you listen to `change` or not. When the system can't tell where the windows are for a moment, they keep the last list too.
- A window's animation (minimizing, going full screen) moves its frame through the animation, so a companion standing on it is carried along before it falls.
- Without the permission (not declared, or the user denied it) `DesktopEngine.windows` is `null`, and in apps with an API older than 6 it's `undefined`: plan for a companion that stays on the bottom of the screen. It's `null` in the app's previews in the details pane too (`launchOptions.permissions` doesn't list `window-positions` there).

## Pace and energy

The app watches the windows only while the content listens to `change`, about 10 times a second, and up to 60 times a second while the mouse button is down on a window (the user may be dragging or resizing it; then only the windows at the pointer are read again). While all the content that listens has stopped drawing or is paused (its windows can't be seen, Pause All Content, the displays sleep, see [Performance and Pausing](./performance)), the app checks them only once a second. Remove the listener (`windows.onchange = null`, `removeEventListener`, `destroy()`) when you don't need it. Without a listener, `list()` and `visibleTopEdges()` read the windows when you call them, and give the same list until your code returns.

Listen only while you need to keep up. A companion on the ground doesn't: it can call `visibleTopEdges()` when it decides whether to jump up, and when it's let go after a drag. It listens while it stands on a window or jumps onto one, to ride along and to fall when the window goes, and stops once it's back on the ground. While nothing listens, dragging windows around costs nothing at all. Reading without a listener asks the system each time, so read when you decide something, not every frame.

Don't redraw on every `change` by itself: keep the list and use it in your own animation, so a companion standing still on a window that doesn't move costs nothing.

## Standing on title bars

A companion is above all windows, so one standing on a title bar that a window in front covers would look like it stands on the front window. `visibleTopEdges()` gives only the parts of the top edges that nothing in front covers, front to back:

```js
const edges = windows.visibleTopEdges();
// [{ id: 4182, x: 120, y: 64, width: 900 }, { id: 391, x: 0, y: 120, width: 120 }, { id: 391, x: 1020, y: 120, width: 708 }]
```

A window that a window in front cuts in two has two parts, like 391 here; full screen windows, Split View ones too, have none (their top is the display's). Then, each step of the animation:

- Standing on a window: find its part again by `id`, the one under the companion. When the window moved, move with it; when there's no such part any more (closed, minimized, covered, or the companion walked past its end), start falling.
- Falling: land on the highest part between where the feet were and where they are now, or on the bottom of the display's `visibleFrame`.

## On the web

The browser can't see the Mac's windows. `desktopengine dev --web` puts a pretend app window on the page for content with the permission: drag it by its title bar, resize it from its bottom right corner, close it with its red dot, and open more with New Window in the menu bar. Pressing a pretend window brings it to the front and makes it the active app's window (`isActiveApp` is true); pressing the desktop, or a widget on the desktop, makes none of them active; pressing a widget or companion above all windows leaves the active one as it is. In the store's previews there are none: `list()` is empty.
