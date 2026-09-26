import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { LANGUAGE_KEY, languageOf } from './language';

export default {
  extends: DefaultTheme,
  enhanceApp({ router, siteData }) {
    if (typeof window === 'undefined') return;
    // switching languages with the menu, or following a link to the other one, becomes the reader's choice
    router.onAfterRouteChange = (href) => {
      const language = languageOf(new URL(href, location.href).pathname, siteData.value.base);
      if (!language) return;
      try {
        localStorage.setItem(LANGUAGE_KEY, language);
      } catch {}
    };
  },
} satisfies Theme;
