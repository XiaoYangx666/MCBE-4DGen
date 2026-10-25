/**
 * Palette metadata shared by the desktop workbench (`web/`) and the browser
 * web app (`webapp/`). Only presentation data lives here: each shell keeps its
 * own persistence (desktop bridge / localStorage) and theme application.
 */

export type Palette = "graphite" | "ocean" | "sand" | "rose" | "violet";

export interface PaletteOption {
  key: Palette;
  label: string;
  hint: string;
}

export const PALETTE_OPTIONS: readonly PaletteOption[] = [
  { key: "graphite", label: "中性灰", hint: "干净、克制" },
  { key: "ocean", label: "海盐蓝", hint: "清爽、低饱和" },
  { key: "sand", label: "暖砂", hint: "柔和、暖色调" },
  { key: "rose", label: "玫瑰灰", hint: "温润、淡玫瑰" },
  { key: "violet", label: "蓝紫", hint: "原有蓝紫配色" },
];

export const DEFAULT_PALETTE: Palette = "graphite";

export function isPalette(value: unknown): value is Palette {
  return (
    typeof value === "string" &&
    PALETTE_OPTIONS.some((option) => option.key === value)
  );
}
