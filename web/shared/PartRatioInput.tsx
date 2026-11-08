import { useEffect, useState } from 'react';

export interface PartRatioInputProps {
  id: string;
  name: string;
  /** Explicit override, or undefined to inherit `defaultRatio`. */
  ratio: number | undefined;
  defaultRatio: number;
  /** `null` removes the override and restores the global ratio. */
  onChange: (id: string, ratio: number | null) => void;
  disabled?: boolean;
}

const percent = (ratio: number) => String(Math.round(ratio * 100));

/**
 * Compact retention field used inside a part row. Empty means "inherit the
 * global ratio", so users only fill in the parts that need special treatment.
 */
export function PartRatioInput({
  id,
  name,
  ratio,
  defaultRatio,
  onChange,
  disabled = false,
}: PartRatioInputProps) {
  const [text, setText] = useState(ratio === undefined ? '' : percent(ratio));
  useEffect(() => {
    setText(ratio === undefined ? '' : percent(ratio));
  }, [ratio]);

  const commit = (next: string) => {
    setText(next);
    if (!next.trim()) {
      onChange(id, null);
      return;
    }
    const value = Number(next);
    if (Number.isFinite(value) && value >= 1 && value <= 100)
      onChange(id, value / 100);
  };

  return (
    <span
      className={`part-ratio-inline${ratio === undefined ? '' : ' custom'}`}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="number"
        min={1}
        max={100}
        step={1}
        inputMode="numeric"
        value={text}
        placeholder={percent(defaultRatio)}
        disabled={disabled}
        aria-label={`${name} 保留面数比例`}
        title={`${name}：留空继承全局 ${percent(defaultRatio)}%`}
        onChange={(event) => commit(event.target.value)}
        onBlur={() => {
          if (text.trim() && !(Number(text) >= 1 && Number(text) <= 100))
            setText(ratio === undefined ? '' : percent(ratio));
        }}
      />
      <span className="part-ratio-unit">%</span>
      <button
        type="button"
        className="part-ratio-clear"
        disabled={disabled || ratio === undefined}
        title="恢复全局比例"
        aria-label={`${name} 恢复全局比例`}
        onClick={() => onChange(id, null)}
      >
        ×
      </button>
    </span>
  );
}
