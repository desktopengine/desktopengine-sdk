#!/usr/bin/env node
// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TYPES, API_VERSION, MANIFEST_FILE, englishText, validatePackage } from './manifest.ts';
import type { Issues, Manifest } from './manifest.ts';
import { createProject, packProject, RENDERERS } from './project.ts';
import { buildProject, isBundledProject } from './build.ts';
import { DevServer, launchRequest, openURL } from './dev.ts';
import { apiBase, login, logout, publish } from './publish.ts';
import type { AppMessage, Metrics } from './dev.ts';

// one level below the SDK folder, in src/ and in dist/
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const HELP = `DesktopEngine SDK ${version} (API ${API_VERSION})

Usage:
  desktopengine create <type> <folder> [--renderer <renderer>] [--id <identifier>] [--name <name>]
      Creates a mini program from a template. Types: ${TYPES.join(', ')}
        --renderer <renderer>       a template drawn another way (three and pixi: then run npm install):
                                    ${Object.entries(RENDERERS).map(([type, list]) => `${type}: ${list.join(', ')}`).join('; ')}
  desktopengine validate [folder]
      Checks manifest.json and the entry, building src/ first. Default: the current folder
  desktopengine build [folder] [--minify]
      Bundles src/index.(ts|js), the modules and npm packages it imports into one index.js in dist/package/
  desktopengine dev [folder] [options]
      Runs the mini program in DesktopEngine, rebuilds and reloads it when files change, prints its console
        --size small|medium|large   widget size
        --level desktop|floating    on the desktop, or above all windows
        --display <number>          the display to run on, starting at 1
        --span                      a wallpaper across all displays, when manifest.json declares wallpaper.span
        --param <key=value>         a parameter value, can be repeated
        --position <x,y>            window position
        --port <port>               random by default
        --perf                      show the frame rate, frame time, CPU and wake-ups of the mini program
        --no-open                   print the URL that connects DesktopEngine instead of opening it
  desktopengine pack [folder] [--out <folder>] [--minify]
      Builds, checks and zips the package (into dist/ by default) for File › Import… in DesktopEngine
  desktopengine login [--api <url>]
      Signs in to the DesktopEngine store with a code you confirm in the browser
  desktopengine logout [--api <url>]
  desktopengine publish [folder] [options]
      Packs the project and uploads it as a new version of its item in the store
        --notes <text>              what's new in this version
        --network-purpose <text>    what the network permission is for (needed to submit with it)
        --submit                    submit the version for review
        --test-link                 make a link that installs this version in DesktopEngine, marked as a test
        --debug                     the test link's copy can be inspected in Safari's Web Inspector
        --api <url>                 another store API (or DESKTOPENGINE_API); DESKTOPENGINE_TOKEN signs in for CI
  desktopengine -h, --help | -v, --version

Projects with src/index.ts or src/index.js are bundled and can use import, TypeScript and npm packages;
projects without src/ are packed as they are, with index.js at the root as the entry.
`;

const USAGE: Record<string, string> = {
  create: 'desktopengine create <type> <folder> [--renderer <renderer>] [--id <identifier>] [--name <name>]',
  validate: 'desktopengine validate [folder]',
  build: 'desktopengine build [folder] [--minify]',
  dev: 'desktopengine dev [folder] [options]',
  pack: 'desktopengine pack [folder] [--out <folder>] [--minify]',
  login: 'desktopengine login [--api <url>]',
  logout: 'desktopengine logout [--api <url>]',
  publish: 'desktopengine publish [folder] [--notes <text>] [--network-purpose <text>] [--submit] [--test-link] [--debug] [--api <url>]',
};

export type FlagValue = string | boolean | (string | boolean)[];

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, FlagValue>;
}

/** Flags that never take a value: `dev --perf folder` keeps `folder` as the folder. */
const SWITCHES = new Set(['help', 'h', 'version', 'v', 'minify', 'perf', 'open', 'span', 'submit', 'test-link', 'debug']);

