import type { MouseEvent } from "react";
import { InlineName } from "../ui/InlineName";
import { PackPreview } from "./PackPreview";
import type {
  Contents,
  LibraryPack,
  SkinItem,
  SlotStatus,
} from "./pack-types";
import type { InlineEdit, PackRow } from "./pack-ui";

export function SkinDetail({
  row,
  skin,
  skinIndex,
  baseUrl,
  contents,
  sourceModel,
  state,
  presetSourceIds,
  library,
  busy,
  locked,
  gameReady,
  installed,
  outdated,
  editing,
  onRename,
  onMenu,
  onInstall,
  onUpdate,
  onOpenPack,
  onAdd,
  onCommit,
  onCancel,
}: {
  row: PackRow;
  skin: SkinItem | undefined;
  skinIndex: number;
  baseUrl: string;
  contents: Contents | null;
  sourceModel: { id: string; name: string } | undefined;
  state: SlotStatus | undefined;
  presetSourceIds: Set<string>;
  library: LibraryPack[];
  busy: string;
  locked: boolean;
  gameReady: boolean;
  installed: boolean;
  outdated: boolean;
  editing: InlineEdit | null;
  onRename: () => void;
  onMenu: (event: MouseEvent) => void;
  onInstall: () => void;
  onUpdate: () => void;
  onOpenPack: (id: string) => void;
  onAdd: () => void;
  onCommit: (edit: InlineEdit, value: string) => void;
  onCancel: () => void;
}) {
  const inline =
    !!skin &&
    editing?.kind === "skin" &&
    editing.pack.key === row.key &&
    editing.skin.index === skin.index &&
    editing.scope === "detail";

  return (
    <div className="skin-detail-pane">
      {skin ? (
        <>
          <div className="skin-title">
            <h3 title="双击重命名" onDoubleClick={onRename}>
              {inline ? (
                <InlineName
                  initial={skin.name}
                  className="inline-title"
                  onCommit={(value) => onCommit(editing, value)}
                  onCancel={onCancel}
                />
              ) : (
                skin.name
              )}
            </h3>
            <div className="selected-skin-actions">
              <button
                type="button"
                className="icon-button"
                title="重命名皮肤"
                aria-label="重命名皮肤"
                disabled={!!busy || locked}
                onClick={onRename}
              >
                ✎
              </button>
              <button
                type="button"
                className="icon-button"
                title="皮肤操作"
                aria-label="皮肤操作"
                disabled={!!busy}
                onClick={onMenu}
              >
                ⋯
              </button>
            </div>
          </div>
          <div className="skin-origin-bar">
            <span>皮肤来源</span>
            {sourceModel ? (
              <a
                href={"#/models?model=" + encodeURIComponent(sourceModel.id)}
              >
                {sourceModel.name} ↗
              </a>
            ) : skin.origin?.template === "image" ? (
              <a
                href={
                  "#/templates?pack=" +
                  encodeURIComponent(skin.origin.packId)
                }
              >
                图片模板 · 继续编辑 ↗
              </a>
            ) : (
              <span>未记录来源</span>
            )}
          </div>
          <PackPreview
            packId={row.id}
            baseUrl={baseUrl}
            skinIndex={skinIndex}
            revision={contents?.revision ?? row.revision}
          />
          {row.preset ? (
            <details className="preset-sources">
              <summary>已加入的本地包</summary>
              {state?.active
                ?.filter((entry) => !presetSourceIds.has(entry.id))
                .map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => onOpenPack(entry.id)}
                  >
                    {library.find((pack) => pack.id === entry.id)?.name ??
                      entry.id}{" "}
                    →
                  </button>
                ))}
              {!state?.active?.some(
                (entry) => !presetSourceIds.has(entry.id),
              ) && <span>预制皮肤</span>}
            </details>
          ) : (
            <div className="skin-actions">
              <span className={installed ? "enabled-label" : ""}>
                {installed ? "游戏中" : "未安装到游戏"}
              </span>
              {!installed ? (
                <button
                  className="primary"
                  disabled={!!busy || !gameReady}
                  onClick={onInstall}
                >
                  安装到游戏
                </button>
              ) : (
                outdated && (
                  <button disabled={!!busy || !gameReady} onClick={onUpdate}>
                    更新到游戏
                  </button>
                )
              )}
            </div>
          )}
          <p className="game-write-note">
            写入或恢复游戏皮肤前，请完全退出 Minecraft。
            {row.preset
              ? "改名与移除只影响游戏中的副本。"
              : "修改本地包后，可手动更新到游戏。"}
          </p>
        </>
      ) : (
        contents && (
          <div className="empty-state empty-pack">
            <h2>{row.preset ? "此预制包暂无皮肤" : "这是一个空皮肤包"}</h2>
            <p>添加已有皮肤，或先到工作台生成新皮肤。</p>
            <div className="button-row">
              <button
                className="primary"
                disabled={!!busy || locked}
                onClick={onAdd}
              >
                添加已有皮肤
              </button>
              <a className="button-link" href="#/models">
                去生成皮肤 →
              </a>
            </div>
          </div>
        )
      )}
    </div>
  );
}
