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

/**
 * Phones often ignore the anchor download attribute, especially iOS. Use the
 * system share/save sheet when it can accept files, otherwise fall back to a
 * regular blob download.
 */
export async function saveOrShare(blob: Blob, filename: string, title: string) {
  const shareNavigator = navigator as Navigator & {
    share?: (data: ShareData) => Promise<void>;
  };
  if (isCoarsePointer() && typeof shareNavigator.share === 'function' && typeof navigator.canShare === 'function') {
    try {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) {
        await shareNavigator.share({ files: [file], title });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // Sharing can fail on some embedded browsers; fall through to download.
    }
  }
  downloadBlob(blob, filename);
}

export function isCompactViewport() {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 860px)').matches;
}

export function isCoarsePointer() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export function safeFilename(name: string, fallback = '4d-skin') {
  const cleaned = name.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').slice(0, 80);
  return cleaned || fallback;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatCount(value: number) {
  return value.toLocaleString('zh-CN');
}
