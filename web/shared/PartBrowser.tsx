import { useMemo, useState } from 'react';
import type { StudioPart } from './texture-types';

type PartFilter = 'all' | 'kept' | 'dropped' | 'shared';

const FILTER_LABEL: Record<PartFilter, string> = {
  all: '全部',
  kept: '保留',
  dropped: '已删除',
  shared: '共享材质',
};

/**
 * Part list shared by the model workspace and the desktop workbench. Part ids
 * are stable identities: duplicate display names never collide.
 *
 * There is no collapse/accordion here: keeping or dropping geometry is the
 * model workspace's only job, so the list is always open and sits flush in the
 * column instead of inside its own card.
 */
export function PartBrowser({
  parts,
  includedParts,
  onTogglePart,
  onSetParts,
  selectedPart,
  onSelectPart,
  disabled = false,
  emptyText = '当前模型没有可管理的部件。',
}: {
  parts: readonly StudioPart[];
  includedParts: ReadonlySet<string>;
  onTogglePart: (id: string) => void;
  onSetParts: (ids: readonly string[]) => void;
  selectedPart: string | null;
  onSelectPart: (id: string | null) => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PartFilter>('all');

  const allPartIds = useMemo(() => parts.map((part) => part.id), [parts]);
  const normalized = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      parts.filter((part) => {
        const kept = includedParts.has(part.id);
        if (filter === 'kept' && !kept) return false;
        if (filter === 'dropped' && kept) return false;
        if (filter === 'shared' && !(part.sharedWith?.length ?? 0)) return false;
        if (!normalized) return true;
        return (
          part.name.toLowerCase().includes(normalized) ||
          part.group.toLowerCase().includes(normalized) ||
          part.meta.toLowerCase().includes(normalized) ||
          part.materials.some((name) => name.toLowerCase().includes(normalized))
        );
      }),
    [parts, includedParts, filter, normalized],
  );
  const groups = useMemo(() => {
    const map = new Map<string, StudioPart[]>();
    for (const part of visible) {
      const list = map.get(part.group) ?? [];
      list.push(part);
      map.set(part.group, list);
    }
    return [...map.entries()];
  }, [visible]);

  if (!parts.length) return <p className="workspace-empty">{emptyText}</p>;

  return (
    <div className="part-browser">
      <div className="part-browser-tools">
        <input
          type="search"
          value={query}
          placeholder="搜索部件、网格或材质…"
          aria-label="搜索部件"
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="part-browser-filters" role="group" aria-label="部件筛选">
          {(Object.keys(FILTER_LABEL) as PartFilter[]).map((key) => (
            <button
              type="button"
              key={key}
              className={filter === key ? 'active' : ''}
              disabled={disabled}
              onClick={() => setFilter(key)}
            >
              {FILTER_LABEL[key]}
            </button>
          ))}
          <span className="part-browser-count">
            {includedParts.size}/{parts.length} 保留
          </span>
        </div>
      </div>
      <div className="texture-studio-actions">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSetParts(allPartIds)}
        >
          全部保留
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onSetParts(allPartIds.filter((id) => !includedParts.has(id)))
          }
        >
          反选
        </button>
      </div>
      {!visible.length && <p className="workspace-empty">没有匹配的部件。</p>}
      <div className="texture-studio-part-groups">
        {groups.map(([group, list]) => {
          const groupIds = list.map((part) => part.id);
          const kept = groupIds.filter((id) => includedParts.has(id)).length;
          return (
            <div className="texture-part-group" key={group}>
              {groups.length > 1 && (
                <div className="texture-part-group-head">
                  <span title={group}>网格 · {group}</span>
                  <small>
                    {kept}/{list.length}
                  </small>
                  <button
                    type="button"
                    disabled={disabled || kept === list.length}
                    onClick={() =>
                      onSetParts([...new Set([...includedParts, ...groupIds])])
                    }
                  >
                    保留本组
                  </button>
                </div>
              )}
              {list.map((part) => {
                const included = includedParts.has(part.id);
                return (
                  <div
                    className={`texture-part-row${selectedPart === part.id ? ' selected' : ''}${included ? '' : ' dropped'}`}
                    key={part.id}
                    title={
                      included
                        ? selectedPart === part.id
                          ? '点击恢复显示全部部件'
                          : `点击只看 ${part.name}`
                        : '部件已删除'
                    }
                    onClick={() => {
                      if (!included || disabled) return;
                      onSelectPart(selectedPart === part.id ? null : part.id);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={included}
                      disabled={disabled}
                      aria-label={`保留 ${part.name}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => onTogglePart(part.id)}
                    />
                    {part.thumbnail ? (
                      <img
                        className="texture-part-thumb"
                        src={part.thumbnail}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="texture-part-thumb empty" aria-hidden="true" />
                    )}
                    <div className="texture-part-text">
                      <button
                        type="button"
                        className="texture-part-name"
                        disabled={disabled || !included}
                        title={included ? `在预览中只显示 ${part.name}` : '部件已删除'}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectPart(selectedPart === part.id ? null : part.id);
                        }}
                      >
                        {part.name}
                      </button>
                      <span className="texture-part-meta" title={part.meta}>
                        {part.meta}
                      </span>
                    </div>
                    {part.sharedWith && part.sharedWith.length > 0 && (
                      <span
                        className="texture-part-shared"
                        title={`共享材质：${part.materials.join('、')}`}
                      >
                        共享 ×{part.sharedWith.length + 1}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
