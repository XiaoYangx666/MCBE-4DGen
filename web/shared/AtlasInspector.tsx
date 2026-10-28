import { useMemo, useState } from 'react';
import { Icon } from './Icons';

export interface AtlasInspectorRegion {
  id: string;
  material: string;
  /** Stable key when a rectangle has one owner. */
  materialKey?: string;
  /** All stable material keys sharing this rectangle. */
  materialKeys?: readonly string[];
  /** All materials sharing this rectangle, when the caller knows them. */
  materials?: readonly string[];
  x: number;
  y: number;
  width: number;
  height: number;
  contentPixels: number;
  source?: string;
  /** True when this rectangle is reused by several materials. */
  shared?: boolean;
}

export interface AtlasInspectorMaterial {
  /** Stable material key; falls back to the name for legacy reports. */
  id?: string;
  name: string;
  /** Content pixels attributed to this material (partitioned). */
  allocated: number;
  /** Pixels covered by a non-transparent triangle. */
  used: number | null;
  /** Pixels covered by any triangle, including transparent texels. */
  uv: number | null;
  /** Current quality multiplier, when the caller can provide it. */
  weight?: number;
  /** Untextured solid-color material. */
  flat?: boolean;
  /** Pixels shared with another material. */
  shared?: number | null;
  /** UV islands clamped to the technical minimum. */
  floorCharts?: number;
  rectPixels?: number;
  wastePixels?: number;
  mode?: 'legacy' | 'budget';
}

