# Mouse and Typing

A window's own events (`mousemove`, `click`…) come only while the pointer is over it. `DesktopEngine.input` follows the mouse anywhere on screen, over other apps too, e.g. for a companion whose eyes follow the pointer. It needs the [`mouse` permission](/reference/manifest#permissions) in the manifest and `"apiVersion": 3`:

```json
"apiVersion": 3,
"permissions": ["mouse"]
```

```js
const input = DesktopEngine.input;

input.onmousemove = ({ x, y }) => lookAt(x, y);
input.onmousedown = ({ x, y, button }) => blink(); // button: 0 primary, 1 middle, 2 secondary
input.onmouseup = () => {};
input.onwheel = ({ deltaX, deltaY }) => spin(deltaY);

// where the pointer is now, without waiting for it to move
const start = input.pointer; // { x, y }, null without the permission
```

Points are global, like `DesktopEngine.Window` and `Screen`: the origin is the top-left of the main display and y points down. Subtract a window's position to get a point in it.

- The events only watch: the pointer still goes to whatever is under it, and nothing is taken away from other apps.
- Moves and wheel turns that come faster than the content takes them are merged: the latest position, the sum of the deltas. Don't count events to measure distance, use the positions.
- The app watches the mouse only while the content listens to one of these events. Remove the listeners (`input.onmousemove = null`, `removeEventListener`, `destroy()`) when you no longer need them.
- Without the permission (not declared, or the user denied it) `pointer` is `null` and the events never come: plan for a companion that doesn't follow the pointer.
- Check `DesktopEngine.apiVersion >= 3` before using `DesktopEngine.input` if the package also runs in apps with an older API.

## Typing

`keyactivity` tells how many keys were pressed in any app, never which ones, on a 100 ms grid. It needs the `key-activity` permission, which only content that comes with DesktopEngine gets, and the user allowing DesktopEngine Input Monitoring in System Settings › Privacy & Security. Other content can declare it, the app lists it, but it never gets it: `keyactivity` never fires and `keyActivityAvailable` is `false`. Even the number of presses and when they come tell something about what's typed, so it isn't a permission users can give to any content.

```js
input.onkeyactivity = ({ count }) => tapPaws(count);
```

## On the web

In `desktopengine dev --web` and the store's previews, the mouse events come while the pointer is over the desktop on the page, over the page's own windows on top of it too. `keyactivity` is off unless the content declares `key-activity` and the page that shows the desktop turns it on for it.
