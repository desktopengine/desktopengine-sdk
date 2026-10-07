# 快速开始

DesktopEngine 应用只做核心服务：运行小程序、管理资源库和播放列表、分配显示器。动态壁纸、小组件和桌面伙伴由开发者和创作者用这个 SDK 制作，用户在应用里导入后使用。

SDK 包含：

- `desktopengine` 命令行：新建、运行调试、构建、检查和打包项目
- 壁纸、小组件、桌面伙伴三种项目模板，壁纸另有 WebGL、three.js 和 PixiJS 版本
- 运行时 API 的类型声明，编辑器可据此补全和检查类型（见 [API 参考](/zh/reference/api)）
- `manifest.json` 的 [JSON Schema](/zh/reference/manifest#json-schema)

## 安装

需要 Node.js 18 或更新版本，以及安装了 [DesktopEngine](https://desktopengine.app) 的 Mac。

```bash
npm install -g @desktopengine/sdk
desktopengine --version
```

不想全局安装，也可以每次用 `npx @desktopengine/sdk <命令>`。

较新的 npm 会提示 esbuild 的安装脚本（`postinstall`）没有运行，可以忽略：SDK 不需要它。

## 新建并运行

```bash
desktopengine create widget ~/Projects/day-progress --id com.example.day-progress --name 今日进度
desktopengine dev ~/Projects/day-progress
```

`create` 的类型可以是 `wallpaper`（壁纸）、`widget`（小组件）或 `companion`（桌面伙伴：角色、吉祥物，或者任何在窗口之上的屏幕上活动的东西），生成的项目结构见[项目和构建](./project)。

`dev` 会打开 DesktopEngine 并在其中运行这个小程序：

- 第一次连接时应用会询问是否允许（没有打开「开发」菜单时会先询问是否打开）。
- 保存文件后自动重新构建、重新载入；窗口被拖到的位置在重新载入后保留。
- `console.log` 等输出、未捕获的异常（带调用栈）、没人处理的 Promise rejection 和 `postMessage('host', …)` 都显示在终端里。Mac App Store 版的 DesktopEngine 看不到没人 await 或 catch 的 async 函数的 rejection，例如脚本末尾的 `main();`：请写成 `main().catch(console.error);`。
- 用参数模拟用户在详情栏里的选择，`DesktopEngine.launchOptions` 和安装后完全一致：

  ```bash
  desktopengine dev . --size medium --level floating --display 2 --param accent=#FF9F0A --param workday=true
  ```

- 加上 `--perf`，终端最后一行每秒更新一次帧率、CPU、唤醒次数和内存，见[性能](./performance)。
- 按 Ctrl-C 停止，小程序也会从桌面上移除。

## 断点调试

在 Safari 的「设置 › 高级」里打开「显示网页开发者功能」，然后选择「开发 › 这台 Mac › 小程序」。打开 DesktopEngine 的「开发」菜单之后载入的小程序才能被检查；`src/` 项目在开发构建里带有 source map，检查器里看到的是原始文件。

不用 `dev` 也可以：先 `desktopengine build`，再打开「设置 › 高级 › 在菜单栏中显示「开发」菜单」，选择「开发 › 载入本地小程序…」（⌘⌥O）选择项目的 `dist/package/` 文件夹，重新构建后会自动重新载入。这种方式下 `DesktopEngine.launchOptions` 是空对象 `{}`（模板里都写了缺省值）。

## 检查、打包和导入

```bash
desktopengine validate ~/Projects/day-progress
desktopengine pack ~/Projects/day-progress
```

`pack` 在项目的 `dist/` 下生成 `<id>-<version>.zip`。在 DesktopEngine 的「全部壁纸」「小组件」或「伙伴」页点工具栏里的导入按钮，或选择「文件 › 导入…」，就可以导入它。请导入 `pack` 生成的包：应用也能导入文件夹，但会原样导入，项目文件夹里的其他文件（`.env`、`node_modules`…）会一起进去，里面有符号链接时会被拒绝。导入后按类型出现在对应的地方：壁纸出现在壁纸网格里（工具栏筛选「动态」），小组件和桌面伙伴出现在各自的页面。导入同一个 `id` 会替换旧版本，桌面上正在运行的实例会用新版本重新启动。

目前通过 .zip 或文件夹分发内容，还没有签名、上传审核和在线内容库。

## 接下来

- [项目和构建](./project)：项目里有什么，`src/` 怎样被打包
- [清单](/zh/reference/manifest)：名称、类型、权限和用户可调的选项
- [壁纸](./wallpaper)，或者看[启动参数](./launch-options)和[窗口](./windows)来做小组件和桌面伙伴
- [设计规则](./design)：怎样让内容和 macOS 融为一体
