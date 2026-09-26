# The `desktopengine dev` Protocol

How `desktopengine dev` (`src/dev.ts` in the SDK) and the DesktopEngine app talk to each other. You only need it to build development tools of your own (an editor extension, say); using `desktopengine dev` doesn't.

## Why the app connects to the command

The app runs in the App Sandbox: it can only read files the user picked in an open panel, not the project path given to the command, but it has the `network.client` entitlement. So the command serves on the loopback address, and the app connects to it as a client, downloads the package into its own container and runs it there. The app needs no extra entitlement and listens on no port.

## Connecting

1. The command listens on a port of `127.0.0.1` (random by default) and makes a random one-time `token` (48 hexadecimal characters).
2. The command runs `open -g "desktopengine://develop/connect?port=<port>&token=<token>"`.
3. The app (which registers the `desktopengine` scheme in `CFBundleURLTypes` of its `Info.plist`) gets the URL:
   - if the Develop menu is off, it asks whether to turn it on;
   - otherwise it asks whether to allow the connection, with a "Don't ask again" checkbox.
4. The app connects to `ws://127.0.0.1:<port>/session?token=<token>`. An older connection on the same port is closed first.

The command only accepts HTTP requests and WebSocket connections with the right `token`; the app only downloads packages from the same port of `127.0.0.1` or `localhost`.

## Messages

All messages on the WebSocket are UTF-8 JSON text messages, told apart by `type`.

### Command → app

| type | Fields | Description |
| --- | --- | --- |
| `load` | `revision`, `url`, `launch` | Download `url` (`/package.zip?token=…`) and run it in place of the version running. `revision` counts up from 1; the app drops downloads and launches that are out of date |
| `stop` | | Stop the mini program, keeping the connection |
| `metrics` | `enabled` | When `true`, the app sends a `metrics` message about every second while the mini program runs; `false` stops them. It holds for versions loaded later too. `dev --perf` sends it after `hello` and before `load` |

`launch` holds what the details pane offers for installed content; every field can be left out:

| Field | Value |
| --- | --- |
| `size` | `small`, `medium` or `large`, for widgets only; the first of `widget.sizes` when it isn't one of them |
| `level` | `desktop` (on the desktop) or `floating` (above all windows); `floating` for desktop pets by default, `desktop` for the rest |
| `display` | The number of the display, starting at 1; the main display by default |
| `parameters` | `{ key: value }`; options not given take the manifest's `default` |
| `position` | `{ x, y }`; by default where the user dragged it, then the top right of the display |

The app works out `DesktopEngine.launchOptions` the same way as for installed content.

### App → command

| type | Fields | Description |
| --- | --- | --- |
| `hello` | `app`, `apiVersion` | The first message after connecting: the app's version and `DesktopEngine.apiVersion`. The command then sends `load` |
| `loaded` | `revision`, `id`, `name`, `version`, `contentType`, `launchOptions` | It's running |
| `load-failed` | `revision`, `message` | Downloading, unpacking, checking the manifest or running `index.js` failed |
| `console` | `level`, `message` | `console.log/info/warn/error/debug`, the arguments formatted and joined with spaces |
| `exception` | `message`, `stack` | An uncaught exception; `stack` may be missing |
| `host` | `message` | The mini program called `postMessage('host', message)`; `move` is remembered, `close` stops the mini program |
| `stopped` | | The mini program stopped (on `stop`, or because it sent `close`) |
| `metrics` | `state`, `fps`, `targetFps`, `frameTime`, `maxFrameTime`, `slowFrames`, `cpu`, `wakeUps`, `jsMemory`, `canvasMemory` | Performance over about a second, see below |

The fields of `metrics`:

| Field | Description |
| --- | --- |
| `state` | `running`; `rendering-paused` (no window can be seen, only drawing stops); `suspended` (fully paused, timers at most once a second) |
| `fps` | Frames per second that actually drew something new |
| `targetFps` | The target frame rate: the app's limit, or the refresh rate when that isn't a multiple of it |
| `frameTime`, `maxFrameTime` | Milliseconds, the average and longest time from the display's refresh to the frame being done, waiting for the mini program's thread to be free included |
| `slowFrames` | Frames longer than a frame's time (`1000 / targetFps` milliseconds) |
| `cpu` | The CPU usage of the mini program's thread, 100 is one core; without audio and video decoding or the GPU |
| `wakeUps` | How many times a second the mini program's thread wakes up |
| `jsMemory` | Bytes, the JavaScript heap's capacity plus the memory objects hold outside it (`ArrayBuffer`s and so on). It comes from a private interface of JavaScriptCore, so the Mac App Store version of the app doesn't measure it and leaves it out; measured about every 5 seconds, this is the latest value |
| `canvasMemory` | Bytes, the video memory of the canvases: drawing buffers (multisampling, depth and stencil included), the textures, buffers and renderbuffers WebGL content creates, and images drawn, added up by size and format, plus the IOSurfaces they're shown with. Measured about every 5 seconds |

Numbers have one decimal place, except `slowFrames`, `targetFps` and the two memory fields.

## Disconnecting

- When the command quits (Ctrl-C), it sends `stop` and then closes the connection; when the connection drops, the app stops the mini program and deletes the files it downloaded too.
- After the app quits or disconnects, the command opens the connection URL again after its next successful build.
- Develop › Connected to desktopengine dev in the app lists the connections, which can be closed one by one; Stop All Mini Programs closes all of them.
