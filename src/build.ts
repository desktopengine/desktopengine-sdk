// DesktopEngine SDK
// Copyright © 2024 senpng. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// Projects with a `src/index.*` are bundled: ES modules, TypeScript and npm packages go into one `index.js`
// that the engine runs as a global script (it only has CommonJS `require()` for files in the package).
// Projects without `src/` are packages as they are.

import fs from 'node:fs';
import path from 'node:path';
import type { Message } from 'esbuild';
import { MANIFEST_FILE, ENTRY_FILE, validateManifest, validatePackage } from './manifest.ts';
import type { Manifest } from './manifest.ts';
import { listPackageFiles } from './files.ts';

export const SOURCE_DIR = 'src';
const SOURCE_ENTRIES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'];
/** Where a bundled project is assembled, inside the ignored `dist/`. */
export const BUILD_DIR = path.join('dist', 'package');
/** Only used while building. */
const BUILD_ONLY_FILES = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']);
/**
 * JavaScriptCore of macOS 12, the oldest system the app runs on.
 * Keep in sync with MACOSX_DEPLOYMENT_TARGET in Configurations/Common.xcconfig.
 */
export const TARGET = 'safari15';

export type BuildMode = 'development' | 'production';

export interface BuildOptions {
  projectDir: string;
  /** `development` inlines a source map, so the Web Inspector shows the original files. */
  mode?: BuildMode;
  minify?: boolean;
}

export interface BuildResult {
  /** The project itself when it isn't bundled. */
  packageDir: string;
  manifest: Manifest;
  files: string[];
  warnings: string[];
  bundled: boolean;
}

/** An error with the messages it was made of, e.g. to show them one by one. */
export class IssuesError extends Error {
  errors: string[];

  constructor(message: string, errors: string[]) {
    super(message);
    this.errors = errors;
  }
}

/** `src/index.*` of a bundled project, or `null`. */
export function findSourceEntry(projectDir: string): string | null {
  for (const name of SOURCE_ENTRIES) {
    const file = path.join(projectDir, SOURCE_DIR, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

export function isBundledProject(projectDir: string): boolean {
  return findSourceEntry(projectDir) !== null;
}

function useColor(stream: NodeJS.WriteStream): boolean {
  return Boolean(stream.isTTY) && !('NO_COLOR' in process.env);
}

function throwIfErrors(errors: string[], title: string): void {
  if (errors.length === 0) return;
  throw new IssuesError(`${title}:\n${errors.map((message) => `  - ${message}`).join('\n')}`, errors);
}

/** The dependencies in package.json that no node_modules, here or in a folder above, has. */
function missingDependencies(projectDir: string): string[] {
  let dependencies: Record<string, string> | undefined;
  try {
    dependencies = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')).dependencies;
  } catch {
    return [];
  }
  const installed = (name: string): boolean => {
    for (let dir = projectDir; ; dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'node_modules', name, 'package.json'))) return true;
      if (path.dirname(dir) === dir) return false;
    }
  };
  return Object.keys(dependencies ?? {}).filter((name) => !installed(name));
}

/** Builds the package of a project. */
export async function buildProject({ projectDir, mode = 'production', minify = false }: BuildOptions): Promise<BuildResult> {
  const entry = findSourceEntry(projectDir);
  if (!entry) {
    const { manifest, errors, warnings } = validatePackage(projectDir);
    throwIfErrors(errors, "Can't pack");
    return { packageDir: projectDir, manifest: manifest!, files: listPackageFiles(projectDir), warnings, bundled: false };
  }

  const manifestPath = path.join(projectDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    throwIfErrors([`Can't find ${MANIFEST_FILE}`], "Can't build");
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new IssuesError(`Can't build:\n  - ${MANIFEST_FILE} isn't valid JSON: ${(error as Error).message}`, [(error as Error).message]);
  }
  const { errors, warnings } = validateManifest(manifest, { packageDir: projectDir });
  if (fs.existsSync(path.join(projectDir, ENTRY_FILE))) {
    errors.push(`${ENTRY_FILE} is built from ${path.relative(projectDir, entry)}: delete the ${ENTRY_FILE} at the root of the project`);
  }
  const missing = missingDependencies(projectDir);
  if (missing.length > 0) {
    errors.push(`${missing.join(', ')} ${missing.length > 1 ? "aren't" : "isn't"} installed: run npm install in ${projectDir}`);
  }
  throwIfErrors(errors, "Can't build");

  const packageDir = path.join(projectDir, BUILD_DIR);
  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });

  // everything but the sources and the npm files goes into the package as it is
  const assets = listPackageFiles(projectDir).filter((name) => !name.startsWith(`${SOURCE_DIR}/`) && !BUILD_ONLY_FILES.has(name));
  for (const name of assets) {
    const destination = path.join(packageDir, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(projectDir, name), destination);
  }

  // loaded when needed: create and validate work without it
  const esbuild = await import('esbuild');
  let result;
  try {
    result = await esbuild.build({
      absWorkingDir: projectDir,
      entryPoints: [entry],
      outfile: path.join(packageDir, ENTRY_FILE),
      bundle: true,
      // a global script: the engine evaluates index.js, it isn't a module
      format: 'iife',
      platform: 'neutral',
      mainFields: ['browser', 'module', 'main'],
      conditions: ['browser'],
      target: TARGET,
      charset: 'utf8',
      minify,
      sourcemap: mode === 'development' ? 'inline' : false,
      define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
      logLevel: 'silent',
    });
  } catch (error) {
    const messages: Message[] | undefined = (error as { errors?: Message[] }).errors;
    if (!Array.isArray(messages)) throw error;
    const formatted = await esbuild.formatMessages(messages, { kind: 'error', color: useColor(process.stderr) });
    throw new IssuesError(`Build failed:\n${formatted.join('').trimEnd()}`, messages.map((message) => message.text));
  }
  if (result.warnings.length > 0) {
    const formatted = await esbuild.formatMessages(result.warnings, { kind: 'warning', color: useColor(process.stderr) });
    warnings.push(...formatted.map((text) => text.trimEnd()));
  }

  const built = validatePackage(packageDir);
  throwIfErrors(built.errors, "Can't build");
  return { packageDir, manifest, files: listPackageFiles(packageDir), warnings, bundled: true };
}
