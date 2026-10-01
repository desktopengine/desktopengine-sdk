// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// Builds the web runtime into dist/web: desktop.js (WebDesktop, for the page, with the frame runtime inside it),
// frame.js (the frame runtime alone, for a frame page on an origin of its own) and the declarations. npm run build
// runs it.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'dist', 'web');
// the browsers that run WebGL 2 and the rest of what contents use
const target = ['es2020', 'chrome100', 'safari15', 'firefox100'];
const banner = '// DesktopEngine SDK web runtime. Copyright © 2026 DesktopEngine. Licensed under the Apache Licence 2.0.';

const frame = await esbuild.build({
  entryPoints: [path.join(here, 'frame', 'index.ts')],
  bundle: true,
  format: 'iife',
  write: false,
  minify: true,
  target,
  legalComments: 'none',
});
const runtime = frame.outputFiles[0].text;

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'frame.js'), `${banner}\n${runtime}`);
await esbuild.build({
  entryPoints: [path.join(here, 'host', 'desktop.ts')],
  bundle: true,
  format: 'esm',
  outfile: path.join(out, 'desktop.js'),
  define: { __FRAME_RUNTIME__: JSON.stringify(runtime) },
  target,
  banner: { js: banner },
  legalComments: 'none',
});
execFileSync(process.execPath, [path.join(here, '..', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(here, 'tsconfig.declarations.json')], { stdio: 'inherit' });
// next to desktop.js, importing what's next to it
const declarations = fs.readFileSync(path.join(out, 'host', 'desktop.d.ts'), 'utf8').replaceAll("'../protocol.ts'", "'./protocol.js'");
fs.writeFileSync(path.join(out, 'desktop.d.ts'), declarations);
fs.rmSync(path.join(out, 'host'), { recursive: true });
console.log(`built ${path.relative(process.cwd(), out)}: desktop.js ${Math.round(fs.statSync(path.join(out, 'desktop.js')).size / 1024)} KB, frame.js ${Math.round(runtime.length / 1024)} KB`);
