# Video

A `Video` shows a video file in a window, and it's also a source for canvases, as a `<video>` element is on the web (API 9): a WebGL shader can sample its frames as a texture, a 2D canvas can draw them. Declare `"apiVersion": 9` in [manifest.json](../reference/manifest#api-versions) to use it as a source.

```js
const video = new DesktopEngine.Video({ src: 'media/loop.mp4', loop: true, muted: true, autoplay: true });
const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

function frame() {
  if (video.readyState >= video.HAVE_CURRENT_DATA) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }
  // … draw with the texture
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

The video doesn't need to be in a window for this: it plays while canvases read it (see [Playing out of a window](#playing-out-of-a-window)).

three.js's `VideoTexture` works as it is: `new THREE.VideoTexture(video)` uploads the frame while `readyState` is at least `HAVE_CURRENT_DATA`. PixiJS's video sources look for a browser's `HTMLVideoElement`, which content doesn't have; upload the frame to a texture of your own as above.

## The frame showing now

Each upload or draw takes the frame the video shows at that moment, at its own size, `videoWidth` × `videoHeight`. A video plays at its own pace: a 30 fps video uploaded at every frame of a 60 Hz display gives the same frame twice, which costs little. Uploading a new frame is a copy on the GPU, about 0.3 ms of the content's time for a 4K frame.

| | Before `loadedmetadata` (`readyState` 0) | Before `loadeddata` (`readyState` 1) | From `loadeddata` on |
|---|---|---|---|
| `texImage2D`, `texSubImage2D` | `INVALID_VALUE` error, the texture stays | nothing, the texture stays | the frame |
| `drawImage` | draws nothing | draws nothing | the frame |
| `createPattern` | `undefined` | `undefined` | a pattern of the frame showing now, which later frames don't change |
| `createImageBitmap` | rejects with `InvalidStateError` | rejects with `InvalidStateError` | a bitmap of the frame |

`readyState`, `videoWidth` and `videoHeight` are as on the web: `HAVE_NOTHING` (0) until the file is opened, `HAVE_METADATA` (1) with `loadedmetadata` once its size is known, `HAVE_CURRENT_DATA` (2) with `loadeddata` once it has a frame, then `HAVE_ENOUGH_DATA` (4) with `canplay`. While it waits for data it's `HAVE_CURRENT_DATA`, and `canplay` comes again when it can go on. Setting another `src` starts over from `HAVE_NOTHING`. There's no `requestVideoFrameCallback`: content uploads at each frame it draws.

### WebGL uploads

They follow WebGL's rules for a video:

- The top of the picture is the texture's first row (`t = 0`), unless `UNPACK_FLIP_Y_WEBGL` is set.
- A frame's colors aren't premultiplied; `UNPACK_PREMULTIPLY_ALPHA_WEBGL` multiplies them by their alpha. Most videos are opaque, where it changes nothing.
- The colors are the video's own, without a color space conversion (`UNPACK_COLORSPACE_CONVERSION_WEBGL` isn't read), as browsers upload videos.
- The formats are the ones WebGL takes for images: `RGBA`, `RGB`, `LUMINANCE`, `ALPHA`, `LUMINANCE_ALPHA` with `UNSIGNED_BYTE` or the packed types; in WebGL 2 also sized ones (`RGBA8`, `SRGB8_ALPHA8`, `R8`, `RG8`, `RGBA16F`, `RGBA32F`…). These are copied on the GPU. Others, a region of the frame (WebGL 2's overloads with a size and `UNPACK_SKIP_*`) and the 3D uploads (`texImage3D`, `texSubImage3D`) read the frame's pixels on the CPU, which takes milliseconds for a large video: avoid them at every frame.
- `texSubImage2D` copies the frame into part of a texture, for example one made with `texStorage2D`.

### 2D canvases

`drawImage(video, …)` in all its forms draws the frame showing now, smoothed as images are. The frame is copied on the GPU once when it changes, so drawing it again (several canvases, several parts) is cheap.

## Playing out of a window

On the web, a video element plays whether or not it's in the page. A `Video` does too, with limits that keep content from decoding videos nobody sees:

- In a window, it plays as always.
- Out of a window, it plays while canvases read its frames: any upload or draw counts.
- A video that was never in a window nor read loads as soon as it has a `src`, and plays when it's asked to (`autoplay` or `play()`), so content can wait for `loadeddata` before it reads it.
- A video given another `src` out of a window loads it too, so content can wait for `loadeddata` again. If no canvas reads it within 3 seconds of when it can play, a video that was in a window before lets go of the file, as below.
- When canvases haven't read a video that isn't in a window for 3 seconds (the content stopped drawing it, or stopped drawing at all), it pauses, firing `pause`, and lets go of its file. Reading it again continues where it was, playing if it was, after a moment to load: meanwhile an upload leaves the texture as it was and `drawImage` draws the last frame it drew. A video removed from its window (itself or with a parent, or its window destroyed) does the same at once, unless canvases are reading it.

It also follows the content's playback rules: while the content is paused it pauses, and continues after. Its sound follows `muted`, `volume` and the `audio` permission as in a window; a video used only as a texture is usually `muted`.

## In the browser preview

`desktopengine dev --web` and the store's preview use the browser's own video element for the frames, with the same states, events and rules. Browsers decode videos their own way: the colors can differ slightly from the app's, and a browser can refuse a file the app plays.
