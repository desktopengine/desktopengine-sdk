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
| `<type>` | `wallpaper`, `widget` or `pet` |
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
| `--level desktop\|floating` | On the desktop, or above all windows; by default pets float above windows and the rest are on the desktop |
| `--display <number>` | The display to run on, starting at 1; the main display by default |
| `--span` | A wallpaper across all displays, when `manifest.json` declares [`wallpaper.span`](/guide/wallpaper#spanning-all-displays) |
| `--param <key=value>` | The value of an option, can be repeated; the others take the manifest's `default` |
| `--position <x,y>` | The window position |
| `--port <port>` | The port to listen on, random by default |
| `--perf` | Shows the frame rate, frame time, CPU, wake-ups and memory, see [Performance](/guide/performance#measuring) |
| `--no-open` | Prints the URL that connects DesktopEngine instead of opening it |

These options stand in for what the user picks in the details pane: the [`launchOptions`](/guide/launch-options) your content reads are the same as once installed.

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
| `--notes <text>` | What's new in this version, shown to reviewers and users |
| `--network-purpose <text>` | What the `network` permission is for; needed to submit a version that has it |
| `--category <category>` | The store's category for it, e.g. `clock`: needed to submit the first time. The categories are listed by `GET /v1/categories` of the store API |
| `--copyright <origin>` | Where the content comes from: `original`, `licensed` or `open`; needed to submit the first time |
| `--copyright-note <text>` | With `licensed`, who licensed it to you; with `open`, the license, e.g. `CC BY 4.0` |
| `--submit` | Submit the version for review after uploading it |
| `--test-link` | Make a link that installs this version in DesktopEngine before it's reviewed, marked as a test, for you and your testers |
| `--debug` | The test link's copy can be inspected in Safari's Web Inspector; only you can install it |
| `--api <url>` | Another store API; also `DESKTOPENGINE_API` |

In CI, set `DESKTOPENGINE_TOKEN` to the token `login` saved, instead of running `login` there.
