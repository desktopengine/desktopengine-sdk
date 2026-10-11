# 命令行

```bash
npm install -g @desktopengine/sdk
desktopengine --help
```

`folder` 缺省是当前文件夹。有 `src/index.ts`（或 `src/index.js`）的项目先打包再使用，可以用 `import`、TypeScript 和 npm 包；没有 `src/` 的项目原样使用，根目录的 `index.js` 就是入口。见[项目和构建](/zh/guide/project)。

## create

```bash
desktopengine create <type> <folder> [--renderer <renderer>] [--id <identifier>] [--name <name>]
```

用模板新建一个项目。

| 参数 | 说明 |
| --- | --- |
| `<type>` | `wallpaper`、`widget` 或 `companion`（旧名称 `pet` 也会创建桌面伙伴） |
| `<folder>` | 新项目的文件夹 |
| `--renderer` | 用另一种方式绘制的模板，目前只有壁纸有：`webgl`、`three`、`pixi`。`three` 和 `pixi` 创建后要先 `npm install`，见[用 WebGL 或渲染引擎绘制](/zh/guide/wallpaper#用-webgl-或渲染引擎绘制) |
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
| `--level desktop\|floating` | 小组件贴在桌面上（缺省），或浮于所有窗口之上；桌面伙伴总是浮在窗口之上 |
| `--display <number>` | 在第几块显示器上运行，从 1 开始，缺省是主显示器 |
| `--span` | 让壁纸跨所有显示器运行，`manifest.json` 要声明 [`wallpaper.span`](/zh/guide/wallpaper#跨显示器) |
| `--param <key=value>` | 一个选项的取值，可以重复；没有给出的用清单里的 `default` |
| `--position <x,y>` | 窗口的位置 |
| `--port <port>` | 监听的端口，缺省随机 |
| `--perf` | 显示帧率、帧耗时、CPU、唤醒次数和内存，见[性能](/zh/guide/performance#测量) |
| `--no-open` | 不打开 DesktopEngine，只打印连接它的 URL |
| `--web` | 改在浏览器里运行，见[在浏览器里运行](#在浏览器里运行) |

这些选项模拟用户在详情栏里的选择，内容读到的 [`launchOptions`](/zh/guide/launch-options) 和安装后一致。

### 在浏览器里运行

`dev --web` 在一个模拟 Mac 桌面的网页上运行项目，用的是 DesktopEngine 商店让用户安装前试用内容的网页运行时。它不需要 App，有浏览器的电脑都能用；和 `dev` 一样，改了文件会重新构建、重新运行，控制台输出打印在终端里。网页的菜单栏可以切换浅色和深色、打开声音、重新运行内容，小组件还可以选尺寸。

网页运行时在浏览器之上实现了同样的 JavaScript API：窗口是定位的元素，画布就是浏览器的画布。内容只看得到它在 DesktopEngine 里有的全局对象，看不到 `window`、`document` 和 DOM，所以走的是和 App 里一样的路径。它很接近，但不完全一样：发布前要在 App 里检查。不同之处：

- 对 [`network.domains`](/zh/guide/network#域名) 里域名的请求（`fetch`、`XMLHttpRequest`、图片和视频）经过代理，只能 GET 和 HEAD，不带 cookie；`dev --web` 不支持 WebSocket。
- `defile://usr/` 里的文件、`localStorage` 和 `sessionStorage` 存在内存里，网页重新加载就没了。
- 内容收不到滚轮事件，键盘事件也收不到（和 App 一样）。
- `DesktopEngine.system.cpuUsage()` 和 `memoryUsage()` 返回缓慢变化的模拟值：网页看不到电脑的数据。

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

## login

```bash
desktopengine login [--api <url>]
```

登录 DesktopEngine 商店：显示一个短码并打开浏览器，在浏览器里用创作者账号确认这个短码。令牌保存在 `~/.config/desktopengine/credentials.json`（设置了 `$XDG_CONFIG_HOME` 时在它下面），只有你自己能读。发布需要创作者账号，目前需要邀请。

`desktopengine logout [--api <url>]` 退出登录并删除令牌。

## publish

```bash
desktopengine publish [folder] [options]
```

像 `pack` 一样打包项目，作为商店里对应条目的新版本上传。第一次发布时按 `manifest.json` 的 `id` 认领条目（`id` 必须以 `app.desktopengine.<你的命名空间>.` 开头），并用清单的 `name` 和 `description` 填写商店页面，之后在创作者后台修改。`version` 必须高于已发布的版本；还是草稿或被拒绝的版本会重新上传。

上传后立即检查（和 `validate` 相同的规则，加上商店的：大小、文件、id 和命名空间），有问题时打印出来，命令以状态 1 退出。提交的版本先在审核用的 Mac 上试运行，再由审核员查看，通过后发布。

| 选项 | 说明 |
| --- | --- |
| `--notes <text>` | 这个版本的新内容（英文），审核员和用户都能看到 |
| `--notes-<locale> <text>` | 其它语言的新内容，例如 `--notes-zh-Hans`；商店按访客的语言显示，没有对应语言时显示英文 |
| `--network-purpose <text>` | `network` 权限的用途；带这个权限的版本提交审核时必须填写 |
| `--copyright <origin>` | 内容的来源：`original`（原创）、`licensed`（已获授权）或 `open`（公共领域或开放许可）；第一次提交时必须填写 |
| `--copyright-note <text>` | `licensed` 时写明授权方；`open` 时写明许可，例如 `CC BY 4.0` |
| `--submit` | 上传后提交审核 |
| `--test-link` | 生成一个链接，在审核前就能把这个版本装进 DesktopEngine（标为测试版），给你自己和测试者用 |
| `--debug` | 测试链接装的副本可以用 Safari 网页检查器调试，只有你自己能安装 |
| `--api <url>` | 使用别的商店 API；也可以用 `DESKTOPENGINE_API` |

在 CI 里把 `DESKTOPENGINE_TOKEN` 设为 `login` 保存的令牌，不用在那里运行 `login`。
