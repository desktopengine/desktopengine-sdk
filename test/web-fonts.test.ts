// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The web runtime's FontFace and DesktopEngine.fonts behave as the app's: the same sources load (package files,
// defile://, blob: and data: URLs, local(), bytes; not http(s)), with the same checks, statuses, errors and messages,
// the set's loading, events and ready, and faces matched by style, then weight, as CSS matches them. The browser's
// faces are stand-ins here; Chrome and WebKit draw with the real ones (dev --web).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createFonts, dataURLBytes, fontDataProblem, matchFace, parseSources, parseStyle, parseWeight, type FontHost, type NativeFontFace } from '../web/frame/fonts.ts';

/** The first bytes of a TrueType font, enough for the runtime's check: the stand-in browser takes them */
const FONT = Uint8Array.from([0, 1, 0, 0, 0, 10, 0, 128, 0, 3, 0, 32, 1, 2, 3, 4]);
const NOT_A_FONT = new TextEncoder().encode('<html>not a font</html>');

interface Fake {
  host: FontHost;
  /** The browser's faces in the frame's document.fonts */
  document: Set<NativeFontFace>;
  /** What the stand-in browser was asked to load */
  loads: { family: string; source: Uint8Array | string; descriptors: { weight: string; style: string } }[];
  /** Lets the queued tasks run and the promises settle */
  settle(): Promise<void>;
}

