# Windows

Content draws in native windows made with `new DesktopEngine.Window({ type })`.

| type | For |
| --- | --- |
| `desktop` | Wallpapers: the desktop level, below the desktop icons, on all Spaces, and it gets mouse moves |
| `widget` | Widgets on the desktop: above the desktop icons, borderless with a clear background, can be dragged |
| `overlay` | Above all windows: borderless with a clear background, on all Spaces and over full screen apps; for floating widgets and desktop companions |

Showing a window doesn't activate DesktopEngine, so it doesn't take the focus from the user's current app. The user can't resize windows: a widget has the size picked for it.

Content makes one type of window, decided by its type and where the user put it, and the runtime enforces it: `desktop` for wallpapers, `overlay` for desktop companions, and for widgets `widget` on the desktop or `overlay` above all windows. Pass `launchOptions.windowType`; any other type, or none, makes `new DesktopEngine.Window()` throw. Content from `desktopengine dev` and the Develop menu is held to the same rules, so you find out before you ship; without launch options (the Develop menu) a widget makes `widget` windows and a companion `overlay` ones.

Windows are transparent and their styles have no corner radius: to round the corners, draw a rounded rectangle on a canvas (see the widget template). A window stays until you call `destroy()`.

Content can have at most 16 windows at once; after that `new DesktopEngine.Window()` throws, so `destroy()` the ones it no longer needs. `widget` and `overlay` windows stay below the menu bar and cover at most half of a display: a window placed higher is moved down, a bigger one is shrunk (its content is clipped). A desktop companion that roams the whole screen moves a small window along with it.

## Mouse

- Pressing anywhere in a `widget` or `overlay` window drags it (the system's own window dragging): a drag gets `mousedown`, the window's `move`, and `mouseup` on release, with no `mousemove` during the drag; a click only gets `click`, no `mousedown` / `mouseup`.
- The window's `dragRegion` limits where a press drags the window; elsewhere presses and drags go to the components (`mousedown`, `mousemove` while the button is down, `mouseup`), for controls such as dials and sliders. `null` (the default) is the whole window, `[]` nowhere.
- A window dropped on a screen edge keeps its size and stays where it was dropped, though macOS still shows where it would tile it.
- The window's `hitRegion` (an array of rectangles in points from the window's top left corner) limits the mouse to those parts: clicks, drags and hovers elsewhere pass through to the windows below. `null` (the default) is the whole window. Transparent parts of a window still catch the mouse by default, so an irregularly shaped companion should update it as it draws (see the companion template).
- `mouseenter`, `mousemove` and `mouseleave` fire even when the window isn't the key window.
- Event callbacks get plain objects, and `this` is the object that fired the event; the double click event is named `dbclick`.

## Keyboard

Content doesn't get the keyboard: typing always goes to the app the user is in, and `keydown` / `keyup` never fire. Only the content that comes with DesktopEngine gets them. Design for the mouse, and use [options](/reference/manifest#options-parameters) for text the user enters.

## Displays and scale

- `launchOptions.display` is the display the content is on: `frame` is the whole screen, `visibleFrame` leaves out the menu bar and the Dock. It doesn't change after launch: `DesktopEngine.ScreenManager.screens` has each display's current `bounds` and `visibleFrame`, and `ScreenManager` fires `change` when they change, e.g. when the user resizes, moves or hides the Dock. A companion that walks along the bottom reads its display's `visibleFrame` again then.
- A window's `devicePixelRatio` is the scale of its display. When a widget or companion is dragged to a display with another scale (from a Retina screen to a 1x external display, say), or the user changes the display's resolution, it changes and the window fires `devicepixelratiochange`: set the canvas's `width` / `height` for the new value and redraw.
- Unlike in browsers, setting `width` / `height` here doesn't reset the 2D context's state: set the scale with `setTransform(ratio, 0, 0, ratio, 0, 0)` rather than adding another `scale()` (see the widget and companion templates).

See [`Window`](/api/interfaces/DesktopEngine.Window) for all its properties and events.
