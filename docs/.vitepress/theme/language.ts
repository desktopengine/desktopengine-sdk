/** localStorage key of the reader's language, 'en' or 'zh': set on the first visit from the browser's, then by the pages read */
export const LANGUAGE_KEY = 'desktopengine-sdk-language';

/** The language of a page, or null for pages in one language only (the API reference) */
export function languageOf(pathname: string, base: string): 'en' | 'zh' | null {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
  if (rest === 'api' || rest.startsWith('api/')) return null;
  return rest === 'zh' || rest.startsWith('zh/') ? 'zh' : 'en';
}
