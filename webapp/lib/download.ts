import { downloadBlob } from '../../web/shared/file-save';
import { isCoarsePointer } from './viewport';

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
