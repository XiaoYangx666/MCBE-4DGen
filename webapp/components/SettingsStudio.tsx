import { PALETTE_OPTIONS } from '../../web/shared/palettes';
import type { Palette, Theme } from '../lib/theme';
import { Icon } from '../../web/shared/Icons';

export function SettingsStudio({
  theme,
  palette,
  onTheme,
  onPalette,
}: {
  theme: Theme;
  palette: Palette;
  onTheme: (theme: Theme) => void;
  onPalette: (palette: Palette) => void;
}) {
  return (
    <div className="info-page">
      <section className="info-card">
        <header className="info-head">
          <div className="template-icon"><Icon name="settings" size={26} /></div>
          <div>
            <h2>设置</h2>
            <p>外观与本地数据。修改会立即生效，并保存在当前浏览器。</p>
          </div>
        </header>

        <div className="info-section">
          <h3>主题</h3>
          <div className="appearance-options" role="group" aria-label="界面主题">
            <button
              type="button"
              aria-pressed={theme === 'light'}
              onClick={() => onTheme('light')}
            >
              <span className="theme-swatch light" aria-hidden="true" />
              浅色
            </button>
            <button
              type="button"
              aria-pressed={theme === 'dark'}
              onClick={() => onTheme('dark')}
            >
              <span className="theme-swatch dark" aria-hidden="true" />
              深色
            </button>
          </div>
        </div>

        <div className="info-section">
          <h3>配色</h3>
          <div className="palette-options" role="group" aria-label="界面配色">
            {PALETTE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={palette === option.key}
                onClick={() => onPalette(option.key)}
              >
                <span className={`palette-preview ${option.key}`} aria-hidden="true">
                  <i /><i /><i />
                </span>
                <b>{option.label}</b>
                <small>{option.hint}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="info-section">
          <h3>本地数据</h3>
          <p className="info-note">
            皮肤包保存在当前浏览器的 IndexedDB 中，不会上传。更换浏览器、使用无痕模式或清除站点数据后，
            需要重新创建或导入皮肤包。
          </p>
        </div>
      </section>
    </div>
  );
}
