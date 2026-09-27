// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

import fs from 'node:fs';
import path from 'node:path';

/** Files and folders of the project itself that never go into a package: the build output, the SDK's types and the
 * TypeScript configs. Deeper in the package, e.g. `assets/types/`, they're the package's own. */
const IGNORED_AT_ROOT: ReadonlySet<string> = new Set(['dist', 'types', 'jsconfig.json', 'tsconfig.json']);

/** Hidden files and folders (.env, .npmrc, .git, .DS_Store…) never go into a package: they can hold secrets, and anyone
 * who installs the package can read it. Nor do npm's folders, or archives such as an older pack. */
function isIgnored(name: string, atRoot: boolean): boolean {
  return name.startsWith('.') || name === 'node_modules' || name.endsWith('.zip') || (atRoot && IGNORED_AT_ROOT.has(name));
}

/** Files of the package in `packageDir`, with `/` separated names, sorted. A symbolic link goes in as what it links
 * to, since the app doesn't install links. */
export function listPackageFiles(packageDir: string): string[] {
  const files: string[] = [];
  // the real paths of the folders being walked: a link to one of them would never end
  const walking = new Set<string>();
  const walk = (dir: string): void => {
    const real = fs.realpathSync(dir);
    if (walking.has(real)) {
      throw new Error(`${relative(dir)} links to a folder that contains it`);
    }
    walking.add(real);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (isIgnored(entry.name, dir === packageDir)) continue;
      const full = path.join(dir, entry.name);
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        let target: fs.Stats;
        try {
          target = fs.statSync(full);
        } catch {
          throw new Error(`${relative(full)} is a symbolic link to a file that doesn't exist`);
        }
        isDirectory = target.isDirectory();
        isFile = target.isFile();
      }
      if (isDirectory) {
        walk(full);
      } else if (isFile) {
        files.push(relative(full));
      }
    }
    walking.delete(real);
  };
  const relative = (full: string): string => path.relative(packageDir, full).split(path.sep).join('/');
  walk(packageDir);
  return files.sort();
}

/** Whether a changed file, relative to the project, can change the package: a file that goes into it, or the
 * TypeScript config at the root, which esbuild reads when it bundles src/ (paths, jsx…). */
export function affectsPackage(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/);
  if (parts.length === 1 && (parts[0] === 'tsconfig.json' || parts[0] === 'jsconfig.json')) return true;
  return !parts.some((part, index) => isIgnored(part, index === 0));
}
