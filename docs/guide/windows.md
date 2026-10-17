# Windows

Content draws in native windows made with `new DesktopEngine.Window({ type })`.

| type | For |
| --- | --- |
| `desktop` | Wallpapers: the desktop level, below the desktop icons, on all Spaces, and it gets mouse moves |
| `widget` | Widgets on the desktop: above the desktop icons, borderless with a clear background, can be dragged |
| `overlay` | Above all windows: borderless with a clear background, on all Spaces and over full screen apps; for floating widgets and desktop companions |

Showing a window doesn't activate DesktopEngine, so it doesn't take the focus from the user's current app. The user can't resize windows, but a widget's when its manifest lets them: see [Widget size](#widget-size).

Content makes one type of window, decided by its type and where the user put it, and the runtime enforces it: `desktop` for wallpapers, `overlay` for desktop companions, and for widgets `widget` on the desktop or `overlay` above all windows. Pass `launchOptions.windowType`; any other type, or none, makes `new DesktopEngine.Window()` throw. Content from `desktopengine dev` and the Develop menu is held to the same rules, so you find out before you ship; without launch options (the Develop menu) a widget makes `widget` windows and a companion `overlay` ones.

Windows are transparent and their styles have no corner radius: to round the corners, draw a rounded rectangle on a canvas (see the widget template). A window stays until you call `destroy()`.

Content can have at most 16 windows at once; after that `new DesktopEngine.Window()` throws, so `destroy()` the ones it no longer needs. `widget` and `overlay` windows stay below the menu bar and cover at most half of a display: a window placed higher is moved down, a bigger one is shrunk (its content is clipped). A widget's own window follows the rules of [Widget size](#widget-size) instead. A desktop companion that roams the whole screen moves a small window along with it.

## Widget size

With `"apiVersion": 8` or later in its manifest, a widget's window is the first `widget` or `overlay` window without a parent that it shows, until that's closed. It has the size the user picked, `launchOptions.width` × `launchOptions.height`, so make it that size:

