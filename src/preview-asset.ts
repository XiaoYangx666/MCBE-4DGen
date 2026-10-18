import sharp from "sharp";
import { cloneDocument, meshopt, prune } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import type { Document, NodeIO, Texture } from "@gltf-transform/core";

/** Preview textures are inspection-only; 1024px keeps 4096px originals from
 * stalling the browser and exhausting GPU memory. */
export const PREVIEW_TEXTURE_LIMIT = 1024;

async function downscale(texture: Texture, limit: number): Promise<void> {
  const image = texture.getImage();
  if (!image?.byteLength) return;
  const metadata = await sharp(image)
    .metadata()
    .catch(() => null as { width?: number; height?: number; hasAlpha?: boolean } | null);
  // Unsupported source format: keep the original bytes rather than failing the import.
  if (!metadata) return;
  const width = metadata.width ?? 0,
    height = metadata.height ?? 0;
  if (!width || !height || Math.max(width, height) <= limit) return;
  const pipeline = sharp(image).resize({
    width: limit,
    height: limit,
    fit: "inside",
    withoutEnlargement: true,
  });
  try {
    const png = !!metadata.hasAlpha;
    const output = png
      ? await pipeline.png({ compressionLevel: 3 }).toBuffer()
      : await pipeline.jpeg({ quality: 82 }).toBuffer();
    texture.setImage(new Uint8Array(output)).setMimeType(png ? "image/png" : "image/jpeg");
  } catch {
    // Keep the original texture if this particular encode is rejected.
  }
}

/**
 * Builds the browser-facing GLB. The working document keeps full-resolution
 * textures and every source accessor; the preview drops unused data and caps
 * textures so the viewer can decode it quickly.
 */
export async function buildPreviewGlb(
  document: Document,
  io: NodeIO,
  textureLimit = PREVIEW_TEXTURE_LIMIT,
): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  const preview = cloneDocument(document);
  await preview.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await Promise.all(preview.getRoot().listTextures().map((texture) => downscale(texture, textureLimit)));
  return new Uint8Array(await io.writeBinary(preview));
}
