# Publishing to the Store

The [DesktopEngine store](https://store.desktopengine.app) is where people find content, try it on a desktop in the browser and install it into the app. Every version is checked automatically and looked at by a reviewer before it's published; the store signs what it publishes, and the app checks that signature when it installs your content and updates it by itself.

Publishing is by invitation while the store opens to creators step by step. What you publish follows the [Content Policy](https://desktopengine.app/content-policy/) and the [Creator Agreement](https://desktopengine.app/creator-agreement/): read them before you start.

## Becoming a creator

Ask for an invitation at [creators@desktopengine.app](mailto:creators@desktopengine.app). In the email, include:

- Links to your work (needed).
- The kinds of items you'd like to publish: wallpapers, widgets, companions…
- The [namespace](#namespace-and-id) you'd like.

The answer comes with an invitation code. Sign in at [store.desktopengine.app/account](https://store.desktopengine.app/account), and in the Creating section enter the code, choose your namespace and accept the agreement and the policy (Become a Creator).

## Namespace and id

Your **namespace** is 3 to 32 lowercase letters, digits and hyphens. It's shown with your items and can't change once you've published, so choose it with care.

The `id` of everything you publish starts with `app.desktopengine.<namespace>.`:

```json
"id": "app.desktopengine.acme.day-progress"
```

The first `publish` of an id makes it your item in the store, for good: the id names the item, its versions and the data it keeps on users' Macs ([storage](./storage) belongs to the id, and an update keeps it). Don't change the id between versions, and change the `com.example.…` id of a new project before you publish it for the first time.

Then sign in to the store in the terminal; the token stays on your Mac:

```bash
desktopengine login
```

## Publishing a version

```bash
desktopengine publish --test-link
desktopengine publish --submit --copyright original --notes "The first version"
```

`publish` builds the package minified, like `pack`, and uploads it as a version of your item. The first time, it fills the store listing from the manifest's `name` and `description`; add subtitles, tags, more languages and a mark for content made with generative AI in the [Creator Studio](https://store.desktopengine.app/studio) on the store. After the first publish, changes to the listing are reviewed before the store shows them.

The upload is checked right away; when something is wrong, the command prints the problems and exits with status 1. Besides the rules of `validate`:

- The id is in your namespace, and `version` is higher than every version published before.
- The package has at most 100 MB (unpacked too), 10,000 files and 48 MB per file, no symbolic links, and only the kinds of files content uses (code, data and text, images, audio, video, 3D models, shaders, fonts, WebAssembly).
- It doesn't declare permissions that only content coming with DesktopEngine gets, such as `key-activity`.
- Its `apiVersion` is no higher than the app that's out supports: content that needs a newer API waits for that app.

A version stays a draft until it's submitted: publishing the same `version` again replaces the upload. Once it's submitted, change `version` for the next upload; a rejected version can be uploaded again with the same one.

Submitting also needs:

- `--copyright`: where the content comes from, `original`, `licensed` or `open` (with `--copyright-note` saying who licensed it to you, or the license). Needed the first time.
- `--network-purpose`, when the content has the `network` permission, see [below](#network-purpose).
- The reasons for its [age rating](#age-rating), when it's above 4+.

All the options are in [Command Line](/reference/cli#publish). In CI, set `DESKTOPENGINE_TOKEN` instead of running `login`.

## Test links

`--test-link` prints a `desktopengine://install?…` link. Opened on a Mac with DesktopEngine, it installs that version before it's reviewed, marked as a test and not counted as an install. Try it there as users will get it: it's installed from the store and asks for its permissions, unlike `dev`, which gets every permission it declares. Send the link to your testers too; it works for 14 days, and `publish --test-link` makes a new one any time.

With `--debug`, the copy the link installs can be inspected in Safari's Web Inspector (installed content can't be, otherwise); only you can install it.

A rejected version has no test links: rejecting it deletes them, and you make new ones once you've uploaded a fixed version.

## What review does

A submitted version is run on a review Mac, in the app and in browsers, before a reviewer sees it.

**In the app**, for a minute, with the limits installed content has. The run takes screenshots after 5, 30 and 55 seconds, in light mode with the clock on an afternoon, each followed by one in dark mode with the clock in the evening; the store's screenshots of your content come from them (for widgets and companions, around what they draw). It records every network request, the console, uncaught exceptions and how much energy the content uses: the store shows energy use, and wasteful content can be rejected (see [Performance](./performance)).

**In the browser**, in the web runtime of [`dev --web`](/reference/cli#in-the-browser), in Chrome and in WebKit (Safari's engine), for 35 seconds; widgets and companions are hovered, clicked and dragged. Your JavaScript runs obfuscated there, as the store's web desktop serves it: local names are changed and strings encoded.

The version is **rejected automatically** when:

- It doesn't start, or throws an uncaught exception, in the app.
- It connects to anything outside its `network.domains`.
- In Chrome, it doesn't start, throws an uncaught exception, has a promise rejection nobody handles, or shows nothing. Most visitors to the store use Chrome, so content has to work there.
- It can't be obfuscated, or stops working once it is, e.g. because it depends on function or class names or on its own source text.

So before you submit, run your content with `desktopengine dev --web` in Chrome and watch the terminal. Requests in the browser go through a proxy that has only GET and HEAD there, so a failed request must not end in an exception: catch it and carry on, as you would offline (see [Network](./network)). `dev --web` sends the other methods too, and says in the terminal when your content uses one.

Other findings don't reject anything by themselves: they're shown to the reviewer, who decides. They include console errors, domains declared but never used, code made from strings (`eval`, `new Function`), blank screenshots, text such as passwords or payments in the screenshots, high energy use, screenshots in Chrome that look different from the app's, a much lower frame rate in the browser, and problems in WebKit.

**The reviewer** then reads the results, looks at the screenshots, runs the version in the browser, and checks it, its listing and its age rating against the Content Policy. An approved version is published right away; a rejected one comes with the reason by email. Fix it and upload it again, then submit. If you think a decision is wrong, reply to that email.

## Age rating

Every version has an age rating, the youngest age it suits, as on the App Store: 4+, 9+, 13+, 16+ or 18+. The [Content Policy](https://desktopengine.app/content-policy/) says what each allows. Choose it in the Creator Studio while the version is a draft or was rejected; a new version starts with the rating of the one before.

- Above 4+, choose the reasons (violence, horror, language…): they're shown on the item's page.
- 16+ and 18+ also need a note for the reviewer saying what the content shows, and only creators who are 18 or older can choose them. These items are hidden on the store until an adult turns them on.
- The rating covers everything the content can show, including what changes over time or comes from the network.

The app installs and runs only what fits its user's age. Reviewers can change a rating, and tell you why.

## Network purpose

Content with the `network` permission says what it uses the network for. The store shows it on the item's page with the domains, so write it for users, for example:

```bash
desktopengine publish --submit --network-purpose "Gets the weather for the city you choose from api.example.com"
```

The reviewer compares it with what the content does and the requests the review run recorded. The network is for the declared domains and the stated purpose only: no tracking, no analytics that identify people, no ads. When an update adds domains, the app asks users for the `network` permission again.

## Updates

Raise `version` in `manifest.json`, then publish and submit again; every version is reviewed. A published version never changes.

- Installed copies update by themselves: the app checks when it starts and once a day.
- The content's data (`localStorage`, `defile://usr/`) is kept: a new version must read what an older one saved.
- When an update declares new permissions, the app asks for them.
- An update that needs a higher `apiVersion` than a user's app has isn't offered to that app.
- When a new version fails to start on a Mac, the app goes back to the version before and doesn't install that one again: fix it in a higher version.

## Removal and revocation

An item that breaks the Content Policy or the Creator Agreement, or that a valid copyright notice is about, can be removed from the store; people who installed it keep their copy. A harmful item, or one of its versions, can be revoked: the store publishes a signed list of revoked content, every app stops running it, and it can't be installed any more. You're told either way, with the reason.
