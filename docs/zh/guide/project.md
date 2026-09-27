# 项目和构建

## 项目

`create` 生成的是 TypeScript 项目：

```
day-progress/
├── manifest.json     清单：标识符、名称、类型、尺寸、权限、选项
├── src/
│   ├── index.ts      入口
│   └── progress.ts   用 import 拆分模块
├── tsconfig.json     编辑器补全和类型检查（npx tsc）
├── types/            运行时 API 的类型声明
├── package.json      可选，用 npm 安装依赖
└── assets/…          可选，图片等资源
```

`manifest.json` 的字段见[清单](/zh/reference/manifest)。

在编辑器里获得补全：`create` 会把类型声明复制到项目的 `types/` 下，`tsconfig.json` 已经包含它，并关掉了 DOM 和 Node.js 的类型（`"lib": ["es2022"]`、`"types": []`），避免和运行时的声明冲突。升级 SDK 后可以用新版本的 `types/desktop-engine.d.ts` 替换项目里的这份。

## 构建

运行时只有 CommonJS 的 `require()`，`dev`、`build` 和 `pack` 会先用 [esbuild](https://esbuild.github.io) 把 `src/index.ts` 连同 `import` 的文件和 `node_modules` 里的包打成一个 `index.js`，在 `dist/package/` 里组装出应用导入的小程序包：

```
dist/package/
├── manifest.json
├── index.js          打包后的入口，在 JavaScriptCore 中以全局脚本执行
└── assets/…          除 src/、types/、tsconfig.json 和 npm 文件以外的文件原样放进包里
```

名字以点开头的隐藏文件和文件夹（`.env`、`.npmrc`、`.git`…）在哪一层都不会放进包里：安装了这个包的人都能看到包里的内容。API 密钥和令牌也不要写在其它文件里。

`node_modules` 文件夹和 `.zip` 文件也不会放进包里。`dist/`、`types/` 和 `tsconfig.json` 只在项目根目录下才排除，更深的层级（比如 `assets/types/`）里同名的是包自己的文件。符号链接按它指向的文件或文件夹放进包里（应用不安装符号链接）；指向不存在的文件、或指向包含它自己的文件夹时，构建会停下来报错。

- 目标是 macOS 12 的 JavaScriptCore（相当于 Safari 15），更新的语法会被转换。
- 只能用不依赖 DOM 和 Node.js 的包；运行时有 `performance.now()`，库如果还用到 `window`、`document` 等全局对象，要先自己补上。three.js 和 PixiJS 可以直接用，见[用 WebGL 或渲染引擎绘制](./wallpaper#用-webgl-或渲染引擎绘制)。
- esbuild 只转换 TypeScript、不检查类型，类型错误由编辑器或 `npx tsc` 发现。
- `--minify` 压缩打包结果，适合带着大型库的项目。
- 入口也可以是 `src/index.js`（或 `.tsx`、`.mjs`）；有 `src/` 时项目根目录不能再有 `index.js`。
- 不想构建也可以：没有 `src/` 的项目原样打包，根目录的 `index.js` 就是入口，其他文件用 `require()` 引用。

各个命令的参数见[命令行](/zh/reference/cli)。
