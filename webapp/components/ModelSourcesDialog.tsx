import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SOURCE_CATEGORIES,
  SOURCE_SITES,
  type SourceCategoryKey,
  type SourceSite,
} from '../../src/source-sites.ts';
import { Icon } from './Icons';

type View = 'all' | SourceCategoryKey;

const SORTED_SITES = [...SOURCE_SITES].sort((a, b) => a.rank - b.rank);
const CATEGORY_LABELS = new Map(
  SOURCE_CATEGORIES.map((category) => [category.key, category.label]),
);

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) throw new Error('复制失败');
  }
}

function SourceCard({ site }: { site: SourceSite }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const copyLink = async () => {
    try {
      await copyText(site.url);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard can be blocked in insecure contexts */ }
  };

  return (
    <article className="source-item">
      <a className="source-main" href={site.url} target="_blank" rel="noopener noreferrer">
        <span className="source-avatar" aria-hidden="true">
          {site.name.replace(/[【】]/g, '').slice(0, 1)}
        </span>
        <span className="source-body">
          <span className="source-head">
            <b>{site.name}</b>
            {site.rating !== undefined && (
              <span className="source-rating">★ {site.rating.toFixed(1)}</span>
            )}
          </span>
          <span className="source-summary">{site.summary}</span>
          <span className="source-chips">
            <span className="source-chip price">{site.pricing}</span>
            {site.formats.slice(0, 4).map((format) => (
              <span className="source-chip" key={format}>{format}</span>
            ))}
          </span>
          <span className="source-domain">{site.region} · {site.domain}</span>
        </span>
      </a>
      <button
        type="button"
        className="source-copy"
        aria-label={`复制 ${site.name} 链接`}
        onClick={() => void copyLink()}
      >
        {copied ? '已复制' : '复制'}
      </button>
    </article>
  );
}

export function ModelSourcesDialog({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    closeButton.current?.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const counts = useMemo(
    () => Object.fromEntries(
      SOURCE_CATEGORIES.map((category) => [
        category.key,
        SORTED_SITES.filter((site) => site.categories.includes(category.key)).length,
      ]),
    ) as Record<SourceCategoryKey, number>,
    [],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return SORTED_SITES.filter((site) =>
      [
        site.name,
        site.summary,
        site.region,
        site.pricing,
        ...site.formats,
        ...site.tags,
        ...site.categories.map((category) => CATEGORY_LABELS.get(category) ?? category),
      ].join(' ').toLowerCase().includes(needle));
  }, [query]);

  const sites = useMemo(() => {
    if (matches) return matches;
    if (view === 'all') return SORTED_SITES;
    return SORTED_SITES.filter((site) => site.categories.includes(view));
  }, [matches, view]);

  const activeCategory = SOURCE_CATEGORIES.find((category) => category.key === view);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="sources-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sources-title"
      >
        <header className="sources-header">
          <div>
            <h2 id="sources-title">获取模型</h2>
            <p>从常用站点下载模型，再回到这里导入。</p>
          </div>
          <button
            ref={closeButton}
            type="button"
            className="icon-button"
            aria-label="关闭获取模型"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="sources-toolbar">
          <input
            type="search"
            value={query}
            aria-label="搜索模型网站"
            placeholder="搜索网站、格式或地区"
            onChange={(event) => setQuery(event.target.value)}
          />
          <nav className="sources-tabs" aria-label="模型网站分类">
            <button
              type="button"
              className={view === 'all' && !query ? 'active' : ''}
              aria-pressed={view === 'all' && !query}
              onClick={() => {
                setView('all');
                setQuery('');
              }}
            >
              全部 <small>{SORTED_SITES.length}</small>
            </button>
            {SOURCE_CATEGORIES.map((category) => (
              <button
                key={category.key}
                type="button"
                className={view === category.key && !query ? 'active' : ''}
                aria-pressed={view === category.key && !query}
                onClick={() => {
                  setView(category.key);
                  setQuery('');
                }}
              >
                {category.label} <small>{counts[category.key]}</small>
              </button>
            ))}
          </nav>
        </div>

        <div className="sources-scroll">
          <div className="sources-caption">
            {matches ? `搜索结果 · ${sites.length}` : activeCategory?.label ?? '全部网站'}
            {!matches && activeCategory?.hint && <span>{activeCategory.hint}</span>}
          </div>
          {sites.length ? (
            <div className="sources-grid">
              {sites.map((site) => <SourceCard key={site.id} site={site} />)}
            </div>
          ) : (
            <div className="empty-state compact">
              <p>没有匹配的站点。</p>
            </div>
          )}
          <p className="sources-note">网页版推荐 GLB / glTF / VRM / OBJ；PMX 请使用桌面版。</p>
        </div>
      </div>
    </div>
  );
}
