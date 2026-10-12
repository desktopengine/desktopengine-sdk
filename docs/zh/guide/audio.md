# 音频

运行时提供 `Audio` 元素（`HTMLAudioElement`）和 Web Audio。发出声音需要在清单里声明 [`audio` 权限](/zh/reference/manifest#权限-permissions)：没有它 `AudioContext` 一直是 `suspended`，`resume()` 和 `audio.play()` 以 `NotAllowedError` 失败，视频也会被静音；`OfflineAudioContext` 和 `decodeAudioData` 不需要权限。

```js
// 播放包里的音效
const chime = new Audio('sounds/chime.mp3');
chime.volume = 0.6;
chime.play();

// Web Audio：解码后反复播放，用 AnalyserNode 做可视化
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

## 支持的节点

`AudioBufferSourceNode`、`OscillatorNode`（含 `PeriodicWave`）、`ConstantSourceNode`、`GainNode`、`BiquadFilterNode`、`IIRFilterNode`、`DelayNode`（可以在反馈回路里）、`StereoPannerNode`、`PannerNode` 和 `context.listener`、`AnalyserNode`、`DynamicsCompressorNode`、`ConvolverNode`、`WaveShaperNode`、`ChannelSplitterNode`、`ChannelMergerNode`。`AudioParam` 支持全部自动化方法，也可以把节点连到参数上做调制。

没有 `AudioWorklet`、`ScriptProcessorNode`、`MediaElementAudioSourceNode` 和媒体流。`PannerNode` 的 `HRTF` 与 `equalpower` 一样按等功率声像处理；`WaveShaperNode` 接受 `oversample` 但不做过采样。

## 说明

- 为浏览器写的音频库大多会读取 `window`、`document` 等全局对象，运行时没有这些（没有 DOM）。three.js 的音频在模板的 `src/three/` 里已经可以直接用；howler.js 需要项目自己补上 `window`、`document`、`location` 的替身（API 5 之前还有 `navigator`）；它的 Web Audio 模式用 `XMLHttpRequest` 加载声音，运行时也有。
- `AudioContext` 创建后在允许时直接是 `running`，桌面上没有需要等待的用户手势。应用暂停内容时（见[暂停规则](./performance#暂停规则)）它变成 `interrupted`，时间停止，恢复后回到 `running`；播放中的 `Audio` 元素同样暂停并在之后继续。只是停止绘制或静音时声音不受影响。
- `Audio` 的 `src` 可以是包内文件（与 `require` 相同的路径规则）和 `defile://` 地址，声明了 `network` 权限时也可以是 http(s) 地址；不支持 `data:` 地址。能播放和解码的格式就是 macOS 支持的：MP3、AAC / M4A、WAV、AIFF、CAF、FLAC、ALAC 等，较新的系统还支持 Ogg；用 `canPlayType()` 判断。
- 声音从系统当前的输出设备播放，跟随系统切换设备；`AudioContext` 的默认采样率是设备的采样率。
- 用户可以在应用里调节每个内容的音量，或者把所有内容静音。它乘在内容自己设置的音量之上，JavaScript 读到的 `volume` 不受影响。
- 内容被移除或停止时，所有声音立即停止。

## Mac 正在播放的声音

`DesktopEngine.systemAudio` 跟随 Mac 正在播放的声音（音乐、视频、其它应用；不包括内容自己发出的声音），用来做音乐可视化。它给的是分析结果，从不给声音本身：整体有多响（`level`），以及从低到高各个频带有多响（`getBands`），都是 0...1。需要 `system-audio` 权限和 `"apiVersion": 6`；有它的内容不能同时有 `network`，这样听到的东西留在 Mac 上。没有这个权限时 `DesktopEngine.systemAudio` 是 `null`。

```js
const audio = DesktopEngine.systemAudio;
const bands = new Float32Array(audio?.bandCount ?? 0); // 默认 32 个

requestAnimationFrame(function draw() {
  if (audio) {
    audio.getBands(bands); // 从低到高，0...1
    for (let i = 0; i < bands.length; i++) {
      // 画一根 bands[i] 高的柱子
    }
  }
  requestAnimationFrame(draw);
});
```

- 按自己的节奏读，比如每帧读一次：数值每秒最多变 30 次，经过平滑（上升快，大约半秒内落下）。频带覆盖 30 Hz 到 16 kHz，按八度均匀分布；设置 `bandCount`（1...`maxBandCount`，即 32）可以得到更少、更宽的频带。`level` 是整体响度，`active` 表示有没有听得见的声音在播放。
- 应用只在内容读取它（或监听 `activechange`）并且有其它应用在出声时才去听，最后一次读取 2 秒后、以及应用暂停内容时停止。听的期间 macOS 会在菜单栏显示录音指示器。内容闲着时想停止收听，就停止读取，等 `activechange`。
- 第一次使用时，macOS 会请用户允许 DesktopEngine 录制系统音频。用户不允许，或者 Mac 的系统早于 macOS 14.2（`supported` 为 false）时，听到的是静音：所有频带和 `level` 都是 0，`active` 为 false。静音时画一些安静的东西，不要当成错误。
- 网页预览（`desktopengine dev --web` 和商店）里是一段像音乐的合成信号。在 `dev --web` 的菜单栏按 ♫ 可以选一个音频文件来代替。
