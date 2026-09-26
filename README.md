# DesktopEngine SDK

[![npm](https://img.shields.io/npm/v/@desktopengine/sdk)](https://www.npmjs.com/package/@desktopengine/sdk)
[![CI](https://github.com/desktopengine/desktopengine-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/desktopengine/desktopengine-sdk/actions/workflows/ci.yml)

用 JavaScript 或 TypeScript 为 [DesktopEngine](https://desktopengine.github.io) 制作动态壁纸、小组件和桌面伙伴。

**文档：<https://desktopengine.github.io/desktopengine-sdk/>**

SDK 包含：

- `desktopengine` 命令行：新建、运行调试、构建、检查和打包项目
- `templates/`：壁纸、小组件、桌面伙伴三种项目模板，壁纸另有 WebGL、three.js 和 PixiJS 版本
- `types/desktop-engine.d.ts`：运行时 API 的类型声明，编辑器可据此补全和检查类型
- `schema/manifest.schema.json`：`manifest.json` 的 JSON Schema

## 快速开始

需要 Node.js 18 或更新版本，以及安装了 DesktopEngine 的 Mac。

```bash
npm install -g @desktopengine/sdk
desktopengine create widget ~/Projects/day-progress --id com.example.day-progress --name 今日进度
desktopengine dev ~/Projects/day-progress
```

`dev` 会打开 DesktopEngine 并在其中运行这个小程序，保存文件后自动重新构建、重新载入，`console.log` 和未捕获的异常显示在终端里。完成后打包：

```bash
desktopengine pack ~/Projects/day-progress
```

在 DesktopEngine 里用「文件 › 导入…」导入生成的 .zip。更多内容见[文档](https://desktopengine.github.io/desktopengine-sdk/guide/getting-started)。

## 参与

问题和建议请提 [issue](https://github.com/desktopengine/desktopengine-sdk/issues)，开发 SDK 本身见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[Apache License 2.0](LICENSE)。DesktopEngine 应用本身不在这个仓库里，也不以这个许可证发布。
