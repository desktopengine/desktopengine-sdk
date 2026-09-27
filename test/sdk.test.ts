// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateManifest, validatePackage, englishText, TYPES } from '../src/manifest.ts';
import { createZip, readZip, crc32 } from '../src/zip.ts';
import { createProject, packProject, listPackageFiles, defaultId, RENDERERS } from '../src/project.ts';
import { buildProject } from '../src/build.ts';
import { affectsPackage } from '../src/files.ts';
import { parseArgs, formatMetrics } from '../src/cli.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
/** The app's repository, when the SDK is its SDK/ folder rather than the standalone desktopengine-sdk repository */
const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url));
const BUILTIN_CONTENT = path.join(REPOSITORY, 'Main', 'Resources', 'BuiltinContent');
/** The SDK's dev dependencies include the renderers' packages (three, pixi.js) */
const NODE_MODULES = fileURLToPath(new URL('../node_modules', import.meta.url));

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'desktopengine-sdk-'));
}

const minimal = { id: 'com.example.clock', name: '时钟', type: 'widget', version: '1.0.0', widget: { sizes: ['small'] }, icon: 'icon.png' };

test('crc32 matches the reference value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('zip round trip keeps names and contents', () => {
  const entries = [
    { name: 'manifest.json', data: Buffer.from('{"a":1}') },
    { name: 'assets/图片.txt', data: Buffer.from('中文内容'.repeat(100)) },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ];
  const zip = createZip(entries);
  const read = readZip(zip);
  assert.deepEqual(read.map((entry) => entry.name), entries.map((entry) => entry.name));
  read.forEach((entry, index) => assert.ok(entry.data.equals(entries[index].data)));
});

test('zip is readable by the system unzip when available', (t) => {
  const probe = spawnSync('unzip', ['-v']);
  if (probe.error) {
    t.skip('unzip is not installed');
    return;
  }
  const dir = tempDir();
  const archive = path.join(dir, 'a.zip');
  fs.writeFileSync(archive, createZip([{ name: 'folder/hello.txt', data: Buffer.from('hello '.repeat(50)) }]));
  const result = spawnSync('unzip', ['-t', archive]);
  assert.equal(result.status, 0, result.stdout.toString() + result.stderr.toString());
});

test('a minimal manifest is valid', () => {
  const { errors } = validateManifest(minimal);
  assert.deepEqual(errors, []);
});

test('missing and wrong fields are reported', () => {
  const { errors } = validateManifest({ id: 'bad id', type: 'gadget', version: 1 });
  assert.ok(errors.some((message) => message.includes('"id"')));
  assert.ok(errors.some((message) => message.includes('"name" is missing')));
  assert.ok(errors.some((message) => message.includes('"type"')));
  assert.ok(errors.some((message) => message.includes('"version"')));
});

test('a wallpaper can declare that it spans all displays', () => {
  const wallpaper = { ...minimal, type: 'wallpaper' };
  const spanning = validateManifest({ ...wallpaper, wallpaper: { span: true } });
  assert.deepEqual(spanning.errors, []);
  assert.ok(!spanning.warnings.some((message) => message.includes('unknown')));
  assert.ok(validateManifest({ ...wallpaper, wallpaper: { span: 'yes' } }).errors.some((message) => message.includes('wallpaper.span')));
  assert.ok(validateManifest({ ...wallpaper, wallpaper: true }).errors.some((message) => message.includes('"wallpaper"')));
  const widget = validateManifest({ ...minimal, type: 'widget', widget: { sizes: ['small'] }, wallpaper: { span: true } });
  assert.deepEqual(widget.errors, []);
  assert.ok(widget.warnings.some((message) => message.includes('Only wallpapers')));
});

test('parameters follow the rules of the app', () => {
  const manifest = {
    ...minimal,
    parameters: [
      { key: 'a', title: 'A', type: 'toggle', default: 'yes' },
      { key: 'a', title: 'B', type: 'number', min: 5, max: 1 },
      { key: 'c', title: 'C', type: 'color', default: 'blue' },
      { key: 'd', title: 'D', type: 'choice' },
      { key: 'e', title: 'E', type: 'choice', options: [{ value: 1, title: 'one' }], default: 2 },
      { key: 'f', title: 'F', type: 'text', default: ['array'] },
      { key: 'g', title: 'G', type: 'slider' },
    ],
  };
  const { errors } = validateManifest(manifest);
  const expected = ['parameters[0].default', 'parameters[1].key', 'parameters[1]": min', 'parameters[2].default', 'parameters[3].options', 'parameters[4].default', 'parameters[5].default', 'parameters[6].type'];
  expected.forEach((fragment) => assert.ok(errors.some((message) => message.includes(fragment)), `expected an error about ${fragment}\n${errors.join('\n')}`));
});

