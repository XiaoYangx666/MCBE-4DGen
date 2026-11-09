import type {
  ConversionResult,
  EditSettings,
  MaterialSummary,
  PartSummary,
  SourceFormat,
} from "../../src/api-types";
import type { HumanoidProfile } from "../../src/humanoid";
import type { ReductionHint } from "../../src/reduce-policy";

export type MaterialRow = MaterialSummary;

export type Session = {
  modelId?: string;
  settings?: Partial<EditSettings> | null;
  id: string;
  name: string;
  /** Source format, used by the preview to choose pixel-art sampling. */
  format?: SourceFormat;
  /** Importer default for triangle retention; explicit saved settings still win. */
  reductionHint?: ReductionHint;
  profile: HumanoidProfile | null;
  materials: MaterialRow[];
  parts?: PartSummary[];
  fingerprint?: string;
  warnings: string[];
};

export type Result = ConversionResult & {
  id: string;
  cached?: boolean;
};
