# 参与开发

欢迎提 issue 和 pull request。

这个仓库由 DesktopEngine 应用的仓库同步而来：SDK 和应用的运行时一起演进（新增 API 时类型声明和实现同时修改），所以改动先合进应用的仓库，再同步到这里。你的 pull request 被接受后，维护者会把它应用到应用的仓库，同步回来的提交保留你的作者信息，pull request 随后关闭。

## 开发

SDK 用 TypeScript 编写：`src/` 是命令行的源码，`test/` 是测试，`npm run build` 用 `tsc` 编译到 `dist/`（发布到 npm 的就是它，支持 Node.js 18+）。源码之间用 `.ts` 后缀互相 import，编译时改写为 `.js`；只用可擦除的语法（没有 `enum`、参数属性），所以 Node.js 22.18 及以上可以直接运行源码，开发时不需要先编译：

```bash
npm install         # 安装依赖，并通过 prepare 编译到 dist/
npm link            # 可选：让 desktopengine 命令指向这份源码的构建
npm start -- dev ~/Projects/day-progress   # 直接运行 src/cli.ts
npm test            # 单元测试：清单检查、zip、模板、构建、dev 服务、命令行
npm run typecheck   # 检查 SDK 源码和测试，并用类型声明检查所有模板
npm run build       # 编译到 dist/
```

- `src/`：`cli.ts` 是入口；`manifest.ts` 是清单规则，与应用的规则一致；`build.ts` 用 esbuild 打包小程序的 `src/`；`dev.ts` 和 `websocket.ts` 是 `desktopengine dev`，与应用之间的约定见 [dev 协议](docs/reference/dev-protocol.md)。
- `templates/`：`create` 用的项目模板，保持精简，作为开发者的起点。`<类型>-<绘制方式>/`（例如 `wallpaper-three`）是 `create --renderer` 用的版本，见 `src/project.ts` 的 `RENDERERS`。
- `types/desktop-engine.d.ts`：运行时 API 的类型声明，依据引擎的实现维护，只写真实可用的 API。
- 代码注释和命令行输出用英文，文档用中文。

## 文档

`docs/` 是文档站（VitePress），API 参考由 TypeDoc 从 `types/desktop-engine.d.ts` 生成：

```bash
cd docs
npm install
npm run dev         # 本地预览
npm run build       # 构建到 docs/.vitepress/dist/
```

推送到 `main` 后由 GitHub Actions 发布到 <https://desktopengine.github.io/desktopengine-sdk/>。

## 发布

`package.json` 的 `version` 改变并推送到 `main` 后，GitHub Actions 检查、测试并发布到 npm（带 provenance），再创建 `v<版本>` 的 tag 和 GitHub Release。带预发布后缀的版本（例如 `0.2.0-beta.1`）发布到 `next` 标签。
