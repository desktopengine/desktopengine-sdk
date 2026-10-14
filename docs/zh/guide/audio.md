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
- `Audio` 的 `src` 可以是包内文件（与 `require` 相同的路径规则）和 `defile://` 地址，声明了 `network` 权限时也可以是 http(s) 地址；不支持 `data:` 和 `blob:` 地址（元素会失败，`error` 的代码是 `MEDIA_ERR_SRC_NOT_SUPPORTED`）。能播放和解码的格式就是 macOS 支持的：MP3、AAC / M4A、WAV、AIFF、CAF、FLAC、ALAC 等，较新的系统还支持 Ogg；用 `canPlayType()` 判断。
- 声音从系统当前的输出设备播放，跟随系统切换设备；`AudioContext` 的默认采样率是设备的采样率。
- 用户可以在应用里调节每个内容的音量，或者把所有内容静音。它乘在内容自己设置的音量之上，JavaScript 读到的 `volume` 不受影响。
- 内容被移除或停止时，所有声音立即停止。

## Mac 正在播放的声音

`DesktopEngine.systemAudio` 分析其他应用在 Mac 上播放的声音（音乐、视频等），用来做音乐可视化。DesktopEngine 自己播放的声音它都听不到：你的内容、其他内容、带声音的视频壁纸。它给的是分析结果，从不给声音本身：整体有多响（`level`），以及从低到高各个频带有多响（`getBands`），取值都在 0...1 之间。需要 `system-audio` 权限和 `"apiVersion": 6`，有它的内容不能同时有 `network`。没有这个权限时 `DesktopEngine.systemAudio` 是 `null`。

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

- 按自己的节奏读，比如每帧读一次：数值每秒最多变 30 次（所以在 60 Hz 的显示器上每两帧变一次），经过平滑（上升快，大约半秒内落下）。频带覆盖 30 Hz 到 16 kHz，按八度均匀分布；设置 `bandCount`（1...`maxBandCount`，即 32）可以得到更少、更宽的频带，它们由这 32 个合并而来。给 `bandCount` 设超出范围的数会被截到范围内，小数部分舍去；设成 `NaN` 或不是数字的值会被忽略。`level` 是整体响度，`active` 表示有没有听得见的声音在播放。
- 只有其他应用在播放音频、并且你的内容在读取 `systemAudio`（最后一次读取后 2 秒内）或监听 `activechange` 时，应用才会去听 Mac 的声音；应用暂停内容时不听。听的期间 macOS 会在菜单栏显示录音指示器。一直占着音频输出、其实只放出静音的应用（空闲的通话、占着声音输出的网页标签）也算在播放，所以内容没什么可显示时，要停止读取，并且移除 `activechange` 监听。`activechange` 不带数据，加上监听本身不会触发它。
- 第一次使用时，macOS 会请用户允许 DesktopEngine 录制系统音频。用户在 macOS 的询问里没有允许，或者系统早于 macOS 14.2（`supported` 为 false）时，听到的是静音：所有频带和 `level` 都是 0，`active` 为 false。静音时画一些安静的东西，不要当成错误。在早于 macOS 14.2 的系统上反正听不到声音，所以应用不会向用户询问 `system-audio`，内容不经询问就得到它。
- 网页预览（`desktopengine dev --web` 和商店）里是一段像音乐的合成信号。在 `dev --web` 的菜单栏点 ♫，可以选一个自己的音频文件来代替，分析方式和应用分析 Mac 播放的声音一样。浏览器播放不了的文件会被忽略，再点 ♫ 重新选。
