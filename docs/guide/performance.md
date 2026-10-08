# Performance and Pausing

Wallpapers, widgets and desktop companions stay on the desktop all day, so they should take as little CPU, GPU and power as they can.

## Pausing

The app decides when to stop drawing, mute or pause content by its type, after Wallpaper Engine's playback rules. Users set the rules for wallpapers in Settings › Wallpaper › Playback:

| When | Wallpapers (dynamic and video) | Widgets and desktop companions |
| --- | --- | --- |
| None of the content's windows can be seen (covered, or in another app's full screen Space) | Stop drawing | Stop drawing |
| A full screen app is on the wallpaper's display | By the setting: keep running, mute or pause (pause by default) | Not affected |
| Another app plays sound (macOS 14.2 and later) | By the setting (mute by default) | Not affected |
| On battery | By the setting (pause by default) | At most 30 fps |
| The displays sleep | Pause and mute | Pause and mute |

- Stop drawing: `requestAnimationFrame` calls back no more and canvases aren't presented; sound, video and timers carry on.
- Pause: video and sound pause too (`AudioContext` becomes `interrupted`, playing `Audio` elements pause and continue afterwards), and `setTimeout` / `setInterval` callbacks run at most once a second, like in a browser's background tab.
- Mute: the sound can't be heard, and JavaScript sees no difference.
- When several apply, the one with the larger effect wins; the user's Mute All Content and the volume of each item apply on top.

The app does all this: the content doesn't check for any of it. Users set the frame rate limit in Settings › General › Performance.

A `Video` plays only while it's in a window: removed from it (itself or with a parent) or with its window destroyed, it pauses (firing `pause`) and lets go of its file, so nothing is read or decoded. Added to a window again, it continues where it was, playing if it was; `play()` and `seek()` in between take effect then, and a video played before it's added starts when it is. Moving it within a window doesn't interrupt it.

## Frame rate

- Content that doesn't need every frame (slow scenery, widgets with a low frame rate) should set `DesktopEngine.preferredFramesPerSecond = 30` rather than skip every other frame in its `requestAnimationFrame` callback: the engine doesn't run the skipped frames at all and doesn't wake the thread, so wake-ups are halved. It applies when the display's refresh rate is a multiple of it (60, 30, 20, 15, 12… at 60 Hz), otherwise every frame runs. It can change at any time; `0` (the default) follows the display. The app's limit (30 fps on battery, say) still applies, and the lower of the two wins.
- Stop `requestAnimationFrame` when nothing moves, and redraw only when the picture changes (as the companion template does). When there is no frame to draw, the app stops driving the mini program's frames, and its wake-ups can drop to 0.
- Don't keep time with `requestAnimationFrame`: schedule what has to happen at a time (a Pomodoro's chime, say) with `setTimeout`, and draw the picture for the current time in `requestAnimationFrame`.
- Don't make timer intervals shorter than you need.

## Measuring

`desktopengine dev --perf` updates the last line of the terminal every second with the mini program's frame rate, frame time, CPU, wake-ups and memory:

```
60/60 fps · 1.2 ms (max 3.0) · CPU 12% · 60 wake-ups/s · JS 8.4 MB · canvas 36 MB
```

- `60/60 fps`: the frames per second that actually drew something new / the target frame rate (the display's refresh rate, or the app's limit, e.g. 30 for widgets on battery).
- `1.2 ms (max 3.0)`: the average and longest time from the display's refresh to the frame being done, including the `requestAnimationFrame` callbacks, layout, presenting canvases, and waiting for the mini program's thread to be free. Frames longer than a frame's time are slow frames (`slow frames`, in yellow).
- `CPU 12%`: the share of one CPU core the mini program's thread takes (JavaScript, layout, drawing commands), without audio and video decoding or the GPU.
- `60 wake-ups/s`: how many times a second the mini program's thread wakes up (frames, timers, network and so on). Content that stays on the desktop should wake up as rarely as it can.
- `JS 8.4 MB`: the JavaScript heap's capacity plus the memory objects hold outside it (`ArrayBuffer`s and so on), updated about every 5 seconds. The Mac App Store version of DesktopEngine doesn't show it.
- `canvas 36 MB`: the video memory of the canvases, added up from the sizes and formats of what they hold (the driver's extra alignment and padding aren't counted):
  - Drawing buffers: width × height × 4 bytes, plus depth and stencil buffers of the same size for WebGL (and 2D canvases that clip). With `antialias` there is another color buffer with 4 samples, and the depth and stencil buffers have 4 samples too (a 1024×1024 WebGL canvas: 4 + 16 + 16 = 36 MB), plus the IOSurfaces it's shown with. Size canvases by `devicePixelRatio`, and leave `antialias` off when you don't need it.
  - The textures, buffers and renderbuffers WebGL creates: `texImage2D` / `texStorage2D` and the others by size and format, a third more with `generateMipmap`; they stop counting once deleted with `deleteTexture` and the others. Textures are usually the largest part of WebGL content: use compressed textures (`WEBGL_compressed_texture_astc`) and smaller sizes where you can.
  - Images drawn on 2D canvases.
- `drawing paused` when it can't be seen (covered), `suspended` when the displays sleep and so on, see [Pausing](#pausing).

Develop › Show Performance HUD shows the same numbers at the top right of each running mini program's window, installed content included. For more detail, use Instruments: each frame is a `Frame` interval in os_signpost (subsystem `app.desktopengine`, category `Rendering`), and the mini program's thread is named `DesktopEngine JS: <name>`.
