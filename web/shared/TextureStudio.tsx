import { MaterialBrowser } from './MaterialBrowser';
import { PartBrowser } from './PartBrowser';
import type {
  StudioMaterial,
  StudioPart,
  TextureMode,
  TextureTarget,
} from './texture-types';

export type {
  StudioMaterial,
  StudioPart,
  TextureMode,
  TexturePixelState,
  TextureTarget,
} from './texture-types';
export type { TextureTarget as TextureTargetType } from './texture-target';

export interface TextureStudioProps {
  mode: TextureMode;
  target: TextureTarget;
  onMode: (mode: TextureMode) => void;
  onTarget: (target: TextureTarget) => void;
  materials: readonly StudioMaterial[];
  selectedMaterial: string | null;
  onSelectMaterial: (id: string | null) => void;
  onToggleMaterial: (id: string) => void;
  onWeight: (id: string, value: number) => void;
  onResetWeight: (id: string) => void;
  onResetAllWeights: () => void;
  parts: readonly StudioPart[];
  includedParts: ReadonlySet<string>;
  onTogglePart: (id: string) => void;
  onSetParts: (ids: readonly string[]) => void;
  selectedPart: string | null;
  onSelectPart: (id: string | null) => void;
  /** Hide dropped parts in the preview; true by default in the hosts. */
  showKeptOnly: boolean;
  onShowKeptOnly: (value: boolean) => void;
  disabled?: boolean;
  /** Extra note shown under the mode switch, e.g. bitmap resolution. */
  note?: string;
  className?: string;
}

/**
 * Legacy combined texture panel. New layouts compose `PartBrowser` and
 * `MaterialBrowser` directly so each workspace only shows its own tools.
 */
export function TextureStudio({
  mode,
  target,
  onMode,
  onTarget,
  materials,
  selectedMaterial,
  onSelectMaterial,
  onToggleMaterial,
  onWeight,
  onResetWeight,
  onResetAllWeights,
  parts,
  includedParts,
  onTogglePart,
  onSetParts,
  selectedPart,
  onSelectPart,
  showKeptOnly,
  onShowKeptOnly,
  disabled = false,
  note,
  className,
}: TextureStudioProps) {
  return (
    <div className={`texture-studio${className ? ` ${className}` : ''}`}>
      <PartBrowser
        compact
        parts={parts}
        includedParts={includedParts}
        onTogglePart={onTogglePart}
        onSetParts={onSetParts}
        selectedPart={selectedPart}
        onSelectPart={onSelectPart}
        showKeptOnly={showKeptOnly}
        onShowKeptOnly={onShowKeptOnly}
        disabled={disabled}
        title="模型部件"
      />
      <MaterialBrowser
        materials={materials}
        selectedMaterial={selectedMaterial}
        onSelectMaterial={onSelectMaterial}
        onToggleMaterial={onToggleMaterial}
        onWeight={onWeight}
        onResetWeight={onResetWeight}
        onResetAllWeights={onResetAllWeights}
        disabled={disabled}
        mode={mode}
        target={target}
        onMode={onMode}
        onTarget={onTarget}
        previewNote={note}
      />
    </div>
  );
}
