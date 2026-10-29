import sharp from 'sharp';
import type { Material, Texture } from '@gltf-transform/core';

/**
 * Tiny data-URL previews of a material's base color texture.
 *
 * The workbench only needs enough pixels to recognize "which texture is this",
 * so thumbnails are rendered once per texture object and shared by every
 * material that samples it. Failures return null: a missing preview must never
 * block opening a model.
 */
const cache = new WeakMap<Texture, Promise<string | null>>();

export function materialThumbnail(material: Material): Promise<string | null> {
  return textureThumbnail(material.getBaseColorTexture());
}

export function textureThumbnail(texture: Texture | null): Promise<string | null> {
  if (!texture) return Promise.resolve(null);
  const cached = cache.get(texture);
  if (cached) return cached;
  const pending = render(texture);
  cache.set(texture, pending);
  return pending;
}

async function render(texture: Texture): Promise<string | null> {
  const image = texture.getImage();
  if (!image?.byteLength) return null;
  try {
    const output = await sharp(Buffer.from(image))
      .resize(48, 48, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return `data:image/webp;base64,${output.toString('base64')}`;
  } catch {
    return null;
  }
}
