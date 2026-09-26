# Manifest (manifest.json)

`manifest.json` sits at the root of the project (and of the mini program package) and describes what the content is and what it needs.

```json
{
  "id": "com.example.day-progress",
  "name": { "en": "Day Progress", "zh-Hans": "今日进度" },
  "type": "widget",
  "version": "1.0.0",
  "apiVersion": 2,
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
| `type` | Yes | `wallpaper`, `widget` or `pet` (desktop pet) |
| `version` | Yes | The version, semantic versioning is recommended, e.g. `1.0.0` |
| `apiVersion` | | The lowest runtime API version it needs, see [API versions](#api-versions) |
| `author` | | The author, shown in the details pane |
| `description` | | A sentence or two about it, can be translated |
| `icon`, `preview` | | The icon and the preview image, paths in the package |
| `widget.sizes` | | The sizes of a widget: `small` 164×164, `medium` 344×164, `large` 344×344; `small` by default |
| `permissions` | | The permissions it needs, see [Permissions](#permissions) |
| `parameters` | | Options users can change, see [Options](#options-parameters) |

`desktopengine validate` checks the manifest by the app's rules; the app refuses packages that break them.

## JSON Schema

Add `$schema` to the manifest and editors such as VS Code complete and check its fields:

```json
{
  "$schema": "https://desktopengine.github.io/desktopengine-sdk/manifest.schema.json",
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

When the user changes an option, the app restarts the instance (dragging a slider or typing is coalesced into one restart), and the new values are in `DesktopEngine.launchOptions.parameters`.

## Permissions

| Permission | Meaning |
| --- | --- |
| `network` | Connect to the internet |
| `files` | Read files the user chooses |
| `audio` | Play sound |
| `system-info` | CPU, memory and network usage |
| `now-playing` | The music that is playing |
| `window-positions` | Where the windows of other apps are |

The app lists these permissions in the details pane. `audio` isn't asked for: content that declares it can make sound, and users control it with the volume and Mute All Content. The other permissions are asked for one by one the first time the user adds the content to the desktop; the user can allow only some of them and change them any time in the details pane (the content restarts). Built-in content isn't asked for, and content that declares no permissions never prompts.

A denied permission doesn't stop the content: it starts as usual with that capability off, so plan for running without it. The permissions it got are in `DesktopEngine.launchOptions.permissions`:

```js
const permissions = DesktopEngine.launchOptions?.permissions ?? [];
if (permissions.includes('network')) {
  refresh();
} else {
  showOfflineHint(); // don't keep retrying
}
```

The runtime enforces `network` (no network without it, see [Network](/guide/network)), `audio` (no sound without it, see [Audio](/guide/audio)) and `system-info` (`cpuUsage()` / `memoryUsage()` throw without it). `files`, `now-playing` and `window-positions` have no API yet; declaring them tells users. Content run by `desktopengine dev` or the Develop menu is yours, so it isn't asked and gets every permission it declares; the ones it doesn't declare are off there too.

## API versions

The runtime has an integer API version that goes up when APIs are added: `DesktopEngine.apiVersion` in JavaScript. This SDK describes version 9 (the first line of `desktopengine --help` shows it too). When you use a new API, put `"apiVersion": 9` in the manifest and older versions of the app refuse to import it and ask users to update; or leave it out and check `DesktopEngine.apiVersion` at run time to fall back.

| Version | Added |
| --- | --- |
| 1 | The first version |
| 2 | `DesktopEngine.system.appearance` and the `appearancechange` event (following the system's light and dark, see [Appearance](/guide/launch-options#appearance)) |
| 3 | `resetTransform()` in Canvas 2D; colors in `#rgba`, `#rrggbbaa` and the space-separated `rgb(255 0 0 / 50%)`, invalid colors are ignored; WebGL's `getContextAttributes()` returns the actual attributes |
| 4 | `fetch`, `Headers`, `Request`, `Response`, `AbortController`, `AbortSignal`, `WebSocket`, `DOMException` (see [Network](/guide/network)); the `network` permission is enforced |
| 5 | `Audio` (`HTMLAudioElement`) and Web Audio: `AudioContext`, `OfflineAudioContext`, the audio nodes, `AudioParam`, `AudioBuffer` (see [Audio](/guide/audio)); global `Event` and `EventTarget`; the `audio` permission is enforced, and videos are muted without it |
| 6 | Streamed response bodies (`Response.body`) and the Streams API, `Blob`, `File`, `URL.createObjectURL`, `FormData`, `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder` (see [Data](/guide/data)); `XMLHttpRequest`, `ProgressEvent`, `MessageEvent`, `CloseEvent`, `self`; WebSocket's `binaryType` defaults to `"blob"` |
| 7 | The `imageRendering` canvas style: `'pixelated'` and `'crisp-edges'` keep pixels sharp when scaled up (see [Runtime Notes](/guide/runtime)) |
| 8 | The window's `devicepixelratiochange` event: `devicePixelRatio` changes when a window moves to a display with another scale (see [Windows](/guide/windows#displays-and-scale)) |
| 9 | `DesktopEngine.preferredFramesPerSecond`: the frame rate the content wants (see [Frame rate](/guide/performance#frame-rate)) |
