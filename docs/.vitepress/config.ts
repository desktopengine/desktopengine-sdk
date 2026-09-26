import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitepress';
import type { DefaultTheme } from 'vitepress';

const REPOSITORY = 'https://github.com/desktopengine/desktopengine-sdk';
const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

/** Written by TypeDoc (npm run api) */
function apiSidebar(): DefaultTheme.SidebarItem[] {
  const file = new URL('../api/typedoc-sidebar.json', import.meta.url);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

const guide: DefaultTheme.SidebarItem[] = [
  {
    text: '开始',
    items: [
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '项目和构建', link: '/guide/project' },
      { text: '设计规则', link: '/guide/design' },
    ],
  },
  {
    text: '内容',
    items: [
      { text: '壁纸', link: '/guide/wallpaper' },
      { text: '启动参数', link: '/guide/launch-options' },
      { text: '窗口', link: '/guide/windows' },
    ],
  },
  {
    text: '能力',
    items: [
      { text: '网络', link: '/guide/network' },
      { text: '数据', link: '/guide/data' },
      { text: '音频', link: '/guide/audio' },
    ],
  },
  {
    text: '运行时',
    items: [
      { text: '运行时说明', link: '/guide/runtime' },
      { text: '性能和暂停规则', link: '/guide/performance' },
    ],
  },
  {
    text: '参考',
    items: [
      { text: '清单', link: '/reference/manifest' },
      { text: '命令行', link: '/reference/cli' },
      { text: 'API 参考', link: '/api/' },
      { text: 'dev 协议', link: '/reference/dev-protocol' },
    ],
  },
];

export default defineConfig({
  title: 'DesktopEngine SDK',
  description: '用 JavaScript 或 TypeScript 为 DesktopEngine 制作动态壁纸、小组件和桌面伙伴',
  lang: 'zh-CN',
  base: '/desktopengine-sdk/',
  cleanUrls: true,
  // the home page of the API reference, which TypeDoc copies into api/index.md
  srcExclude: ['api-readme.md'],
  head: [['link', { rel: 'icon', type: 'image/png', href: '/desktopengine-sdk/favicon.png' }]],

  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: '指南', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: '清单', link: '/reference/manifest' },
      { text: '命令行', link: '/reference/cli' },
      { text: 'API 参考', link: '/api/', activeMatch: '/api/' },
      {
        text: `v${version}`,
        items: [
          { text: '更新记录', link: `${REPOSITORY}/releases` },
          { text: 'npm', link: 'https://www.npmjs.com/package/@desktopengine/sdk' },
          { text: 'DesktopEngine', link: 'https://desktopengine.github.io' },
        ],
      },
    ],
    sidebar: {
      '/guide/': guide,
      '/reference/': guide,
      '/api/': [
        { text: 'API 参考', link: '/api/' },
        { text: '全部声明', link: '/api/globals', items: apiSidebar() },
        { text: '返回指南', link: '/guide/getting-started' },
      ],
    },
    socialLinks: [{ icon: 'github', link: REPOSITORY }],
    editLink: {
      // the API reference is generated from the type declarations
      pattern: ({ filePath }) =>
        filePath.startsWith('api/')
          ? 'https://github.com/desktopengine/desktopengine-sdk/blob/main/types/desktop-engine.d.ts'
          : `https://github.com/desktopengine/desktopengine-sdk/edit/main/docs/${filePath}`,
      text: '在 GitHub 上编辑此页',
    },
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          // Chinese has no spaces between words
          options: {
            tokenize: (text: string) =>
              Array.from(new Intl.Segmenter('zh', { granularity: 'word' }).segment(text))
                .filter((segment) => segment.isWordLike)
                .map((segment) => segment.segment),
          },
        },
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: {
            noResultsText: '没有找到',
            resetButtonTitle: '清除',
            displayDetails: '显示详细列表',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    outline: { level: [2, 3], label: '本页内容' },
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色',
    darkModeSwitchTitle: '切换到深色',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '回到顶部',
    langMenuLabel: '语言',
    notFound: { title: '找不到这个页面', quote: '它可能已经移动或删除了。', linkText: '回到首页' },
    footer: { message: 'SDK 以 Apache License 2.0 发布', copyright: 'Copyright © 2024 senpng' },
  },

  /** manifest.json files point their $schema at the copy published with the site */
  buildEnd({ outDir }) {
    fs.copyFileSync(new URL('../../schema/manifest.schema.json', import.meta.url), path.join(outDir, 'manifest.schema.json'));
  },
});