test('unknown permissions and fields are warnings, not errors', () => {
  const { errors, warnings } = validateManifest({ ...minimal, permissions: ['camera'], extra: true });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((message) => message.includes('camera')));
  assert.ok(warnings.some((message) => message.includes('extra')));
});

test('text can be translated', () => {
  const translated = {
    ...minimal,
    name: { en: 'Clock', 'zh-Hans': '时钟' },
    description: { en: 'The time', 'zh-Hans': '时间' },
    parameters: [{ key: 'a', title: { en: 'Style', 'zh-Hans': '样式' }, type: 'choice', options: [{ value: 1, title: { en: 'One', 'zh-Hans': '一' } }] }],
  };
  assert.deepEqual(validateManifest(translated), { errors: [], warnings: [] });

  const { errors, warnings } = validateManifest({
    ...minimal,
    name: {},
    description: { en: '' },
    parameters: [{ key: 'a', title: { 'zh-Hans': '样式', chinese: '样式' }, type: 'toggle' }],
  });
  ['"name" has no translations', '"description.en"'].forEach((fragment) =>
    assert.ok(errors.some((message) => message.includes(fragment)), `expected an error about ${fragment}\n${errors.join('\n')}`));
  ['"chinese"', '"parameters[0].title" has no "en"'].forEach((fragment) =>
    assert.ok(warnings.some((message) => message.includes(fragment)), `expected a warning about ${fragment}\n${warnings.join('\n')}`));
});

test('icon paths must stay inside the package', () => {
  const { errors } = validateManifest({ ...minimal, icon: '../secret.png' });
  assert.ok(errors.some((message) => message.includes('"icon"')));
});

test('defaultId turns a folder name into a reverse DNS id', () => {
  assert.equal(defaultId('My Clock!'), 'com.example.my-clock');
  assert.equal(defaultId('---'), 'com.example.app');
});

for (const type of TYPES) {
  test(`the ${type} template creates a valid package that packs`, async () => {
    const dir = path.join(tempDir(), `my-${type}`);
    const files = createProject({ type, targetDir: dir, name: '我的 "测试"' });
    assert.ok(files.includes('manifest.json'));
    assert.ok(files.includes(path.join('src', 'index.ts')));
    assert.ok(files.includes('tsconfig.json'));
    assert.ok(files.includes('.gitignore'));
    assert.ok(files.includes(path.join('types', 'desktop-engine.d.ts')));
    assert.ok(!files.includes('index.js'), 'index.js is built from src/');

    const { manifest, packageDir, bundled } = await buildProject({ projectDir: dir });
    assert.ok(bundled);
    assert.equal(manifest.type, type);
    assert.equal(manifest.id, `com.example.my-${type}`);
    assert.equal(manifest.name, '我的 "测试"');

    // the built entry is a script the engine can evaluate
    const check = spawnSync(process.execPath, ['--check', path.join(packageDir, 'index.js')]);
    assert.equal(check.status, 0, check.stderr.toString());

    const { output } = await packProject({ packageDir: dir });
    assert.equal(path.basename(output), `com.example.my-${type}-1.0.0.zip`);
    const names = readZip(fs.readFileSync(output)).map((entry) => entry.name);
    assert.ok(names.includes('manifest.json'));
    assert.ok(names.includes('index.js'));
    // sources, editor helpers and build output stay out of the package
    assert.ok(!names.some((name) => name.startsWith('src/') || name.startsWith('types/') || name.startsWith('dist/') || ['tsconfig.json', '.gitignore'].includes(name)));
  });
}

for (const [type, renderers] of Object.entries(RENDERERS)) {
  for (const renderer of renderers) {
    test(`the ${type} template drawn with ${renderer} builds`, async () => {
      const dir = path.join(tempDir(), `my-${renderer}`);
      const files = createProject({ type, renderer, targetDir: dir });
      assert.ok(files.includes(path.join('src', 'index.ts')));
      // a rendering library comes from npm, WebGL is the engine's own
      if (files.includes('package.json')) {
        const { dependencies } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        assert.ok(Object.keys(dependencies).length > 0);
        // what npm install would do
        fs.symlinkSync(NODE_MODULES, path.join(dir, 'node_modules'), 'dir');
      }
      const { manifest, packageDir, files: built } = await buildProject({ projectDir: dir });
      assert.equal(manifest.type, type);
      assert.deepEqual(built.sort(), ['index.js', 'manifest.json'], 'npm files stay out of the package');
      const check = spawnSync(process.execPath, ['--check', path.join(packageDir, 'index.js')]);
      assert.equal(check.status, 0, check.stderr.toString());
    });
  }
}

