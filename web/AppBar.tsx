import { useEffect, useState, type ReactNode } from "react";
import { pages, type PageKey } from "./navigation";

export function AppBar({
  page,
  children,
}: {
  page: PageKey;
  children?: ReactNode;
}) {
  const [state, setState] = useState<DesktopWindowState>({
    maximized: false,
    fullscreen: false,
    focused: true,
  });

  useEffect(() => {
    const desktop = window.desktop!;
    document.documentElement.classList.add("desktop-shell");
    let active = true;
    const update = (value: DesktopWindowState) => {
      if (active) setState(value);
    };
    void desktop.windowState().then(update);
    const off = desktop.onWindowState(update);
    return () => {
      active = false;
      off();
      document.documentElement.classList.remove("desktop-shell");
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.expanded = String(
      state.maximized || state.fullscreen,
    );
  }, [state]);

  const action = (name: "minimize" | "maximize" | "close" | "menu") =>
    void window.desktop!.windowAction(name);

  return (
    <header className={`desktop-appbar${state.focused ? "" : " inactive"}`}>
      <a className="desktop-brand" href="#/" title="4DGen 概览">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m12 2 9 5v10l-9 5-9-5V7Zm0 0v10m9-5-9 5-9-5m9 5v10" />
        </svg>
        <b>
          4D<span>Gen</span>
        </b>
      </a>
      <nav aria-label="主导航">
        {pages.map(({ key, label, href }) => (
          <a
            key={key}
            href={href}
            aria-current={page === key ? "page" : undefined}
            className={page === key ? "active" : ""}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="appbar-space" />
      <div className="appbar-actions">
        {children}
        <button
          className="appbar-menu"
          onClick={() => action("menu")}
          aria-label="应用菜单"
          title="应用菜单"
        >
          ···
        </button>
      </div>
      <div className="window-controls">
        <button
          onClick={() => action("minimize")}
          aria-label="最小化"
          title="最小化"
        >
          <svg viewBox="0 0 16 16">
            <path d="M3 8h10" />
          </svg>
        </button>
        <button
          onClick={() => action("maximize")}
          aria-label={state.maximized ? "还原窗口" : "最大化"}
          title={state.maximized ? "还原窗口" : "最大化"}
        >
          <svg viewBox="0 0 16 16">
            {state.maximized ? (
              <path d="M5 5V3h8v8h-2M3 5h8v8H3Z" />
            ) : (
              <path d="M3.5 3.5h9v9h-9Z" />
            )}
          </svg>
        </button>
        <button
          className="window-close"
          onClick={() => action("close")}
          aria-label="关闭窗口"
          title="关闭"
        >
          <svg viewBox="0 0 16 16">
            <path d="m3.5 3.5 9 9m0-9-9 9" />
          </svg>
        </button>
      </div>
    </header>
  );
}
