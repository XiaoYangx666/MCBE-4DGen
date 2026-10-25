import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SOURCE_CATEGORIES,
  SOURCE_SITES,
  type SourceCategoryKey,
  type SourceSite,
} from "../../src/source-sites";
import { copyTextToClipboard } from "./clipboard";

type View = "all" | SourceCategoryKey;

const SORTED_SITES = [...SOURCE_SITES].sort((a, b) => a.rank - b.rank);
const CATEGORY_LABELS = new Map(
  SOURCE_CATEGORIES.map((category) => [category.key, category.label]),
);

function siteInitial(site: SourceSite) {
  return site.name.replace(/[【】]/g, "").slice(0, 1);
}

function SiteCard({
  site,
  icon,
  copyText,
}: {
  site: SourceSite;
  icon?: (site: SourceSite) => ReactNode;
  copyText: (text: string) => Promise<void>;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copyLink() {
    try {
      await copyText(site.url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopyState("idle"), 1500);
  }

  return (
    <div className="source-card-wrap">
      <a
        className="source-card"
        href={site.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`打开 ${site.name}`}
      >
        <span className="source-icon" aria-hidden="true">
          {icon ? (
            icon(site)
          ) : (
            <span className="source-icon-fallback">{siteInitial(site)}</span>
          )}
        </span>
        <span className="source-card-body">
          <span className="source-card-head">
            <span className="source-card-title">
              <b>{site.name}</b>
              <span className="source-region">{site.region}</span>
            </span>
            {site.rating !== undefined && (
              <span className="source-rating">★ {site.rating.toFixed(1)}</span>
            )}
          </span>
          <span className="source-summary">{site.summary}</span>
          <span className="source-chips">
            <span className="source-chip price">{site.pricing}</span>
            {site.formats.slice(0, 4).map((format) => (
              <span className="source-chip" key={format}>
                {format}
              </span>
            ))}
            {site.categories
              .filter((category) => category !== "general")
              .slice(0, 1)
              .map((category) => (
                <span className="source-chip category" key={category}>
                  {CATEGORY_LABELS.get(category)}
                </span>
              ))}
          </span>
          <span className="source-card-foot">
            <small>{site.domain}</small>
          </span>
        </span>
      </a>
      <button
        type="button"
        className="source-copy"
        title="复制链接"
        aria-label={`复制 ${site.name} 链接`}
        onClick={() => void copyLink()}
      >
        {copyState === "copied"
          ? "已复制"
          : copyState === "failed"
            ? "复制失败"
            : "复制"}
      </button>
    </div>
  );
}

function SiteSection({
  title,
  hint,
  sites,
  icon,
  copyText,
}: {
  title: string;
  hint?: string;
  sites: SourceSite[];
  icon?: (site: SourceSite) => ReactNode;
  copyText: (text: string) => Promise<void>;
}) {
  if (!sites.length) return null;
  return (
    <section className="source-section">
      <div className="source-section-head">
        <h3>{title}</h3>
        {hint && <span>{hint}</span>}
      </div>
      <div className="source-grid">
        {sites.map((site) => (
          <SiteCard
            key={site.id}
            site={site}
            icon={icon}
            copyText={copyText}
          />
        ))}
      </div>
    </section>
  );
}

export interface SourceDirectoryProps {
  /** Intro copy above the search field. */
  lead?: ReactNode;
  /** Hint below the grid. */
  note?: ReactNode;
  /** Label for the "all sites" tab, e.g. `全部网站`. */
  allLabel?: string;
  /** Section heading when no category is selected. Defaults to `全部网站`. */
  allTitle?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** Render the content of a card icon. Defaults to the site's first letter. */
  icon?: (site: SourceSite) => ReactNode;
  /** Clipboard implementation. Defaults to `navigator.clipboard`. */
  copyText?: (text: string) => Promise<void>;
  className?: string;
}

/**
 * Model-source directory: search, category tabs and site cards. The shell
 * (modal/dialog chrome) stays with each app; icons and clipboard behaviour are
 * injected so the desktop bridge and the browser clipboard never leak here.
 */
export function SourceDirectory({
  lead,
  note,
  allLabel = "全部网站",
  allTitle = "全部网站",
  searchPlaceholder = "搜索网站、类型、格式或地区…",
  emptyLabel = "没有匹配的站点。",
  icon,
  copyText = copyTextToClipboard,
  className = "",
}: SourceDirectoryProps) {
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");

  const categoryCounts = useMemo(
    () =>
      Object.fromEntries(
        SOURCE_CATEGORIES.map((category) => [
          category.key,
          SORTED_SITES.filter((site) => site.categories.includes(category.key))
            .length,
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
        ...site.categories.map(
          (category) => CATEGORY_LABELS.get(category) ?? category,
        ),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query]);

  const categorySites = useMemo(() => {
    if (view === "all") return null;
    return SORTED_SITES.filter((site) => site.categories.includes(view));
  }, [view]);

  const activeCategory = SOURCE_CATEGORIES.find(
    (category) => category.key === view,
  );

  return (
    <div className={"source-directory " + className}>
      <div className="source-toolbar">
        {lead && <p className="source-lead">{lead}</p>}
        <div className="source-search-row">
          <input
            type="search"
            aria-label="搜索模型网站"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")}>
              清除
            </button>
          )}
        </div>
        <nav className="source-tabs" aria-label="模型网站分类">
          <button
            type="button"
            className={view === "all" && !query ? "active" : ""}
            aria-pressed={view === "all" && !query}
            onClick={() => {
              setView("all");
              setQuery("");
            }}
          >
            {allLabel} <small>{SORTED_SITES.length}</small>
          </button>
          {SOURCE_CATEGORIES.map((category) => (
            <button
              type="button"
              key={category.key}
              className={view === category.key && !query ? "active" : ""}
              aria-pressed={view === category.key && !query}
              onClick={() => {
                setView(category.key);
                setQuery("");
              }}
            >
              {category.label}
              <small>{categoryCounts[category.key]}</small>
            </button>
          ))}
        </nav>
      </div>

      <div className="source-scroll">
        {matches ? (
          <SiteSection
            title={`搜索结果 · ${matches.length}`}
            hint={`关键词「${query.trim()}」`}
            sites={matches}
            icon={icon}
            copyText={copyText}
          />
        ) : (
          <SiteSection
            title={activeCategory?.label ?? allTitle}
            hint={activeCategory?.hint}
            sites={categorySites ?? SORTED_SITES}
            icon={icon}
            copyText={copyText}
          />
        )}
        {matches && !matches.length && (
          <p className="source-empty">{emptyLabel}</p>
        )}
        {note && <p className="source-note">{note}</p>}
      </div>
    </div>
  );
}
