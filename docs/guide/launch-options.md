# Launch Options

When the app launches content, it provides the read-only `DesktopEngine.launchOptions` before `index.js` runs:

```js
const options = DesktopEngine.launchOptions || {};
options.windowType;   // 'widget' (on the desktop) or 'overlay' (above windows), for new DesktopEngine.Window({ type })
options.width;        // the widget's width in points, for the size picked
options.height;
options.position;     // { x, y }: where the user last dragged it, or the default position the app worked out
options.display;      // { id, name, frame, visibleFrame, scale }
options.displays;     // every display instead, when a wallpaper spans them, see Wallpapers
options.parameters;   // the values of the options
options.locale;       // the user's preferred language, e.g. 'en-US'
options.permissions;  // the permissions the user allowed, e.g. ['audio', 'network']; denied ones aren't there
options.screenSaver;  // { preview } when running as the screen saver, absent otherwise
```

Coordinates are the ones of `DesktopEngine.Window` styles: the origin at the top left of the main display, y pointing down. See [`LaunchOptions`](/api/interfaces/DesktopEngine.LaunchOptions) for all the fields.

- `parameters` are the values of the [options](/reference/manifest#options-parameters); the content restarts when the user changes them.
- See [Permissions](/reference/manifest#permissions) for `permissions`, [Spanning all displays](./wallpaper#spanning-all-displays) for `displays` and [Screen saver](./wallpaper#screen-saver) for `screenSaver`.
- While developing, `desktopengine dev --size / --level / --display / --span / --param / --position` stand in for them, see [Command Line](/reference/cli#dev).

## Talking to the app

```js
win.onmove = (payload) => postMessage('host', { type: 'move', x: payload.x, y: payload.y });
postMessage('host', { type: 'close' }); // removes itself from the desktop
```

The app remembers the position `move` reports and passes it back in `options.position` next time.

## Appearance

`DesktopEngine.system.appearance` is the system's current appearance, `'light'` or `'dark'`. `appearancechange` fires when the user switches it in System Settings (or Auto switches it by the time of day):

```js
const system = DesktopEngine.system;
let dark = system.appearance === 'dark';
system.onappearancechange = (event) => {
  dark = event.appearance === 'dark';
  draw();
};
```

An Appearance option should offer `auto` (following the system) as its default, see the widget and wallpaper templates. Wallpapers draw every frame anyway: read `appearance` each frame and fade to its colors, no event needed.
