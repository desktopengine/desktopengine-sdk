// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// DesktopEngine.systemAudio's analysis, as the app makes it: 128 fine bands from 30 Hz to 16 kHz, spaced evenly in
// octaves, each the power per octave relative to a full-scale sine, tilted +3 dB per octave around 1 kHz and smoothed
// (a fast rise, a fall of 120 dB a second). Contents get them merged into fewer bands and scaled to 0...1. A browser
// can't hear the Mac: the frame plays a made-up signal like music, or the page analyses an audio element it plays
// (`WebDesktop.setSystemAudioSource`, `desktopengine dev --web`'s ♫ button).

export const FINE_BAND_COUNT = 128;
export const LOWEST_FREQUENCY = 30;
export const HIGHEST_FREQUENCY = 16000;
/** Analyses a second */
export const ANALYSIS_RATE = 60;
/** Bands content gets by default, and the most it may ask for unless it comes with DesktopEngine */
export const RESTRICTED_BAND_COUNT = 32;
/** Without the detailed analysis: a new analysis at most this often (ms), values rounded to multiples of 1/255 */
export const RESTRICTED_INTERVAL = 1000 / 30;
export const RESTRICTED_QUANTUM = 1 / 255;

export interface Snapshot {
  /** FINE_BAND_COUNT powers per octave */
  bands: Float32Array;
  /** Mean square of the samples */
  level: number;
}

export function emptySnapshot(): Snapshot {
  return { bands: new Float32Array(FINE_BAND_COUNT), level: 0 };
}

function bandEdge(index: number): number {
  return LOWEST_FREQUENCY * (HIGHEST_FREQUENCY / LOWEST_FREQUENCY) ** (index / FINE_BAND_COUNT);
}

function bandCenter(index: number): number {
  return Math.sqrt(bandEdge(index) * bandEdge(index + 1));
}

/** A band's power per octave as content gets it, 0...1: -80 dB...-12 dB */
export function normalizedBand(power: number): number {
  if (!(power > 0)) return 0;
  return Math.min(1, Math.max(0, (10 * Math.log10(power) + 80) / 68));
}

/** The level as content gets it, 0...1: -60 dB...0 dB */
export function normalizedLevel(meanSquare: number): number {
  if (!(meanSquare > 0)) return 0;
  return Math.min(1, Math.max(0, (10 * Math.log10(meanSquare) + 60) / 60));
}

/** Louder than -60 dB */
export function isAudible(meanSquare: number): boolean {
  return meanSquare > 1e-6;
}

/** Means of the fine bands for `count` bands over the same range, 0...1; `quantum` > 0 rounds them to multiples of it */
export function mergeBands(snapshot: Snapshot, target: Float32Array, count: number, quantum: number): void {
  count = Math.min(Math.max(1, count), FINE_BAND_COUNT);
  const step = FINE_BAND_COUNT / count;
  const filled = Math.min(count, target.length);
  for (let band = 0; band < filled; band++) {
    const start = band * step;
    const end = (band + 1) * step;
    let sum = 0;
    let weights = 0;
    for (let fine = Math.floor(start); fine < FINE_BAND_COUNT && fine < end; fine++) {
      const weight = Math.min(end, fine + 1) - Math.max(start, fine);
      sum += weight * snapshot.bands[fine];
      weights += weight;
    }
    const value = normalizedBand(weights > 0 ? sum / weights : 0);
    target[band] = quantum > 0 ? Math.round(value / quantum) * quantum : value;
  }
}

