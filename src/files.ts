// DesktopEngine SDK
// Copyright © 2024 senpng. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

import fs from 'node:fs';
import path from 'node:path';

/** Files that never go into a package. */
export const IGNORED: ReadonlySet<string> = new Set(['.DS_Store', '.git', '.gitignore', 'node_modules', 'dist', 'types', 'jsconfig.json', 'tsconfig.json']);

/** Files of the package in `packageDir`, with `/` separated names, sorted. */
export function listPackageFiles(packageDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED.has(entry.name) || entry.name.endsWith('.zip')) continue;
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
  return !parts.some((part) => IGNORED.has(part)) && !relativePath.endsWith('.zip');
}
