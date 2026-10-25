import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ImageStudio } from './components/ImageStudio';
import { PackStudio } from './components/PackStudio';
import { Icon } from './components/Icons';
import { SkinPackProvider, useSkinPack } from './lib/pack-context';
import {
  applyAppearance, initialPalette, initialTheme, PALETTES,
  rememberPalette, rememberTheme, type Palette, type Theme,
} from './lib/theme';

// three.js and the model loaders are only needed after switching to model mode.
const ModelStudio = lazy(async () => {
  const module = await import('./components/ModelStudio');
  return { default: module.ModelStudio };
});

type Mode = 'image' | 'model' | 'pack';

const REPO = 'https://github.com/XiaoYangx666/MCBE-4DGen';

function readMode(): Mode {
  const value = window.location.hash.replace('#', '').split('?')[0];
  return value === 'model' ? 'model' : value === 'pack' ? 'pack' : 'image';
}

export function App() {
  return (
    <SkinPackProvider>
      <AppShell />
    </SkinPackProvider>
  );
}

function AppShell() {
  const { pack } = useSkinPack();
  const [mode, setMode] = useState<Mode>(readMode);
  const [modelVisited, setModelVisited] = useState(() => readMode() === 'model');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [palette, setPalette] = useState<Palette>(initialPalette);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteControl = useRef<HTMLDivElement>(null);

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
    if (!paletteOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!paletteControl.current?.contains(event.target as Node)) setPaletteOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPaletteOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [paletteOpen]);

  useEffect(() => {
    document.title = mode === 'image'
      ? '4DGen Web · 图片皮肤'
      : mode === 'model' ? '4DGen Web · 3D 模型' : '4DGen Web · 我的皮肤包';
    if (mode === 'model') setModelVisited(true);
  }, [mode]);

  const switchMode = (next: Mode) => {
    setMode(next);
    if (next === 'model') setModelVisited(true);
    history.replaceState(null, '', `#${next}`);
  };

  return (
    <div className="app">
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
            3D 模型 <em>BETA</em>
          </button>
          <button
            type="button"
            className={mode === 'pack' ? 'active' : ''}
            onClick={() => switchMode('pack')}
          >
            皮肤包
            {!!pack?.skins.length && <span className="nav-count">{pack.skins.length}</span>}
          </button>
        </nav>
        <div className="header-right">
          <span className="local"><b /> 本机处理</span>
          <div className="palette-control" ref={paletteControl}>
            <button
              type="button"
              className="icon-button"
              title="界面配色"
              aria-label="界面配色"
              aria-haspopup="menu"
              aria-expanded={paletteOpen}
              onClick={() => setPaletteOpen((open) => !open)}
            >
              <Icon name="palette" size={16} />
            </button>
            {paletteOpen && (
              <div className="palette-popover" role="menu" aria-label="界面配色">
                {PALETTES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={palette === item.key}
                    className={palette === item.key ? 'selected' : ''}
                    onClick={() => {
                      setPalette(item.key);
                      setPaletteOpen(false);
                    }}
                  >
                    <span className={`palette-swatch ${item.key}`} aria-hidden="true">
                      <i /><i /><i />
                    </span>
                    <span className="palette-copy">
                      <b>{item.label}</b>
                      <small>{item.hint}</small>
                    </span>
                    {palette === item.key && <Icon name="check" size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
          <a className="header-link" href={REPO} target="_blank" rel="noreferrer">
            <Icon name="github" size={15} /> GitHub
          </a>
        </div>
      </header>

      <main className="page-content">
        <h1 className="sr-only">
          {mode === 'image' ? '图片皮肤' : mode === 'model' ? '3D 模型' : '我的皮肤包'}
        </h1>
        <div className="studio-host">
          <div hidden={mode !== 'image'}><ImageStudio /></div>
          {modelVisited && (
            <div hidden={mode !== 'model'}>
              <Suspense fallback={<div className="panel-loading"><span className="spinner" /> 正在加载模型工作台…</div>}>
                <ModelStudio />
              </Suspense>
            </div>
          )}
          <div hidden={mode !== 'pack'}><PackStudio /></div>
        </div>
      </main>

      <footer>
        <span>4DGen Web / 图片与模型工作台</span>
        <span>
          文件在本机处理，不会上传 · <a href={REPO} target="_blank" rel="noreferrer">GitHub</a> · GPL-3.0
        </span>
      </footer>
    </div>
  );
}
