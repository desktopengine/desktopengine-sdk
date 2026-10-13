// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// DesktopEngine.systemAudio: the manifest's rules for its permission, and the web runtime's analysis, which has to
// give what the app gives.

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateManifest } from '../src/manifest.ts';
import {
  FINE_BAND_COUNT, RESTRICTED_BAND_COUNT, analyseSpectrum, emptySnapshot, isAudible, mergeBands, normalizedBand, normalizedLevel,
  restrictedRefresh, syntheticSnapshot,
} from '../web/system-audio.ts';

const minimal = { id: 'com.example.visualizer', name: 'Visualizer', type: 'wallpaper', version: '1.0.0', preview: 'preview.png' };

test('the system-audio permission asks for the API that has DesktopEngine.systemAudio', () => {
  const { errors, warnings } = validateManifest({ ...minimal, permissions: ['system-audio'] });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((message) => message.includes('"apiVersion": 6')));
  const declared = validateManifest({ ...minimal, permissions: ['system-audio'], apiVersion: 6 });
  assert.deepEqual(declared, { errors: [], warnings: [] });
});

test('content that hears the Mac can\'t reach the network, unless its id is in the store\'s reserved namespace', () => {
  const both = { permissions: ['system-audio', 'network'], network: { domains: ['api.example.com'] }, apiVersion: 6 };
  const { errors } = validateManifest({ ...minimal, ...both });
  assert.ok(errors.some((message) => message.includes('"system-audio"') && message.includes('"network"')));
  assert.deepEqual(validateManifest({ ...minimal, ...both, id: 'app.desktopengine.official.visualizer' }).errors, []);
});

test('the made-up signal is the app\'s, sample for sample', () => {
  // what the app's made-up signal gives, merged into 8 bands
  const expected: Record<number, { bands: number[]; level: number }> = {
    0: { bands: [0.94323, 0.57393, 0.43852, 0.36286, 0.30314, 0.37207, 0.35904, 0.27561], level: 0.76667 },
    1.25: { bands: [0.39972, 0.34511, 0.44559, 0.41084, 0.37034, 0.36177, 0.53524, 0.59496], level: 0.6733 },
    7.9: { bands: [0.45775, 0.30742, 0.41252, 0.39453, 0.34231, 0.37738, 0.32602, 0.23678], level: 0.63444 },
  };
  for (const [time, { bands, level }] of Object.entries(expected)) {
    const snapshot = syntheticSnapshot(Number(time));
    const merged = new Float32Array(8);
    mergeBands(snapshot, merged, 8, false);
    merged.forEach((value, index) => assert.ok(Math.abs(value - bands[index]) < 1e-4, `${time}s band ${index}: ${value}`));
    assert.ok(Math.abs(normalizedLevel(snapshot.level) - level) < 1e-4);
  }
});

test('bands are merged, scaled to 0...1 and rounded as the app does', () => {
  const snapshot = syntheticSnapshot(3.3);
  const fine = new Float32Array(FINE_BAND_COUNT);
  mergeBands(snapshot, fine, FINE_BAND_COUNT, false);
  fine.forEach((value, index) => assert.equal(value, Math.fround(normalizedBand(snapshot.bands[index]))));

  const coarse = new Float32Array(32);
  mergeBands(snapshot, coarse, 32, true);
  for (const value of coarse) {
    assert.ok(value >= 0 && value <= 1);
    assert.ok(Math.abs(value * 255 - Math.round(value * 255)) < 1e-3);
  }

  // a shorter array gets what fits; the rest of a longer one is left alone
  const short = new Float32Array(3);
  mergeBands(snapshot, short, 32, true);
  assert.deepEqual([...short], [...coarse.slice(0, 3)]);
  const long = new Float32Array(40).fill(-1);
  mergeBands(snapshot, long, 32, true);
  assert.deepEqual([...long.slice(0, 32)], [...coarse]);
  assert.equal(long[32], -1);
  // without the detailed analysis, 32 at most
  mergeBands(snapshot, long, 40, true);
  assert.deepEqual([...long.slice(0, 32)], [...coarse]);
  assert.equal(long[32], -1);

  assert.equal(normalizedBand(0), 0);
  assert.equal(normalizedBand(1e9), 1);
  assert.equal(normalizedLevel(1), 1);
  assert.equal(normalizedLevel(1e-7), 0);
  assert.equal(isAudible(1e-3), false);
  assert.equal(isAudible(1.1e-3), true);
});

