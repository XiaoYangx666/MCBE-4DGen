import { safeFilename } from './format.ts';

/**
 * Trigger a browser download and keep the object URL alive long enough for
 * mobile browsers that resolve the download asynchronously.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Windows-safe ZIP name derived from a pack name. */
export function zipFileName(name: string, fallback = '4d-skin') {
  return `${safeFilename(name, fallback)}.zip`;
}