/** Flags given more than once become arrays, `--no-x` is `x: false`. */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, FlagValue> = {};
  const set = (key: string, value: string | boolean): void => {
    const existing = flags[key];
    flags[key] = existing === undefined ? value : ([] as (string | boolean)[]).concat(existing, value);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      if (inlineValue !== undefined) {
        set(key, inlineValue);
      } else if (key.startsWith('no-')) {
        set(key.slice(3), false);
      } else if (!SWITCHES.has(key) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        set(key, argv[++i]);
      } else {
        set(key, true);
      }
    } else if (/^-[A-Za-z]$/.test(arg)) {
      // -h, -v: a short switch
      set(arg.slice(1), true);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/** The last value of a flag that takes a value, `undefined` when it wasn't given one. */
function stringFlag(value: FlagValue | undefined): string | undefined {
  const last = Array.isArray(value) ? value[value.length - 1] : value;
  return typeof last === 'string' ? last : undefined;
}

/** Every value of a flag that can be repeated. */
function stringFlags(value: FlagValue | undefined): string[] {
  return (value === undefined ? [] : ([] as (string | boolean)[]).concat(value)).filter((item): item is string => typeof item === 'string');
}

/** A word for the shell, quoted when it has spaces or other special characters, e.g. a folder to copy from the output */
export function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Relative to the current folder when it's inside it, absolute otherwise. */
function displayPath(file: string): string {
  const relative = path.relative(process.cwd(), file);
  if (relative === '') return '.';
  return relative.startsWith('..') || path.isAbsolute(relative) ? file : relative;
}

function printIssues({ errors, warnings }: Issues): void {
  errors.forEach((message) => console.error(`error: ${message}`));
  warnings.forEach((message) => console.warn(`warning: ${message}`));
}

const color = (() => {
  const enabled = Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env);
  const wrap = (code: number) => (text: string): string => (enabled ? `\u001b[${code}m${text}\u001b[0m` : text);
  return { red: wrap(31), yellow: wrap(33), green: wrap(32), dim: wrap(2) };
})();

function time(): string {
  return color.dim(new Date().toTimeString().slice(0, 8));
}

/** Megabytes, with a decimal below 10. */
function formatMemory(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

/** One line for a `metrics` message of `dev --perf`. */
export function formatMetrics(metrics: Metrics): string {
  const memory = [
    metrics.jsMemory === undefined ? '' : ` · JS ${formatMemory(metrics.jsMemory)}`,
    ` · canvas ${formatMemory(metrics.canvasMemory)}`,
  ].join('');
  const usage = `CPU ${Math.round(metrics.cpu)}% · ${Math.round(metrics.wakeUps)} wake-ups/s${memory}`;
  if (metrics.state === 'suspended') return `suspended · ${usage}`;
  if (metrics.state === 'rendering-paused') return `drawing paused, no window is visible · ${usage}`;
  const frames = `${Math.round(metrics.fps)}/${metrics.targetFps} fps · ${metrics.frameTime.toFixed(1)} ms (max ${metrics.maxFrameTime.toFixed(1)})`;
  const slow = metrics.slowFrames > 0 ? ` · ${metrics.slowFrames} slow frame${metrics.slowFrames === 1 ? '' : 's'}` : '';
  return `${frames} · ${usage}${slow}`;
}

/**
 * `dev --perf` keeps the newest metrics on the last line of a terminal and prints the rest above it;
 * other output gets a line every 10 seconds.
 */
class StatusLine {
  private text = '';
  private lastPrinted = 0;
  private readonly isTTY = Boolean(process.stdout.isTTY);
  private readonly restore: (() => void)[] = [];

  constructor() {
    if (!this.isTTY) return;
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      const original = console[level];
      console[level] = (...args: unknown[]) => {
        const text = this.text;
        this.clear();
        original.apply(console, args);
        if (text) this.show(text);
      };
      this.restore.push(() => {
        console[level] = original;
      });
    }
  }

  show(text: string): void {
    if (!this.isTTY) {
      if (Date.now() - this.lastPrinted >= 10000) {
        this.lastPrinted = Date.now();
        console.log(`${time()} ${text}`);
      }
      return;
    }
    this.text = text;
    process.stdout.write(`\r\u001b[2K${text}`);
  }

  clear(): void {
    if (this.isTTY && this.text) {
      process.stdout.write('\r\u001b[2K');
    }
    this.text = '';
  }

  close(): void {
    this.clear();
    this.restore.forEach((restore) => restore());
  }
}

