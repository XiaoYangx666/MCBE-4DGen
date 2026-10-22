import type { ActivePack } from "../../src/pack-types.ts";

export function findActivePack(
  active: ActivePack[] | undefined,
  packID: string,
): ActivePack | undefined {
  return active?.find((entry) => entry.id === packID);
}

/** `skins` omitted means the whole pack was installed. */
export function installedSkinIndices(
  entry: ActivePack | undefined,
  skinCount: number,
): number[] {
  if (!entry) return [];
  return entry.skins ?? Array.from({ length: skinCount }, (_, index) => index);
}

export function isSkinInstalled(
  entry: ActivePack | undefined,
  index: number,
): boolean {
  return !!entry && (!entry.skins || entry.skins.includes(index));
}

export function isPackOutdated(
  entry: ActivePack | undefined,
  revision: string,
): boolean {
  return !!entry && entry.revision !== revision;
}

export function isPackFullyInstalled(
  entry: ActivePack | undefined,
  skinCount: number,
): boolean {
  return (
    !!entry && (!entry.skins || entry.skins.length >= Math.max(0, skinCount))
  );
}
