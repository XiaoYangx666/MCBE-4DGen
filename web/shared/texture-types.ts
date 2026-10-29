import type { MaterialListItem } from './MaterialList';

export type TextureMode = 'legacy' | 'budget';
export type TextureTarget = 'density' | 'retention';

/** How a pixel number in the material browser was produced. */
export type TexturePixelState = 'actual' | 'estimate' | 'pending' | 'none';

export interface StudioPart {
  id: string;
  name: string;
  /** Structural owner (mesh / node), never a guessed body-part label. */
  group: string;
  meta: string;
  /** Materials this part samples. */
  materials: readonly string[];
  /** Stable material key, when the host has one. */
  materialKey?: string;
  /** Other part names that sample the same material. */
  sharedWith?: readonly string[];
}

export interface StudioMaterial extends MaterialListItem {
  /** Relative density / retention multiplier. */
  quality: number;
  /** Pixels from the last conversion, null before the first result. */
  lastPixels?: number | null;
  /** Change versus the previous conversion of the same model. */
  deltaPixels?: number | null;
  /** Number of UV islands clamped to the technical minimum. */
  floorCharts?: number;
  flat?: boolean;
}
