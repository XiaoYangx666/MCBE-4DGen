export type Theme = 'light' | 'dark';
export type Palette = 'graphite' | 'ocean' | 'sand' | 'rose' | 'violet';

export const PALETTES: { key: Palette; label: string; hint: string }[] = [
  { key: 'graphite', label: '中性灰', hint: '干净、克制' },
  { key: 'ocean', label: '海盐蓝', hint: '清爽、低饱和' },
  { key: 'sand', label: '暖砂', hint: '柔和、暖色调' },
  { key: 'rose', label: '玫瑰灰', hint: '温润、淡玫瑰' },
  { key: 'violet', label: '蓝紫', hint: '原有蓝紫配色' },
];

const THEME_KEY = '4dgen-web-theme';
const PALETTE_KEY = '4dgen-web-palette';
const media = window.matchMedia('(prefers-color-scheme: dark)');

function isPalette(value: string | null): value is Palette {
  return PALETTES.some((palette) => palette.key === value);
}

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
  return 'graphite';
}

export function applyAppearance(theme: Theme, palette: Palette) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.palette = palette;
  // Read the resolved variable so the browser chrome matches every palette.
  const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim();
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', canvas || (theme === 'dark' ? '#19191c' : '#f4f4f5'));
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
