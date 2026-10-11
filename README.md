# DesktopEngine SDK

[![npm](https://img.shields.io/npm/v/@desktopengine/sdk)](https://www.npmjs.com/package/@desktopengine/sdk)
[![CI](https://github.com/desktopengine/desktopengine-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/desktopengine/desktopengine-sdk/actions/workflows/ci.yml)

Make dynamic wallpapers, widgets and desktop companions for [DesktopEngine](https://desktopengine.app) in JavaScript or TypeScript.

**Documentation: <https://desktopengine.app/desktopengine-sdk/>** · [简体中文](https://desktopengine.app/desktopengine-sdk/zh/)

The SDK includes:

- The `desktopengine` command line tool: create, run and debug, build, validate and pack projects, and publish them to the store
- `templates/`: project templates for wallpapers, widgets and desktop companions, plus WebGL, three.js and PixiJS versions for wallpapers
- `types/desktop-engine.d.ts`: type declarations of the runtime API, for completion and type checking in editors
- `schema/manifest.schema.json`: the JSON Schema of `manifest.json`

## Quick start

You need Node.js 18 or later, and a Mac with DesktopEngine installed.

```bash
npm install -g @desktopengine/sdk
desktopengine create widget ~/Projects/day-progress --id com.example.day-progress --name "Day Progress"
desktopengine dev ~/Projects/day-progress
```

`dev` opens DesktopEngine and runs the mini program in it. Saving a file rebuilds and reloads it, and `console.log` and uncaught exceptions are printed in the terminal. When it's done, pack it and import the .zip in DesktopEngine with File › Import… to try it yourself:

```bash
desktopengine pack ~/Projects/day-progress
```

To share it, publish it to the [DesktopEngine store](https://store.desktopengine.app) (by invitation for now): sign in with your creator account, test the version with a link that installs it before review, then submit it for review.

```bash
desktopengine login
desktopengine publish ~/Projects/day-progress --test-link
desktopengine publish ~/Projects/day-progress --submit --copyright original
```

See the [documentation](https://desktopengine.app/desktopengine-sdk/guide/getting-started) for more, and [Publishing](https://desktopengine.app/desktopengine-sdk/guide/publishing) for the store's review.

## Contributing

Report problems and ideas in [issues](https://github.com/desktopengine/desktopengine-sdk/issues). To work on the SDK itself, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE). The DesktopEngine app itself isn't in this repository and isn't released under this license.
