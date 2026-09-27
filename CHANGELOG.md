# Changelog

Changes to `@desktopengine/sdk` that matter to its users. Versions follow [semantic versioning](https://semver.org).

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
