# Changelog

Changes to `@desktopengine/sdk` that matter to its users. Versions follow [semantic versioning](https://semver.org).

## 1.4.0 (2026-09-30)

### Features

- content listening to parameterschange applies changed options without restarting

### Bug Fixes

- **canvas:** a canvas whose work the GPU stopped is lost, so it can't hang the GPU every frame
- **canvas:** 2D contexts have isContextLost() too, as on the web

## 1.3.0 (2026-09-27)

### Features

- **component:** add gap, boxSizing and display: contents styles

### Bug Fixes

- hidden files like .env never go into a package
- only the project's own dist, types and tsconfig stay out of the package, and links go in as what they link to
- the CLI takes -h and -v
- create quotes the folder in the command it suggests
- dev doesn't report a disconnection when the app connects again
- pack keeps the zip in its folder whatever the version says
- dev rebuilds after a TypeScript config change, and create's hint keeps a dash folder a folder

## 1.2.0 (2026-09-27)

### Features

- **window:** windows keep their size when dropped on a screen edge, unless allowsTiling

## 1.1.0 (2026-09-26)

### Features

- wallpapers can span all displays (manifest wallpaper.span, launchOptions.displays, dev --span)
- add localStorage and a Node-style fs

### Bug Fixes

- harden file paths and storage cleanup

## 1.0.0 (2026-09-26)

The first release, for API version 1: the `desktopengine` command line tool (`create`, `dev`, `build`, `validate`, `pack`), project templates for wallpapers, widgets and desktop pets, the type declarations of the runtime API and the JSON Schema of `manifest.json`.
