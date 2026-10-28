import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { ImageStudio } from './components/ImageStudio';
import { PackStudio } from './components/PackStudio';
import { AppDrawer, type Mode } from './components/AppDrawer';
import { AboutStudio } from './components/AboutStudio';
import { SettingsStudio } from './components/SettingsStudio';
import { ModelSourcesPage } from './components/ModelSourcesPage';
import { Icon } from './components/Icons';
import { BUILD_LABEL } from '../web/shared/build-log';
import { useSkinPack, SkinPackProvider } from './lib/pack-context';
import { REPO } from './lib/links';
import { useCompactViewport } from './lib/use-compact-viewport';
import {
  applyAppearance, initialPalette, initialTheme,
  rememberPalette, rememberTheme, type Palette, type Theme,
} from './lib/theme';

// three.js and the model loaders are only needed after switching to model mode.
const ModelStudio = lazy(async () => {
  const module = await import('./components/ModelStudio');
  return { default: module.ModelStudio };
});

function readMode(): Mode {
  const value = window.location.hash.replace('#', '').split('?')[0];
  if (value === 'model' || value === 'sources' || value === 'pack' || value === 'settings' || value === 'about')
    return value;
  return 'image';
}

export function App() {
  return (
    <SkinPackProvider>
      <AppShell />
    </SkinPackProvider>
  );
}

const MODE_TITLES: Record<Mode, string> = {
  image: '图片皮肤',
  model: '3D 模型',
  sources: '获取模型',
  pack: '皮肤包',
  settings: '设置',
  about: '关于',
};

function AppShell() {
  const { pack } = useSkinPack();
  const compact = useCompactViewport();
  const [mode, setMode] = useState<Mode>(readMode);
  const [modelVisited, setModelVisited] = useState(() => readMode() === 'model');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [palette, setPalette] = useState<Palette>(initialPalette);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    const change = () => {
      const next = readMode();
      setMode(next);
      if (next === 'model') setModelVisited(true);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);

  useEffect(() => {
    applyAppearance(theme, palette);
    rememberTheme(theme);
    rememberPalette(palette);
  }, [theme, palette]);

  useEffect(() => {
    document.title = `4DGen Web · ${MODE_TITLES[mode]}`;
    if (mode === 'model') setModelVisited(true);
    setDrawerOpen(false);
  }, [mode]);

  useEffect(() => {
    if (!compact) setDrawerOpen(false);
  }, [compact]);

  const switchMode = (next: Mode) => {
    setMode(next);
    if (next === 'model') setModelVisited(true);
    setDrawerOpen(false);
    history.replaceState(null, '', `#${next}`);
  };

  return (
    <div className={`app mode-${mode}`}>
      {compact ? (
        <header className="app-nav app-nav-mobile">
          <button
            type="button"
            className="menu-button"
            aria-label="打开菜单"
            aria-expanded={drawerOpen}
            aria-controls="app-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <Icon name="menu" size={20} />
          </button>
          <span className="mobile-page-title">{MODE_TITLES[mode]}</span>
          <span className="local"><b /> 本机处理</span>
        </header>
      ) : (
        <header className="app-nav">
          <a className="brand" href="#image" onClick={() => setMode('image')}>
            <Icon name="cube" size={22} />
            4D<span>Gen</span>
            <i>WEB STUDIO</i>
          </a>
          <nav aria-label="主导航">
            <button
              type="button"
              className={mode === 'image' ? 'active' : ''}
              onClick={() => switchMode('image')}
            >
              图片皮肤
            </button>
            <button
              type="button"
              className={mode === 'model' ? 'active' : ''}
              onClick={() => switchMode('model')}
            >
              3D 模型
            </button>
            <button
              type="button"
              className={mode === 'sources' ? 'active' : ''}
              onClick={() => switchMode('sources')}
            >
              获取模型
            </button>
            <button
              type="button"
              className={mode === 'pack' ? 'active' : ''}
              onClick={() => switchMode('pack')}
            >
              皮肤包
              {!!pack?.skins.length && <span className="nav-count">{pack.skins.length}</span>}
            </button>
            <button
              type="button"
              className={mode === 'settings' ? 'active' : ''}
              onClick={() => switchMode('settings')}
            >
              设置
            </button>
            <button
              type="button"
              className={mode === 'about' ? 'active' : ''}
              onClick={() => switchMode('about')}
            >
              关于
            </button>
          </nav>
          <div className="header-right">
            <span className="local"><b /> 本机处理</span>
          </div>
        </header>
      )}
      {compact && (
        <AppDrawer
          open={drawerOpen}
          mode={mode}
          packCount={pack?.skins.length ?? 0}
          onClose={closeDrawer}
          onNavigate={switchMode}
        />
      )}

      <main className="page-content">
        <h1 className="sr-only">{MODE_TITLES[mode]}</h1>
        <div className="studio-host">
          <div hidden={mode !== 'image'}><ImageStudio /></div>
          {modelVisited && (
            <div hidden={mode !== 'model'}>
              <Suspense fallback={<div className="panel-loading"><span className="spinner" /> 正在加载模型工作台…</div>}>
                <ModelStudio onOpenMenu={() => setDrawerOpen(true)} />
              </Suspense>
            </div>
          )}
          <div hidden={mode !== 'sources'}><ModelSourcesPage /></div>
          <div hidden={mode !== 'pack'}><PackStudio /></div>
          <div hidden={mode !== 'settings'}>
            <SettingsStudio
              theme={theme}
              palette={palette}
              onTheme={setTheme}
              onPalette={setPalette}
            />
          </div>
          <div hidden={mode !== 'about'}><AboutStudio /></div>
        </div>
      </main>

      <footer>
        <span>4DGen Web · 构建 {BUILD_LABEL}</span>
        <span>
          文件在本机处理，不会上传 · <a href={REPO} target="_blank" rel="noreferrer">GitHub</a> · GPL-3.0
        </span>
      </footer>
    </div>
  );
}
