import type { HumanoidProfile } from './humanoid.ts';

/** Per-material summary returned when a model session is created. */
export interface MaterialSummary {
  name: string;
  triangles: number;
  alpha: number;
  doubleSided: boolean;
  transparent: boolean;
}

/** Editing settings persisted on a model library entry. */
export interface EditSettings {
  binding: string;
  ratio: number;
  maxError: number;
  height: number;
  excluded: string[];
  materialWeights: Record<string, number>;
  profile: HumanoidProfile | null;
}

/** Persisted model-library entry shared by the server and the web client. */
export interface ModelEntry {
  id: string;
  path: string;
  name: string;
  created: string;
  updated: string;
  settings?: EditSettings;
  packIds?: string[];
  profile?: HumanoidProfile | null;
  stats?: { triangles: number; materials: number; bytes: number };
  previewKey?: string;
  sourceAvailable?: boolean;
}

/** Response of opening a model in the workbench. */
export interface LoadedSession {
  id: string;
  modelId: string;
  name: string;
  settings: EditSettings | null;
  profile: HumanoidProfile | null;
  materials: MaterialSummary[];
  warnings: string[];
}

export interface TextureAtlasReport {
  width: number;
  height: number;
  bytes: number;
  /** Share of atlas pixels covered by a triangle with non-zero alpha. */
  sampledUtilization?: number;
  /** Share of atlas pixels covered by a triangle, including transparent texels. */
  uvUtilization?: number;
  contentUtilization: number;
  allocatedUtilization: number;
  sampledPixels?: number;
  uvPixels?: number;
  contentPixels?: number;
  allocatedPixels?: number;
  gutterPixels?: number;
  emptyPixels?: number;
  gutterUtilization?: number;
  emptyUtilization?: number;
  /** Share of chart bounding-box pixels that a triangle actually covers. */
  chartCoverage?: number;
}

export interface TextureMaterialUsage {
  name: string;
  /** Stable material identity; names can repeat. */
  key?: string;
  pixels: number;
  /** Triangle-covered pixels, including transparent texels. */
  uvPixels?: number;
  regions: number[];
  /** Exact atlas texels the material's triangles map to. */
  atlasTexels?: number;
  /** Native texels the material samples. */
  sourceTexels?: number;
  /** Atlas texels per world unit². */
  texelDensity?: number;
  /** Charts clamped to the technical minimum size. */
  floorCharts?: number;
  /** Content pixels attributed to this material. */
  rectPixels?: number;
  wastePixels?: number;
  /** Continuous area requested by the budget. */
  targetArea?: number;
  actualArea?: number;
}

export interface TextureRegionReport {
  id: number;
  material: string;
  materialKey?: string | null;
  materials: string[];
  surfaceAreas: Record<string, number>;
  weightedArea: number;
  x: number;
  y: number;
  width: number;
  height: number;
  source: unknown;
  resized: { width: number; height: number };
  tiles: unknown;
  crop: unknown;
}

/** Texture optimization report nested under `details.texture`. */
export interface TextureReport {
  originalTextures?: { width: number; height: number; bytes: number }[];
  atlas?: TextureAtlasReport;
  filter?: unknown;
  padding?: number;
  allocation?: string;
  materialWeights?: Record<string, number>;
  materials?: TextureMaterialUsage[];
  regions?: TextureRegionReport[];
  /** Rectangles saved by overlaying identical charts. */
  shared?: { charts: number; savedPixels: number };
  /** Per-part texture demand, when part ids are available. */
  parts?: { id: string; name: string; triangles: number; atlasTexels: number }[];
  warnings?: string[];
}

export interface ConversionDetails {
  texture?: TextureReport;
  [key: string]: unknown;
}

export interface ConversionReport {
  triangles?: number;
  [key: string]: unknown;
}

/** Result payload stored on a conversion job. */
export interface ConversionResult {
  report: ConversionReport;
  details?: ConversionDetails;
  excluded: string[];
  conversionMs?: number;
  textureOnly?: boolean;
  settings?: Partial<EditSettings>;
}
