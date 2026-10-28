import { useEffect, useRef, useState } from 'react';

export interface MaterialListItem {
  id: string;
  name: string;
  meta: string;
  thumbnail?: string | null;
  color?: string;
  included: boolean;
  weight: number;
  soloed?: boolean;
  selected?: boolean;
  /** Compact result badge, e.g. "1,240 px · +80". */
  status?: string;
  /** Warn when the allocator hit a technical floor. */
  limited?: boolean;
}

export interface MaterialListProps {
  items: MaterialListItem[];
  disabled?: boolean;
  onToggle: (id: string) => void;
  onSelect?: (id: string) => void;
  onSolo?: (id: string) => void;
  onWeight: (id: string, value: number) => void;
  /** Hide the inline numeric weight input (the host has a dedicated tuner). */
  showWeight?: boolean;
  weightLabel?: string;
  weightTitle?: string;
}

function WeightInput({
  value,
  label,
  disabled,
  onCommit,
  title,
}: {
  value: number;
  label: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
  title?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const cancel = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (cancel.current) {
      cancel.current = false;
      setDraft(String(value));
      return;
    }
    const parsed = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 20) {
      onCommit(parsed);
      setDraft(String(parsed));
    } else {
      setDraft(String(value));
    }
  };
  return (
    <input
      className="shared-material-weight"
      type="number"
      min={0}
      max={20}
      step={0.05}
      inputMode="decimal"
      aria-label={`${label} 像素权重`}
      title={title ?? "相对像素权重，默认 1；0 表示最低像素预算，材质仍会保留"}
      disabled={disabled}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancel.current = true;
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * Shared material rows for the desktop workbench and the browser model studio.
 * The caller normalizes its own material/state shape into `MaterialListItem`.
 */
export function MaterialList({
  items,
  disabled = false,
  onToggle,
  onSelect,
  onSolo,
  onWeight,
  showWeight = true,
  weightLabel,
  weightTitle,
}: MaterialListProps) {
  return (
    <div className={`shared-material-list ${onSolo ? 'with-solo' : ''}`}>
      {items.map((item) => (
        <div
          className={[
            'shared-material-item',
            item.selected ? 'selected' : '',
            item.soloed ? 'solo' : '',
          ].filter(Boolean).join(' ')}
          key={item.id}
        >
          <input
            type="checkbox"
            checked={item.included}
            disabled={disabled}
            aria-label={`保留 ${item.name}`}
            onChange={() => onToggle(item.id)}
          />
          {item.thumbnail ? (
            <img className="shared-material-thumb" src={item.thumbnail} alt="" />
          ) : (
            <span
              className="shared-material-swatch"
              style={{ background: item.color ?? 'var(--line)' }}
            />
          )}
          <button
            type="button"
            className="shared-material-name"
            disabled={disabled || !onSelect}
            title={onSelect ? '点击选择此材质' : undefined}
            onClick={() => onSelect?.(item.id)}
          >
            {item.name}
          </button>
          <span className="shared-material-meta">{item.meta}</span>
          {item.status && (
            <span className={`shared-material-status${item.limited ? ' limited' : ''}`}>
              {item.status}
            </span>
          )}
          {showWeight && (
            <WeightInput
              value={item.weight}
              label={weightLabel ? `${item.name} ${weightLabel}` : item.name}
              disabled={disabled || !item.included}
              onCommit={(value) => onWeight(item.id, value)}
              {...(weightTitle ? { title: weightTitle } : {})}
            />
          )}
          {onSolo && (
            <button
              type="button"
              className={`shared-material-solo ${item.soloed ? 'active' : ''}`}
              disabled={disabled}
              title="仅用于观察，不影响转换时保留的材质"
              onClick={() => onSolo(item.id)}
            >
              {item.soloed ? '还原' : '只看'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
