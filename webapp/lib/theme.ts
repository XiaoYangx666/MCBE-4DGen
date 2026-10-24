export type Theme = 'light' | 'dark';

const KEY = '4dgen-web-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage can be blocked */ }
  return media.matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.palette = 'violet';
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#17191f' : '#f3f5fa');
}

export function rememberTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch { /* keep the in-memory theme */ }
}
