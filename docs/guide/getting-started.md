# Getting Started

The DesktopEngine app only provides the core services: it runs mini programs, manages the library and playlists, and assigns displays. Dynamic wallpapers, widgets and desktop pets are made by developers and creators with this SDK, and users import them into the app.

The SDK includes:

- The `desktopengine` command line tool: create, run and debug, build, validate and pack projects
- Project templates for wallpapers, widgets and desktop pets, plus WebGL, three.js and PixiJS versions for wallpapers
- Type declarations of the runtime API, which editors use for completion and type checking (see the [API reference](/api/))
- A [JSON Schema](/reference/manifest#json-schema) for `manifest.json`

## Install

You need Node.js 18 or later, and a Mac with [DesktopEngine](https://desktopengine.github.io) installed.

```bash
npm install -g @desktopengine/sdk
desktopengine --version
```

To skip the global install, run `npx @desktopengine/sdk <command>` instead.

Recent versions of npm warn that esbuild's install script (`postinstall`) didn't run. You can ignore it: the SDK doesn't need it.

## Create and run

```bash
desktopengine create widget ~/Projects/day-progress --id com.example.day-progress --name "Day Progress"
desktopengine dev ~/Projects/day-progress
```

The type given to `create` is `wallpaper`, `widget` or `pet`. See [Projects and Builds](./project) for what the project contains.

`dev` opens DesktopEngine and runs the mini program in it:

- The first time it connects, the app asks whether to allow it (and first whether to turn on the Develop menu, if it's off).
- Saving a file rebuilds and reloads it; the position its window was dragged to is kept across reloads.
- `console.log` and the other console output, uncaught exceptions (with their stack), rejected promises nobody handles and `postMessage('host', …)` are printed in the terminal. The Mac App Store version of DesktopEngine doesn't see the rejection of an async function's promise that nothing awaits or catches, e.g. `main();` at the end of the script: write `main().catch(console.error);`.
- Options stand in for what the user picks in the details pane, and `DesktopEngine.launchOptions` is exactly what it is once installed:

  ```bash
  desktopengine dev . --size medium --level floating --display 2 --param accent=#FF9F0A --param workday=true
  ```

- With `--perf`, the last line of the terminal shows the frame rate, CPU, wake-ups and memory every second, see [Performance](./performance).
- Press Ctrl-C to stop; the mini program is removed from the desktop too.

## Debugging with breakpoints

In Safari, turn on "Show features for web developers" in Settings › Advanced, then choose Develop › *this Mac* › the mini program. Only mini programs loaded after DesktopEngine's Develop menu is turned on can be inspected. Development builds of `src/` projects have source maps, so the inspector shows your original files.

You can also do without `dev`: run `desktopengine build`, turn on Settings › Advanced › Show Develop Menu in Menu Bar, choose Develop › Load Local Mini Program… (⌘⌥O) and pick the project's `dist/package/` folder. It reloads after each build. This way `DesktopEngine.launchOptions` is an empty object `{}` (the templates have defaults for everything).

## Validate, pack and import

```bash
desktopengine validate ~/Projects/day-progress
desktopengine pack ~/Projects/day-progress
```

`pack` writes `<id>-<version>.zip` into the project's `dist/`. To import it, click the import button in the toolbar of All Wallpapers, Widgets or Pets in DesktopEngine, or choose File › Import…. Import what `pack` makes: the app takes a folder too, but as it is, so a project folder would bring its other files along (`.env`, `node_modules`…) and a symbolic link in it is refused. What you import shows up by type: wallpapers in the wallpaper grid (filter the toolbar by Dynamic), widgets and pets on their own pages. Importing the same `id` again replaces the old version, and instances running on the desktop restart with the new one.

For now content is shared as a .zip or a folder: there is no signing, review or online library yet.

## Next

- [Projects and Builds](./project): what's in a project and how `src/` is bundled
- [Manifest](/reference/manifest): name, type, permissions and the options users can change
- [Wallpapers](./wallpaper), or [Launch Options](./launch-options) and [Windows](./windows) for widgets and desktop pets
- [Design Guidelines](./design): how content fits in with macOS
