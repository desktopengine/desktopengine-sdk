# 性能和暂停规则

壁纸、小组件和桌面伙伴一直待在桌面上，要尽量少占 CPU、GPU 和电量。

## 暂停规则

应用按内容的类型决定什么时候停止绘制、静音或暂停，参照 Wallpaper Engine 的播放规则，用户在「设置 › 壁纸 › 播放」里调整壁纸的规则：

| 情况 | 壁纸（动态壁纸和视频壁纸） | 小组件、桌面伙伴 |
| --- | --- | --- |
| 内容的窗口都看不见（被遮住、在其他应用的全屏空间里） | 停止绘制 | 停止绘制 |
| 壁纸所在的显示器上有全屏应用 | 按设置：继续运行、静音或暂停（默认暂停） | 不受影响 |
| 其他应用在播放声音（macOS 14.2 及以上） | 按设置（默认静音） | 不受影响 |
| 使用电池 | 按设置（默认暂停） | 最多 30 fps |
| 显示器睡眠 | 暂停并静音 | 暂停并静音 |

- 停止绘制：`requestAnimationFrame` 不再回调，画布不再提交；声音、视频和计时器照常。
- 暂停：同时暂停视频和声音（`AudioContext` 变成 `interrupted`，播放中的 `Audio` 元素暂停，恢复后继续），`setTimeout` / `setInterval` 的回调最多每秒执行一次，像浏览器的后台标签页。
- 静音：只是听不到声音，JavaScript 看不到任何变化。
- 同时满足几条时按影响更大的那条处理；用户的「所有内容静音」和每个内容的音量另外生效。

这些都由应用处理，内容不需要自己判断。帧率上限由用户在「设置 › 通用 › 性能」里统一调整。

## 帧率

- 不需要满帧的内容（缓慢的风景、低帧率的小组件）设 `DesktopEngine.preferredFramesPerSecond = 30`，而不是在 `requestAnimationFrame` 回调里跳过一半的帧：跳过的帧引擎根本不会执行，线程也不会被唤醒，唤醒次数减半。显示器的刷新率是它的整数倍时才生效（60 Hz 时可以是 60、30、20、15、12…），否则每帧都会执行；可以随时改，`0`（默认）跟随显示器。应用的限制（例如用电池时的 30 fps）照样生效，取两者中较低的那个。
- 不需要动画时停止 `requestAnimationFrame`，只在画面变化时重画（companion 模板的做法）。没有要画的帧时应用会停止驱动这个小程序的帧，唤醒次数可以降到 0。
- 不要用 `requestAnimationFrame` 计时：到点要做的事（例如番茄钟响铃）用 `setTimeout` 安排，画面在 `requestAnimationFrame` 里按当前时间来画。
- 定时器间隔不要比需要的短。

## 测量

`desktopengine dev --perf` 在终端最后一行每秒更新一次小程序的帧率、帧耗时、CPU、唤醒次数和内存：

```
60/60 fps · 1.2 ms (max 3.0) · CPU 12% · 60 wake-ups/s · JS 8.4 MB · canvas 36 MB
```

- `60/60 fps`：每秒真正画出新内容的帧数 / 目标帧率（显示器的刷新率，或应用限制的帧率，例如用电池时小组件是 30）。
- `1.2 ms (max 3.0)`：从显示器刷新到这一帧做完的平均和最长时间，包括 `requestAnimationFrame` 回调、布局、提交画布，以及等小程序线程空下来的时间。超过一帧时长的帧记为慢帧（`slow frames`，黄色显示）。
- `CPU 12%`：小程序线程占用一个 CPU 核心的比例（JavaScript、布局、绘图命令），不含音视频解码和 GPU。
- `60 wake-ups/s`：小程序线程每秒被唤醒的次数（帧、定时器、网络等）。桌面上常驻的内容要尽量少唤醒。
- `JS 8.4 MB`：JavaScript 堆的容量加上对象在堆外占用的内存（ArrayBuffer 等），约 5 秒更新一次。Mac App Store 版的 DesktopEngine 不显示这一项。
- `canvas 36 MB`：画布占用的显存，按各项的尺寸和格式累加（驱动额外的对齐和填充不算）：
  - 绘图缓冲：宽 × 高 × 4 字节，WebGL（和用到裁剪的 2D）再加同样大小的深度、模板缓冲；开了 `antialias` 时颜色另有一份 4 倍采样的缓冲，深度、模板缓冲也变成 4 倍（1024×1024 的 WebGL 画布：4 + 16 + 16 = 36 MB）；另有显示用的 IOSurface。按 `devicePixelRatio` 决定画布大小，不需要时别开 `antialias`。
  - WebGL 创建的纹理、缓冲和 renderbuffer：`texImage2D` / `texStorage2D` 等按尺寸和格式计算，`generateMipmap` 再加三分之一；`deleteTexture` 等删掉后就不再计入。纹理是 WebGL 内容里最常见的大头，能用压缩纹理（`WEBGL_compressed_texture_astc`）、较小的尺寸就用。
  - 画在 2D 画布上的图片。
- 看不见（被遮住）时显示 `drawing paused`，显示器睡眠等情况下显示 `suspended`，见[暂停规则](#暂停规则)。

「开发 › 显示性能 HUD」在每个运行中的小程序窗口右上角显示同样的数字，已安装的内容也包括在内。更细的分析用 Instruments：每一帧在 os_signpost 里是一个 `Frame` 区间（子系统 `app.desktopengine`，类别 `Rendering`），小程序的线程名是 `DesktopEngine JS: <名称>`。
