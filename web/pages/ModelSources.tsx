import { useMemo, useState } from "react";
import {
  SOURCE_CATEGORIES,
  SOURCE_SITES,
  type SourceCategoryKey,
  type SourceSite,
} from "../../src/source-sites";
import { Modal } from "../ui/Modal";

type View = "all" | SourceCategoryKey;

const SORTED_SITES = [...SOURCE_SITES].sort((a, b) => a.rank - b.rank);
const CATEGORY_LABELS = new Map(
  SOURCE_CATEGORIES.map((category) => [category.key, category.label]),
);

function SiteIcon({ site }: { site: SourceSite }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="source-icon" aria-hidden="true">
      {!failed && (
        <img
          src={`/api/source-icon?domain=${encodeURIComponent(site.domain)}`}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          onLoad={(event) => {
            if (event.currentTarget.naturalWidth < 8) setFailed(true);
          }}
        />
      )}
      {failed && (
        <span className="source-icon-fallback">
          {site.name.replace(/[【】]/g, "").slice(0, 1)}
        </span>
      )}
    </span>
  );
}

function copyText(text: string): Promise<void> {
  return navigator.clipboard
    .writeText(text)
    .catch(() => {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      if (!copied) throw Error("复制失败");
    });
}

function SiteCard({ site }: { site: SourceSite }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  async function copyLink() {
    try {
      if (window.desktop?.copyText) await window.desktop.copyText(site.url);
      else await copyText(site.url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 1500);
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
        <SiteIcon site={site} />
        <div className="source-card-body">
          <div className="source-card-head">
            <div>
              <b>{site.name}</b>
              <span className="source-region">{site.region}</span>
            </div>
            {site.rating !== undefined && (
              <span className="source-rating">★ {site.rating.toFixed(1)}</span>
            )}
          </div>
          <p>{site.summary}</p>
          <div className="source-chips">
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
          </div>
          <div className="source-card-foot">
            <small>{site.domain}</small>
          </div>
        </div>
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
}: {
  title: string;
  hint?: string;
  sites: SourceSite[];
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
          <SiteCard key={site.id} site={site} />
        ))}
      </div>
    </section>
  );
}

export function ModelSources({ onClose }: { onClose: () => void }) {
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
    <Modal
      title="获取模型"
      label="获取模型"
      className="model-sources"
      closeLabel="关闭获取模型"
      closeOnBackdrop
      autoFocusClose
      onClose={onClose}
    >
      <div className="source-toolbar">
        <p className="source-lead">
          从常用站点找模型，下载后回到「源模型」导入。优先选择 ZIP、PMX、VRM
          或 GLB，并保留模型与贴图的目录结构。
        </p>
        <div className="source-search-row">
          <input
            type="search"
            aria-label="搜索模型网站"
            placeholder="搜索网站、类型、格式或地区…"
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
            全部网站 <small>{SORTED_SITES.length}</small>
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
          />
        ) : (
          <SiteSection
            title={activeCategory?.label ?? "全部网站"}
            hint={activeCategory?.hint}
            sites={categorySites ?? SORTED_SITES}
          />
        )}
        <p className="source-format-hint">
          提示：UnityPackage 需要先在 Unity 中导出 FBX/VRM；MMD 配布站的部分文件需要作者说明中的密码。下载后请保留模型、贴图和
          MMD 动作文件的相对目录。
        </p>
      </div>
    </Modal>
  );
}