test('without the detailed analysis, every band count is made of the 32 bands, as the app makes it', () => {
  // what the app gives for the made-up signal at 3.3 s, in multiples of 1/255
  const expected: Record<number, number[]> = {
    1: [121],
    5: [80, 145, 108, 60, 77],
    12: [57, 91, 83, 136, 156, 96, 85, 69, 56, 54, 69, 85],
    32: [58, 56, 55, 99, 91, 63, 68, 95, 79, 109, 157, 160, 157, 97, 96, 94, 89, 84, 78, 72, 65, 60, 56, 53, 53, 54, 56, 66, 72, 78, 84, 90],
  };
  const snapshot = syntheticSnapshot(3.3);
  for (const [count, values] of Object.entries(expected)) {
    const merged = new Float32Array(Number(count));
    mergeBands(snapshot, merged, Number(count), true);
    assert.deepEqual([...merged].map((value) => Math.round(value * 255)), values, `${count} bands`);
  }

  // two analyses whose fine bands differ only within each of the 32 bands give the same for every count: reading them
  // all tells no more than the 32 bands do
  const even = emptySnapshot();
  const uneven = emptySnapshot();
  const shares = [0.5, 1.5, 0.75, 1.25];
  for (let band = 0; band < FINE_BAND_COUNT; band++) {
    // loud and quiet bands in turn, powers of 2 so that the shares add up exactly
    const coarse = Math.floor(band / 4);
    even.bands[band] = 2 ** (coarse % 2 ? -24 : -8 - (coarse % 3));
    uneven.bands[band] = even.bands[band] * shares[band % 4];
  }
  for (let count = 1; count <= RESTRICTED_BAND_COUNT; count++) {
    const a = new Float32Array(count);
    const b = new Float32Array(count);
    mergeBands(even, a, count, true);
    mergeBands(uneven, b, count, true);
    assert.deepEqual([...b], [...a], `${count} bands`);
  }
  // which merging the fine bands themselves would tell apart, even rounded
  const fromFine = (analysis: typeof even) => {
    const merged = new Float32Array(5);
    mergeBands(analysis, merged, 5, false);
    return [...merged].map((value) => Math.round(value * 255));
  };
  assert.notDeepEqual(fromFine(uneven), fromFine(even));
});

test('without the detailed analysis, content reading in every display frame gets a new analysis every other frame', () => {
  // a jitter of up to ±1 ms, the same every run
  let seed = 7;
  const jitter = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return (seed / 2 ** 31 - 0.5) * 2;
  };
  const read = (interval: number, duration: number) => {
    let next = -Infinity;
    const frames: number[] = [];
    for (let frame = 0; frame * interval < duration; frame++) {
      const refreshed = restrictedRefresh(next, 1000 + frame * interval + jitter());
      if (refreshed === null) continue;
      next = refreshed;
      frames.push(frame);
    }
    return frames;
  };
  const steps = (frames: number[]) => new Set(frames.slice(1).map((frame, index) => frame - frames[index]));
  assert.deepEqual(steps(read(1000 / 60, 10_000)), new Set([2]));
  assert.deepEqual(steps(read(1000 / 120, 10_000)), new Set([4]));
  assert.deepEqual(steps(read(1000 / 30, 10_000)), new Set([1]));
  // never more than 30 a second, however often it reads
  const often = read(1, 10_000);
  assert.ok(often.length <= 301, `${often.length} analyses in 10 s`);
  assert.ok(often.length >= 299, `${often.length} analyses in 10 s`);
});

test('a page\'s spectrum lands in the band of its frequency', () => {
  // an AnalyserNode's dB for a full-scale 1 kHz sine: its bin is 0.21 (Blackman window, scaled by 1/N), -13.6 dB
  const sampleRate = 48000;
  const fftSize = 4096;
  const decibels = new Float32Array(fftSize / 2).fill(-Infinity);
  const bin = Math.round(1000 / (sampleRate / fftSize));
  decibels[bin] = 20 * Math.log10(0.21);
  const snapshot = emptySnapshot();
  for (let i = 0; i < 30; i++) analyseSpectrum(decibels, sampleRate, fftSize, 0.5, snapshot);
  const loudest = snapshot.bands.indexOf(Math.max(...snapshot.bands));
  const frequency = 30 * (16000 / 30) ** ((loudest + 0.5) / FINE_BAND_COUNT);
  assert.ok(Math.abs(Math.log2(frequency / 1000)) < 0.1, `loudest band at ${frequency} Hz`);
  assert.ok(Math.abs(normalizedLevel(snapshot.level) - normalizedLevel(0.5)) < 0.01);
});
