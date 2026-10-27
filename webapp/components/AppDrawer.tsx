import { useCallback, useEffect, useRef, useState } from 'react';
import { Changelog } from '../../web/shared/Changelog';
import { PALETTE_OPTIONS, type Palette } from '../../web/shared/palettes';
import type { Theme } from '../lib/theme';
import { REPO } from '../lib/links';
import { Icon, type IconName } from './Icons';

export type Mode = 'image' | 'model' | 'pack';

interface AppDrawerProps {
  open: boolean;
  mode: Mode;
  packCount: number;
  theme: Theme;
  palette: Palette;
  onClose: () => void;
  onNavigate: (mode: Mode) => void;
  onTheme: (theme: Theme) => void;
  onPalette: (palette: Palette) => void;
}

const MODES: { key: Mode; icon: IconName; label: string; hint: string }[] = [
  { key: 'image', icon: 'image', label: '图片皮肤', hint: '立绘生成平面皮肤' },
  { key: 'model', icon: 'cube', label: '3D 模型', hint: 'GLB / VRM / PMX → 4D' },
  { key: 'pack', icon: 'archive', label: '皮肤包', hint: '管理与导出 ZIP' },
];

type DrawerSection = 'nav' | 'appearance' | 'about';
const SECTIONS: { key: DrawerSection; label: string }[] = [
  { key: 'nav', label: '工作台' },
  { key: 'appearance', label: '外观' },
  { key: 'about', label: '关于' },
];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Mobile navigation drawer. Page switching is rare, so the drawer keeps the
 * top bar short while leaving theme, palette and repository links reachable.
 */
export function AppDrawer({
  open,
  mode,
  packCount,
  theme,
  palette,
  onClose,
  onNavigate,
  onTheme,
  onPalette,
}: AppDrawerProps) {
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [section, setSection] = useState<DrawerSection>('nav');

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (open) setSection('nav');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocus.current?.focus();
    };
  }, [open, close]);

  return (
    <div className={`drawer-layer ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="drawer-backdrop" onClick={close} aria-hidden="true" />
      <aside
        ref={panel}
        id="app-drawer"
        className="app-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="主菜单"
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          const touch = event.changedTouches[0];
          if (!start || !touch) return;
          const dx = touch.clientX - start.x;
          const dy = Math.abs(touch.clientY - start.y);
          if (dx > 70 && dy < 48) close();
        }}
      >
        <div className="drawer-head">
          <div className="brand drawer-brand">
            <Icon name="cube" size={20} />
            4D<span>Gen</span>
            <i>WEB STUDIO</i>
          </div>
          <button
            ref={closeButton}
            type="button"
            className="drawer-close"
            aria-label="关闭菜单"
            onClick={close}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="drawer-tabs" role="tablist" aria-label="菜单分类">
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={section === item.key}
              className={section === item.key ? 'active' : ''}
              onClick={() => setSection(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="drawer-scroll" role="tabpanel">
          {section === 'nav' && (
            <div className="drawer-nav-list">
              {MODES.map((item) => {
                const active = mode === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`drawer-nav-item ${active ? 'active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onNavigate(item.key)}
                  >
                    <span className="drawer-nav-icon"><Icon name={item.icon} size={18} /></span>
                    <span className="drawer-nav-copy">
                      <b>{item.label}</b>
                      <small>{item.hint}</small>
                    </span>
                    {item.key === 'model' && <span className="drawer-nav-badge">BETA</span>}
                    {item.key === 'pack' && packCount > 0 && (
                      <span className="drawer-nav-count">{packCount}</span>
                    )}
                    {active && <Icon name="check" size={15} className="drawer-nav-check" />}
                  </button>
                );
              })}
            </div>
          )}

          {section === 'appearance' && (
            <>
              <div className="drawer-section">
                <span className="drawer-section-label">主题</span>
                <div className="drawer-theme">
                  <button
                    type="button"
                    className={theme === 'light' ? 'active' : ''}
                    aria-pressed={theme === 'light'}
                    onClick={() => onTheme('light')}
                  >
                    <Icon name="sun" size={16} /> 浅色
                  </button>
                  <button
                    type="button"
                    className={theme === 'dark' ? 'active' : ''}
                    aria-pressed={theme === 'dark'}
                    onClick={() => onTheme('dark')}
                  >
                    <Icon name="moon" size={16} /> 深色
                  </button>
                </div>
              </div>

              <div className="drawer-section">
                <span className="drawer-section-label">配色</span>
                <div className="drawer-palettes">
                  {PALETTE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`drawer-palette ${palette === option.key ? 'active' : ''}`}
                      aria-pressed={palette === option.key}
                      onClick={() => onPalette(option.key)}
                    >
                      <span className={`palette-swatch ${option.key}`} aria-hidden="true">
                        <i /><i /><i />
                      </span>
                      <span className="drawer-palette-label">{option.label}</span>
                      {palette === option.key && <Icon name="check" size={14} />}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {section === 'about' && (
            <div className="drawer-about">
              <Changelog drawer onOpen={close} />
              <a className="drawer-about-link" href={REPO} target="_blank" rel="noreferrer">
                <Icon name="github" size={16} />
                <span>GitHub</span>
                <span className="drawer-about-arrow" aria-hidden="true">↗</span>
              </a>
              <div className="drawer-about-note">
                <span className="local"><b /> 本机处理 · 文件不会上传</span>
                <small>4DGen Web · GPL-3.0</small>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
