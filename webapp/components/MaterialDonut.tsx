import { atlasColor } from '../../web/shared/atlas-colors';

export interface MaterialDonutEntry {
  key: string;
  name: string;
  pixels: number;
}

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 1.4;

/**
 * Allocation donut for the texture tab. Segments use the same stable colours
 * as the atlas overlay; tapping one selects that material in both views.
 */
export function MaterialDonut({
  materials,
  total,
  selected,
  onSelect,
}: {
  materials: readonly MaterialDonutEntry[];
  total: number;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const items = materials
    .filter((material) => material.pixels > 0)
    .map((material) => ({
      ...material,
      share: total > 0 ? material.pixels / total : 0,
    }))
    .sort((a, b) => b.pixels - a.pixels);
  if (!items.length) return null;
  const used = items.reduce((sum, item) => sum + item.pixels, 0);
  const usedShare = total > 0 ? used / total : 0;
  const active = items.find((item) => item.key === selected) ?? null;

  let offset = 0;
  const segments = items.map((item) => {
    const length = item.share * CIRCUMFERENCE;
    const dash = Math.max(0, length - GAP);
    const segment = {
      ...item,
      dash,
      rest: Math.max(0, CIRCUMFERENCE - dash),
      offset: -offset,
    };
    offset += length;
    return segment;
  });

  return (
    <figure className="material-donut">
      <figcaption>
        材质占比 · 已用 {(usedShare * 100).toFixed(1)}% · {items.length} 个
      </figcaption>
      <div className="material-donut-ring">
        <svg viewBox="0 0 120 120" role="group" aria-label="材质占图集比例">
          <circle
            className="material-donut-track"
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            strokeWidth="16"
          />
          {segments.map((segment) => (
            <circle
              key={segment.key}
              className={`material-donut-segment${segment.key === selected ? ' active' : ''}`}
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              stroke={atlasColor(segment.key)}
              strokeWidth={segment.key === selected ? 20 : 16}
              strokeDasharray={`${segment.dash} ${segment.rest}`}
              strokeDashoffset={segment.offset}
              transform="rotate(-90 60 60)"
              tabIndex={0}
              role="button"
              aria-pressed={segment.key === selected}
              aria-label={`${segment.name}，占图集 ${(segment.share * 100).toFixed(1)}%`}
              onClick={() => onSelect?.(segment.key === selected ? null : segment.key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect?.(segment.key === selected ? null : segment.key);
                }
              }}
            />
          ))}
        </svg>
        <div className="material-donut-center">
          {active ? (
            <>
              <b title={active.name}>{active.name}</b>
              <span>{(active.share * 100).toFixed(1)}%</span>
            </>
          ) : (
            <>
              <b>已用</b>
              <span>{(usedShare * 100).toFixed(1)}%</span>
            </>
          )}
        </div>
      </div>
      <ul className="material-donut-legend">
        {items.map((item) => (
          <li key={item.key}>
            <i style={{ background: atlasColor(item.key) }} aria-hidden="true" />
            <span title={item.name}>{item.name}</span>
            <em>{(item.share * 100).toFixed(1)}%</em>
          </li>
        ))}
      </ul>
    </figure>
  );
}
