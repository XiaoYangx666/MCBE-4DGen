import JSZip from 'jszip';
import type { SkinPackFiles } from './skin-pack-files.ts';

export interface SkinPackZipOptions {
  /** Level 1 JSON compression for content that was already validated. */
  fast?: boolean;
}

function fill(zip: JSZip, files: Readonly<SkinPackFiles>, level: number) {
  for (const [name, bytes] of Object.entries(files)) {
    if (/\.png$/i.test(name)) {
      // PNG data is already compressed; storing it avoids a second pass.
      zip.file(name, bytes, { compression: 'STORE' });
    } else {
      zip.file(name, bytes, {
        compression: 'DEFLATE',
        compressionOptions: { level },
      });
    }
  }
}

/**
 * Flat legacy skin pack archive: every file stays at the ZIP root. Both shells
 * use the same compression policy, but each keeps its own output type.
 */
export async function zipSkinPackBytes(
  files: Readonly<SkinPackFiles>,
  options: SkinPackZipOptions = {},
): Promise<Uint8Array> {
  const level = options.fast ? 1 : 6;
  const zip = new JSZip();
  fill(zip, files, level);
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level },
  });
}

/** Browser variant that avoids copying the archive into a Blob. */
export async function zipSkinPackBlob(
  files: Readonly<SkinPackFiles>,
  options: SkinPackZipOptions = {},
): Promise<Blob> {
  const level = options.fast ? 1 : 6;
  const zip = new JSZip();
  fill(zip, files, level);
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level },
  });
}
