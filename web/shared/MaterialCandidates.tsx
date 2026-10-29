export interface MaterialCandidate {
  id: string;
  name: string;
  meta?: string;
  color?: string;
}

/**
 * Explicit disambiguation for shared atlas rectangles or overlapping 3D
 * surfaces. The host never guesses the first candidate.
 */
export function MaterialCandidates({
  title = '多个材质共用这个区域',
  candidates,
  onPick,
  onClose,
}: {
  title?: string;
  candidates: readonly MaterialCandidate[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  if (!candidates.length) return null;
  return (
    <div className="material-candidates" role="dialog" aria-label={title}>
      <div className="material-candidates-head">
        <b>{title}</b>
        <button type="button" className="icon-button" aria-label="关闭候选选择" onClick={onClose}>
          ×
        </button>
      </div>
      <p>请选择要调整的材质；这里的每一项都使用稳定标识。</p>
      <div className="material-candidates-list">
        {candidates.map((candidate) => (
          <button
            type="button"
            key={candidate.id}
            onClick={() => onPick(candidate.id)}
          >
            <span
              className="material-candidates-dot"
              style={{ background: candidate.color ?? 'var(--line)' }}
            />
            <span>{candidate.name}</span>
            {candidate.meta && <small>{candidate.meta}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}