test('create refuses a non-empty folder and an unknown type', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
  assert.throws(() => createProject({ type: 'widget', targetDir: dir }), /isn't empty/);
  assert.throws(() => createProject({ type: 'gadget', targetDir: path.join(dir, 'x') }), /Unsupported type/);
  assert.throws(() => createProject({ type: 'scene', targetDir: path.join(dir, 'w') }), /Unsupported type "scene"/);
  assert.throws(() => createProject({ type: 'wallpaper', renderer: 'babylon', targetDir: path.join(dir, 'y') }), /Unsupported renderer "babylon" for wallpaper/);
  assert.throws(() => createProject({ type: 'widget', renderer: 'pixi', targetDir: path.join(dir, 'z') }), /widget has no renderer templates/);
});

test('pack refuses an invalid package', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id: 'x' }));
  await assert.rejects(packProject({ packageDir: dir }), /Can't pack/);
});

test('listPackageFiles skips hidden helpers and archives', () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), '');
  fs.writeFileSync(path.join(dir, '.DS_Store'), '');
  fs.writeFileSync(path.join(dir, 'old.zip'), '');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'a.png'), '');
  fs.writeFileSync(path.join(dir, 'index.js'), '');
  assert.deepEqual(listPackageFiles(dir), ['assets/a.png', 'index.js']);
});

test('listPackageFiles leaves out hidden files, which can hold secrets', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'index.js'), '');
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=secret');
  fs.writeFileSync(path.join(dir, '.npmrc'), '//registry.npmjs.org/:_authToken=secret');
  fs.mkdirSync(path.join(dir, '.vscode'));
  fs.writeFileSync(path.join(dir, '.vscode', 'settings.json'), '{}');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', '.env.local'), 'API_KEY=secret');
  fs.writeFileSync(path.join(dir, 'assets', 'a.png'), '');
  assert.deepEqual(listPackageFiles(dir), ['assets/a.png', 'index.js']);
  assert.equal(affectsPackage('.env'), false);
  assert.equal(affectsPackage('assets/.env.local'), false);
  assert.equal(affectsPackage('assets/a.png'), true);
});

test('listPackageFiles leaves out the build output and the types of the project, not folders so named deeper', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'index.js'), '');
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
  for (const folder of ['dist', 'types', 'assets/dist', 'assets/types']) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
    fs.writeFileSync(path.join(dir, folder, 'a.png'), '');
  }
  fs.writeFileSync(path.join(dir, 'assets', 'tsconfig.json'), '{}');
  assert.deepEqual(listPackageFiles(dir), ['assets/dist/a.png', 'assets/tsconfig.json', 'assets/types/a.png', 'index.js']);
  assert.equal(affectsPackage('types/desktop-engine.d.ts'), false);
  assert.equal(affectsPackage('assets/types/a.png'), true);
});

test('listPackageFiles takes a symbolic link as what it links to', () => {
  const dir = tempDir();
  const shared = tempDir();
  fs.writeFileSync(path.join(shared, 'font.ttf'), 'font');
  fs.mkdirSync(path.join(shared, 'sounds'));
  fs.writeFileSync(path.join(shared, 'sounds', 'ding.mp3'), 'ding');
  fs.writeFileSync(path.join(dir, 'index.js'), '');
  fs.symlinkSync(path.join(shared, 'font.ttf'), path.join(dir, 'font.ttf'));
  fs.symlinkSync(path.join(shared, 'sounds'), path.join(dir, 'sounds'));
  assert.deepEqual(listPackageFiles(dir), ['font.ttf', 'index.js', 'sounds/ding.mp3']);

  fs.symlinkSync(path.join(shared, 'missing.png'), path.join(dir, 'missing.png'));
  assert.throws(() => listPackageFiles(dir), /missing\.png is a symbolic link to a file that doesn't exist/);
  fs.unlinkSync(path.join(dir, 'missing.png'));

  fs.symlinkSync(dir, path.join(dir, 'sounds', 'loop'));
  assert.throws(() => listPackageFiles(dir), /links to a folder that contains it/);
});

test('the CLI names a mini program by its English name', () => {
  assert.equal(englishText('时钟'), '时钟');
  assert.equal(englishText({ 'zh-Hans': '时钟', en: 'Clock' }), 'Clock');
  assert.equal(englishText({ 'zh-Hans': '时钟' }), '时钟');

  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...minimal, icon: undefined, name: { 'zh-Hans': '时钟', en: 'Clock' } }));
  fs.writeFileSync(path.join(dir, 'index.js'), '');
  const result = spawnSync(process.execPath, [CLI, 'validate', dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Clock \(com\.example\.clock 1\.0\.0\): no problems found\./m);
});

