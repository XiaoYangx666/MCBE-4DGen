import type {
  ConversionResult,
  EditSettings,
  MaterialSummary,
  PartSummary,
} from "../../src/api-types";
import type { HumanoidProfile } from "../../src/humanoid";

export type MaterialRow = MaterialSummary;

export type Session = {
  modelId?: string;
  settings?: Partial<EditSettings> | null;
  id: string;
  name: string;
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
