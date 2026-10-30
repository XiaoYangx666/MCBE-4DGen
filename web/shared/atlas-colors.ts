/**
 * Stable per-material colours shared by the atlas overlay and the allocation
 * bars. Hashing the material id keeps the colour the same across sorting and
 * between the atlas regions and the texture table.
 */
export const ATLAS_COLORS = [
  '#e06c75',
  '#61afef',
  '#98c379',
  '#e5c07b',
  '#c678dd',
  '#56b6c2',
  '#d19a66',
  '#7f9cf5',
  '#f78fb3',
  '#4db6ac',
];

export function atlasColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1)
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return ATLAS_COLORS[hash % ATLAS_COLORS.length]!;
}
