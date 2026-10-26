import {
  DEFAULT_PALETTE,
  isPalette,
  type Palette,
} from "../shared/palettes";
import { applyThemeToDocument } from "../shared/appearance";

export type { Palette } from "../shared/palettes";
export type Appearance = "system" | "light" | "dark";

const APPEARANCES: readonly Appearance[] = ["system", "light", "dark"];

let palette: Palette = DEFAULT_PALETTE;
let preference: Appearance = "system";
const media = matchMedia("(prefers-color-scheme: dark)");

export const getPalette = () => palette;
export const getAppearance = () => preference;

const isAppearance = (value: unknown): value is Appearance =>
  typeof value === "string" &&
  (APPEARANCES as readonly string[]).includes(value);

function apply() {
  applyThemeToDocument(
    preference === "system" ? (media.matches ? "dark" : "light") : preference,
    palette,
  );
}

export async function initializeAppearance() {
  try {
    const saved = window.desktop
      ? await window.desktop.appearance()
      : localStorage.getItem("4dgen-appearance");
    if (isAppearance(saved)) preference = saved;
  } catch {
    // A missing desktop bridge or blocked storage keeps the default theme.
  }
  try {
    const saved = window.desktop
      ? await window.desktop.palette()
      : localStorage.getItem("4dgen-palette");
    if (isPalette(saved)) palette = saved;
  } catch {
    // Keep the default palette.
  }
  apply();
  media.addEventListener("change", () => {
    if (preference === "system") apply();
  });
}

export async function setAppearance(value: Appearance) {
  if (window.desktop) await window.desktop.appearance(value);
  else localStorage.setItem("4dgen-appearance", value);
  preference = value;
  apply();
}

export async function setPalette(value: Palette) {
  if (window.desktop) await window.desktop.palette(value);
  else localStorage.setItem("4dgen-palette", value);
  palette = value;
  apply();
}
