# 视频

`Video` 在窗口里显示视频文件，也和网页上的 `<video>` 元素一样可以当画布的来源（API 9）：WebGL 的着色器可以把它的帧当纹理采样，2D 画布可以画它的帧。要把它当来源用，在 [manifest.json](../reference/manifest#api-版本) 里声明 `"apiVersion": 9`。

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
  // …用这个纹理绘制
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

视频不用放进窗口：画布在读它的时候它就播放（见[窗口外的播放](#窗口外的播放)）。

three.js 的 `VideoTexture` 可以直接用：`new THREE.VideoTexture(video)` 在 `readyState` 至少是 `HAVE_CURRENT_DATA` 时上传帧。PixiJS 的视频来源找的是浏览器的 `HTMLVideoElement`，内容里没有它；像上面那样把帧上传到自己的纹理里。

## 这时显示的帧

每次上传或绘制取的都是视频这一刻显示的那一帧，尺寸是它自己的 `videoWidth` × `videoHeight`。视频按自己的速度播放：30 fps 的视频在 60 Hz 的显示器上每帧都上传，同一帧会上传两次，代价很小。上传新的一帧是 GPU 上的一次复制，4K 的帧约占内容 0.3 ms。

| | `loadedmetadata` 之前（`readyState` 0） | `loadeddata` 之前（`readyState` 1） | `loadeddata` 起 |
|---|---|---|---|
| `texImage2D`、`texSubImage2D` | `INVALID_VALUE` 错误，纹理不变 | 什么都不做，纹理不变 | 这一帧 |
| `drawImage` | 什么都不画 | 什么都不画 | 这一帧 |
| `createPattern` | `undefined` | `undefined` | 这时那一帧的图案，之后的帧不改变它 |
| `createImageBitmap` | 以 `InvalidStateError` 拒绝 | 以 `InvalidStateError` 拒绝 | 这一帧的位图 |

`readyState`、`videoWidth` 和 `videoHeight` 和网页上一样：打开文件之前是 `HAVE_NOTHING`（0），知道尺寸时是 `HAVE_METADATA`（1）并发 `loadedmetadata`，有了一帧时是 `HAVE_CURRENT_DATA`（2）并发 `loadeddata`，然后是 `HAVE_ENOUGH_DATA`（4）并发 `canplay`。等数据时是 `HAVE_CURRENT_DATA`，能继续时再发一次 `canplay`。换一个 `src` 从 `HAVE_NOTHING` 重新开始。没有 `requestVideoFrameCallback`：内容在画每一帧时上传。

### WebGL 的上传

按 WebGL 对视频的规则：

- 画面的顶上是纹理的第一行（`t = 0`），除非设了 `UNPACK_FLIP_Y_WEBGL`。
- 帧的颜色没有预乘；`UNPACK_PREMULTIPLY_ALPHA_WEBGL` 把颜色乘上 alpha。大多数视频是不透明的，这时没有区别。
- 颜色是视频自己的，不做色彩空间的转换（不读 `UNPACK_COLORSPACE_CONVERSION_WEBGL`），和浏览器上传视频一样。
- 格式是 WebGL 对图片接受的那些：`RGBA`、`RGB`、`LUMINANCE`、`ALPHA`、`LUMINANCE_ALPHA` 配 `UNSIGNED_BYTE` 或打包的类型；WebGL 2 还有带尺寸的（`RGBA8`、`SRGB8_ALPHA8`、`R8`、`RG8`、`RGBA16F`、`RGBA32F`……）。这些在 GPU 上复制。其它格式、帧的一部分（WebGL 2 带尺寸的重载和 `UNPACK_SKIP_*`）和 3D 上传（`texImage3D`、`texSubImage3D`）在 CPU 上读帧的像素，大的视频要几毫秒：不要每帧都这样做。
- `texSubImage2D` 把帧复制进纹理的一部分，例如 `texStorage2D` 建的纹理。

### 2D 画布

`drawImage(video, …)` 的各种形式都画这时显示的那一帧，和图片一样平滑。帧变了才在 GPU 上复制一次，所以再画一次（几张画布、几个部分）代价很小。

## 窗口外的播放

在网页上，视频元素不管在不在页面里都会播放。`Video` 也一样，只是有些限制，免得内容解码没人看的视频：

- 在窗口里，照常播放。
- 不在窗口里，画布在读它的帧时播放：任何上传或绘制都算。
- 从没进过窗口、也从没被读过的视频，有了 `src` 就加载，要求播放（`autoplay` 或 `play()`）时就播放，这样内容可以等 `loadeddata` 之后再读它。
- 不在窗口里的视频换了 `src` 也会加载，内容可以再等 `loadeddata`。能播放后 3 秒内没有画布读它的话，进过窗口的视频会像下面说的那样放开文件。
- 不在窗口里的视频 3 秒没有被画布读过（内容不再画它，或者不再绘制），就暂停（发 `pause`）并放开文件。再读它时从原来的位置继续，原来在播放就接着播放，加载要一点时间：这期间上传不改变纹理，`drawImage` 画它画过的最后一帧。从窗口移除的视频（它自己或父组件，或者窗口被 destroy）马上这样做，除非画布正在读它。

它也遵守内容的播放规则：内容暂停时它暂停，之后继续。它的声音和在窗口里一样按 `muted`、`volume` 和 `audio` 权限；只当纹理用的视频通常是 `muted`。

## 在浏览器预览里

`desktopengine dev --web` 和商店的预览用浏览器自己的视频元素取帧，状态、事件和规则相同。浏览器有自己解码视频的方式：颜色可能和 App 里略有不同，浏览器也可能不播放 App 能播放的文件。
