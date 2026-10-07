# Changelog

Changes to `@desktopengine/sdk` that matter to its users. Versions follow [semantic versioning](https://semver.org).

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
