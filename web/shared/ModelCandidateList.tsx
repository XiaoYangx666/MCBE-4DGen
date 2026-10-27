import type { ModelCandidate, ModelFormat } from '../../src/model-candidates.ts';
import { formatBytes } from './format';

export interface ModelCandidateListProps {
  candidates: readonly ModelCandidate[];
  /** Selected candidate path. */
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
  /** Formats that cannot be loaded here, shown but not selectable. */
  disabledFormats?: readonly ModelFormat[];
  /** Extra hint for a single candidate, e.g. why it is unavailable. */
  note?: (candidate: ModelCandidate) => string | null;
  emptyText?: string;
}

/** Radio list of models found inside one archive, shared by both frontends. */
export function ModelCandidateList({
  candidates,
  value,
  onChange,
  disabled = false,
  disabledFormats = [],
  note,
  emptyText = '没有找到可导入的模型。',
}: ModelCandidateListProps) {
  if (!candidates.length) return <p className="pick-empty">{emptyText}</p>;
  return (
    <div className="pick-list" role="radiogroup" aria-label="选择包内模型">
      {candidates.map((candidate) => {
        const unavailable = disabledFormats.includes(candidate.format);
        const extension = candidate.name.split('.').pop()?.toUpperCase() ?? '';
        const extra = note?.(candidate);
        return (
          <label
            key={candidate.path}
            className={candidate.path === value ? 'on' : undefined}
            title={candidate.path}
          >
            <input
              type="radio"
              name="model-candidate"
              checked={candidate.path === value}
              disabled={disabled || unavailable}
              onChange={() => onChange(candidate.path)}
            />
            <span className="pick-name">{candidate.name}</span>
            <span className="pick-meta">
              {extension}
              {candidate.bytes > 0 ? ` · ${formatBytes(candidate.bytes)}` : ''}
            </span>
            {extra && <span className="pick-note">{extra}</span>}
          </label>
        );
      })}
    </div>
  );
}