export interface AtlasInspectorSummary {
  contentPixels?: number;
  allocatedPixels?: number;
  uvPixels?: number;
  sharedContentPixels?: number;
  unusedContentPixels?: number;
  overlapPixels?: number;
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
  coverageSrc,
  summary,
  selected: selectedProp,
  onSelect,
  onClose,
}: {
  src: string;
  size: number;
  regions: readonly AtlasInspectorRegion[];
  materials: readonly AtlasInspectorMaterial[];
  /** Optional atlas preview with unused rectangle pixels tinted. */
  coverageSrc?: string;
  summary?: AtlasInspectorSummary;
  /** Controlled material selection; omit for internal state. */
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onClose?: () => void;
}) {
  const [internal, setInternal] = useState<string | null>(null);
  const selected = selectedProp !== undefined ? selectedProp : internal;
  const select = (id: string | null) => {
    if (onSelect) onSelect(id);
    if (selectedProp === undefined) setInternal(id);
  };
  const [showCoverage, setShowCoverage] = useState(false);
  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    materials.forEach((item, index) =>
      map.set(item.id ?? item.name, COLORS[index % COLORS.length]!),
    );
    return map;
  }, [materials]);
  const rows = useMemo(
    () => [...materials].sort((a, b) => b.allocated - a.allocated),
    [materials],
  );
  const totalPixels = size * size;
  const allocated = summary?.allocatedPixels ?? rows.reduce((sum, row) => sum + row.allocated, 0);
  const content = summary?.contentPixels ?? allocated;
  const uv = summary?.uvPixels ?? rows.reduce((sum, row) => sum + (row.uv ?? row.used ?? 0), 0);
  const selectedId = selected && rows.some((row) => (row.id ?? row.name) === selected)
    ? selected
    : selected;
  const selectedRegions = selectedId
    ? regions.filter((region) =>
        region.materialKeys
          ? region.materialKeys.includes(selectedId)
          : (region.materialKey ?? region.material) === selectedId ||
            region.material === materials.find((row) => (row.id ?? row.name) === selectedId)?.name,
      )
    : [];
  const selectedMaterial = rows.find((row) => (row.id ?? row.name) === selectedId);

  return (
    <div className="atlas-inspector">
      <header className="atlas-inspector-head">
        <div>
          <b>贴图诊断</b>
          <small>
            {size} × {size} · 内容 {((content / totalPixels) * 100).toFixed(1)}% ·
            三角采样 {((uv / totalPixels) * 100).toFixed(1)}%
            {summary?.sharedContentPixels
              ? ` · 共享 ${((summary.sharedContentPixels / totalPixels) * 100).toFixed(1)}%`
              : ''}
            {summary?.unusedContentPixels
              ? ` · 矩形内未采样 ${((summary.unusedContentPixels / totalPixels) * 100).toFixed(1)}%`
              : ''}
          </small>
        </div>
        <div className="atlas-inspector-actions">
          {coverageSrc && (
            <button
              type="button"
              className={`atlas-inspector-toggle${showCoverage ? ' active' : ''}`}
              onClick={() => setShowCoverage((value) => !value)}
            >
              {showCoverage ? '显示原图' : '高亮未使用'}
            </button>
          )}
          {onClose && (
            <button type="button" className="icon-button" aria-label="关闭贴图诊断" onClick={onClose}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </header>
      <div className="atlas-inspector-body">
        <div className="atlas-inspector-stage">
          <div className="atlas-inspector-image">
            <img src={showCoverage && coverageSrc ? coverageSrc : src} alt="输出贴图与分区" />
            <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
              {regions.map((region) => {
                const owner = region.materialKeys?.[0] ?? region.materialKey ?? region.material;
                const active = selectedId !== null &&
                  (region.materialKeys
                    ? region.materialKeys.includes(selectedId)
                    : (region.materialKey ?? region.material) === selectedId ||
                      region.material === selectedMaterial?.name);
                const shared = region.shared || (region.materialKeys?.length ?? 0) > 1;
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
                    strokeOpacity={selectedId && !active ? 0.2 : 0.95}
                    strokeWidth={active ? 1.6 : 0.7}
                    strokeDasharray={shared ? '2 1.5' : undefined}
                    onClick={() => select(active ? null : (owner ?? null))}
                  />
                );
              })}
            </svg>
          </div>
          <p className="field-help">
            点击色块或右侧材质查看实际区域。虚线框是多个材质共享的矩形；
            红色高亮（开启「高亮未使用」）表示没有三角面采样的像素。
          </p>
          {selectedMaterial && (
            <div className="atlas-inspector-detail">
              <b style={{ color: colorOf.get(selectedMaterial.id ?? selectedMaterial.name) }}>
                {selectedMaterial.name}
              </b>
              <span>{selectedMaterial.allocated.toLocaleString('zh-CN')} px 归属</span>
              {selectedMaterial.uv != null && (
                <span>{(selectedMaterial.uv ?? 0).toLocaleString('zh-CN')} px 被三角面覆盖</span>
              )}
              {selectedMaterial.shared ? (
                <span>其中 {selectedMaterial.shared.toLocaleString('zh-CN')} px 与其他材质重叠</span>
              ) : (
                <span>无跨材质重叠采样</span>
              )}
              <span>
                {selectedMaterial.flat
                  ? '纯色采样'
                  : selectedMaterial.floorCharts
                    ? `受最小尺寸限制的 UV 岛：${selectedMaterial.floorCharts}`
                    : '未触发最小尺寸限制'}
              </span>
              {selectedMaterial.weight !== undefined && (
                <span>当前质量 {selectedMaterial.weight.toFixed(2)}×</span>
              )}
              {selectedRegions.map((region) => (
                <span key={region.id}>
                  {region.width}×{region.height} @ {region.x},{region.y}
                  {region.materialKeys && region.materialKeys.length > 1
                    ? ` · 共享 ×${region.materialKeys.length}`
                    : ''}
                  {region.source ? ` · ${region.source}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="atlas-inspector-list">
          {rows.map((row) => {
            const id = row.id ?? row.name;
            const flat = row.flat === true;
            const blank = flat || row.allocated <= 0
              ? 0
              : Math.max(0, row.allocated - (row.uv ?? row.used ?? 0));
            const transparent = flat
              ? 0
              : Math.max(0, (row.uv ?? row.used ?? 0) - (row.used ?? 0));
            const atFloor = (row.floorCharts ?? 0) > 0;
            return (
              <button
                key={id}
                type="button"
                className={`atlas-inspector-row${selectedId === id ? ' selected' : ''}`}
                onClick={() => select(selectedId === id ? null : id)}
              >
                <span className="atlas-inspector-dot" style={{ background: colorOf.get(id) }} />
                <span className="atlas-inspector-name" title={row.name}>{row.name}</span>
                <span className="atlas-inspector-stat">
                  {row.allocated.toLocaleString('zh-CN')} px
                  {row.weight !== undefined ? ` · ${row.weight.toFixed(2)}×` : ''}
                </span>
                <span className="atlas-inspector-bar">
                  <i style={{ width: `${row.allocated ? ((row.used ?? 0) / row.allocated) * 100 : 0}%` }} />
                </span>
                <span className="atlas-inspector-blank">
                  {flat
                    ? '纯色采样'
                    : `未覆盖 ${row.allocated ? (blank / row.allocated * 100).toFixed(0) : 0}%${
                        transparent > 0 ? ` · 透明 ${(transparent / row.allocated * 100).toFixed(0)}%` : ''
                      }${atFloor ? ' · 已触底' : ''}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <details className="atlas-inspector-advanced">
        <summary>详细统计</summary>
        <table>
          <thead>
            <tr>
              <th>材质</th>
              <th>归属内容</th>
              <th>三角采样</th>
              <th>共享</th>
              <th>内容未用</th>
              <th>限制</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id ?? row.name}>
                <td>{row.name}</td>
                <td>{row.allocated.toLocaleString('zh-CN')} px</td>
                <td>{(row.uv ?? row.used ?? 0).toLocaleString('zh-CN')} px</td>
                <td>{(row.shared ?? 0).toLocaleString('zh-CN')} px</td>
                <td>{(row.wastePixels ?? 0).toLocaleString('zh-CN')} px</td>
                <td>{(row.floorCharts ?? 0) > 0 ? `触底 ×${row.floorCharts}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
