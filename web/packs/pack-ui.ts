import type { LibraryPack, SkinItem } from "./pack-types";

export const gameSlotName = "custom";

export type PackRow = {
  key: string;
  id: string;
  name: string;
  skins: number;
  revision: string;
  preset: boolean;
  pack?: LibraryPack;
  gameSkins?: true;
};

export type MenuState = {
  x: number;
  y: number;
  pack: PackRow;
  skin?: SkinItem;
  scope: "list" | "detail";
};

export type InlineEdit =
  | { kind: "pack"; pack: PackRow; scope: "list" | "detail" }
  | {
      kind: "skin";
      pack: PackRow;
      skin: SkinItem;
      scope: "list" | "detail";
    };

export type PackDialogKind =
  | "create"
  | "import"
  | "delete"
  | "remove-skin"
  | "add"
  | "export"
  | null;
