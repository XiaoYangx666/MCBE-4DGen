import type { MouseEvent } from "react";
import { InlineName } from "../ui/InlineName";
import type { InlineEdit, PackRow } from "./pack-ui";

export function PackSidebar({
  rows,
  selectedKey,
  query,
  editing,
  personaInUse,
  isGameActive,
  onQueryChange,
  onSelect,
  onRename,
  onMenu,
  onCommit,
  onCancel,
}: {
  rows: PackRow[];
  selectedKey?: string;
  query: string;
  editing: InlineEdit | null;
  personaInUse: boolean;
  isGameActive: (row: PackRow) => boolean;
  onQueryChange: (value: string) => void;
  onSelect: (row: PackRow) => void;
  onRename: (row: PackRow) => void;
  onMenu: (event: MouseEvent, row: PackRow) => void;
  onCommit: (edit: InlineEdit, value: string) => void;
  onCancel: () => void;
}) {
  return (
    <aside className="pack-list-pane organized-packs">
      <div className="pack-sidebar-head">
        <input
          aria-label="搜索皮肤包"
          placeholder="搜索皮肤包…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <div className="pack-sidebar-scroll">
        {rows.map((row) => {
          const game = isGameActive(row);
          const inline =
            editing?.kind === "pack" &&
            editing.pack.key === row.key &&
            editing.scope === "list";
          return (
            <div
              key={row.key}
              role="button"
              tabIndex={0}
              title={row.gameSkins ? row.name : "双击重命名，右键更多操作"}
              className={
                "pack-library-row text-only" +
                (row.key === selectedKey ? " selected" : "")
              }
              onClick={() => onSelect(row)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(row);
                }
              }}
              onDoubleClick={() => {
                if (!row.gameSkins) onRename(row);
              }}
              onContextMenu={(event) => {
                if (row.gameSkins) return;
                event.preventDefault();
                onSelect(row);
                onMenu(event, row);
              }}
            >
              <span className="pack-row-copy">
                {inline ? (
                  <InlineName
                    initial={row.name}
                    className="inline-pack"
                    onCommit={(value) => onCommit(editing, value)}
                    onCancel={onCancel}
                  />
                ) : (
                  <b>{row.name}</b>
                )}
                <small>
                  {row.gameSkins ? `${row.skins} 个角色` : `${row.skins} 套皮肤`}
                  {row.gameSkins
                    ? " · 角色创建器"
                    : row.preset
                      ? " · 游戏目录"
                      : row.pack?.draft
                        ? " · 空包"
                        : ""}
                </small>
              </span>
              <span className="pack-row-end">
                {game && (
                  <span
                    className={
                      "pack-game-badge" +
                      (row.gameSkins ? " persona" : " installed")
                    }
                  >
                    {row.gameSkins
                      ? personaInUse
                        ? "当前使用"
                        : "角色创建器"
                      : "游戏中"}
                  </span>
                )}
              </span>
            </div>
          );
        })}
        {!rows.length && (
          <div className="small-empty">
            {query ? "没有匹配的本地包" : "新建或导入你的皮肤包"}
          </div>
        )}
      </div>
    </aside>
  );
}
