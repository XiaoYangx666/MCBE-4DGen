import type { ReactNode } from 'react';
import {
  FACE_GREEN_MAX,
  FACE_YELLOW_MAX,
  triangleBudget,
} from './triangle-budget';

export interface RatioFieldProps {
  ratio: number;
  onChange: (ratio: number) => void;
  /** Final source face count, including backfaces. */
  sourceTriangles: number;
  /** Estimated final output at the selected ratio. */
  targetFaces: number;
  /** Last converted output, when the result is still fresh. */
  actualFaces?: number | null;
  disabled?: boolean;
  /** Show the desktop workbench's target/actual face budget box. */
  showBudget?: boolean;
  /** Optional hint under the legend. */
  help?: ReactNode;
}

const FACE_LABELS = { green: '轻量', yellow: '可接受', red: '偏高' } as const;

/**
 * Retention slider with the desktop workbench's green/yellow/red face bands.
 * Shared by the desktop settings panel and the browser model studio.
 */
export function RatioField({
  ratio,
  onChange,
  sourceTriangles,
  targetFaces,
  actualFaces,
  disabled,
  showBudget = true,
  help,
}: RatioFieldProps) {
  const budget = triangleBudget(targetFaces);
  const actualBudget = actualFaces != null ? triangleBudget(actualFaces) : null;
  const source = Math.max(1, sourceTriangles);
  // Place the face-count bands on the slider's 1%-100% retention axis.
  const zone = (faces: number) => Math.max(0, Math.min(100,
    ((Math.min(1, faces / source) - 0.01) / 0.99) * 100));
  const track = `linear-gradient(90deg,
    color-mix(in srgb, var(--face-green) 55%, transparent) 0 ${zone(FACE_GREEN_MAX)}%,
    color-mix(in srgb, var(--face-yellow) 55%, transparent) ${zone(FACE_GREEN_MAX)}% ${zone(FACE_YELLOW_MAX)}%,
    color-mix(in srgb, var(--face-red) 55%, transparent) ${zone(FACE_YELLOW_MAX)}% 100%)`;
  return (
    <div className="ratio-field">
      <span className="ratio-label">
        保留面数比例 <b>{Math.round(ratio * 100)}%</b>
      </span>
      <div className="ratio-slider" style={{ background: track }}>
        <input
          type="range"
          aria-label="保留面数比例"
          min={0.01}
          max={1}
          step={0.01}
          value={ratio}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      <div className="ratio-legend">
        <span className="green">轻量 &lt; 2 万</span>
        <span className="yellow">2–5 万</span>
        <span className="red">&gt; 5 万</span>
      </div>
      {showBudget && (
        <div className={`face-estimate face-${budget.level}`}>
          <div className="face-row">
            <strong>目标约 {targetFaces.toLocaleString('zh-CN')} 面</strong>
            <span className={`face-chip ${budget.level}`}>{FACE_LABELS[budget.level]}</span>
          </div>
          {actualFaces != null && actualBudget && (
            <div className="face-row">
              <span className="face-actual">上次实际 {actualFaces.toLocaleString('zh-CN')} 面</span>
              <span className={`face-chip ${actualBudget.level}`}>{FACE_LABELS[actualBudget.level]}</span>
            </div>
          )}
        </div>
      )}
      {help && <p className="field-help">{help}</p>}
    </div>
  );
}
