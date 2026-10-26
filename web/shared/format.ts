/**
 * Small display-only helpers shared by the desktop workbench and the browser
 * web app. No Node or storage dependencies.
 */

/** Compact byte label, e.g. `1.5 KB` / `12.34 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

/** Turn an arbitrary display name into a filesystem-safe file name stem. */
export function safeFilename(name: string, fallback = "4d-skin"): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned || fallback;
}
