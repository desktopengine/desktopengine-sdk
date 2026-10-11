# Changelog

Changes to `@desktopengine/sdk` that matter to its users. Versions follow [semantic versioning](https://semver.org).

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
