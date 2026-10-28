import { useMemo, useState } from 'react';
import { Icon } from './Icons';

export interface AtlasInspectorRegion {
  id: string;
  material: string;
  /** All materials sharing this rectangle, when the caller knows them. */
  materials?: readonly string[];
  x: number;
  y: number;
  width: number;
  height: number;
  contentPixels: number;
  source?: string;
}

export interface AtlasInspectorMaterial {
  name: string;
  /** Content pixels allocated to this material, padding excluded. */
  allocated: number;
  /** Pixels covered by a non-transparent triangle. */
  used: number | null;
  /** Pixels covered by any triangle, including transparent texels. */
  uv: number | null;
  /** Current pixel weight, when the caller can provide it. */
  weight?: number;
}

const COLORS = [
  '#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd',
  '#56b6c2', '#d19a66', '#7f9cf5', '#f78fb3', '#4db6ac',
];

export function AtlasInspector({
  src,
  size,
  regions,
  materials,
  onClose,
}: {
  src: string;
  size: number;
  regions: readonly AtlasInspectorRegion[];
  materials: readonly AtlasInspectorMaterial[];
  onClose?: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    materials.forEach((item, index) => map.set(item.name, COLORS[index % COLORS.length]!));
    return map;
  }, [materials]);
  const rows = useMemo(
    () => [...materials].sort((a, b) => b.allocated - a.allocated),
    [materials],
  );
  const totalPixels = size * size;
  const allocated = rows.reduce((sum, row) => sum + row.allocated, 0);
  const used = rows.reduce((sum, row) => sum + (row.used ?? 0), 0);
  const selectedRegions = selected
    ? regions.filter((region) =>
        region.materials ? region.materials.includes(selected) : region.material === selected,
      )
    : [];

  return (
    <div className="atlas-inspector">
      <header className="atlas-inspector-head">
        <div>
          <b>贴图分区</b>
          <small>
            {size} × {size} · 已分配 {(allocated / totalPixels * 100).toFixed(1)}% ·
            非透明 {(used / totalPixels * 100).toFixed(1)}%
          </small>
        </div>
        {onClose && (
          <button type="button" className="icon-button" aria-label="关闭贴图分区" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        )}
      </header>
      <div className="atlas-inspector-body">
        <div className="atlas-inspector-stage">
          <div className="atlas-inspector-image">
            <img src={src} alt="输出贴图分区" />
            <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
              {regions.map((region) => {
                const owner = region.materials?.[0] ?? region.material;
                const active = selected !== null &&
                  (region.materials ? region.materials.includes(selected) : region.material === selected);
                return (
                  <rect
                    key={region.id}
                    x={region.x + 0.5}
                    y={region.y + 0.5}
                    width={Math.max(0, region.width - 1)}
                    height={Math.max(0, region.height - 1)}
                    fill={active ? colorOf.get(owner) : 'transparent'}
                    fillOpacity={active ? 0.28 : 0}
                    stroke={colorOf.get(owner) ?? '#fff'}
                    strokeOpacity={selected && !active ? 0.25 : 0.95}
                    strokeWidth={active ? 1.4 : 0.7}
                    onClick={() => setSelected(active ? null : owner)}
                  />
                );
              })}
            </svg>
          </div>
          <p className="field-help">
            点击色块或右侧材质查看来源。空白比例高的材质可以降低像素权重后重新转换。
          </p>
          {selected && selectedRegions.length > 0 && (
            <div className="atlas-inspector-detail">
              <b style={{ color: colorOf.get(selected) }}>{selected}</b>
              <span>{selectedRegions.length} 个区域</span>
              {selectedRegions.map((region) => (
                <span key={region.id}>
                  {region.width}×{region.height} @ {region.x},{region.y}
                  {region.source ? ` · ${region.source}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="atlas-inspector-list">
          {rows.map((row) => {
            const blank = row.allocated > 0
              ? Math.max(0, row.allocated - (row.uv ?? row.used ?? 0))
              : 0;
            const transparent = Math.max(0, (row.uv ?? row.used ?? 0) - (row.used ?? 0));
            return (
              <button
                key={row.name}
                type="button"
                className={`atlas-inspector-row${selected === row.name ? ' selected' : ''}`}
                onClick={() => setSelected(selected === row.name ? null : row.name)}
              >
                <span className="atlas-inspector-dot" style={{ background: colorOf.get(row.name) }} />
                <span className="atlas-inspector-name">{row.name}</span>
                <span className="atlas-inspector-stat">
                  {row.allocated.toLocaleString('zh-CN')} px
                  {row.weight !== undefined ? ` · 权重 ${row.weight}` : ''}
                </span>
                <span className="atlas-inspector-bar">
                  <i style={{ width: `${row.allocated ? ((row.used ?? 0) / row.allocated) * 100 : 0}%` }} />
                </span>
                <span className="atlas-inspector-blank">
                  空白 {row.allocated ? (blank / row.allocated * 100).toFixed(0) : 0}%
                  {transparent > 0 ? ` · 透明 ${(transparent / row.allocated * 100).toFixed(0)}%` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
