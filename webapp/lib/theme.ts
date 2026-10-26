import {
  DEFAULT_PALETTE,
  PALETTE_OPTIONS,
  isPalette,
  type Palette,
} from '../../web/shared/palettes';
import { type Theme } from '../../web/shared/appearance';

export type { Palette } from '../../web/shared/palettes';
export type { Theme } from '../../web/shared/appearance';
export { applyThemeToDocument as applyAppearance } from '../../web/shared/appearance';

/** Palette metadata shared with the desktop workbench. */
export const PALETTES = PALETTE_OPTIONS;

const THEME_KEY = '4dgen-web-theme';
const PALETTE_KEY = '4dgen-web-palette';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage can be blocked */ }
  return media.matches ? 'dark' : 'light';
}

export function initialPalette(): Palette {
  try {
    const saved = localStorage.getItem(PALETTE_KEY);
    if (isPalette(saved)) return saved;
  } catch { /* storage can be blocked */ }
  // Matches the desktop workbench default.
  return DEFAULT_PALETTE;
}

export function rememberTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch { /* keep the in-memory theme */ }
}

export function rememberPalette(palette: Palette) {
  try {
    localStorage.setItem(PALETTE_KEY, palette);
  } catch { /* keep the in-memory palette */ }
}
