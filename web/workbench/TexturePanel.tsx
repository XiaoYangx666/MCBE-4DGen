import { useMemo, useState } from 'react';
import type { Result, Session } from './types';

type MaterialFilter = 'all' | 'limited';

const FILTER_LABEL: Record<MaterialFilter, string> = {
  all: '全部',
  limited: '已到最小',
};

/**
 * Texture workspace outliner: search, filter and select materials. Density
 * editing and allocation charts live in the inspector on the right, so this
 * column stays a plain, scannable list.
 */
export function TexturePanel({
  session,
  result,
  previewBusy,
  stale,
  selected,
  onSelect,
  includedParts,
  busy,
}: {
  session: Session | null;
  result: Result | null;
  previewBusy: boolean;
  stale: boolean;
  selected: string;
  onSelect: (id: string | null) => void;
  includedParts: ReadonlySet<string>;
  busy: boolean;
}) {
  const materials = session?.materials ?? [];
  const parts = session?.parts ?? [];
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MaterialFilter>('all');
  const [sort, setSort] = useState<'default' | 'pixels' | 'name'>('default');
  const [showUnused, setShowUnused] = useState(false);

  const labels = useMemo(() => {
    const totals = new Map<string, number>();
    for (const material of materials)
      totals.set(material.name, (totals.get(material.name) ?? 0) + 1);
    const seen = new Map<string, number>();
    const map = new Map<string, string>();
    for (const material of materials) {
      if (material.label) {
        map.set(material.key, material.label);
        continue;
      }
      if ((totals.get(material.name) ?? 1) <= 1) {
        map.set(material.key, material.name || '未命名');
        continue;
      }
      const index = (seen.get(material.name) ?? 0) + 1;
      seen.set(material.name, index);
      map.set(material.key, `${material.name || '未命名'} #${index}`);
    }
    return map;
  }, [materials]);

  const measurements = useMemo(
    () =>
      new Map(
        (result?.details?.texture?.materials ?? []).map((material) => [
          material.key ?? material.name,
          material,
        ]),
      ),
    [result],
  );
  const atlas = result?.details?.texture?.atlas ?? null;
  const atlasPixels = atlas ? atlas.width * atlas.height : 0;

  const rows = useMemo(() => {
    const list = materials.map((material) => {
      const measurement = measurements.get(material.key);
      const related = parts.filter((part) => part.materialKey === material.key);
      const kept = related.filter((part) => includedParts.has(part.id)).length;
      const partText = related.length
        ? kept === related.length
          ? ` · ${related.length} 部件`
          : ` · 保留 ${kept}/${related.length} 部件`
        : '';
      const pixels = measurement?.rectPixels ?? measurement?.pixels ?? null;
      const limited = (measurement?.floorCharts ?? 0) > 0;
      // Without part metadata every material is treated as used.
      const unused = parts.length > 0 && kept === 0;
      return {
        id: material.key,
        name: labels.get(material.key) ?? (material.name || '未命名'),
        meta: `${material.triangles.toLocaleString('zh-CN')} 面${partText}${
          material.alpha < 1 ? ` · α ${material.alpha}` : ''
        }${unused ? ' · 无保留部件' : ''}`,
        thumbnail: material.thumbnail ?? null,
        color: material.color ?? null,
        limited,
        unused,
        pixels,
        share:
          pixels !== null && atlasPixels > 0
            ? (pixels / atlasPixels) * 100
            : null,
        status:
          pixels === null
            ? null
            : `${pixels.toLocaleString('zh-CN')} px`,
      };
    });
    const normalized = query.trim().toLowerCase();
    const filtered = list.filter((row) => {
      if (!showUnused && row.unused) return false;
      if (filter === 'limited' && !row.limited) return false;
      if (!normalized) return true;
      return (
        row.name.toLowerCase().includes(normalized) ||
        row.meta.toLowerCase().includes(normalized) ||
        row.id.toLowerCase().includes(normalized)
      );
    });
    if (sort === 'pixels')
      return [...filtered].sort((a, b) => (b.pixels ?? -1) - (a.pixels ?? -1));
    if (sort === 'name')
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return filtered;
  }, [
    materials,
    measurements,
    parts,
    includedParts,
    labels,
    atlasPixels,
    query,
    filter,
    sort,
    showUnused,
  ]);

  const unusedCount = useMemo(
    () =>
      materials.filter((material) => {
        if (!parts.length) return false;
        return parts
          .filter((part) => part.materialKey === material.key)
          .every((part) => !includedParts.has(part.id));
      }).length,
    [materials, parts, includedParts],
  );

  if (!session) {
    return <div className="empty-list">从模型管理打开模型后调整材质清晰度</div>;
  }

  return (
    <div className="texture-list">
      <div className="texture-list-head">
        <div>
          <b>材质</b>
          <small>
            {rows.length}/{materials.length} 项
            {previewBusy
              ? ' · 正在更新'
              : stale
                ? ' · 预览待更新'
                : result
                  ? ' · 预览已是最新'
                  : ' · 尚未生成预览'}
          </small>
        </div>
      </div>
      <div className="texture-list-tools">
        <input
          type="search"
          value={query}
          placeholder="搜索材质名称、标识或信息…"
          aria-label="搜索材质"
          disabled={busy}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="texture-table-filters" role="group" aria-label="材质筛选">
          {(Object.keys(FILTER_LABEL) as MaterialFilter[]).map((key) => (
            <button
              type="button"
              key={key}
              className={filter === key ? 'active' : ''}
              disabled={busy}
              onClick={() => setFilter(key)}
            >
              {FILTER_LABEL[key]}
            </button>
          ))}
        </div>
        <select
          aria-label="材质排序"
          value={sort}
          disabled={busy}
          onChange={(event) =>
            setSort(event.target.value as 'default' | 'pixels' | 'name')
          }
        >
          <option value="default">模型顺序</option>
          <option value="pixels">像素分配</option>
          <option value="name">名称</option>
        </select>
        <label className="texture-table-unused" title="显示在模型页删掉全部部件的材质">
          <input
            type="checkbox"
            checked={showUnused}
            disabled={busy || !unusedCount}
            onChange={(event) => setShowUnused(event.target.checked)}
          />
          含未使用{unusedCount ? ` (${unusedCount})` : ''}
        </label>
      </div>
      <div className="texture-list-scroll">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`texture-row${row.id === selected ? ' selected' : ''}`}
            onClick={() => onSelect(row.id)}
          >
            {row.thumbnail ? (
              <img className="texture-row-thumb" src={row.thumbnail} alt="" />
            ) : (
              <span
                className="texture-row-thumb swatch"
                style={{ background: row.color ?? 'var(--line)' }}
              />
            )}
            <div className="texture-row-main">
              <b title={row.name}>{row.name}</b>
              <small>{row.meta}</small>
            </div>
            <span
              className={`texture-row-alloc${row.limited ? ' limited' : ''}`}
              title="分配像素 · 占图集比例"
            >
              {row.share != null && (
                <i
                  className="texture-row-alloc-bar"
                  style={{ width: `${Math.min(100, row.share)}%` }}
                />
              )}
              <b>{row.status ?? '—'}</b>
              {row.share != null && <em>{row.share.toFixed(1)}%</em>}
            </span>
          </div>
        ))}
        {!rows.length && (
          <p className="workspace-empty">
            {materials.length ? '没有匹配的材质。' : '当前模型没有材质。'}
          </p>
        )}
      </div>
    </div>
  );
}
