/** Read only PMX vertex layout/texture table/material metadata, leaving geometry and skin import to Assimp.
 * Layout references: Assimp MMDPmxParser and oguna/MMDFormats (documented in docs/stages/stage-6-avatars.md).
 * Bounds-checked before every read; malformed counts are rejected before native conversion.
 */
export function readPMXMaterials(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const skip = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || offset + n > bytes.length) throw new Error('Truncated or invalid PMX data');
    const start = offset; offset += n; return start;
  };
  const byte = () => view.getUint8(skip(1));
  const int = () => view.getInt32(skip(4), true);
  const count = (label: string, minimumBytes: number) => {
    const n = int();
    if (n < 0 || n > (bytes.length - offset) / minimumBytes) throw new Error('Invalid PMX ' + label + ' count');
    return n;
  };
  if (new TextDecoder().decode(bytes.subarray(skip(4), 4)) !== 'PMX ') throw new Error('Invalid PMX signature');
  const version = view.getFloat32(skip(4), true);
  if (Math.abs(version - 2) > 1e-5 && Math.abs(version - 2.1) > 1e-5 || !Number.isFinite(version)) throw new Error('Only PMX 2.0/2.1 are supported');
  if (byte() !== 8) throw new Error('Unsupported PMX globals layout');
  const encoding = byte(), extraUV = byte();
  if (encoding > 1 || extraUV > 4) throw new Error('Invalid PMX encoding or additional UV count');
  const sizes = Array.from({ length: 6 }, byte);
  if (sizes.some((size) => ![1, 2, 4].includes(size))) throw new Error('Invalid PMX index size');
  const [vertexSize, textureSize, , boneSize] = sizes as [number, number, number, number, number, number];
  const text = () => {
    const n = int();
    const start = skip(n);
    return new TextDecoder(encoding ? 'utf-8' : 'utf-16le', { fatal: true }).decode(bytes.subarray(start, start + n));
  };
  for (let i = 0; i < 4; i++) text();
  const vertices = count('vertex', 32 + extraUV * 16 + 1 + boneSize + 4);
  for (let i = 0; i < vertices; i++) {
    skip(32 + extraUV * 16);
    const skin = byte();
    if (skin === 0) skip(boneSize);
    else if (skin === 1) skip(2 * boneSize + 4);
    else if (skin === 2 || skin === 4) skip(4 * boneSize + 16);
    else if (skin === 3) skip(2 * boneSize + 40);
    else throw new Error('Invalid PMX skinning type');
    skip(4);
  }
  const indices = count('index', vertexSize);
  if (indices % 3) throw new Error('PMX index count must be divisible by three');
  skip(indices * vertexSize);
  const textures = Array.from({ length: count('texture', 4) }, text);
  const materialCount = count('material', 4);
  const materials: { name: string; doubleSided: boolean; alpha: number; indices: number }[] = [];
  let total = 0;
  for (let i = 0; i < materialCount; i++) {
    const name = text(); text();
    const properties = skip(44); // diffuse4, specular3, specular power1, ambient3
    const alpha = view.getFloat32(properties + 12, true);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('Invalid PMX diffuse alpha');
    const flags = byte();
    skip(20 + textureSize * 2 + 1); // edge color/size, diffuse/sphere texture indices, sphere mode
    const sharedToon = byte();
    if (sharedToon !== 0 && sharedToon !== 1) throw new Error('Invalid PMX toon flag');
    skip(sharedToon ? 1 : textureSize); text();
    const n = int();
    if (n < 0 || n % 3 || total + n > indices) throw new Error('Invalid PMX material index count');
    total += n;
    materials.push({ name, doubleSided: !!(flags & 1), alpha, indices: n });
  }
  if (total !== indices || !materials.length) throw new Error('PMX material ranges do not cover geometry');
  return { version, textures, materials };
}
