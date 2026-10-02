# Changelog

Changes to `@desktopengine/sdk` that matter to its users. Versions follow [semantic versioning](https://semver.org).

## 2.0.0 (2026-10-02)

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
