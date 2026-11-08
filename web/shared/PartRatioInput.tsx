import { useEffect, useRef, useState } from 'react';

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
 * Compact retention field used inside a part row.
 *
 * Edits stay local until Enter/Tab/blur so typing "60" does not trigger a full
 * preview rebuild for "6" first. Empty means "inherit the global ratio".
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
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const committed = ratio === undefined ? '' : percent(ratio);

  // Follow external changes (global reset, saved settings) unless the field is
  // being edited; a focused draft must not be overwritten mid-typing.
  useEffect(() => {
    if (!focused) setText(committed);
  }, [committed, focused]);

  const commit = () => {
    const next = text.trim();
    if (!next) {
      if (ratio !== undefined) onChange(id, null);
      setText('');
      return;
    }
    const value = Number(next);
    if (Number.isFinite(value) && value >= 1 && value <= 100) {
      const normalized = Math.round(value);
      setText(String(normalized));
      if (normalized !== Math.round((ratio ?? -1) * 100))
        onChange(id, normalized / 100);
    } else {
      setText(committed);
    }
  };

  const pending = text.trim() !== committed;

  return (
    <span
      className={`part-ratio-inline${ratio === undefined ? '' : ' custom'}${pending ? ' pending' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={input}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={3}
        autoComplete="off"
        value={text}
        placeholder={percent(defaultRatio)}
        disabled={disabled}
        aria-label={`${name} 保留面数比例`}
        title={`${name}：留空继承全局 ${percent(defaultRatio)}%；输入后按 Enter 或点击别处应用`}
        onFocus={(event) => {
          setFocused(true);
          event.target.select();
        }}
        onChange={(event) => setText(event.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
            input.current?.blur();
          } else if (event.key === 'Escape') {
            setText(committed);
            input.current?.blur();
          }
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
