import { useMemo, useRef, useState } from 'react';
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';
import { Icon } from './Icons';
import { atlasColor } from './atlas-colors';

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

const ZOOM_MIN = 1;
const ZOOM_MAX = 12;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function AtlasInspector({
  src,
  size,
  regions,
  materials,
  coverageSrc,
  selected: selectedProp,
  onSelect,
  onSelectCandidates,
  onClose,
  variant = 'panel',
  showList = true,
  showAdvanced = true,
  emptyText = '转换后查看实际图集。',
}: {
  src: string;
  size: number;
  regions: readonly AtlasInspectorRegion[];
  materials: readonly AtlasInspectorMaterial[];
  /** Optional atlas preview with unused rectangle pixels tinted. */
  coverageSrc?: string;
  /** Controlled material selection; omit for internal state. */
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Called instead of onSelect when a rectangle has several owners. */
  onSelectCandidates?: (ids: readonly string[]) => void;
  onClose?: () => void;
  variant?: 'dialog' | 'panel';
  showList?: boolean;
  showAdvanced?: boolean;
  emptyText?: string;
}) {
  const [internal, setInternal] = useState<string | null>(null);
  const selected = selectedProp !== undefined ? selectedProp : internal;
  const select = (id: string | null) => {
    if (onSelect) onSelect(id);
    if (selectedProp === undefined) setInternal(id);
  };
  const [showCoverage, setShowCoverage] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<{ region: AtlasInspectorRegion; x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    materials.forEach((item) =>
      map.set(item.id ?? item.name, atlasColor(item.id ?? item.name)),
    );
    return map;
  }, [materials]);
  const rows = useMemo(
    () => [...materials].sort((a, b) => b.allocated - a.allocated),
    [materials],
  );
  const totalPixels = Math.max(1, size * size);
  const selectedMaterial = rows.find((row) => (row.id ?? row.name) === selected);

  const zoomBy = (factor: number) => {
    setZoom((current) => clamp(current * factor, ZOOM_MIN, ZOOM_MAX));
  };
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left - rect.width / 2;
    const cursorY = event.clientY - rect.top - rect.height / 2;
    const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
    const next = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const ratio = next / zoom;
    setPan({
      x: cursorX - (cursorX - pan.x) * ratio,
      y: cursorY - (cursorY - pan.y) * ratio,
    });
    setZoom(next);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
    suppressClick.current = false;
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) > 3) {
      current.moved = true;
      suppressClick.current = true;
      // Capture only once a real drag starts: capturing on pointerdown makes the
      // image swallow clicks aimed at the atlas rectangles.
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!current.moved) return;
    setPan({
      x: current.panX + dx,
      y: current.panY + dy,
    });
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const pickRegion = (region: AtlasInspectorRegion) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const ids = region.materialKeys?.length
      ? [...region.materialKeys]
      : [region.materialKey ?? region.material].filter(Boolean);
    if (ids.length > 1 && onSelectCandidates) {
      onSelectCandidates(ids);
      return;
    }
    const owner = ids[0] ?? null;
    select(selected === owner ? null : owner);
  };

  return (
    <div className={`atlas-inspector variant-${variant}`}>
      <header className="atlas-inspector-head">
        <div>
          <b>最终贴图</b>
        </div>
        <div className="atlas-inspector-actions">
          <div className="atlas-zoom" role="group" aria-label="图集缩放">
            <button type="button" aria-label="缩小图集" onClick={() => zoomBy(1 / 1.35)}>
              −
            </button>
            <span>{zoom.toFixed(1)}×</span>
            <button type="button" aria-label="放大图集" onClick={() => zoomBy(1.35)}>
              +
            </button>
            <button type="button" aria-label="重置图集视图" onClick={resetView}>
              重置
            </button>
          </div>
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
      {!regions.length && !materials.length ? (
        <p className="workspace-empty">{emptyText}</p>
      ) : (
        <div className="atlas-inspector-body">
          <div className="atlas-inspector-stage">
            <div
              className={`atlas-inspector-image${zoom > 1 ? ' zoomed' : ''}`}
              ref={imageRef}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className="atlas-inspector-canvas"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                }}
              >
                <img src={showCoverage && coverageSrc ? coverageSrc : src} alt="输出贴图与分区" draggable={false} />
                <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
                  {regions.map((region) => {
                    const owner = region.materialKeys?.[0] ?? region.materialKey ?? region.material;
                    const active = selected !== null &&
                      (region.materialKeys
                        ? region.materialKeys.includes(selected)
                        : (region.materialKey ?? region.material) === selected ||
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
                        strokeOpacity={selected && !active ? 0.2 : 0.95}
                        strokeWidth={active ? 1.6 : 0.7}
                        strokeDasharray={shared ? '2 1.5' : undefined}
                        onClick={() => pickRegion(region)}
                        onMouseEnter={(event) => {
                          const box = imageRef.current?.getBoundingClientRect();
                          if (!box) return;
                          setHover({
                            region,
                            x: event.clientX - box.left,
                            y: event.clientY - box.top,
                          });
                        }}
                        onMouseMove={(event) => {
                          const box = imageRef.current?.getBoundingClientRect();
                          if (!box) return;
                          setHover({
                            region,
                            x: event.clientX - box.left,
                            y: event.clientY - box.top,
                          });
                        }}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                </svg>
              </div>
              {hover && (() => {
                const hoverOwner =
                  hover.region.materialKeys?.[0] ??
                  hover.region.materialKey ??
                  hover.region.material;
                const hoverRow =
                  rows.find((row) => (row.id ?? row.name) === hoverOwner) ??
                  rows.find((row) => row.name === hover.region.material);
                return (
                  <div
                    className="atlas-region-tip"
                    style={{
                      left: Math.max(4, Math.min(hover.x + 12, 168)),
                      top: hover.y + 12,
                    }}
                  >
                    <b>{hoverRow?.name ?? hover.region.material}</b>
                    {hoverRow && (
                      <span>
                        分配 {hoverRow.allocated.toLocaleString('zh-CN')} px · 占整图{' '}
                        {((hoverRow.allocated / totalPixels) * 100).toFixed(1)}%
                      </span>
                    )}
                    {(hover.region.materialKeys?.length ?? 0) > 1 && (
                      <span>共享矩形 ×{hover.region.materialKeys!.length}</span>
                    )}
                    <span>
                      {hover.region.width}×{hover.region.height} @ {hover.region.x},{hover.region.y}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
          {showList && (
            <div className="atlas-inspector-list">
              {rows.map((row) => {
                const id = row.id ?? row.name;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`atlas-inspector-row${selected === id ? ' selected' : ''}`}
                    onClick={() => select(selected === id ? null : id)}
                  >
                    <span className="atlas-inspector-dot" style={{ background: colorOf.get(id) }} />
                    <span className="atlas-inspector-name" title={row.name}>{row.name}</span>
                    <span className="atlas-inspector-stat" title="分配像素 · 占整张图的比例">
                      {row.allocated.toLocaleString('zh-CN')} px ·{' '}
                      {((row.allocated / totalPixels) * 100).toFixed(1)}%
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {showAdvanced && rows.length > 0 && (
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
                  <td>{(row.floorCharts ?? 0) > 0 ? `已到最小 ×${row.floorCharts}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
