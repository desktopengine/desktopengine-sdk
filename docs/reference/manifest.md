# Manifest (manifest.json)

`manifest.json` sits at the root of the project (and of the mini program package) and describes what the content is and what it needs.

```json
{
  "id": "com.example.day-progress",
  "name": { "en": "Day Progress", "zh-Hans": "今日进度" },
  "type": "widget",
  "version": "1.0.0",
  "apiVersion": 1,
  "author": "Example",
  "icon": "assets/icon.png",
  "widget": { "sizes": ["small", "medium"] },
  "parameters": [
    { "key": "accent", "title": "Accent Color", "type": "color", "default": "#0A84FF" }
  ]
}
```

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | A unique identifier in reverse domain name form, only letters, digits, dots and hyphens, e.g. `com.example.clock` |
| `name` | Yes | The name shown in the library, can be translated, see [Localization](#localization) |
| `type` | Yes | `wallpaper`, `widget` or `companion` (desktop companion), see [Types](#types) |
| `version` | Yes | The version, semantic versioning is recommended, e.g. `1.0.0` |
| `apiVersion` | | The lowest runtime API version it needs, see [API versions](#api-versions) |
| `author` | | The author, shown in the details pane |
| `description` | | A sentence or two about it, can be translated |
| `icon`, `preview` | | The icon and the preview image, paths in the package |
| `previewDark` | | The preview image in dark mode, a path in the package: for content that follows the system appearance, `preview` is then the one in light mode. Without it, `preview` shows in both |
| `widget.sizes` | | The sizes of a widget: `small` 164×164, `medium` 344×164, `large` 344×344; `small` by default |
| `wallpaper.span` | | `true` when a wallpaper can span displays, see [Spanning displays](/guide/wallpaper#spanning-displays) |
| `permissions` | | The permissions it needs, see [Permissions](#permissions) |
| `network.domains` | With `network` | The domains it connects to, see [Network](/guide/network#domains) |
| `parameters` | | Options users can change, see [Options](#options-parameters) |

`desktopengine validate` checks the manifest by the app's rules; the app refuses packages that break them.

## Types

| `type` | What it is |
| --- | --- |
| `wallpaper` | A dynamic wallpaper: fills a display (or all of them, see `wallpaper.span`) below every window |
| `widget` | Sits where the user puts it, on the desktop or above all windows, in the sizes of `widget.sizes` |
| `companion` | A desktop companion: a character, a mascot, a little vehicle, a game… that lives above all windows and moves around the screen on its own |

`companion` needs `"apiVersion": 2`. Apps with API 1 know companions by their old name, `pet`: a manifest that still says `pet` works everywhere and the app treats it as `companion`, `validate` only warns. `launchOptions.type` is the type as the manifest writes it.

## JSON Schema

Add `$schema` to the manifest and editors such as VS Code complete and check its fields:

```json
{
  "$schema": "https://desktopengine.app/desktopengine-sdk/manifest.schema.json",
  "id": "com.example.day-progress"
}
```

The same schema is in the npm package, `schema/manifest.schema.json`.

## Localization

`name`, `description`, and the `title` and `options[].title` of options can be a string, or translations by language. The app picks the user's preferred language, and `en` when none matches:

```json
"name": { "en": "Day Progress", "zh-Hans": "今日进度" }
```

Language codes are the ones macOS uses, e.g. `en`, `zh-Hans`, `zh-Hant`, `ja`; codes with a region such as `zh-CN` match too. Text drawn on a canvas is translated by your code, picking by `DesktopEngine.launchOptions.locale`.

## Options (parameters)

You only declare the options; the app draws them as a native form in the details pane, so you don't build a settings UI.

```json
{ "key": "accent", "title": "Accent Color", "type": "color", "default": "#0A84FF" }
```

| type | Control | default |
| --- | --- | --- |
| `toggle` | A switch | A boolean |
| `number` | A slider when it has both `min` and `max` (`step` is the step), a number field otherwise | A number |
| `text` | A text field | A string |
| `color` | A color well | `#RRGGBB` |
| `choice` | A pop-up menu, `options` is `[{ "value": …, "title": "…" }]` | One of the `value`s |

When the user changes an option, the new values are in `DesktopEngine.launchOptions.parameters`. Content that listens to `parameterschange` applies them while it keeps running, see [When options change](/guide/launch-options#when-options-change); the app restarts other content (dragging a slider or typing is coalesced into one restart).

## Permissions

| Permission | Meaning |
| --- | --- |
| `network` | Connect to the domains in `network.domains` |
| `audio` | Play sound |
| `system-info` | CPU and memory usage |
| `mouse` | Where the pointer is and the clicks, in any app (needs `"apiVersion": 3`), see [Following the Mouse](/guide/input) |
| `system-audio` | How loud the sound other apps play on the Mac is, overall and from low to high, never the sound itself (needs `"apiVersion": 6`); content with it can't have `network` too, see [What the Mac plays](/guide/audio#what-the-mac-plays) |
| `window-positions` | Where other apps' windows are, their size and order, and which belong to the app in use; never their titles or what they show (needs `"apiVersion": 6`), see [Other Apps' Windows](/guide/app-windows) |

Any other permission is an error: the app neither lists nor asks for permissions it doesn't know, and the content never gets them. The app lists these permissions in the details pane. `audio` isn't asked for: content that declares it can make sound, and users control it with the volume and Mute All Content. The other permissions are asked for one by one the first time the user adds the content to the desktop; the user can allow only some of them and change them any time in the details pane (the content restarts). Content that declares no permissions never prompts. On a Mac before macOS 14.2 `system-audio` isn't asked for either: there's nothing to hear, so the content gets it and hears silence (`supported` is false).

A denied permission doesn't stop the content: it starts as usual with that capability off, so plan for running without it. The permissions it got are in `DesktopEngine.launchOptions.permissions`, each once, in the app and in the web preview alike. The previews in the app's details pane are silent and don't see other apps' windows, so `audio` and `window-positions` aren't there:

```js
const permissions = DesktopEngine.launchOptions?.permissions ?? [];
if (permissions.includes('network')) {
  refresh();
} else {
  showOfflineHint(); // don't keep retrying
}
```

With `network`, list the domains the content connects to; it can reach those and nothing else, and the permission prompt shows them to users:

```json
"permissions": ["network"],
"network": { "domains": ["api.example.com", "*.tile.example.org"] }
```

The runtime enforces `network` (no network without it, and only the listed domains with it, see [Network](/guide/network#domains)), `audio` (no sound without it, see [Audio](/guide/audio)), `system-info` (`cpuUsage()` / `memoryUsage()` throw without it), `mouse` (`DesktopEngine.input`'s mouse events never come without it), `window-positions` (`DesktopEngine.windows` is `null` without it) and `system-audio` (`DesktopEngine.systemAudio` is `null` without it). Declaring both `system-audio` and `network` is an error: `desktopengine validate` reports it, and the app and the store refuse the package. Content run by `desktopengine dev` or the Develop menu is yours, so it isn't asked and gets every permission it declares, under the same rules as installed content (`network`, for example, still reaches only the listed domains). The ones it doesn't declare are off there too.

## API versions

The runtime has an integer API version that goes up when APIs are added: `DesktopEngine.apiVersion` in JavaScript. This SDK describes version 6 (the first line of `desktopengine --help` shows it too). When you use an API added later, put its version in `"apiVersion"` and apps with an older API refuse to import the package and ask users to update; or leave it out and check `DesktopEngine.apiVersion` at run time to fall back.

| Version | Added |
| --- | --- |
| 1 | The first version |
| 2 | The `companion` type, formerly `pet` |
| 3 | `DesktopEngine.input` and the `mouse` permission, see [Following the Mouse](/guide/input) |
| 4 | `Image`'s `size` `fill` (stretched) and `none` (its own size), `Video`'s `objectFit` `none`; every mouse button's `mousedown` and `mouseup`, with `button` and `buttons` in the mouse events' payload, see [Mouse](/guide/windows#mouse); `queueMicrotask`, `atob`, `btoa` and `crypto` (`getRandomValues`, `randomUUID`), see [Globals](/guide/runtime#globals); `currentTime`, `duration` and `paused` of `Video` |
| 5 | `ellipse()`, `roundRect()`, `getTransform()`, `createConicGradient()`, `letterSpacing` and `wordSpacing` of 2D canvases, `setTransform()` taking a matrix, the blend modes (`multiply`…`luminosity`), the rest of `TextMetrics`, `Path2D`, `isPointInPath` and `isPointInStroke`; `createImageBitmap` and `new ImageData()`; `structuredClone`, `MessageChannel`, `FileReader`, `CustomEvent` and `navigator`, see [Globals](/guide/runtime#globals) |
| 6 | `BroadcastChannel`, with the scopes `package` and `namespace`, see [Messages Between Content](/guide/messaging); `DesktopEngine.systemAudio` and the `system-audio` permission, see [What the Mac plays](/guide/audio#what-the-mac-plays); `DesktopEngine.windows` (`list()`, `visibleTopEdges()` and `change`) and the `window-positions` permission, see [Other Apps' Windows](/guide/app-windows); an `Image` loads its `src` before it's in a component, so its `load` can be waited for before adding it |

Version 4 also changed APIs as in browsers: the double click event is `dblclick` (it was `dbclick`), and `click` and `dblclick` get the mouse events' payload, `{ x, y, … }` (it was `{ position: { x, y } }`). It removed `wxBindCanvasTexture` and `blBindCanvasTexture` of WebGL contexts, the global `mixin` and `promisify`, and the `files`, `now-playing` and `window-positions` permissions, which had no API (version 6 brings `window-positions` back with `DesktopEngine.windows`). Content that used them needs `"apiVersion": 4` once it's changed.
