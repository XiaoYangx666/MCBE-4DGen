import { atlasColor } from '../../web/shared/atlas-colors';

export interface MaterialShareEntry {
  key: string;
  name: string;
  pixels: number;
}

/**
 * Compact vertical stacked bar plus legend for the result tab. Materials are
 * ranked by pixel share; the long tail collapses into one neutral segment so
 * the legend stays readable on a phone.
 */
export function MaterialShareChart({
  materials,
  total,
  limit = 8,
}: {
  materials: readonly MaterialShareEntry[];
  total: number;
  limit?: number;
}) {
  const entries = materials
    .filter((material) => material.pixels > 0)
    .map((material) => ({
      ...material,
      share: total > 0 ? material.pixels / total : 0,
    }))
    .sort((a, b) => b.pixels - a.pixels);
  if (!entries.length) return null;
  const used = entries.reduce((sum, entry) => sum + entry.pixels, 0);
  const usedShare = total > 0 ? used / total : 0;
  const shown = entries.slice(0, limit);
  const rest = entries.slice(limit).reduce((sum, entry) => sum + entry.pixels, 0);
  if (rest > 0)
    shown.push({
      key: 'rest',
      name: '其他材质',
      pixels: rest,
      share: total > 0 ? rest / total : 0,
    });
  return (
    <figure className="material-share">
      <figcaption>
        材质占比 · 已用 {(usedShare * 100).toFixed(1)}% · {entries.length} 个
      </figcaption>
      <div className="material-share-body">
        <div className="material-share-bar" role="img" aria-label="材质像素占比">
          {shown.map((entry) => {
            const color = entry.key === 'rest' ? 'var(--line)' : atlasColor(entry.key);
            return (
              <span
                key={entry.key}
                style={{ flexGrow: entry.share, background: color }}
                title={`${entry.name} ${(entry.share * 100).toFixed(1)}%`}
              />
            );
          })}
        </div>
        <ul className="material-share-legend">
          {shown.map((entry) => {
            const color = entry.key === 'rest' ? 'var(--line)' : atlasColor(entry.key);
            return (
              <li key={entry.key}>
                <i style={{ background: color }} aria-hidden="true" />
                <span title={entry.name}>{entry.name}</span>
                <em>{(entry.share * 100).toFixed(1)}%</em>
              </li>
            );
          })}
        </ul>
      </div>
    </figure>
  );
}
