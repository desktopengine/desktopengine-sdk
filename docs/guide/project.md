# Projects and Builds

## Projects

`create` makes a TypeScript project:

```
day-progress/
├── manifest.json     the manifest: identifier, name, type, sizes, permissions, options
├── src/
│   ├── index.ts      the entry
│   └── progress.ts   modules split with import
├── tsconfig.json     completion and type checking in editors (npx tsc)
├── types/            type declarations of the runtime API
├── package.json      optional, for dependencies from npm
└── assets/…          optional, images and other resources
```

See [Manifest](/reference/manifest) for the fields of `manifest.json`.

Completion in editors: `create` copies the type declarations into the project's `types/`, and `tsconfig.json` includes them and leaves out the DOM and Node.js types (`"lib": ["es2022"]`, `"types": []`), which would conflict with the runtime's declarations. After updating the SDK, replace the project's copy with the new `types/desktop-engine.d.ts`.

## Builds

The runtime only has CommonJS `require()`. `dev`, `build` and `pack` first bundle `src/index.ts`, the files it imports and the packages from `node_modules` into one `index.js` with [esbuild](https://esbuild.github.io), and put together the mini program package the app imports in `dist/package/`:

```
dist/package/
├── manifest.json
├── index.js          the bundled entry, run as a global script in JavaScriptCore
└── assets/…          all files but src/, types/, tsconfig.json and the npm files are copied as they are
```

- The target is the JavaScriptCore of macOS 12 (as in Safari 15): newer syntax is transformed.
- Only packages that don't need the DOM or Node.js work. The runtime has `performance.now()`; if a library also uses globals such as `window` or `document`, provide them first. three.js and PixiJS work, see [Drawing with WebGL or a rendering library](./wallpaper#drawing-with-webgl-or-a-rendering-library).
- esbuild only strips TypeScript, it doesn't check types: your editor or `npx tsc` finds type errors.
- `--minify` makes the bundle smaller, which helps projects with large libraries.
- The entry can also be `src/index.js` (or `.tsx`, `.mjs`). With `src/`, the project root can't have an `index.js`.
- You can also skip the build: a project without `src/` is packed as it is, with `index.js` at its root as the entry, loading other files with `require()`.

See [Command Line](/reference/cli) for the options of each command.