/** A made-up signal like music (a beat, a bass line, chords, hi-hats) at `time` seconds; the app makes the same */
export function syntheticSnapshot(time: number, snapshot: Snapshot = emptySnapshot()): Snapshot {
  const bassNotes = [55, 55, 65.41, 49];
  const chords = [[220, 277.18, 329.63], [246.94, 311.13, 369.99], [196, 246.94, 293.66], [220, 261.63, 329.63]];
  const beatLength = 0.5; // 120 beats a minute
  const beats = time / beatLength;
  const beatPhase = beats - Math.floor(beats);
  const beat = Math.floor(beats);
  const eighths = time / (beatLength / 2);
  const eighthPhase = eighths - Math.floor(eighths);
  const offbeat = Math.floor(eighths) % 2 === 1;
  const kick = Math.exp(-beatPhase * 6);
  const hat = offbeat ? Math.exp(-eighthPhase * 14) : 0;
  const bassNote = bassNotes[beat % 4];
  const chord = chords[Math.floor(beat / 8) % 4];

  for (let band = 0; band < FINE_BAND_COUNT; band++) {
    const frequency = bandCenter(band);
    const octave = Math.log2(frequency / 1000);
    let decibels = -60 + 6 * Math.sin((2 * Math.PI * time) / 7.3 + octave);
    if (frequency < 150) decibels += 36 * kick * (1 - frequency / 150);
    for (let harmonic = 1; harmonic <= 3; harmonic++) {
      const distance = Math.log2(frequency / (bassNote * harmonic));
      decibels += (28 / harmonic) * Math.exp(-(distance * distance) / (2 * 0.06 * 0.06)) * (0.6 + 0.4 * Math.exp(-beatPhase * 3));
    }
    for (const note of chord) {
      const distance = Math.log2(frequency / note);
      decibels += 24 * Math.exp(-(distance * distance) / (2 * 0.05 * 0.05));
    }
    if (frequency > 6000) decibels += 26 * hat;
    snapshot.bands[band] = 10 ** (decibels / 10);
  }
  snapshot.level = 10 ** ((-22 + 8 * kick + 2 * hat) / 10);
  return snapshot;
}

const FALL_FACTOR = 10 ** -0.2;
const RISE_AMOUNT = 0.7;

/** Rises 70% of the way to a louder value, falls to a quieter one by at most 2 dB */
function smooth(previous: number, value: number): number {
  if (value > previous) return previous + RISE_AMOUNT * (value - previous);
  return Math.max(value, previous * FALL_FACTOR);
}

/**
 * The analysis of a Web Audio AnalyserNode's spectrum (`getFloatFrequencyData`, with smoothingTimeConstant 0) into
 * `snapshot`, smoothing it: call it ANALYSIS_RATE times a second. `meanSquare` from its time-domain data.
 */
export function analyseSpectrum(decibels: Float32Array, sampleRate: number, fftSize: number, meanSquare: number, snapshot: Snapshot): void {
  // the analyser's Blackman window has a gain of 0.42 and a noise bandwidth of 1.73 bins, and it scales by 1/N: a
  // full-scale sine's bin is 0.21
  const binWidth = sampleRate / fftSize;
  const lastBin = decibels.length - 1;
  const power = (bin: number) => {
    // WebKit's analyser gives NaN at times, which would stay in the smoothed values for good
    const value = decibels[Math.min(bin, lastBin)];
    return Number.isFinite(value) ? 10 ** (value / 10) / (0.21 * 0.21 * 1.73) : 0;
  };
  for (let band = 0; band < FINE_BAND_COUNT; band++) {
    const low = bandEdge(band);
    const high = bandEdge(band + 1);
    const center = Math.sqrt(low * high);
    const first = Math.min(Math.ceil(low / binWidth), lastBin);
    const end = Math.min(Math.ceil(high / binWidth), lastBin + 1);
    const perOctave = center * Math.LN2 * (center / 1000);
    let value: number;
    if (end > first) {
      let sum = 0;
      for (let bin = first; bin < end; bin++) sum += power(bin);
      value = (sum * perOctave) / ((end - first) * binWidth);
    } else {
      const position = Math.min(center / binWidth, lastBin);
      const below = Math.floor(position);
      const fraction = position - below;
      value = ((power(below) * (1 - fraction) + power(below + 1) * fraction) * perOctave) / binWidth;
    }
    snapshot.bands[band] = smooth(snapshot.bands[band], value);
  }
  snapshot.level = smooth(snapshot.level, Number.isFinite(meanSquare) ? meanSquare : 0);
}
