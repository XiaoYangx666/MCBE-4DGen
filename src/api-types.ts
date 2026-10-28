import type { HumanoidProfile } from './humanoid.ts';

/** Per-material summary returned when a model session is created. */
export interface MaterialSummary {
  /** Stable identity `m:{name}#{occurrence}`; display names can repeat. */
  key: string;
  name: string;
  triangles: number;
  alpha: number;
  doubleSided: boolean;
  transparent: boolean;
  /** Parts that own triangles of this material. */
  partIds: string[];
}

/** One primitive or instanced-node part of the source model. */
export interface PartSummary {
  id: string;
  name: string;
  node: string;
  mesh: string;
  /** Primitive index, or -1 for a whole instanced node. */
  primitive: number;
  materialKey: string;
  materialName: string;
  triangles: number;
  vertices: number;
  instancePart: boolean;
}

/** Editing settings persisted on a model library entry. */
export interface EditSettings {
  binding: string;
  ratio: number;
  maxError: number;
  height: number;
  /** Material keys to exclude. Legacy saves may contain unique names. */
  excluded: string[];
  /** Relative quality per stable material key. */
  materialWeights: Record<string, number>;
  profile: HumanoidProfile | null;
  /** Stable part ids to keep. Missing means all current parts. */
  includedParts?: string[];
  /** Legacy compact planner is the default; budget is opt-in. */
  textureMode?: 'legacy' | 'budget';
  textureTarget?: 'texel-density' | 'texel-retention';
  atlasSharing?: boolean;
  /** Structure fingerprint the selection was made against. */
  fingerprint?: string;
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
  /** Every keepable part of the current document. */
  parts: PartSummary[];
  /** Current structure fingerprint for saved selections. */
  fingerprint: string;
  /** Selection entries dropped because they did not match this model. */
  selectionWarnings: string[];
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
  /** Unique content pixels no triangle samples. */
  unusedContentPixels?: number;
  /** Pixels sampled by two or more materials. */
  overlapPixels?: number;
  /** Unique content pixels inside shared rectangles. */
  sharedContentPixels?: number;
  /** Content pixels not attributed to any material (normally 0). */
  unattributedPixels?: number;
}

export interface TextureMaterialUsage {
  name: string;
  /** Stable material identity; names can repeat. */
  key?: string;
  pixels: number;
  /** Triangle-covered pixels, including transparent texels. */
  uvPixels?: number;
  /** Triangle-covered pixels also covered by another material. */
  sharedPixels?: number;
  /** Triangle-covered pixels no other material covers. */
  uniquePixels?: number;
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
  /** Stable keys matching `materials`; shared rectangles list every owner. */
  materialKeys?: string[];
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
