export type Palette = "graphite" | "ocean" | "sand" | "rose" | "violet";
export type Appearance = "system" | "light" | "dark";

const PALETTES: readonly Palette[] = [
  "graphite",
  "ocean",
  "sand",
  "rose",
  "violet",
];
const APPEARANCES: readonly Appearance[] = ["system", "light", "dark"];

let palette: Palette = "graphite";
let preference: Appearance = "system";
const media = matchMedia("(prefers-color-scheme: dark)");

export const getPalette = () => palette;
export const getAppearance = () => preference;

const isPalette = (value: unknown): value is Palette =>
  typeof value === "string" && (PALETTES as readonly string[]).includes(value);
const isAppearance = (value: unknown): value is Appearance =>
  typeof value === "string" &&
  (APPEARANCES as readonly string[]).includes(value);

function apply() {
  document.documentElement.dataset.theme =
    preference === "system" ? (media.matches ? "dark" : "light") : preference;
  document.documentElement.dataset.palette = palette;
  window.dispatchEvent(new Event("appearancechange"));
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
