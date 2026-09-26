// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPES, isOneOf } from './manifest.ts';
import type { ContentType } from './manifest.ts';
import { createZip } from './zip.ts';
import { listPackageFiles } from './files.ts';
import { buildProject } from './build.ts';

/** The SDK folder: src/ while developing, dist/ when installed, both one level below it. */
const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATES_DIR = path.join(SDK_ROOT, 'templates');
const TYPES_FILE = path.join(SDK_ROOT, 'types', 'desktop-engine.d.ts');

export { listPackageFiles };

/** `my-clock` → `com.example.my-clock` */
export function defaultId(dirName: string): string {
  const slug = dirName.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
  return `com.example.${slug}`;
}

/**
 * Templates drawn another way than the type's own, e.g. with a rendering library from npm:
 * `create wallpaper <folder> --renderer three` uses templates/wallpaper-three.
 */
export const RENDERERS: Partial<Record<ContentType, readonly string[]>> = {
  wallpaper: ['webgl', 'three', 'pixi'],
};

export interface CreateOptions {
  type: string;
  /** One of RENDERERS[type]; the type's own template when absent. */
  renderer?: string;
  targetDir: string;
  id?: string;
  name?: string;
}

/**
 * Copies a template into `targetDir` and fills in the id and name.
 * @returns created files, relative to `targetDir`
 */
export function createProject({ type, renderer, targetDir, id, name }: CreateOptions): string[] {
  if (!isOneOf(TYPES, type)) {
    throw new Error(`Unsupported type "${type}", the types are ${TYPES.join(', ')}`);
  }
  const renderers = RENDERERS[type] ?? [];
  if (renderer !== undefined && !renderers.includes(renderer)) {
    throw new Error(renderers.length > 0
      ? `Unsupported renderer "${renderer}" for ${type}, the renderers are ${renderers.join(', ')}`
      : `${type} has no renderer templates`);
  }
  const templateDir = path.join(TEMPLATES_DIR, renderer ? `${type}-${renderer}` : type);
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(`${targetDir} exists and isn't empty`);
  }

  const replacements: Record<string, string> = {
    __ID__: id || defaultId(path.basename(path.resolve(targetDir))),
    __NAME__: name || path.basename(path.resolve(targetDir)),
  };
  const created: string[] = [];

  const copy = (from: string, to: string): void => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const source = path.join(from, entry.name);
      const destination = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destination, { recursive: true });
        copy(source, destination);
        continue;
      }
      let data = fs.readFileSync(source);
      if (/\.(json|ts|js|md)$/.test(entry.name)) {
        let text = data.toString('utf8');
        for (const [placeholder, value] of Object.entries(replacements)) {
          // JSON-escape so names with quotes stay valid in manifest.json
          const escaped = JSON.stringify(value).slice(1, -1);
          text = text.split(placeholder).join(escaped);
        }
        data = Buffer.from(text, 'utf8');
      }
      fs.writeFileSync(destination, data);
      created.push(path.relative(targetDir, destination));
    }
  };

  fs.mkdirSync(targetDir, { recursive: true });
  copy(templateDir, targetDir);

  // the runtime API for tsconfig.json: editor completions and `tsc` type checking
  fs.mkdirSync(path.join(targetDir, 'types'), { recursive: true });
  fs.copyFileSync(TYPES_FILE, path.join(targetDir, 'types', 'desktop-engine.d.ts'));
  created.push(path.join('types', 'desktop-engine.d.ts'));

  // npm leaves .gitignore out of published packages, so it isn't a template file
  fs.writeFileSync(path.join(targetDir, '.gitignore'), 'dist/\nnode_modules/\n');
  created.push('.gitignore');

  return created.sort();
}

/** The files of a built package, zipped the way the app imports them. */
export function zipPackage(packageDir: string, files: string[] = listPackageFiles(packageDir)): Buffer {
  return createZip(files.map((name) => ({
    name,
    data: fs.readFileSync(path.join(packageDir, name)),
    date: fs.statSync(path.join(packageDir, name)).mtime,
  })));
}

export interface PackOptions {
  /** the project folder */
  packageDir: string;
  outDir?: string;
  minify?: boolean;
}

/** Builds, validates and zips the package for importing into DesktopEngine. */
export async function packProject({ packageDir, outDir, minify = false }: PackOptions): Promise<{ output: string; files: string[]; warnings: string[] }> {
  const built = await buildProject({ projectDir: packageDir, mode: 'production', minify });
  const zip = zipPackage(built.packageDir, built.files);

  const outputDir = outDir || path.join(packageDir, 'dist');
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, `${built.manifest.id}-${built.manifest.version}.zip`);
  fs.writeFileSync(output, zip);
  return { output, files: built.files, warnings: built.warnings };
}
