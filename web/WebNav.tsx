import type { ReactNode } from "react";
import { pages, type PageKey } from "./navigation";

export function WebNav({
  page,
  modelName,
  action,
}: {
  page: PageKey;
  modelName?: string;
  action?: ReactNode;
}) {
  return (
    <header className="app-nav">
      <a className="brand" href="#/">
        4D<span>Gen</span>
        <i>LOCAL STUDIO</i>
      </a>
      <nav aria-label="主导航">
        {pages.map(({ key, label, href }) => (
          <a
            key={key}
            className={page === key ? "active" : ""}
            aria-current={page === key ? "page" : undefined}
            href={href}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="header-right">
        {modelName && (
          <span className="current-model" title={modelName}>
            {modelName}
          </span>
        )}
        {action}
        <span className="local">
          <b /> {window.desktop ? "桌面运行" : "本地环境运行"}
        </span>
      </div>
    </header>
  );
}
