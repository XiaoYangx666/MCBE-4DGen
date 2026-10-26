import type { Palette } from './palettes.ts';

export type Theme = 'light' | 'dark';

/**
 * Apply the host theme and palette to the document. Persistence stays in each
 * shell (localStorage or the desktop bridge); the resolved CSS variables are
 * shared through `web/styles/theme.css`.
 */
export function applyThemeToDocument(theme: Theme, palette: Palette) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.palette = palette;
  // Read the resolved variable so the browser chrome matches every palette.
  const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim();
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', canvas || (theme === 'dark' ? '#19191c' : '#f4f4f5'));
  window.dispatchEvent(new Event('appearancechange'));
}
