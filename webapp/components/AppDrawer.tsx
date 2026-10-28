import { useCallback, useEffect, useRef } from 'react';
import { Icon, type IconName } from '../../web/shared/Icons';

export type Mode = 'image' | 'model' | 'sources' | 'pack' | 'settings' | 'about';

interface AppDrawerProps {
  open: boolean;
  mode: Mode;
  packCount: number;
  onClose: () => void;
  onNavigate: (mode: Mode) => void;
}

interface DrawerItem {
  key: Mode;
  icon: IconName;
  label: string;
  hint: string;
}

const WORKSPACE_MODES: DrawerItem[] = [
  { key: 'image', icon: 'image', label: '图片皮肤', hint: '立绘生成平面皮肤' },
  { key: 'model', icon: 'cube', label: '3D 模型', hint: 'GLB / VRM / PMX → 4D' },
  { key: 'sources', icon: 'globe', label: '获取模型', hint: '常用模型站点目录' },
  { key: 'pack', icon: 'archive', label: '皮肤包', hint: '管理与导出 ZIP' },
];

const APP_MODES: DrawerItem[] = [
  { key: 'settings', icon: 'settings', label: '设置', hint: '主题、配色与本地数据' },
  { key: 'about', icon: 'info', label: '关于', hint: '构建号、更新日志与许可' },
];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Mobile navigation drawer. Settings and About are real pages, so the drawer
 * only switches pages and keeps appearance controls out of the navigation.
 */
export function AppDrawer({
  open,
  mode,
  packCount,
  onClose,
  onNavigate,
}: AppDrawerProps) {
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

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

  const renderItems = (items: DrawerItem[]) => items.map((item) => {
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
        {item.key === 'pack' && packCount > 0 && (
          <span className="drawer-nav-count">{packCount}</span>
        )}
        {active && <Icon name="check" size={15} className="drawer-nav-check" />}
      </button>
    );
  });

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

        <div className="drawer-scroll">
          <div className="drawer-section">
            <span className="drawer-section-label">工作台</span>
            <div className="drawer-nav-list">{renderItems(WORKSPACE_MODES)}</div>
          </div>
          <div className="drawer-section">
            <span className="drawer-section-label">应用</span>
            <div className="drawer-nav-list">{renderItems(APP_MODES)}</div>
          </div>
        </div>
      </aside>
    </div>
  );
}