test('parseArgs reads positional arguments and flags', () => {
  assert.deepEqual(parseArgs(['create', 'widget', 'dir', '--id', 'a.b', '--name=名字', '--force']), {
    positional: ['create', 'widget', 'dir'],
    flags: { id: 'a.b', name: '名字', force: true },
  });
  assert.deepEqual(parseArgs(['dev', '--param', 'a=1', '--param=b=x=y', '--no-open']), {
    positional: ['dev'],
    flags: { param: ['a=1', 'b=x=y'], open: false },
  });
  // switches don't take the folder as their value
  assert.deepEqual(parseArgs(['dev', '--perf', 'dir', '--minify']), {
    positional: ['dev', 'dir'],
    flags: { perf: true, minify: true },
  });
  // short switches; a value that starts with a dash stays a value
  assert.deepEqual(parseArgs(['-v']), { positional: [], flags: { v: true } });
  assert.deepEqual(parseArgs(['pack', '-h']), { positional: ['pack'], flags: { h: true } });
  assert.deepEqual(parseArgs(['dev', '--position', '-10,20']), { positional: ['dev'], flags: { position: '-10,20' } });
});

test('formatMetrics sums up a second of the mini program', () => {
  const metrics = { type: 'metrics', state: 'running', fps: 59.6, targetFps: 60, frameTime: 1.24, maxFrameTime: 3, slowFrames: 0, cpu: 12.4, wakeUps: 60.2, canvasMemory: 46_137_344 } as const;
  assert.equal(formatMetrics(metrics), '60/60 fps · 1.2 ms (max 3.0) · CPU 12% · 60 wake-ups/s · canvas 44 MB');
  assert.equal(formatMetrics({ ...metrics, slowFrames: 1 }), '60/60 fps · 1.2 ms (max 3.0) · CPU 12% · 60 wake-ups/s · canvas 44 MB · 1 slow frame');
  assert.equal(formatMetrics({ ...metrics, state: 'rendering-paused', cpu: 0, wakeUps: 1 }), 'drawing paused, no window is visible · CPU 0% · 1 wake-ups/s · canvas 44 MB');
  assert.equal(formatMetrics({ ...metrics, state: 'suspended', cpu: 0, wakeUps: 1 }), 'suspended · CPU 0% · 1 wake-ups/s · canvas 44 MB');
  // JS memory only from Developer ID and Debug builds of the app
  assert.equal(formatMetrics({ ...metrics, jsMemory: 126_877_696, canvasMemory: 6_291_456 }), '60/60 fps · 1.2 ms (max 3.0) · CPU 12% · 60 wake-ups/s · JS 121 MB · canvas 6.0 MB');
});

test('the CLI refuses arguments it has no use for', () => {
  // what `npm start create wallpaper x --renderer three` passes on: npm keeps --renderer
  const root = tempDir();
  const dir = path.join(root, 'x');
  const result = spawnSync(process.execPath, [CLI, 'create', 'wallpaper', dir, 'three'], { encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: 'start' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unexpected argument: three/);
  assert.match(result.stderr, /npm start -- create/);
  assert.equal(fs.existsSync(dir), false);
});

test('the CLI creates, validates and packs a project', () => {
  const root = tempDir();
  const dir = path.join(root, 'clock');
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });

  let result = run('create', 'widget', dir, '--id', 'com.example.clock');
  assert.equal(result.status, 0, result.stderr);

  result = run('validate', dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no problems found/);

  result = run('pack', dir, '--out', path.join(root, 'out'));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(root, 'out', 'com.example.clock-1.0.0.zip')));

  result = run('validate', root);
  assert.equal(result.status, 1);

  result = run('unknown');
  assert.equal(result.status, 1);
});

test('the built-in content of the app is valid and its shared code is in sync', {
  skip: !fs.existsSync(BUILTIN_CONTENT) && 'not in the app repository',
}, () => {
  const root = BUILTIN_CONTENT;
  const packages = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  assert.ok(packages.length > 0);

  const ids = new Set<string>();
  for (const entry of packages) {
    const dir = path.join(root, entry.name);
    const { manifest, errors } = validatePackage(dir);
    assert.deepEqual(errors, [], `${entry.name}\n${errors.join('\n')}`);
    const id = manifest?.id ?? '';
    assert.equal(id, entry.name, 'the folder is named after the id');
    assert.ok(!ids.has(id));
    ids.add(id);

    for (const file of listPackageFiles(dir).filter((name) => name.endsWith('.js'))) {
      const check = spawnSync(process.execPath, ['--check', path.join(dir, file)]);
      assert.equal(check.status, 0, `${entry.name}/${file}\n${check.stderr}`);
    }
  }

  const sync = spawnSync(path.join(REPOSITORY, 'Main', 'BuiltinContentSource', 'sync.sh'), ['--check'], { encoding: 'utf8' });
  assert.equal(sync.status, 0, sync.stderr);
});
