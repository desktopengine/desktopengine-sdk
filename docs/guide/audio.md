# 音频

运行时提供 `Audio` 元素（`HTMLAudioElement`）和 Web Audio（API 5）。发出声音需要在清单里声明 [`audio` 权限](/reference/manifest#权限-permissions)：没有它 `AudioContext` 一直是 `suspended`，`resume()` 和 `audio.play()` 以 `NotAllowedError` 失败，视频也会被静音；`OfflineAudioContext` 和 `decodeAudioData` 不需要权限。

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

- 为浏览器写的音频库大多会读取 `window`、`document` 等全局对象，运行时没有这些（没有 DOM）。three.js 的音频在模板的 `src/three/` 里已经可以直接用；howler.js 需要项目自己补上 `window`、`document`、`navigator`、`location` 的替身；它的 Web Audio 模式用 `XMLHttpRequest` 加载声音，API 6 起才有，之前只能用 `html5: true`。
- `AudioContext` 创建后在允许时直接是 `running`，桌面上没有需要等待的用户手势。应用暂停内容时（见[暂停规则](./performance#暂停规则)）它变成 `interrupted`，时间停止，恢复后回到 `running`；播放中的 `Audio` 元素同样暂停并在之后继续。只是停止绘制或静音时声音不受影响。
- `Audio` 的 `src` 可以是包内文件（与 `require` 相同的路径规则）和 `defile://` 地址，声明了 `network` 权限时也可以是 http(s) 地址；不支持 `data:` 地址。能播放和解码的格式就是 macOS 支持的：MP3、AAC / M4A、WAV、AIFF、CAF、FLAC、ALAC 等，较新的系统还支持 Ogg；用 `canPlayType()` 判断。
- 声音从系统当前的输出设备播放，跟随系统切换设备；`AudioContext` 的默认采样率是设备的采样率。
- 用户可以在应用里调节每个内容的音量，或者把所有内容静音。它乘在内容自己设置的音量之上，JavaScript 读到的 `volume` 不受影响。
- 内容被移除或停止时，所有声音立即停止。
- 还不能读取系统的音频输出（例如做音乐可视化）。
