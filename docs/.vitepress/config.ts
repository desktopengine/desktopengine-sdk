import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitepress';
import type { DefaultTheme } from 'vitepress';
import { LANGUAGE_KEY } from './theme/language';

const BASE = '/desktopengine-sdk/';
const REPOSITORY = 'https://github.com/desktopengine/desktopengine-sdk';
const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

/** Written by TypeDoc (npm run api) */
function apiSidebar(): DefaultTheme.SidebarItem[] {
  const file = new URL('../api/typedoc-sidebar.json', import.meta.url);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

/**
 * First visit without a language picked: readers whose browser prefers Chinese go to the same page under /zh/.
 * Runs before the page renders, so the English page doesn't flash. The API reference is English only.
 */
const detectLanguage = `(() => {
  const rest = location.pathname.startsWith('${BASE}') ? location.pathname.slice(${BASE.length}) : null;
  if (rest === null || rest === 'api' || rest.startsWith('api/')) return;
  try {
    if (localStorage.getItem('${LANGUAGE_KEY}')) return;
    const chinese = /^zh\\b/i.test((navigator.languages && navigator.languages[0]) || navigator.language || '');
    localStorage.setItem('${LANGUAGE_KEY}', chinese ? 'zh' : 'en');
    if (chinese && rest !== 'zh' && !rest.startsWith('zh/')) {
      location.replace('${BASE}zh/' + rest + location.search + location.hash);
    }
  } catch {}
})();`;

const english: DefaultTheme.Config = {
  nav: [
    { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
    { text: 'Manifest', link: '/reference/manifest' },
    { text: 'Command Line', link: '/reference/cli' },
    { text: 'API Reference', link: '/api/', activeMatch: '/api/' },
    {
      text: `v${version}`,
      items: [
        { text: 'Releases', link: `${REPOSITORY}/releases` },
        { text: 'npm', link: 'https://www.npmjs.com/package/@desktopengine/sdk' },
        { text: 'DesktopEngine', link: 'https://desktopengine.app' },
      ],
    },
  ],
  sidebar: {
    '/guide/': guideSidebar(),
    '/reference/': guideSidebar(),
    '/api/': [
      { text: 'API Reference', link: '/api/' },
      { text: 'All Declarations', link: '/api/globals', items: apiSidebar() },
      { text: 'Back to the Guide', link: '/guide/getting-started' },
    ],
  },
  editLink: {
    // the API reference is generated from the type declarations. The function runs in the browser: no constants
    pattern: ({ filePath }) =>
      filePath.startsWith('api/')
        ? 'https://github.com/desktopengine/desktopengine-sdk/blob/main/types/desktop-engine.d.ts'
        : `https://github.com/desktopengine/desktopengine-sdk/edit/main/docs/${filePath}`,
    text: 'Edit this page on GitHub',
  },
  footer: { message: 'The SDK is released under the Apache License 2.0', copyright: 'Copyright © 2026 DesktopEngine' },
};

function guideSidebar(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: 'Start',
      items: [
        { text: 'Getting Started', link: '/guide/getting-started' },
        { text: 'Projects and Builds', link: '/guide/project' },
        { text: 'Design Guidelines', link: '/guide/design' },
      ],
    },
    {
      text: 'Content',
      items: [
        { text: 'Wallpapers', link: '/guide/wallpaper' },
        { text: 'Launch Options', link: '/guide/launch-options' },
        { text: 'Windows', link: '/guide/windows' },
      ],
    },
    {
      text: 'Capabilities',
      items: [
        { text: 'Network', link: '/guide/network' },
        { text: 'Data', link: '/guide/data' },
        { text: 'Storage and Files', link: '/guide/storage' },
        { text: 'Audio', link: '/guide/audio' },
      ],
    },
    {
      text: 'Runtime',
      items: [
        { text: 'Runtime Notes', link: '/guide/runtime' },
        { text: 'Performance and Pausing', link: '/guide/performance' },
      ],
    },
    {
      text: 'Reference',
      items: [
        { text: 'Manifest', link: '/reference/manifest' },
        { text: 'Command Line', link: '/reference/cli' },
        { text: 'API Reference', link: '/api/' },
        { text: 'dev Protocol', link: '/reference/dev-protocol' },
      ],
    },
  ];
}

