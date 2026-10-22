import type { MouseEvent } from "react";
import { InlineName } from "../ui/InlineName";
import { SelectableRow } from "../ui/SelectableRow";
import { GameStatusBadge } from "./GameStatusBadge";
import type { SkinItem } from "./pack-types";
import type { InlineEdit, PackRow } from "./pack-ui";

export function SkinList({
  pack,
  runtime,
  actions,
}: {
  pack: {
    row: PackRow;
    skins: SkinItem[] | null;
    selectedIndex: number;
    editing: InlineEdit | null;
  };
  runtime: {
    busy: string;
    gameReady: boolean;
    installed: (index: number) => boolean;
    outdated: boolean;
  };
  actions: {
    onSelect: (index: number) => void;
    onRename: (skin: SkinItem) => void;
    onMenu: (event: MouseEvent, skin: SkinItem) => void;
    onInstall: (index: number) => void;
    onUpdate: () => void;
    onCommit: (edit: InlineEdit, value: string) => void;
    onCancel: () => void;
  };
}) {
  const { row, skins, selectedIndex, editing } = pack;
  const { busy, gameReady, installed, outdated } = runtime;
  const {
    onSelect,
    onRename,
    onMenu,
    onInstall,
    onUpdate,
    onCommit,
    onCancel,
  } = actions;
  return (
    <div className="skin-list-pane">
      <div className="pane-caption">包内皮肤</div>
      {!skins ? (
        <p className="muted">正在读取…</p>
      ) : (
        skins.map((skin) => {
          const isInstalled = !row.preset && installed(skin.index);
          const isOutdated = isInstalled && outdated;
          const inline =
            editing?.kind === "skin" &&
            editing.pack.key === row.key &&
            editing.skin.index === skin.index &&
            editing.scope === "list";
          return (
            <SelectableRow
              key={skin.index}
              className="skin-item text-only"
              selected={skin.index === selectedIndex}
              onSelect={() => onSelect(skin.index)}
              onRename={() => {
                onSelect(skin.index);
                onRename(skin);
              }}
              onMenu={(event) => onMenu(event, skin)}
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
              {!row.preset && (
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
                      <GameStatusBadge kind="skin" />
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
            </SelectableRow>
          );
        })
      )}
    </div>
  );
}