function fake(files: Record<string, Uint8Array> = {}, blobs: Record<string, Uint8Array> = {}): Fake {
  const document = new Set<NativeFontFace>();
  const loads: Fake['loads'] = [];
  const host: FontHost = {
    fileBytes: (path) => files[path.replace(/^\.?\//, '')] ?? null,
    blobBytes: async (url) => blobs[url] ?? null,
    async loadNative(family, source, descriptors) {
      loads.push({ family, source, descriptors });
      if (typeof source === 'string' && !source.includes('Courier New')) throw new DOMException('not installed', 'NetworkError');
      return { family, weight: descriptors.weight, style: descriptors.style };
    },
    addNative: (face) => document.add(face),
    deleteNative: (face) => document.delete(face),
    queueTask: (callback) => setImmediate(callback),
  };
  const settle = async () => {
    for (let round = 0; round < 20; round++) await new Promise((resolve) => setImmediate(resolve));
  };
  return { host, document, loads, settle };
}

const errorOf = (promise: Promise<unknown>): Promise<[string, string] | null> =>
  promise.then(() => null, (error: DOMException) => [error.name, error.message]);

test('src lists, weights and styles parse as the engine parses them', () => {
  assert.deepEqual(parseSources('url(fonts/a.ttf)'), [{ url: 'fonts/a.ttf' }]);
  assert.deepEqual(parseSources(` url("fonts/My Font.otf") format("opentype"), url('b.woff2') format(woff2) tech(variations), local( "Avenir Next" ) `),
    [{ url: 'fonts/My Font.otf' }, { url: 'b.woff2' }, { local: 'Avenir Next' }]);
  // a format there's no reading skips the source
  assert.deepEqual(parseSources('url(a.eot) format("embedded-opentype"), url(a.svg) format("svg"), url(a.ttf)'), [{ url: 'a.ttf' }]);
  assert.deepEqual(parseSources('local(Courier New)'), [{ local: 'Courier New' }]);
  for (const invalid of ['', 'nonsense(', 'url(a.ttf) url(b.ttf)', 'url(a.ttf),', 'url()', 'a.ttf']) {
    assert.equal(parseSources(invalid), null, invalid);
  }
  assert.deepEqual(parseWeight('normal'), [400, 400]);
  assert.deepEqual(parseWeight('bold'), [700, 700]);
  assert.deepEqual(parseWeight(' 650 '), [650, 650]);
  assert.deepEqual(parseWeight('900 100'), [100, 900]);
  for (const invalid of ['heavy', '0', '1001', '100 200 300', 'bold 700']) assert.equal(parseWeight(invalid), null, invalid);
  assert.equal(parseStyle('Italic'), 'italic');
  assert.equal(parseStyle('oblique 10deg 20deg'), 'oblique');
  assert.equal(parseStyle('slanted'), null);
  assert.equal(parseStyle('oblique 10'), null);
});

test('fonts are checked as the app checks them, and data: URLs decode', () => {
  assert.equal(fontDataProblem(FONT), null);
  for (const tag of ['OTTO', 'true', 'ttcf', 'wOFF', 'wOF2']) {
    assert.equal(fontDataProblem(Uint8Array.from([...new TextEncoder().encode(tag), 0, 0, 0, 0, 0, 0, 0, 0])), null, tag);
  }
  assert.equal(fontDataProblem(NOT_A_FONT), "it isn't a TrueType, OpenType, WOFF or WOFF2 font");
  assert.equal(fontDataProblem(new Uint8Array(64 * 1024 * 1024 + 1)), "it's 64.0 MB, a font can be at most 64 MB");
  assert.deepEqual(dataURLBytes(`data:font/ttf;base64,${Buffer.from(FONT).toString('base64')}`), FONT);
  assert.deepEqual(dataURLBytes('data:,%00%01%00%00ab'), Uint8Array.from([0, 1, 0, 0, 97, 98]));
  assert.equal(dataURLBytes('data:nothing'), null);
});

test('faces are matched by style, then weight, as CSS and the engine match them', () => {
  const face = (family: string, minimumWeight: number, maximumWeight: number, style: 'normal' | 'italic' | 'oblique', name: string) =>
    ({ family, minimumWeight, maximumWeight, style, name });
  const faces = [
    face('Pair', 400, 400, 'normal', 'regular'),
    face('Pair', 700, 700, 'normal', 'bold'),
    face('Pair', 400, 400, 'italic', 'italic'),
    face('Other', 100, 900, 'normal', 'other'),
  ];
  const pick = (italic: boolean, weight: number, family = 'Pair') => matchFace(faces, family, italic, weight)?.name ?? null;
  assert.equal(pick(false, 400), 'regular');
  assert.equal(pick(false, 300), 'regular');
  // up to 500 heavier first, then lighter
  assert.equal(pick(false, 500), 'regular');
  assert.equal(pick(false, 600), 'bold');
  assert.equal(pick(false, 900), 'bold');
  // style before weight
  assert.equal(pick(true, 700), 'italic');
  assert.equal(pick(false, 400, 'pair'), 'regular');
  assert.equal(pick(false, 250, 'other'), 'other');
  assert.equal(pick(false, 400, 'Missing'), null);
  // an italic falls back to oblique, then normal; a normal one to oblique before italic
  const slanted = [face('S', 400, 400, 'italic', 'italic'), face('S', 400, 400, 'oblique', 'oblique')];
  assert.equal(matchFace(slanted, 'S', false, 400)?.name, 'oblique');
  assert.equal(matchFace([face('N', 400, 400, 'normal', 'normal')], 'N', true, 400)?.name, 'normal');
  // two equal faces: the last
  assert.equal(matchFace([face('E', 400, 400, 'normal', 'first'), face('E', 400, 400, 'normal', 'second')], 'E', false, 400)?.name, 'second');
});

test('a face from a package file loads on load(), and the set follows it as the app does', async () => {
  const { host, document, loads, settle } = fake({ 'fonts/a.ttf': FONT });
  const { FontFace, FontFaceSet, FontFaceSetLoadEvent, fonts } = createFonts(host);
  const face = new FontFace('TestSans', 'url(fonts/a.ttf) format("truetype")', { weight: '100 900' });
  assert.deepEqual([face.status, face.family, face.weight, face.style, fonts.status], ['unloaded', 'TestSans', '100 900', 'normal', 'loaded']);
  assert.equal(Object.prototype.toString.call(face), '[object FontFace]');
  assert.equal(Object.prototype.toString.call(fonts), '[object FontFaceSet]');
  assert.equal(FontFace.name, 'FontFace');
  assert.equal(FontFaceSet.name, 'FontFaceSet');
  assert.ok(new FontFaceSetLoadEvent('loading') instanceof Event);

  const events: string[] = [];
  fonts.addEventListener('loading', (event) => events.push(`${event.type}:${(event as InstanceType<typeof FontFaceSetLoadEvent>).fontfaces.length}`));
  fonts.onloadingdone = (event) => events.push(`${event.type}:${(event as InstanceType<typeof FontFaceSetLoadEvent>).fontfaces[0] === face}`);
  assert.equal(fonts.add(face), fonts);
  assert.equal(fonts.check('40px TestSans'), false);
  assert.equal(fonts.check('40px Unknown'), true);
  assert.equal(document.size, 0);

  const loading = face.load();
  assert.equal(loading, face.loaded);
  assert.deepEqual([face.status, fonts.status], ['loading', 'loading']);
  const ready = fonts.ready;
  assert.equal(await loading, face);
  assert.equal(await ready, fonts);
  await settle();
  assert.deepEqual(events, ['loading:0', 'loadingdone:true']);
  assert.deepEqual([face.status, fonts.status, fonts.check('40px TestSans')], ['loaded', 'loaded', true]);
  // the browser's face, in the document while it's loaded and in the set
  assert.equal(loads.length, 1);
  assert.deepEqual([loads[0].family, loads[0].descriptors], ['TestSans', { weight: '100 900', style: 'normal' }]);
  assert.equal(document.size, 1);
  const [native] = document;
  face.weight = 'bold';
  face.family = '"Renamed Sans"';
  assert.deepEqual([native.family, native.weight], ['Renamed Sans', 'bold']);
  assert.deepEqual([fonts.size, fonts.has(face), [...fonts].length, [...fonts.values()][0] === face], [1, true, 1, true]);
  assert.equal(fonts.delete(face), true);
  assert.equal(fonts.delete(face), false);
  assert.equal(document.size, 0);
  fonts.add(face);
  assert.equal(document.size, 1);
  fonts.clear();
  assert.deepEqual([fonts.size, document.size], [0, 0]);
});

test('bytes, blob: and data: URLs load; the set loads the faces a font picks', async () => {
  const { host, loads, settle } = fake({}, { 'blob:null/1': FONT });
  const { FontFace, fonts } = createFonts(host);
  const buffer = FONT.slice().buffer;
  const regular = new FontFace('Pair', buffer);
  assert.equal(regular.status, 'loading');
  // copied when it's made
  new Uint8Array(buffer).fill(0);
  const bold = new FontFace('Pair', new DataView(FONT.slice().buffer), { weight: 'bold' });
  const italic = new FontFace('Pair', 'url("blob:null/1")', { style: 'italic' });
  const data = new FontFace('Data', `url(data:font/ttf;base64,${Buffer.from(FONT).toString('base64')})`);
  for (const face of [regular, bold, italic, data]) fonts.add(face);
  const loaded = await fonts.load('italic 40px Pair, Helvetica');
  assert.deepEqual(loaded, [italic]);
  assert.deepEqual(await fonts.load('bold 12px Data, Pair'), [data, bold]);
  await settle();
  assert.deepEqual([regular.status, bold.status, italic.status, data.status], ['loaded', 'loaded', 'loaded', 'loaded']);
  assert.deepEqual(loads[0].source, FONT);
  assert.equal(await errorOf(fonts.load('Missing')).then((error) => error?.[0]), 'SyntaxError');
  assert.throws(() => fonts.check('bold'), { name: 'SyntaxError' });
});

test('failures are the web\'s errors, with the app\'s messages', async () => {
  const { host, settle } = fake({ 'fonts/text.ttf': NOT_A_FONT });
  const { FontFace, FontFaceSet, fonts } = createFonts(host);

  const missing = new FontFace('Missing', 'url(fonts/none.ttf)');
  assert.deepEqual(await errorOf(missing.load()), ['NetworkError', "Can't load the font fonts/none.ttf: the file doesn't exist"]);
  assert.equal(missing.status, 'error');
  // the last source's failure
  const text = new FontFace('Text', 'url(fonts/text.ttf), url(https://example.com/a.woff2)');
  assert.deepEqual(await errorOf(text.load()),
    ['NetworkError', "Can't load the font https://example.com/a.woff2: fonts aren't loaded from the network, fetch() the file and give the FontFace its bytes"]);
  const notAFont = new FontFace('Text', 'url(fonts/text.ttf)');
  assert.deepEqual(await errorOf(notAFont.load()), ['NetworkError', "Can't load the font fonts/text.ttf: it isn't a TrueType, OpenType, WOFF or WOFF2 font"]);
  const blob = new FontFace('Blob', 'url(blob:null/missing)');
  assert.deepEqual(await errorOf(blob.load()), ['NetworkError', "Can't load the font blob:null/missing: there's no such blob URL"]);

  const badSource = new FontFace('Bad', 'nonsense(');
  assert.equal(badSource.status, 'error');
  assert.equal((await errorOf(badSource.loaded))?.[0], 'SyntaxError');
  const badWeight = new FontFace('Bad', 'url(a.ttf)', { weight: 'heavy' });
  assert.deepEqual([badWeight.status, (await errorOf(badWeight.loaded))?.[0]], ['error', 'SyntaxError']);
  const badFamily = new FontFace('  ', 'url(a.ttf)');
  assert.equal((await errorOf(badFamily.loaded))?.[0], 'SyntaxError');

  const bytes = new FontFace('Bytes', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));
  assert.equal(bytes.status, 'loading');
  assert.deepEqual(await errorOf(bytes.loaded), ['SyntaxError', "Can't load the font data: it isn't a TrueType, OpenType, WOFF or WOFF2 font"]);
  assert.equal(bytes.status, 'error');

  const local = new FontFace('Local', 'local("No Such Font 12345"), local(Courier New)');
  assert.equal(await errorOf(local.load()), null);
  assert.equal(local.status, 'loaded');
  const noLocal = new FontFace('Local', 'local("No Such Font 12345")');
  assert.deepEqual(await errorOf(noLocal.load()), ['NetworkError', "Can't load the font local(No Such Font 12345): no installed font has that name"]);

  assert.throws(() => new (FontFace as unknown as new (family: string) => unknown)('One'), TypeError);
  assert.throws(() => { local.weight = 'heavy'; }, { name: 'SyntaxError' });
  assert.equal(local.weight, 'normal');
  assert.throws(() => fonts.add({} as InstanceType<typeof FontFace>), TypeError);
  assert.throws(() => new (FontFaceSet as unknown as new () => unknown)(), TypeError);

  const errors: number[] = [];
  fonts.onloadingerror = (event) => errors.push((event as unknown as { fontfaces: unknown[] }).fontfaces.length);
  const failing = new FontFace('Failing', 'url(fonts/none.ttf)');
  fonts.add(failing);
  await errorOf(failing.load());
  await settle();
  assert.deepEqual(errors, [1]);
});