- Unless `widget.resize` lets the content resize it (see [Widget sizes](/reference/manifest#widget-sizes)), it keeps that size whatever its style says.
- It stays inside the visible frame of its display, below the menu bar and clear of the Dock. With a `hitRegion`, only the part that takes the mouse (the bounds of its rectangles) has to stay inside on the left, the right and the bottom, so a transparent margin round the widget, e.g. for its shadow, may be off the screen or over the Dock and the widget can be put right against the edge; the top of the window still stays below the menu bar, so leave little room above what you draw. While the user drags the widget it follows the pointer anywhere (only the menu bar stops it); once they let go, it slides back inside in a quarter of a second, onto the display under the pointer, firing `move` as it goes. A widget bigger than that is scaled down in its shape, or, when `widget.resize` lets it change shape (no `"aspectRatio": "fixed"`), each edge is kept to the display on its own, then to the smallest size it may have; `launchOptions.width` and `height` already are. There's no other limit on its size.
- When it gets another frame than its style asked for, its style takes that frame and it fires `resize` (read its `width` and `height`) or `move`.
- Being kept on the display is only for as long as it doesn't fit: a widget that grows against the edge of the screen (or up into the menu bar) is pushed in, and once it's small enough again it goes back to its place, the corner you keep where it is staying put. Its place changes only when the user drags it or your content moves it (sets `left` / `top` at the size it has); setting a new size from where it was pushed, e.g. to keep a corner where it is, isn't a move. Its display changes the same way: when the user drops it on another display, or your content moves it there (with or without a new size). A widget that only changes its size stays on its display, even when keeping a corner where it is would reach onto the display next to it. The display it's on is the one where it takes the mouse (its `hitRegion`), not where its transparent margins reach.

With `"by": ["user"]` the user resizes the widget by its edges and corners like an ordinary window, and once the pointer has rested on the widget a moment, a short stroke of glass appears just outside its bottom right corner, following the corner's curve as your widget draws it, to show that it can be resized (it stays while the pointer is on the widget, at that corner or on the stroke); a press anywhere else still drags it, and a click still only clicks. The window fires `resize` while they drag, at most once a frame: lay out and draw again in the new size. With `"by": ["content"]` the content sets its window's `width` and `height` (and `left` and `top` to move it) itself, e.g. a list that grows; the window keeps to the range, and fires `resize` only when it gets another size than asked. Whoever resized it, the app remembers the widget's size and place and starts it there next time. The previews in the app's details pane run it in the size picked.

A widget made for an earlier API keeps the rules it was made with: its windows follow the rules for all `widget` and `overlay` windows above.

## Mouse

- Pressing anywhere in a `widget` or `overlay` window drags it (the system's own window dragging): a drag gets `mousedown`, the window's `move`, and `mouseup` on release, with no `mousemove` during the drag; a click only gets `click`, no `mousedown` / `mouseup`.
- The window's `dragRegion` limits where a press drags the window; elsewhere presses and drags go to the components (`mousedown`, `mousemove` while the button is down, `mouseup`), for controls such as dials and sliders. `null` (the default) is the whole window, `[]` nowhere.
- A window dropped on a screen edge keeps its size and stays where it was dropped, though macOS still shows where it would tile it.
- The window's `hitRegion` (an array of rectangles in points from the window's top left corner) limits the mouse to those parts: clicks, drags and hovers elsewhere pass through to the windows below. `null` (the default) is the whole window. Transparent parts of a window still catch the mouse by default, so an irregularly shaped companion should update it as it draws (see the companion template).
- `mouseenter`, `mousemove` and `mouseleave` fire even when the window isn't the key window.
- A `widget` or `overlay` window gets `wheel` (API 8) while the pointer is over the part of it that takes the mouse (its `hitRegion`, the whole window without one), without taking the focus from the app the user is in: on the component under the pointer and the ones around it, up to the window. The deltas are the system's, about lines: `deltaY` is positive when the user scrolls toward the top (with natural scrolling, fingers moving down the trackpad, so content that follows `deltaY` moves with the fingers); a trackpad sends many small ones, and keeps sending them for a moment after the fingers lift. Before API 8 the wheel reached only a key window, which windows on the desktop never are.
- Event callbacks get plain objects, and `this` is the object that fired the event. The mouse events, `click` and `dblclick` have the fields of the DOM's `MouseEvent` of the same name: `x` and `y` in the component, the modifier keys, `button` (the one that went down or up) and `buttons` (the ones held). Every button gives `mousedown` and `mouseup`; only the primary one clicks and drags the window.

## Keyboard

Content doesn't get the keyboard: typing always goes to the app the user is in. Design for the mouse, and use [options](/reference/manifest#options-parameters) for text the user enters.

## Displays and scale

- `launchOptions.display` is the display the content is on: `frame` is the whole screen, `visibleFrame` leaves out the menu bar and the Dock. It doesn't change after launch: `DesktopEngine.ScreenManager.screens` has each display's current `bounds` and `visibleFrame`, and `ScreenManager` fires `change` when they change, e.g. when the user resizes, moves or hides the Dock. A companion that walks along the bottom reads its display's `visibleFrame` again then.
- A window's `devicePixelRatio` is the scale of its display. When a widget or companion is dragged to a display with another scale (from a Retina screen to a 1x external display, say), or the user changes the display's resolution, it changes and the window fires `devicepixelratiochange`: set the canvas's `width` / `height` for the new value and redraw.
- Unlike in browsers, setting `width` / `height` here doesn't reset the 2D context's state: set the scale with `setTransform(ratio, 0, 0, ratio, 0, 0)` rather than adding another `scale()` (see the widget and companion templates).

See [`Window`](/api/interfaces/DesktopEngine.Window) for all its properties and events.