const chineseGuide: DefaultTheme.SidebarItem[] = [
  {
    text: '开始',
    items: [
      { text: '快速开始', link: '/zh/guide/getting-started' },
      { text: '项目和构建', link: '/zh/guide/project' },
      { text: '设计规则', link: '/zh/guide/design' },
    ],
  },
  {
    text: '内容',
    items: [
      { text: '壁纸', link: '/zh/guide/wallpaper' },
      { text: '启动参数', link: '/zh/guide/launch-options' },
      { text: '窗口', link: '/zh/guide/windows' },
    ],
  },
  {
    text: '能力',
    items: [
      { text: '网络', link: '/zh/guide/network' },
      { text: '数据', link: '/zh/guide/data' },
      { text: '存储和文件', link: '/zh/guide/storage' },
      { text: '音频', link: '/zh/guide/audio' },
    ],
  },
  {
    text: '运行时',
    items: [
      { text: '运行时说明', link: '/zh/guide/runtime' },
      { text: '性能和暂停规则', link: '/zh/guide/performance' },
    ],
  },
  {
    text: '参考',
    items: [
      { text: '清单', link: '/zh/reference/manifest' },
      { text: '命令行', link: '/zh/reference/cli' },
      { text: 'API 概览', link: '/zh/reference/api' },
      { text: 'API 参考（英文）', link: '/api/' },
      { text: 'dev 协议', link: '/zh/reference/dev-protocol' },
    ],
  },
];

const chinese: DefaultTheme.Config = {
  nav: [
    { text: '指南', link: '/zh/guide/getting-started', activeMatch: '/zh/guide/' },
    { text: '清单', link: '/zh/reference/manifest' },
    { text: '命令行', link: '/zh/reference/cli' },
    { text: 'API 参考', link: '/zh/reference/api' },
    {
      text: `v${version}`,
      items: [
        { text: '更新记录', link: `${REPOSITORY}/releases` },
        { text: 'npm', link: 'https://www.npmjs.com/package/@desktopengine/sdk' },
        { text: 'DesktopEngine', link: 'https://desktopengine.app' },
      ],
    },
  ],
  sidebar: { '/zh/': chineseGuide },
  editLink: { pattern: `${REPOSITORY}/edit/main/docs/:path`, text: '在 GitHub 上编辑此页' },
  outline: { level: [2, 3], label: '本页内容' },
  docFooter: { prev: '上一页', next: '下一页' },
  darkModeSwitchLabel: '外观',
  lightModeSwitchTitle: '切换到浅色',
  darkModeSwitchTitle: '切换到深色',
  sidebarMenuLabel: '目录',
  returnToTopLabel: '回到顶部',
  langMenuLabel: '语言',
  notFound: { title: '找不到这个页面', quote: '它可能已经移动或删除了。', linkText: '回到首页' },
  footer: { message: 'SDK 以 Apache License 2.0 发布', copyright: 'Copyright © 2026 DesktopEngine' },
};

export default defineConfig({
  title: 'DesktopEngine SDK',
  base: BASE,
  cleanUrls: true,
  // the home page of the API reference, which TypeDoc copies into api/index.md
  srcExclude: ['api-readme.md'],
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${BASE}favicon.png` }],
    ['script', {}, detectLanguage],
  ],

  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      description: 'Make dynamic wallpapers, widgets and desktop pets for DesktopEngine in JavaScript or TypeScript',
      themeConfig: english,
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      description: '用 JavaScript 或 TypeScript 为 DesktopEngine 制作动态壁纸、小组件和桌面伙伴',
      themeConfig: chinese,
    },
  },

  themeConfig: {
    logo: '/logo.png',
    socialLinks: [{ icon: 'github', link: REPOSITORY }],
    outline: { level: [2, 3] },
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
        locales: {
          zh: {
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
      },
    },
  },

  /** manifest.json files point their $schema at the copy published with the site */
  buildEnd({ outDir }) {
    fs.copyFileSync(new URL('../../schema/manifest.schema.json', import.meta.url), path.join(outDir, 'manifest.schema.json'));
  },
});
