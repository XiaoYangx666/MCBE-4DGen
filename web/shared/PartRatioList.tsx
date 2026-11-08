import { useEffect, useMemo, useState } from 'react';

export interface PartRatioItem {
  id: string;
  name: string;
  /** Structural owner used only for sorting/labels. */
  group?: string;
  /** Source triangles, shown next to the part name when known. */
  triangles?: number;
}

export interface PartRatioListProps {
  parts: readonly PartRatioItem[];
  includedParts: ReadonlySet<string>;
  /** Only explicit overrides; missing entries inherit `defaultRatio`. */
  ratios: Readonly<Record<string, number>>;
  defaultRatio: number;
  /** `null` removes the override and restores the global ratio. */
  onChange: (id: string, ratio: number | null) => void;
  onResetAll: () => void;
  disabled?: boolean;
  className?: string;
}

const percent = (ratio: number) => String(Math.round(ratio * 100));

function PartRatioRow({
  part,
  ratio,
  defaultRatio,
  onChange,
  disabled,
}: {
  part: PartRatioItem;
  ratio: number | undefined;
  defaultRatio: number;
  onChange: (id: string, ratio: number | null) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState(ratio === undefined ? '' : percent(ratio));
  useEffect(() => {
    setText(ratio === undefined ? '' : percent(ratio));
  }, [ratio]);

  const commit = (next: string) => {
    setText(next);
    if (!next.trim()) {
      onChange(part.id, null);
      return;
    }
    const value = Number(next);
    if (Number.isFinite(value) && value >= 1 && value <= 100)
      onChange(part.id, value / 100);
  };

  return (
    <label className="part-ratio-row">
      <span className="part-ratio-name" title={part.group ? `${part.group} · ${part.name}` : part.name}>
        <b>{part.name}</b>
        {part.triangles !== undefined && (
          <small>{part.triangles.toLocaleString('zh-CN')} 面</small>
        )}
      </span>
      <span className="part-ratio-input">
        <input
          type="number"
          min={1}
          max={100}
          step={1}
          inputMode="numeric"
          value={text}
          placeholder={percent(defaultRatio)}
          disabled={disabled}
          aria-label={`${part.name} 保留面数比例`}
          onChange={(event) => commit(event.target.value)}
          onBlur={() => {
            if (text.trim() && !(Number(text) >= 1 && Number(text) <= 100))
              setText(ratio === undefined ? '' : percent(ratio));
          }}
        />
        <span>%</span>
        <button
          type="button"
          className="part-ratio-clear"
          disabled={disabled || ratio === undefined}
          title="恢复全局比例"
          aria-label={`${part.name} 恢复全局比例`}
          onClick={() => onChange(part.id, null)}
        >
          ×
        </button>
      </span>
      <em>{ratio === undefined ? '继承全局' : `全局 ${percent(defaultRatio)}%`}</em>
    </label>
  );
}

/**
 * Compact per-part retention editor shared by the desktop workbench and the
 * browser studio. Only kept parts are listed; empty inputs inherit the global
 * slider so users do not have to touch every part.
 */
export function PartRatioList({
  parts,
  includedParts,
  ratios,
  defaultRatio,
  onChange,
  onResetAll,
  disabled = false,
  className,
}: PartRatioListProps) {
  const items = useMemo(
    () =>
      parts
        .filter((part) => includedParts.has(part.id))
        .sort((a, b) =>
          (a.group ?? '').localeCompare(b.group ?? '') ||
          a.name.localeCompare(b.name),
        ),
    [parts, includedParts],
  );
  const overrides = items.filter((part) => ratios[part.id] !== undefined).length;
  if (!items.length) return null;
  return (
    <details className={`part-ratio-list${className ? ` ${className}` : ''}`}>
      <summary>
        <span>按部件减面</span>
        <small>{overrides ? `${overrides} 个自定义` : '默认跟随全局'}</small>
      </summary>
      <p className="part-ratio-help">
        留空跟随全局 {percent(defaultRatio)}%；需要保留细节的部件调高，次要部件调低。只影响三角面数量，贴图占用仍在纹理页调整。
      </p>
      <div className="part-ratio-rows">
        {items.map((part) => (
          <PartRatioRow
            key={part.id}
            part={part}
            ratio={ratios[part.id]}
            defaultRatio={defaultRatio}
            onChange={onChange}
            disabled={disabled}
          />
        ))}
      </div>
      <button
        type="button"
        className="part-ratio-reset"
        disabled={disabled || !overrides}
        onClick={onResetAll}
      >
        全部恢复默认
      </button>
    </details>
  );
}
