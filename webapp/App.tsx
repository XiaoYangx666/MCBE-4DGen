import { lazy, Suspense, useEffect, useState } from 'react';
import { ImageStudio } from './components/ImageStudio';
import { Icon } from './components/Icons';
import { applyTheme, initialTheme, rememberTheme, type Theme } from './lib/theme';

// three.js and the model loaders are only needed after switching to model mode.
const ModelStudio = lazy(async () => {
  const module = await import('./components/ModelStudio');
  return { default: module.ModelStudio };
});

type Mode = 'image' | 'model';

const REPO = 'https://github.com/XiaoYangx666/MCBE-4DGen';

function readMode(): Mode {
  return window.location.hash.replace('#', '') === 'model' ? 'model' : 'image';
}

export function App() {
  const [mode, setMode] = useState<Mode>(readMode);
  const [modelVisited, setModelVisited] = useState(() => readMode() === 'model');
  const [theme, setTheme] = useState<Theme>(initialTheme);

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
    applyTheme(theme);
    rememberTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.title = mode === 'image' ? '4DGen Web · 图片皮肤' : '4DGen Web · 3D 模型';
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
        </nav>
        <div className="header-right">
          <span className="local"><b /> 本机处理</span>
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
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              {mode === 'image' ? 'TEMPLATE / IMAGE' : 'CONVERT / 3D MODEL'}
            </div>
            <h1>{mode === 'image' ? '图片皮肤' : '3D 模型'}</h1>
            <p>
              {mode === 'image'
                ? '把立绘、表情包或透明 PNG 做成双面平面皮肤，不需要三维模型。'
                : '导入模型，自动拼贴贴图并生成基岩版 poly_mesh 皮肤。'}
            </p>
          </div>
          <div className="page-heading-actions">
            <span className="badge">128 × 128 贴图</span>
            <span className="badge">静态整体绑定</span>
          </div>
        </div>

        <div className="studio-host">
          <div hidden={mode !== 'image'}><ImageStudio /></div>
          {modelVisited && (
            <div hidden={mode !== 'model'}>
              <Suspense fallback={<div className="panel-loading"><span className="spinner" /> 正在加载模型工作台…</div>}>
                <ModelStudio />
              </Suspense>
            </div>
          )}
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
