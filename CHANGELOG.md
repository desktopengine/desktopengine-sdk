# Changelog

Changes to `@desktopengine/sdk` that matter to its users. Versions follow [semantic versioning](https://semver.org).

## 6.0.3 (2026-10-31)

### Bug Fixes

- The web runtime no longer clicks a widget or companion after it is dragged

## 6.0.2 (2026-10-31)

### Bug Fixes

- In Safari the web runtime gives the wheel to widgets and companions without the audio permission

## 6.0.1 (2026-10-31)

### Bug Fixes

- The web runtime fires click and then dblclick for the second click of a double click, as the app does

## 6.0.0 (2026-10-27)

API version 9 (was 8): packages with `"apiVersion": 9` need an app that has it.

### Breaking Changes

- A looping Video goes on from the start without a pause and doesn't fire ended, as a looping video element does
- DesktopEngine.audioSettings tells content the mute and volume the user set for it (API 9); in the app, content that plays sound starts muted until the user turns its sound on

### Features

- API 9, FontFace and DesktopEngine.fonts give 2D canvases fonts of the content's own
- A Video is a source for WebGL textures and 2D canvases as a video element is, with videoWidth, videoHeight, readyState and their events (API 9)
- manifest.json can say which tool made a package from something else and from what, in "converter"
- "audio": { "volume": 0...1 } in manifest.json is where the user's volume for the content starts (API 9)

### Bug Fixes

- The web runtime's WebAssembly has no instantiateStreaming or compileStreaming, as in the app

## 5.0.0 (2026-10-18)

API version 8 (was 7): packages with `"apiVersion": 8` need an app that has it.

### Breaking Changes

- widget sizes of their own and widget.resize (API 8): users and content resize widgets, no half-display cap for a widget's window
- remove DesktopEngine.system.cpuUsage() and memoryUsage(); DesktopEngine.systemStatus reads the processor and memory

### Features

- check that wallpaper.screenSaver is true or false
- API 8, an option can be shown only for some values of another with showWhen
- DesktopEngine.systemStatus, the Mac's processor, memory, network, power, temperature and disk, in the types and the web runtime (API 8)
- widgets and companions get wheel events while the pointer is over their clickable area (API 8)

### Bug Fixes

- a widget that resizes itself in the web runtime stays on its display
- a widget in the web runtime moves to another display when it moves itself there with a new size, and its display is where it takes the mouse

## 4.3.0 (2026-10-16)

API version 7 (was 6): packages with `"apiVersion": 7` need an app that has it.

### Features

- add DesktopEngine.syncStorage (API 7)

## 4.2.0 (2026-10-14)

API version 6 (was 5): packages with `"apiVersion": 6` need an app that has it.

### Features

- BroadcastChannel to other running content, with the scopes package and namespace (API 6)
- DesktopEngine.systemAudio and the system-audio permission (API 6): how loud what the Mac plays is, in bands from low to high; a made-up signal in the web preview, or an audio file chosen in dev --web
- DesktopEngine.windows tells content with the window-positions permission where other apps' windows are, with list(), visibleTopEdges() and change (API 6)

### Bug Fixes

- The Permission type of launchOptions includes system-audio
- The web runtime's Video takes options that aren't an object as none instead of throwing, and components read each option once and take src only as a string
- The web runtime's Video takes a src only as a non-empty string, as in the app, and keeps its playback rate when the src changes
- The web runtime's Image takes a src only as a non-empty string, as in the app, and size and position only as strings
- A Window in the web runtime no longer takes one of the 16 window slots when making it throws, style values whose reading or conversion throws are left out instead of throwing, and a window type such as "toString" makes a normal window
- The web runtime's Image keeps its picture until a new src has loaded, calls back only for the last src set and doesn't load data: URLs, as in the app
- The web preview copies, posts and times like the app: structuredClone, MessageChannel and BroadcastChannel follow the app's rules, timers aren't clamped by the browser and slow down in a hidden page, and system audio and other apps' windows match
- The guides, types and manifest schema cover only what your content can use, without key-activity, keyboard events or the screen saver, and describe the API 6 features as the app runs them
- The web preview finds content's globals, calls its listeners and handles the page's messages even after the content replaces builtins like Set.prototype.has, Array.prototype.filter or the Array iterator
- The web preview converts component styles as the app does: only strings and numbers, nothing thrown, a whole style read before it replaces the old one
- The web preview's Audio plays the package's files and http(s) URLs and, as in the app, no data: or blob: URLs, and a Video doesn't play a data: URL
- In the web preview, content's global object inherits Object.prototype as in the app (globalThis.toString, hasOwnProperty, constructor), and `delete name` removes a global the content created
- The PixiJS wallpaper template no longer throws when the mouse is pressed over the desktop
- The web preview reads getContext's alpha and antialias as the app does: a value other than undefined counts as true or false, so { alpha: null } is opaque and { antialias: 1 } antialiases

## 4.1.1 (2026-10-12)

### Bug Fixes

- a WebSocket to ws:// in the web runtime says why in its error event's message and closes without a reason, as in the app

## 4.1.0 (2026-10-12)

API version 5 (was 4): packages with `"apiVersion": 5` need an app that has it.

### Features

- dev --web passes WebSockets to the domains of network.domains through its proxy, as the store's preview does, and the SDK exports proxyPreviewWebSocket for other servers
- dev --web sends every request method through its proxy, with the request's headers and body, as the app does; the store's preview and its review still send GET and HEAD only
- ellipse() and roundRect() for 2D canvases, API 5
- getTransform() and setTransform() taking a matrix for 2D canvases, API 5
- structuredClone, MessageChannel, FileReader, CustomEvent and navigator, API 5
- createConicGradient, letterSpacing, wordSpacing, the blend modes and the rest of TextMetrics for 2D canvases, API 5
- Path2D, with SVG path data, and isPointInPath and isPointInStroke for 2D canvases, API 5
- createImageBitmap and new ImageData(), API 5

### Bug Fixes

- The web runtime's canvases offer only what the app's do: browser-only 2D members such as ellipse and roundRect are undefined, other compositing modes, colors and fonts are ignored, and WebGL lists only the app's extensions
- In the web runtime, new WebSocket() throws a SecurityError as in the app when the network permission or network.domains doesn't allow the address, and http and ws addresses fail as the app's App Transport Security makes them
- The preview proxy counts every spelling of the IPv6 loopback and unspecified addresses as the local network, not only ::1 and ::
- **canvas:** mediumpurple and palevioletred are CSS's colors in 2D canvases, in the app and the web runtime
- **canvas:** copy, source-in, source-out, destination-in and destination-atop clear the 2D canvas outside what's drawn, as on the web, so masking with destination-in works
- **canvas:** restore() brings back the whole clip of the 2D state it returns to, so a clip made before an earlier save() isn't lost
- **canvas:** lighten and darken blend 2D drawing as on the web, translucent colors included; darker is another name for darken
- **canvas:** 2D gradients match the web: stops mix without premultiplying, more than five stops work, stops at one offset make a hard edge, and radial gradients with a start radius are right
- **canvas:** arc() with equal start and end angles draws nothing and angles 2π or more apart draw the whole circle, as on the web; a negative radius throws IndexSizeError in arc() and arcTo()
- dev --web warns about request headers that the store's preview and review refuse, and its proxy passes back no cross-origin policies
- dev --web's WebSocket proxy passes an abnormal closure on as one, and a close without a code as 1005
- after a 2D canvas resizes, restore() in the web runtime brings back the saved states, as in the app
- fillStyle and strokeStyle in the web runtime keep giving back the gradient or pattern they were set to when nothing else refers to it
- navigator.language and languages are written as browsers write them in the web preview too, and the declarations say where the text baselines are
- the web runtime takes letterSpacing and wordSpacing of "0" without a unit, and rejects ImageBitmaps larger than the app makes
- the web runtime's createImageBitmap crops, resizes and flips as the app does, in WebKit too

## 4.0.0 (2026-10-11)

API version 4 (was 3): packages with `"apiVersion": 4` need an app that has it.

### Breaking Changes

- The files, now-playing and window-positions permissions are removed and an unknown permission is an error; system-info is documented as CPU and memory only
- API 4 follows the web: the double click event is dblclick, click gets the mouse events' { x, y, … }, every mouse button has mousedown and mouseup with button and buttons, and wxBindCanvasTexture, blBindCanvasTexture, mixin and promisify are gone

### Features

- Image's size can be "fill", which stretches the image, or "none", which shows it at its own size, and Video's objectFit can be "none", API 4
- queueMicrotask, atob, btoa and crypto (getRandomValues, randomUUID) are globals, and a Video has currentTime, duration and paused

## 3.0.1 (2026-10-11)

### Bug Fixes

- When the web runtime's page is resized, a widget or companion keeps its place in the free area, so one at the right edge or above the Dock stays there

## 3.0.0 (2026-10-11)

### Breaking Changes

- Content makes only the window type of launchOptions.windowType; panel and normal are gone from the types

## 2.7.0 (2026-10-11)

### Features

- **content:** A widget or companion is on the desktop once; adding it again shows the one that's there
- **content:** A preview for dark mode: previewDark in the manifest is shown instead of preview when the system is dark

## 2.6.1 (2026-10-09)

### Bug Fixes

- publish no longer has --category, as the store has no categories (tags say what an item is); an older script passing it still works

## 2.6.0 (2026-10-08)

### Features

- login and publish tell the store the SDK's version and API version in X-Client-* headers

## 2.5.1 (2026-10-08)

### Bug Fixes

- A Video plays only while it's in a window: out of one it pauses and lets go of its file, and continues where it was when it's back; the web preview does the same

## 2.5.0 (2026-10-07)

### Features

- publish takes release notes in other languages with --notes-<locale>, e.g. --notes-zh-Hans; the store shows them in the visitor's language

## 2.4.1 (2026-10-07)

### Bug Fixes

- On the web, DesktopEngine.input follows the pointer over the whole desktop, also over the page's own windows on top of it, as in the app

## 2.4.0 (2026-10-07)

API version 3 (was 2): packages with `"apiVersion": 3` need an app that has it.

### Features

- DesktopEngine.input follows the mouse anywhere on screen with the "mouse" permission and tells content that comes with the app how many keys are pressed ("key-activity"), API 3

## 2.3.0 (2026-10-07)

API version 2 (was 1): packages with `"apiVersion": 2` need an app that has it.

### Features

- desktop pets are now desktop companions: the type is companion (API 2), and pet keeps working as its old name

## 2.2.3 (2026-10-03)

### Bug Fixes

- Audio elements in the web runtime pause while the content is paused and go on afterwards, as in the app

## 2.2.2 (2026-10-03)

### Bug Fixes

- Audio elements in the web runtime follow the sound being turned on and off, keep the muted content sets, and play once the browser allows it instead of failing

## 2.2.1 (2026-10-03)

### Bug Fixes

- content with the audio permission plays sound in the web runtime in Safari, its frame taking the pointer over its windows

## 2.2.0 (2026-10-02)

### Features

- Screen.visibleFrame is a display's area without the menu bar and the Dock, kept current as the Dock is resized, moved or hidden

## 2.1.0 (2026-10-02)

### Features

- the package ships type declarations for its modules, so other projects can import validateManifest from dist/manifest.js with its types

## 2.0.0 (2026-10-02)

The first stable release. Changes since the 1.4.0 preview:

### Breaking Changes

- the network permission lists the domains it reaches in network.domains; content gets no keyboard and at most 16 windows

### Features

- desktopengine login and publish, to upload projects to the DesktopEngine store
- publish --category, --copyright and --copyright-note set the store's details
- web runtime for previews in the browser, and desktopengine dev --web
- dev --web's proxy follows redirects only within network.domains and refuses domains that resolve to the local network
- a content on the web desktop can have a preview proxy of its own
- framePage() in the web runtime makes the page to serve at frameURL

### Bug Fixes

- the web preview's proxy connects only to addresses it checked, and the web runtime stops content that leaves its page
- login writes its credentials to a new private file, never into one others could read
- a destroyed window closes and can't be shown again
- the web preview's frame gets a token for the proxy only; frameURL docs say when srcdoc frames share the page's thread
- the web runtime drives contents' animation frames from the page, so Safari no longer slows them to about 20 fps
- a restarted widget or pet in the web runtime stays where it was moved, kept on its screen
- a widget restarted in another size in the web runtime is kept on its screen in that size

## Before 2.0.0

0.1.0 and 1.0.0 to 1.4.0 were previews, published while the DesktopEngine app and store were being built. They are deprecated on npm: use 2.0.0 or later.
