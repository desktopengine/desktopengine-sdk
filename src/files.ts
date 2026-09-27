// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

import fs from 'node:fs';
import path from 'node:path';

/** Files that never go into a package, besides hidden ones. */
export const IGNORED: ReadonlySet<string> = new Set(['node_modules', 'dist', 'types', 'jsconfig.json', 'tsconfig.json']);

/** Hidden files and folders (.env, .npmrc, .git, .DS_Store…) never go into a package: they can hold secrets, and anyone
 * who installs the package can read it */
function isIgnored(name: string): boolean {
  return name.startsWith('.') || IGNORED.has(name);
}

/** Files of the package in `packageDir`, with `/` separated names, sorted. */
export function listPackageFiles(packageDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (isIgnored(entry.name) || entry.name.endsWith('.zip')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(path.relative(packageDir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(packageDir);
  return files.sort();
}

/** Whether a changed file, relative to the project, can change the package. */
export function affectsPackage(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/);
  return !parts.some(isIgnored) && !relativePath.endsWith('.zip');
}
