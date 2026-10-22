import type { MouseEvent } from "react";
import { InlineName } from "../ui/InlineName";
import type { Contents } from "./pack-types";
import type { InlineEdit, PackRow } from "./pack-ui";

export function PackHeader({
  pack,
  runtime,
  actions,
}: {
  pack: { row: PackRow; contents: Contents | null };
  runtime: { busy: string; locked: boolean; editing: InlineEdit | null };
  actions: {
    onRename: () => void;
    onMenu: (event: MouseEvent) => void;
    onAdd: () => void;
    onCommit: (edit: InlineEdit, value: string) => void;
    onCancel: () => void;
  };
}) {
  const { row, contents } = pack;
  const { busy, locked, editing } = runtime;
  const { onRename, onMenu, onAdd, onCommit, onCancel } = actions;
  const inline =
    editing?.kind === "pack" &&
    editing.pack.key === row.key &&
    editing.scope === "detail";
  return (
    <div className="pack-detail-bar">
      <div>
        <h2 title="双击重命名" onDoubleClick={onRename}>
          {inline ? (
            <InlineName
              initial={row.name}
              className="inline-title"
              onCommit={(value) => onCommit(editing, value)}
              onCancel={onCancel}
            />
          ) : (
            <>
              {row.name}
              {row.preset && (
                <span className="preset-title-badge">游戏目录</span>
              )}
            </>
          )}
        </h2>
        <span>
          {contents?.skins.length ?? row.skins} 套皮肤
          {row.preset ? " · 来自游戏目录" : " · 本地皮肤包"}
        </span>
      </div>
      <div className="pack-detail-actions">
        <button disabled={!!busy || locked} onClick={onAdd}>
          ＋ 添加皮肤
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="皮肤包操作"
          title="更多操作"
          disabled={!!busy}
          onClick={onMenu}
        >
          ⋯
        </button>
      </div>
    </div>
  );
}
