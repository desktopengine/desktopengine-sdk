# Audio

The runtime has the `Audio` element (`HTMLAudioElement`) and Web Audio. Making sound needs the [`audio` permission](/reference/manifest#permissions) in the manifest: without it `AudioContext` stays `suspended`, `resume()` and `audio.play()` fail with `NotAllowedError`, and videos are muted. `OfflineAudioContext` and `decodeAudioData` need no permission.

```js
// Play a sound from the package
const chime = new Audio('sounds/chime.mp3');
chime.volume = 0.6;
chime.play();

// Web Audio: decode once, loop it, and visualize it with an AnalyserNode
const context = new AudioContext();
const analyser = context.createAnalyser();
analyser.connect(context.destination);
const buffer = await context.decodeAudioData(await (await fetch('sounds/loop.m4a')).arrayBuffer());
const source = new AudioBufferSourceNode(context, { buffer, loop: true });
source.connect(analyser);
source.start();

const levels = new Uint8Array(analyser.frequencyBinCount);
requestAnimationFrame(function draw() {
  analyser.getByteFrequencyData(levels);
  // ...
  requestAnimationFrame(draw);
});
```

## Nodes

`AudioBufferSourceNode`, `OscillatorNode` (with `PeriodicWave`), `ConstantSourceNode`, `GainNode`, `BiquadFilterNode`, `IIRFilterNode`, `DelayNode` (in feedback loops too), `StereoPannerNode`, `PannerNode` and `context.listener`, `AnalyserNode`, `DynamicsCompressorNode`, `ConvolverNode`, `WaveShaperNode`, `ChannelSplitterNode`, `ChannelMergerNode`. `AudioParam` has all the automation methods, and nodes can be connected to parameters for modulation.

There is no `AudioWorklet`, `ScriptProcessorNode`, `MediaElementAudioSourceNode` or media streams. `PannerNode`'s `HRTF` pans with equal power, like `equalpower`; `WaveShaperNode` takes `oversample` but doesn't oversample.

## Notes

- Most audio libraries written for browsers read globals such as `window` and `document`, which the runtime doesn't have (there is no DOM). three.js audio works as it is in the template's `src/three/`. howler.js needs the project to provide stand-ins for `window`, `document` and `location` (and `navigator` before API 5); its Web Audio mode loads sounds with `XMLHttpRequest`, which the runtime has.
- An allowed `AudioContext` is `running` right away: there is no user gesture to wait for on the desktop. When the app pauses content (see [Pausing](./performance#pausing)) it becomes `interrupted` and its time stops, then goes back to `running`; playing `Audio` elements pause too and continue afterwards. When drawing only stops, or the content is muted, sound isn't affected.
- The `src` of `Audio` can be a file in the package (with the same path rules as `require`) or a `defile://` address, and an http(s) address with the `network` permission; `data:` addresses aren't supported. It plays and decodes what macOS does: MP3, AAC / M4A, WAV, AIFF, CAF, FLAC, ALAC and more, and Ogg on newer systems; check with `canPlayType()`.
- Sound plays on the system's current output device and follows it when it changes; the default sample rate of `AudioContext` is the device's.
- Users can set the volume of each item of content in the app, or mute all content. It multiplies the volume the content sets, and the `volume` JavaScript reads doesn't change.
- When content is removed or stopped, all its sound stops at once.

## What the Mac plays

`DesktopEngine.systemAudio` follows what the Mac plays (music, videos, other apps; never your content's own sound), for music visualizers. It's an analysis, never the sound itself: how loud it is overall (`level`) and in bands from low to high (`getBands`), each 0...1. It needs the `system-audio` permission and `"apiVersion": 6`; content with it can't have `network` too, so that what's heard stays on the Mac. Without the permission `DesktopEngine.systemAudio` is `null`.

```js
const audio = DesktopEngine.systemAudio;
const bands = new Float32Array(audio?.bandCount ?? 0); // 32 by default

requestAnimationFrame(function draw() {
  if (audio) {
    audio.getBands(bands); // low to high, 0...1
    for (let i = 0; i < bands.length; i++) {
      // draw a bar bands[i] tall
    }
  }
  requestAnimationFrame(draw);
});
```

- Read it at your own pace, e.g. every frame: the values change up to 30 times a second, smoothed (they rise fast and fall within about half a second). The bands cover 30 Hz to 16 kHz, spaced evenly in octaves; set `bandCount` (1...`maxBandCount`, which is 32) for fewer, wider ones. `level` is the overall loudness, `active` says whether anything audible plays.
- The app listens only while content reads it (or listens to `activechange`) and another app plays sound, and stops 2 seconds after the last read and while the app pauses the content. Meanwhile macOS shows its recording indicator in the menu bar. To stop listening while the content is idle, stop reading and wait for `activechange`.
- The first time, macOS asks the user to allow DesktopEngine to record system audio. A user who doesn't allow it, or a Mac before macOS 14.2 (`supported` is false), gets silence: every band and `level` 0, and `active` false. Draw something calm for silence rather than an error.
- In the web preview (`desktopengine dev --web` and the store) it's a made-up signal like music. Press ♫ in `dev --web`'s menu bar to choose an audio file to hear instead.
