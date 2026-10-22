import type { MenuItem } from "../ui/ContextMenu";
import type { SlotStatus } from "./pack-types";
import type { MenuState } from "./pack-ui";

export type PackMenuRuntime = {
  busy: string;
  locked: boolean;
  gameReady: boolean;
  state: SlotStatus | undefined;
  isActive: (packID: string) => boolean;
  isOutdated: (pack: MenuState["pack"]) => boolean;
  isFullyInstalled: (pack: MenuState["pack"]) => boolean;
  isSkinInstalled: (packID: string, index: number) => boolean;
};

export type PackMenuActions = {
  renamePack: (pack: MenuState["pack"], scope: "list" | "detail") => void;
  renameSkin: (
    pack: MenuState["pack"],
    skin: NonNullable<MenuState["skin"]>,
    scope: "list" | "detail",
  ) => void;
  installSkin: (
    pack: MenuState["pack"],
    skin: NonNullable<MenuState["skin"]>,
  ) => void;
  updatePack: (pack: MenuState["pack"]) => void;
  disableSkin: (
    pack: MenuState["pack"],
    skin: NonNullable<MenuState["skin"]>,
  ) => void;
  removeSkin: (
    pack: MenuState["pack"],
    skin: NonNullable<MenuState["skin"]>,
  ) => void;
  installPack: (pack: MenuState["pack"]) => void;
  disablePack: (pack: MenuState["pack"]) => void;
  exportPack: (pack: MenuState["pack"]) => void;
  deletePack: (pack: MenuState["pack"]) => void;
  restorePack: (pack: MenuState["pack"]) => void;
  recoverPack: (pack: MenuState["pack"]) => void;
};

export function buildPackMenu(
  menu: MenuState,
  runtime: PackMenuRuntime,
  actions: PackMenuActions,
): MenuItem[] {
  const { pack, skin, scope } = menu;
  const items: MenuItem[] = [];
  if (skin) {
    items.push({
      label: "重命名",
      onSelect: () => actions.renameSkin(pack, skin, scope),
    });
    if (pack.preset) {
      items.push({
        label: "从游戏中移除",
        danger: true,
        separate: true,
        disabled: !!runtime.busy || runtime.locked,
        onSelect: () => actions.removeSkin(pack, skin),
      });
      return items;
    }
    const installed = runtime.isSkinInstalled(pack.id, skin.index);
    if (!installed) {
      items.push({
        label: "安装到游戏",
        disabled: !!runtime.busy || !runtime.gameReady,
        onSelect: () => actions.installSkin(pack, skin),
      });
    } else {
      if (runtime.isOutdated(pack)) {
        items.push({
          label: "更新到游戏",
          disabled: !!runtime.busy || !runtime.gameReady,
          onSelect: () => actions.updatePack(pack),
        });
      }
      items.push({
        label: "从游戏中移除",
        disabled: !!runtime.busy || !runtime.gameReady,
        onSelect: () => actions.disableSkin(pack, skin),
      });
    }
    items.push({
      label: "移出此包",
      danger: true,
      separate: true,
      disabled: !!runtime.busy || runtime.locked,
      onSelect: () => actions.removeSkin(pack, skin),
    });
    return items;
  }

  items.push({
    label: "重命名皮肤包",
    onSelect: () => actions.renamePack(pack, scope),
  });
  if (pack.preset) {
    if (runtime.state?.pending) {
      items.push({
        label: "恢复中断的操作",
        disabled: !!runtime.busy,
        onSelect: () => actions.recoverPack(pack),
      });
    } else {
      items.push({
        label: "恢复初始皮肤包",
        disabled:
          !!runtime.busy ||
          !runtime.state?.managed ||
          !runtime.state.active?.length ||
          runtime.locked,
        onSelect: () => actions.restorePack(pack),
      });
    }
    return items;
  }

  if (!runtime.isFullyInstalled(pack)) {
    items.push({
      label: "整包安装到游戏",
      disabled: !!runtime.busy || !runtime.gameReady || !pack.skins,
      onSelect: () => actions.installPack(pack),
    });
  }
  if (runtime.isActive(pack.id) && runtime.isOutdated(pack)) {
    items.push({
      label: "更新到游戏",
      disabled:
        !!runtime.busy ||
        !runtime.gameReady ||
        !pack.skins ||
        !!pack.pack?.draft,
      onSelect: () => actions.updatePack(pack),
    });
  }
  if (runtime.isActive(pack.id)) {
    items.push({
      label: "从游戏中移除",
      disabled: !!runtime.busy || !runtime.gameReady,
      onSelect: () => actions.disablePack(pack),
    });
  }
  items.push({
    label: "导出 .zip",
    separate: true,
    disabled: !pack.skins,
    onSelect: () => actions.exportPack(pack),
  });
  items.push({
    label: "删除皮肤包",
    danger: true,
    disabled: !!runtime.busy || runtime.isActive(pack.id),
    hint: runtime.isActive(pack.id)
      ? "先从游戏中移除，才能删除本地包"
      : undefined,
    onSelect: () => actions.deletePack(pack),
  });
  return items;
}
