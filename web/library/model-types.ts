import type { ModelEntry } from "../../src/api-types";
import type { LibraryPack } from "../packs/pack-types";

export type Model = ModelEntry;

export type Row = {
  id: string;
  name: string;
  model: Model | null;
  packs: LibraryPack[];
};

export const when = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const num = (value?: number) =>
  value === undefined ? "—" : value.toLocaleString("zh-CN");

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
