# Command Line

```bash
npm install -g @desktopengine/sdk
desktopengine --help
```

`folder` defaults to the current folder. Projects with `src/index.ts` (or `src/index.js`) are bundled first and can use `import`, TypeScript and npm packages; projects without `src/` are used as they are, with `index.js` at the root as the entry. See [Projects and Builds](/guide/project).

## create

```bash
desktopengine create <type> <folder> [--renderer <renderer>] [--id <identifier>] [--name <name>]
```

Creates a project from a template.

| Argument | Description |
| --- | --- |
| `<type>` | `wallpaper`, `widget` or `companion` (`pet`, its old name, makes a companion too) |
| `<folder>` | The folder of the new project |
| `--renderer` | A template drawn another way, only for wallpapers for now: `webgl`, `three`, `pixi`. Run `npm install` after creating a `three` or `pixi` project, see [Drawing with WebGL or a rendering library](/guide/wallpaper#drawing-with-webgl-or-a-rendering-library) |
| `--id` | The manifest's `id`, `com.example.<folder name>` by default |
| `--name` | The manifest's `name` |

## dev

```bash
desktopengine dev [folder] [options]
```

Runs the project in DesktopEngine, rebuilds and reloads it when files change, and prints its console output and uncaught exceptions. Press Ctrl-C to stop.

| Option | Description |
| --- | --- |
| `--size small\|medium\|large` | The widget size; the first of `widget.sizes` when it isn't one of them |
| `--level desktop\|floating` | On the desktop, or above all windows; by default companions float above windows and the rest are on the desktop |
| `--display <number>` | The display to run on, starting at 1; the main display by default |
| `--span` | A wallpaper across all displays, when `manifest.json` declares [`wallpaper.span`](/guide/wallpaper#spanning-all-displays) |
| `--param <key=value>` | The value of an option, can be repeated; the others take the manifest's `default` |
| `--position <x,y>` | The window position |
| `--port <port>` | The port to listen on, random by default |
| `--perf` | Shows the frame rate, frame time, CPU, wake-ups and memory, see [Performance](/guide/performance#measuring) |
| `--no-open` | Prints the URL that connects DesktopEngine instead of opening it |
| `--web` | Runs it in the browser instead, see [In the browser](#in-the-browser) |

These options stand in for what the user picks in the details pane: the [`launchOptions`](/guide/launch-options) your content reads are the same as once installed.

### In the browser

`dev --web` runs the project on a page that looks like a Mac desktop, in the web runtime the DesktopEngine store uses to let people try content before they install it. It doesn't need the app, so it works on any computer with a browser; it rebuilds and reloads on changes and prints the console in the terminal like `dev`. The menu bar of the page switches between light and dark, turns the sound on and starts the content again, and for widgets picks the size.

The web runtime implements the same JavaScript API on top of the browser: windows are positioned elements, canvases are the browser's canvases. Your content only sees the globals it has in DesktopEngine, not `window`, `document` or the DOM, so it takes the same paths as in the app. It is close, not the same: check your content in the app before you publish it. Differences:

- Requests (`fetch`, `XMLHttpRequest`, images and videos) to the domains of [`network.domains`](/guide/network#domains) go through a proxy, GET and HEAD only, without cookies; WebSocket isn't available with `dev --web`.
- Files in `defile://usr/`, `localStorage` and `sessionStorage` are kept in memory and gone when the page reloads.
- The scroll wheel doesn't reach the content, and keyboard events never do (as in the app).
- `DesktopEngine.system.cpuUsage()` and `memoryUsage()` return made-up values that change slowly: a web page can't see the computer's.

## build

```bash
desktopengine build [folder] [--minify]
```

Bundles `src/index.(ts|js)`, the modules and npm packages it imports into one `index.js`, and puts it with the manifest and assets in `dist/package/`. `--minify` makes the bundle smaller.

## validate

```bash
desktopengine validate [folder]
```

Checks `manifest.json` and the entry by the app's rules, building `src/` first. Exits with status 1 when there are errors, so it fits in CI.

## pack

```bash
desktopengine pack [folder] [--out <folder>] [--minify]
```

Builds, validates and zips the package into `<id>-<version>.zip` (in the project's `dist/` by default), which File › Import… in DesktopEngine imports.

## login

```bash
desktopengine login [--api <url>]
```

Signs in to the DesktopEngine store: it shows a short code and opens the browser, where you confirm the code with your creator account. The token is kept in `~/.config/desktopengine/credentials.json` (in `$XDG_CONFIG_HOME` when it's set), readable only by you. Publishing needs a creator account, which is by invitation for now.

`desktopengine logout [--api <url>]` signs out and forgets the token.

## publish

```bash
desktopengine publish [folder] [options]
```

Packs the project like `pack` and uploads it as a new version of its item in the store. The first time, it claims the item for the `id` in `manifest.json` (the id must start with `app.desktopengine.<your namespace>.`) and fills the store listing from the manifest's `name` and `description`; edit the listing in the creator console afterwards. `version` must be higher than the published one; a version that is still a draft, or was rejected, is uploaded again.

The upload is checked right away (the same rules as `validate`, plus the store's: size, files, id and namespace). Problems are printed and the command exits with status 1. A submitted version is run on a review Mac and looked at by a reviewer before it's published.

| Option | Description |
| --- | --- |
| `--notes <text>` | What's new in this version, in English, shown to reviewers and users |
| `--notes-<locale> <text>` | What's new in another language, e.g. `--notes-zh-Hans`; the store shows the notes in the visitor's language, and the English ones where there are none in it |
| `--network-purpose <text>` | What the `network` permission is for; needed to submit a version that has it |
| `--category <category>` | The store's category for it, e.g. `clock`: needed to submit the first time. The categories are listed by `GET /v1/categories` of the store API |
| `--copyright <origin>` | Where the content comes from: `original`, `licensed` or `open`; needed to submit the first time |
| `--copyright-note <text>` | With `licensed`, who licensed it to you; with `open`, the license, e.g. `CC BY 4.0` |
| `--submit` | Submit the version for review after uploading it |
| `--test-link` | Make a link that installs this version in DesktopEngine before it's reviewed, marked as a test, for you and your testers |
| `--debug` | The test link's copy can be inspected in Safari's Web Inspector; only you can install it |
| `--api <url>` | Another store API; also `DESKTOPENGINE_API` |

In CI, set `DESKTOPENGINE_TOKEN` to the token `login` saved, instead of running `login` there.
