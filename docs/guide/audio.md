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
- The `src` of `Audio` can be a file in the package (with the same path rules as `require`) or a `defile://` address, and an http(s) address with the `network` permission; `data:` and `blob:` addresses aren't supported (the element fails with an `error` of code `MEDIA_ERR_SRC_NOT_SUPPORTED`). It plays and decodes what macOS does: MP3, AAC / M4A, WAV, AIFF, CAF, FLAC, ALAC and more, and Ogg on newer systems; check with `canPlayType()`.
- Sound plays on the system's current output device and follows it when it changes; the default sample rate of `AudioContext` is the device's.
- The app's volume and mute are above everything the content plays, see [Volume and mute](#volume-and-mute). The `volume` JavaScript reads doesn't change.
- When content is removed or stopped, all its sound stops at once.

## Volume and mute

Each item of content that plays sound has a mute switch and a volume in the app, and users can mute all content. They're above what the content does, from the most to the least:

1. The app: Mute All Content, Pause All Content, the user's playback rules for wallpapers (e.g. while an app is full screen, or another app plays sound) and the displays sleeping
2. The item's mute switch. Content starts muted: users turn on the sound of what they want to hear
3. The item's volume, 0...1. It starts at the manifest's [`audio.volume`](/reference/manifest#audio), or 1, until the user sets one
4. The volumes the content sets in its code (`Audio.volume`, `GainNode`s, a `Video`'s `volume`): they only balance its own sounds

What's heard is the content's mix, kept to full scale, times the item's volume, and nothing while it's muted: a `GainNode` turned above 1 isn't louder than the volume the user set. This applies from the start, before `index.js` runs, so content isn't heard while it loads, and changes without restarting the content.

`DesktopEngine.audioSettings` (API 9) tells the content what the user set: `muted` is `true` while the user muted all content or this item, and `volume` is the item's volume. It's read only, right from `index.js`'s first line, and fires `change` when either changes. It's `undefined` without the `audio` permission. The other reasons the app mutes content (the playback rules, the displays sleeping, pausing) aren't told: `muted` stays `false` then.

```js
const settings = DesktopEngine.audioSettings;
let sounds = null;

async function update() {
  // load the sounds only once someone can hear them
  if (settings && !settings.muted && !sounds) {
    sounds = await loadSounds();
  }
}
settings?.addEventListener('change', update);
update();
```

Don't scale your sounds by `volume`: the app does. Use it to show something, e.g. a quieter animation at a low volume.

In the web preview (`desktopengine dev --web` and the store), `muted` is the page's sound switch, which starts off, and `volume` is the manifest's `audio.volume`, or 1; the page doesn't change the sound by it.

## What the Mac plays

`DesktopEngine.systemAudio` follows what other apps play on the Mac (music, videos…), for music visualizers. It never hears what DesktopEngine plays itself: your content, other content, a video wallpaper with sound. It's an analysis, never the sound itself: how loud it is overall (`level`) and in bands from low to high (`getBands`), each 0...1. It needs the `system-audio` permission and `"apiVersion": 6`, and content with it can't have `network` too. Without the permission `DesktopEngine.systemAudio` is `null`.

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

- Read it at your own pace, e.g. every frame: the values change up to 30 times a second (so on a 60 Hz display, every other frame), smoothed (they rise fast and fall within about half a second). The bands cover 30 Hz to 16 kHz, spaced evenly in octaves; set `bandCount` (1...`maxBandCount`, which is 32) for fewer, wider ones, merged from the 32. A `bandCount` out of range is clamped and its fraction dropped; setting `NaN` or anything but a number is ignored. `level` is the overall loudness, `active` says whether anything audible plays.
- The app listens to the Mac only while another app is playing audio and your content reads `systemAudio` (until 2 seconds after the last read) or listens to `activechange`, and never while the app pauses the content. Meanwhile macOS shows its recording indicator in the menu bar. An app that keeps its audio on while it plays only silence (an idle call, a browser tab holding its sound open) counts as playing, so when your content has nothing to show, stop reading and remove the `activechange` listener. `activechange` has no payload, and adding a listener doesn't fire it by itself.
- The first time, macOS asks the user to allow DesktopEngine to record system audio. A user who doesn't allow that, or a Mac before macOS 14.2 (`supported` is false), gets silence: every band and `level` 0, and `active` false. Draw something calm for silence rather than an error. On a Mac before macOS 14.2 the app doesn't ask the user about `system-audio`, since there's nothing to hear: the content gets it without asking.
- In the web preview (`desktopengine dev --web` and the store) it's a made-up signal like music. Press ♫ in `dev --web`'s menu bar to hear an audio file of yours instead, analysed as the app analyses what the Mac plays. A file the browser can't play is dropped: press ♫ again to choose another.
