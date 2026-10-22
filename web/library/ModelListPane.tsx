import { num, type Row } from "./model-types";

export function ModelListPane({
  rows,
  visible,
  selectedId,
  query,
  filter,
  sort,
  onQueryChange,
  onFilterChange,
  onSortChange,
  onChoose,
  activeSlots,
}: {
  rows: Row[];
  visible: Row[];
  selectedId?: string;
  query: string;
  filter: string;
  sort: string;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onChoose: (row: Row) => void;
  activeSlots: (packId: string) => string[];
}) {
  return (
    <aside className="model-list">
      <div className="model-list-tools">
        <div className="library-toolbar">
          <input
            aria-label="搜索模型"
            placeholder="搜索模型名称、路径或皮肤版本…"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          <select
            aria-label="筛选模型"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
          >
            <option value="all">全部源模型</option>
            <option value="source">未生成皮肤版本</option>
            <option value="skin">有皮肤版本</option>
          </select>
          <select
            aria-label="模型排序"
            value={sort}
            onChange={(event) => onSortChange(event.target.value)}
          >
            <option value="recent">最近编辑</option>
            <option value="name">名称排序</option>
          </select>
          <span>{visible.length} 项</span>
        </div>
      </div>
      <div className="model-list-scroll">
        {visible.map((row) => (
          <button
            className={
              "model-row" + (row.id === selectedId ? " selected" : "")
            }
            key={row.id}
            onClick={() => onChoose(row)}
          >
            <span className="model-avatar small">
              {row.name.replace(/[【】]/g, "").slice(0, 1)}
            </span>
            <span className="model-row-copy">
              <b>{row.name}</b>
              <small>
                {row.model
                  ? `${num(row.model.stats?.triangles)} 面`
                  : "待关联源模型"}{" "}
                · {row.packs.length} 版本
                {row.model?.sourceAvailable === false ? " · 源文件丢失" : ""}
              </small>
            </span>
            {row.packs.some((pack) => activeSlots(pack.id).length > 0) && (
              <span className="status-dot" title="已启用" />
            )}
          </button>
        ))}
        {!visible.length && (
          <div className="empty-state">
            <h3>{rows.length ? "没有匹配的模型" : "模型库为空"}</h3>
            <p>
              {rows.length
                ? "试试其他名称或筛选条件。"
                : "导入模型后会显示在这里。"}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
