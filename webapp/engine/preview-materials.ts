import type * as THREE from 'three';
import { preparePreviewMaterial } from '../../web/shared/preview-material.ts';
import type { AlphaMode } from './types.ts';

export interface SourceAlpha {
  alphaMode: AlphaMode;
  alphaCutoff: number;
}

const SOURCE_ALPHA = 'sourceAlpha';

type AlphaMaterial = THREE.Material & {
  alphaTest?: number;
  transparent?: boolean;
  userData: Record<string, unknown>;
};

/**
 * The preview policy turns blended materials into alpha-tested cutouts, but
 * conversion must keep the source alpha semantics. Remember them before the
 * preview mutates the shared three.js materials.
 */
export function rememberSourceAlpha(material: AlphaMaterial): void {
  if (material.userData[SOURCE_ALPHA]) return;
  const alphaTest = material.alphaTest ?? 0;
  material.userData[SOURCE_ALPHA] = {
    alphaMode: alphaTest > 0 ? 'MASK' : material.transparent ? 'BLEND' : 'OPAQUE',
    alphaCutoff: alphaTest > 0 ? alphaTest : 0.5,
  } satisfies SourceAlpha;
}

export function sourceAlphaOf(material: AlphaMaterial): SourceAlpha | undefined {
  return material.userData[SOURCE_ALPHA] as SourceAlpha | undefined;
}

/**
 * Apply the workbench preview material rules to a loaded scene: opaque-alpha
 * transparent materials become cutouts (crisp highlights instead of white
 * films) and partially transparent materials stop writing depth. The desktop
 * viewer uses the same policy, so both previews match.
 */
export function preparePreviewMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      const alphaMaterial = material as AlphaMaterial;
      rememberSourceAlpha(alphaMaterial);
      preparePreviewMaterial(alphaMaterial);
    }
  });
}
