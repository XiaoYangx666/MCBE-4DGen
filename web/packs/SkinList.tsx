import type { MouseEvent } from "react";
import { InlineName } from "../ui/InlineName";
import type { SkinItem } from "./pack-types";
import type { InlineEdit, PackRow } from "./pack-ui";

export function SkinList({
  pack,
  skins,
  selectedIndex,
  editing,
  busy,
  gameReady,
  installed,
  outdated,
  onSelect,
  onRename,
  onMenu,
  onInstall,
  onUpdate,
  onCommit,
  onCancel,
}: {
  pack: PackRow;
  skins: SkinItem[] | null;
  selectedIndex: number;
  editing: InlineEdit | null;
  busy: string;
  gameReady: boolean;
  installed: (index: number) => boolean;
  outdated: boolean;
  onSelect: (index: number) => void;
  onRename: (skin: SkinItem) => void;
  onMenu: (event: MouseEvent, skin: SkinItem) => void;
  onInstall: (index: number) => void;
  onUpdate: () => void;
  onCommit: (edit: InlineEdit, value: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="skin-list-pane">
      <div className="pane-caption">包内皮肤</div>
      {!skins ? (
        <p className="muted">正在读取…</p>
      ) : (
        skins.map((skin) => {
          const isInstalled = !pack.preset && installed(skin.index);
          const isOutdated = isInstalled && outdated;
          const inline =
            editing?.kind === "skin" &&
            editing.pack.key === pack.key &&
            editing.skin.index === skin.index &&
            editing.scope === "list";
          return (
            <div
              role="button"
              tabIndex={0}
              className={
                "skin-item text-only" +
                (skin.index === selectedIndex ? " selected" : "")
              }
              key={skin.index}
              onClick={() => onSelect(skin.index)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(skin.index);
                }
              }}
              onDoubleClick={() => {
                onSelect(skin.index);
                onRename(skin);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onSelect(skin.index);
                onMenu(event, skin);
              }}
            >
              <span className="skin-order">{skin.index + 1}</span>
              <span className="skin-item-copy">
                {inline ? (
                  <InlineName
                    initial={skin.name}
                    className="inline-skin"
                    onCommit={(value) => onCommit(editing, value)}
                    onCancel={onCancel}
                  />
                ) : (
                  <b>{skin.name}</b>
                )}
              </span>
              {!pack.preset && (
                <span className="skin-item-state">
                  {isInstalled ? (
                    isOutdated ? (
                      <button
                        type="button"
                        className="mini-button"
                        disabled={!!busy || !gameReady}
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdate();
                        }}
                      >
                        更新
                      </button>
                    ) : (
                      <span className="skin-installed-badge">游戏中</span>
                    )
                  ) : (
                    <button
                      type="button"
                      className="mini-button"
                      disabled={!!busy || !gameReady}
                      onClick={(event) => {
                        event.stopPropagation();
                        onInstall(skin.index);
                      }}
                    >
                      安装
                    </button>
                  )}
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