function printAppMessage(message: AppMessage): void {
  switch (message.type) {
    case 'console': {
      const text = String(message.message);
      if (message.level === 'error') console.error(`${time()} ${color.red(text)}`);
      else if (message.level === 'warn') console.warn(`${time()} ${color.yellow(text)}`);
      else if (message.level === 'debug') console.log(`${time()} ${color.dim(text)}`);
      else console.log(`${time()} ${text}`);
      break;
    }
    case 'exception':
      console.error(`${time()} ${color.red(`Uncaught exception: ${message.message}`)}`);
      if (message.stack) console.error(color.dim(String(message.stack).replace(/^/gm, '    ')));
      break;
    case 'host':
      console.log(`${time()} ${color.dim(`postMessage('host') ${JSON.stringify(message.message)}`)}`);
      break;
    case 'loaded':
      console.log(`${time()} ${color.green(`Loaded "${message.name}" ${message.version} (build ${message.revision})`)}`);
      break;
    case 'load-failed':
      console.error(`${time()} ${color.red(`Couldn't load build ${message.revision}: ${message.message}`)}`);
      break;
    case 'stopped':
      console.log(`${time()} ${color.dim('The mini program stopped, saving a file loads it again')}`);
      break;
    default:
      break;
  }
}

async function dev(projectDir: string, flags: Record<string, FlagValue>): Promise<number> {
  // the launch options depend on the manifest; build errors are printed and fixed while watching
  let manifest: Manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(projectDir, MANIFEST_FILE), 'utf8'));
  } catch (error) {
    console.error(`Can't read ${MANIFEST_FILE}: ${(error as Error).message}`);
    return 1;
  }
  const { launch, warnings } = launchRequest(manifest, {
    size: stringFlag(flags.size),
    level: stringFlag(flags.level),
    display: stringFlag(flags.display),
    span: flags.span === true,
    position: stringFlag(flags.position),
    params: stringFlags(flags.param),
  });
  warnings.forEach((message) => console.warn(`warning: ${message}`));

  const portFlag = stringFlag(flags.port);
  const port = portFlag === undefined ? 0 : Number(portFlag);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('--port must be an integer from 0 to 65535');
    return 1;
  }
  const shouldOpen = flags.open !== false;
  const perf = flags.perf === true;
  const server = new DevServer({ projectDir, launch, port, metrics: perf });
  const status = perf ? new StatusLine() : null;
  let connectTimer: NodeJS.Timeout | undefined;
  let everConnected = false;

  const connect = async (): Promise<void> => {
    if (!shouldOpen) return;
    try {
      await openURL(server.connectURL);
    } catch {
      console.error(color.red("Can't open DesktopEngine: is it installed? With --no-open you can open the connection URL yourself."));
      return;
    }
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      if (!server.isConnected) {
        console.warn(color.yellow("DesktopEngine hasn't connected yet: choose Allow in DesktopEngine."));
      }
    }, 10000);
  };

  server.on('built', ({ revision, manifest: built, warnings: buildWarnings }) => {
    buildWarnings.forEach((message) => console.warn(`warning: ${message}`));
    if (revision > 1) console.log(`${time()} ${color.dim(`Rebuilt "${englishText(built.name)}"`)}`);
    if ((built.apiVersion ?? 0) > API_VERSION) {
      console.warn(color.yellow(`manifest.json needs API ${built.apiVersion}, this SDK knows ${API_VERSION}`));
    }
    // the app went away (quit or disconnected): bring it back with the new build
    if (everConnected && !server.isConnected) void connect();
  });
  server.on('build-failed', (error) => console.error(`${time()} ${color.red(error.message)}`));
  server.on('connected', (hello) => {
    everConnected = true;
    clearTimeout(connectTimer);
    console.log(`${time()} ${color.green(`Connected to DesktopEngine ${hello.app || ''} (API ${hello.apiVersion})`)}`);
    if (server.revision === 0) {
      console.warn(color.yellow('Nothing to run yet: the mini program loads once the build succeeds, fix the error above'));
    }
    const needed = server.manifest?.apiVersion ?? 0;
    if (needed > hello.apiVersion) {
      console.warn(color.yellow(`manifest.json needs API ${needed}, this DesktopEngine has ${hello.apiVersion}: update the app`));
    }
  });
  server.on('disconnected', () => {
    status?.clear();
    console.log(`${time()} ${color.yellow('DesktopEngine disconnected, saving a file connects it again')}`);
  });
  server.on('app', (message) => {
    if (message.type === 'metrics') {
      const text = formatMetrics(message);
      status?.show(message.slowFrames > 0 ? color.yellow(text) : text);
      return;
    }
    // nothing runs anymore: the numbers are stale
    if (message.type === 'stopped' || message.type === 'load-failed') status?.clear();
    printAppMessage(message);
  });

  await server.start();
  console.log(`Serving ${displayPath(projectDir)} to DesktopEngine at 127.0.0.1:${server.port}, press Ctrl-C to stop`);
  if (shouldOpen) {
    await connect();
  } else {
    console.log(`Open this URL on the Mac to connect DesktopEngine:\n  ${server.connectURL}`);
  }

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      clearTimeout(connectTimer);
      status?.close();
      server.stop().then(resolve, resolve);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const [command, ...rest] = positional;

  if (flags.version || flags.v) {
    console.log(version);
    return 0;
  }
  if (!command || command === 'help' || flags.help || flags.h) {
    console.log(HELP);
    return command || flags.help || flags.h ? 0 : 1;
  }

  // `npm start create wallpaper x --renderer three` hands us `three` without the flag npm kept for itself
  const extra = rest.slice(command === 'create' ? 2 : 1);
  if (extra.length > 0 && command in USAGE) {
    console.error(`Unexpected argument${extra.length > 1 ? 's' : ''}: ${extra.join(' ')}`);
    if (process.env.npm_lifecycle_event) {
      console.error('npm run keeps options such as --renderer for itself, put -- before the command: npm start -- create …');
    }
    console.error(`usage: ${USAGE[command]}`);
    return 1;
  }

  switch (command) {
    case 'create': {
      const [type, dir] = rest;
      if (!type || !dir) {
        console.error(`usage: ${USAGE.create}`);
        return 1;
      }
      const targetDir = path.resolve(dir);
      const renderer = stringFlag(flags.renderer);
      const files = createProject({ type, renderer, targetDir, id: stringFlag(flags.id), name: stringFlag(flags.name) });
      console.log(`Created a ${type} mini program${renderer ? ` drawn with ${renderer}` : ''} in ${targetDir}:`);
      files.forEach((file) => console.log(`  ${file}`));
      // the templates drawn with a rendering library depend on npm packages
      // `-w` would be taken for an option: `./-w`
      const shown = displayPath(targetDir);
      const folder = shellQuote(shown.startsWith('-') ? `./${shown}` : shown);
      const install = files.includes('package.json') ? `cd ${folder} && npm install && desktopengine dev .` : `desktopengine dev ${folder}`;
      console.log(`\nNext: ${install}`);
      return 0;
    }
    case 'validate': {
      const packageDir = path.resolve(rest[0] || '.');
      if (isBundledProject(packageDir)) {
        const { manifest, warnings } = await buildProject({ projectDir: packageDir, mode: 'production' });
        printIssues({ errors: [], warnings });
        console.log(`${englishText(manifest.name)} (${manifest.id} ${manifest.version}) built, no problems found.`);
        return 0;
      }
      const result = validatePackage(packageDir);
      printIssues(result);
      if (result.errors.length > 0 || !result.manifest) {
        return 1;
      }
      console.log(`${englishText(result.manifest.name)} (${result.manifest.id} ${result.manifest.version}): no problems found.`);
      return 0;
    }
    case 'build': {
      const projectDir = path.resolve(rest[0] || '.');
      const { packageDir, files, warnings, bundled } = await buildProject({ projectDir, mode: 'production', minify: flags.minify === true });
      printIssues({ errors: [], warnings });
      if (!bundled) {
        console.log(`No src/index.*, nothing to build: the project is the package (${files.length} files).`);
      } else {
        console.log(`Built ${files.length} files: ${displayPath(packageDir)}`);
      }
      return 0;
    }
    case 'dev':
      return dev(path.resolve(rest[0] || '.'), flags);
    case 'pack': {
      const packageDir = path.resolve(rest[0] || '.');
      const out = stringFlag(flags.out);
      const outDir = out === undefined ? undefined : path.resolve(out);
      const { output, files, warnings } = await packProject({ packageDir, outDir, minify: flags.minify === true });
      printIssues({ errors: [], warnings });
      console.log(`Packed ${files.length} files: ${displayPath(output)}`);
      return 0;
    }
    case 'login': {
      const api = apiBase(stringFlag(flags.api));
      const { email } = await login({
        api,
        prompt: (code, url) => {
          console.log(`Confirm the code ${code} in the browser: ${url}`);
          openURL(url).catch(() => undefined);
        },
      });
      console.log(`Signed in as ${email}.`);
      return 0;
    }
    case 'logout': {
      const signedOut = await logout(apiBase(stringFlag(flags.api)));
      console.log(signedOut ? 'Signed out.' : 'You weren\'t signed in.');
      return 0;
    }
    case 'publish': {
      const result = await publish({
        projectDir: path.resolve(rest[0] || '.'),
        api: apiBase(stringFlag(flags.api)),
        notes: stringFlag(flags.notes),
        networkPurpose: stringFlag(flags['network-purpose']),
        submit: flags.submit === true,
        testLink: flags['test-link'] === true,
        debug: flags.debug === true,
      });
      printIssues({ errors: result.errors, warnings: result.warnings });
      if (result.errors.length) {
        console.error(`${result.id} ${result.version} was uploaded, but the checks found problems: fix them and publish again.`);
        return 1;
      }
      if (result.testLink) console.log(`Test link: ${result.testLink}`);
      console.log(
        result.status === 'queued'
          ? `${result.id} ${result.version} is submitted for review.`
          : `${result.id} ${result.version} is uploaded as a draft: submit it with --submit, or in the creator console.`,
      );
      return 0;
    }
    default:
      console.error(`Unknown command "${command}"\n`);
      console.log(HELP);
      return 1;
  }
}

/** Run as a command, including through the symlink npm creates for `bin`. */
function isEntryPoint(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return fs.realpathSync(script) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: Error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
