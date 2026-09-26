# Audio

The runtime has the `Audio` element (`HTMLAudioElement`) and Web Audio (API 5). Making sound needs the [`audio` permission](/reference/manifest#permissions) in the manifest: without it `AudioContext` stays `suspended`, `resume()` and `audio.play()` fail with `NotAllowedError`, and videos are muted. `OfflineAudioContext` and `decodeAudioData` need no permission.

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

- Most audio libraries written for browsers read globals such as `window` and `document`, which the runtime doesn't have (there is no DOM). three.js audio works as it is in the template's `src/three/`. howler.js needs the project to provide stand-ins for `window`, `document`, `navigator` and `location`; its Web Audio mode loads sounds with `XMLHttpRequest`, which is there since API 6 (before that, only `html5: true` works).
- An allowed `AudioContext` is `running` right away: there is no user gesture to wait for on the desktop. When the app pauses content (see [Pausing](./performance#pausing)) it becomes `interrupted` and its time stops, then goes back to `running`; playing `Audio` elements pause too and continue afterwards. When drawing only stops, or the content is muted, sound isn't affected.
- The `src` of `Audio` can be a file in the package (with the same path rules as `require`) or a `defile://` address, and an http(s) address with the `network` permission; `data:` addresses aren't supported. It plays and decodes what macOS does: MP3, AAC / M4A, WAV, AIFF, CAF, FLAC, ALAC and more, and Ogg on newer systems; check with `canPlayType()`.
- Sound plays on the system's current output device and follows it when it changes; the default sample rate of `AudioContext` is the device's.
- Users can set the volume of each item of content in the app, or mute all content. It multiplies the volume the content sets, and the `volume` JavaScript reads doesn't change.
- When content is removed or stopped, all its sound stops at once.
- Reading the system's audio output (for music visualizers, say) isn't possible yet.
