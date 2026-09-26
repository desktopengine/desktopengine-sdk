# 命令行

```bash
npm install -g @desktopengine/sdk
desktopengine --help
```

`folder` 缺省是当前文件夹。有 `src/index.ts`（或 `src/index.js`）的项目先打包再使用，可以用 `import`、TypeScript 和 npm 包；没有 `src/` 的项目原样使用，根目录的 `index.js` 就是入口。见[项目和构建](/guide/project)。

## create

```bash
desktopengine create <type> <folder> [--renderer <renderer>] [--id <identifier>] [--name <name>]
```

用模板新建一个项目。

| 参数 | 说明 |
| --- | --- |
| `<type>` | `wallpaper`、`widget` 或 `pet` |
| `<folder>` | 新项目的文件夹 |
| `--renderer` | 用另一种方式绘制的模板，目前只有壁纸有：`webgl`、`three`、`pixi`。`three` 和 `pixi` 创建后要先 `npm install`，见[用 WebGL 或渲染引擎绘制](/guide/wallpaper#用-webgl-或渲染引擎绘制) |
| `--id` | 清单的 `id`，缺省是 `com.example.<文件夹名>` |
| `--name` | 清单的 `name` |

## dev

```bash
desktopengine dev [folder] [options]
```

在 DesktopEngine 里运行项目，文件改变后重新构建、重新载入，终端里显示它的 console 输出和未捕获的异常。按 Ctrl-C 停止。

| 选项 | 说明 |
| --- | --- |
| `--size small\|medium\|large` | 小组件的尺寸，不在 `widget.sizes` 里时用第一个 |
| `--level desktop\|floating` | 贴在桌面上，或浮于所有窗口之上；缺省时桌面伙伴浮在窗口之上，其他贴在桌面上 |
| `--display <number>` | 在第几块显示器上运行，从 1 开始，缺省是主显示器 |
| `--param <key=value>` | 一个选项的取值，可以重复；没有给出的用清单里的 `default` |
| `--position <x,y>` | 窗口的位置 |
| `--port <port>` | 监听的端口，缺省随机 |
| `--perf` | 显示帧率、帧耗时、CPU、唤醒次数和内存，见[性能](/guide/performance#测量) |
| `--no-open` | 不打开 DesktopEngine，只打印连接它的 URL |

这些选项模拟用户在详情栏里的选择，内容读到的 [`launchOptions`](/guide/launch-options) 和安装后一致。

## build

```bash
desktopengine build [folder] [--minify]
```

把 `src/index.(ts|js)` 连同它 `import` 的模块和 npm 包打成一个 `index.js`，和清单、资源一起放进 `dist/package/`。`--minify` 压缩打包结果。

## validate

```bash
desktopengine validate [folder]
```

按应用的规则检查 `manifest.json` 和入口，有 `src/` 时先构建。有错误时以状态 1 退出，适合放进 CI。

## pack

```bash
desktopengine pack [folder] [--out <folder>] [--minify]
```

构建、检查并打包成 `<id>-<version>.zip`（缺省放在项目的 `dist/` 下），在 DesktopEngine 里用「文件 › 导入…」导入。
