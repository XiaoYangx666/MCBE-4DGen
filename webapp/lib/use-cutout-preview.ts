import { useEffect, useState } from 'react';
import { previewImageCutout, type CutoutPreview } from '../engine/image-skin';

export interface CutoutPreviewState {
  preview: CutoutPreview | null;
  busy: boolean;
}

/**
 * Debounced cutout preview for the image studio. Changing the file, enabling
 * the cutout or moving the tolerance slider cancels stale work instead of
 * racing the latest result.
 */
export function useCutoutPreview(
  file: Blob | null,
  enabled: boolean,
  tolerance: number,
  delay = 160,
): CutoutPreviewState {
  const [preview, setPreview] = useState<CutoutPreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file || !enabled) {
      setPreview(null);
      setBusy(false);
      return;
    }
    let active = true;
    setBusy(true);
    const timer = window.setTimeout(() => {
      void previewImageCutout(file, { tolerance })
        .then((next) => {
          if (active) setPreview(next);
        })
        .catch(() => {
          if (active) setPreview(null);
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, delay);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [file, enabled, tolerance, delay]);

  return { preview, busy };
}
