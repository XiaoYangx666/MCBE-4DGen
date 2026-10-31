import { useMemo, useState } from 'react';
import { atlasColor } from '../shared/atlas-colors';
import { partDisplayNames, type PartNameInput } from '../shared/part-labels';
import type { Result, Session } from './types';

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 1.4;

/**
 * Atlas allocation as a donut. Segments share the atlas overlay colours, and
 * hovering one shows the material, the parts it belongs to and how much of the
 * atlas it takes, so the ring explains itself without a legend.
 */
export function TextureChart({
  session,
  result,
  selected,
  onSelect,
}: {
  session: Session | null;
  result: Result | null;
  selected: string;
  onSelect: (id: string | null) => void;
}) {
  const materials = session?.materials ?? [];
  const parts = session?.parts ?? [];
  const measurements = useMemo(
    () =>
      new Map(
        (result?.details?.texture?.materials ?? []).map((material) => [
          material.key ?? material.name,
          material,
        ]),
      ),
    [result],
  );
  const atlas = result?.details?.texture?.atlas ?? null;
  const atlasPixels = atlas ? atlas.width * atlas.height : 0;

  const partsByMaterial = useMemo(() => {
    const map = new Map<string, PartNameInput[]>();
    for (const part of parts) {
      const list = map.get(part.materialKey) ?? [];
      list.push({
        name: part.name,
        node: part.node,
        mesh: part.mesh,
        material: part.materialName,
      });
      map.set(part.materialKey, list);
    }
    return map;
  }, [parts]);

  const shares = useMemo(() => {
    const items = materials
      .map((material) => {
        const measurement = measurements.get(material.key);
        const pixels = measurement?.rectPixels ?? measurement?.pixels ?? 0;
        return {
          id: material.key,
          name: material.label ?? (material.name || '未命名'),
          pixels,
        };
      })
      .filter((item) => item.pixels > 0)
      .sort((a, b) => b.pixels - a.pixels);
    const used = items.reduce((sum, item) => sum + item.pixels, 0);
    return { items, used, total: atlasPixels };
  }, [materials, measurements, atlasPixels]);

  const [hover, setHover] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

  const usedPercent =
    shares.total > 0 ? (shares.used / shares.total) * 100 : 0;

  let offset = 0;
  const segments = shares.items.map((item) => {
    const length =
      shares.total > 0 ? (item.pixels / shares.total) * CIRCUMFERENCE : 0;
    const segment = {
      ...item,
      percent: shares.total > 0 ? (item.pixels / shares.total) * 100 : 0,
      dash: Math.max(0, length - GAP),
      rest: Math.max(0, CIRCUMFERENCE - Math.max(0, length - GAP)),
      offset: -offset,
    };
    offset += length;
    return segment;
  });

  const hovered = hover
    ? (segments.find((segment) => segment.id === hover.id) ?? null)
    : null;
  const hoveredParts = hovered
    ? partDisplayNames(partsByMaterial.get(hovered.id) ?? [])
    : [];
  const hoveredPartLabel = hoveredParts.length
    ? `部件：${hoveredParts.slice(0, 4).join('、')}${
        hoveredParts.length > 4 ? ` 等 ${hoveredParts.length} 个` : ''
      }`
    : '部件：未关联到具体部件';
  const viewportWidth =
    typeof window === 'undefined' ? 1280 : window.innerWidth;
  const tooltipX = hover
    ? Math.min(Math.max(hover.x, 132), Math.max(132, viewportWidth - 132))
    : 0;

  return (
    <div className="texture-chart">
      <div className="texture-chart-head">
        <b>占用</b>
        <small>
          {shares.total > 0
            ? `已用 ${usedPercent.toFixed(1)}% · ${shares.items.length} 个材质`
            : '运行一次预览后显示占用'}
        </small>
      </div>

      <div className="texture-donut">
        <svg
          viewBox="0 0 120 120"
          role="group"
          aria-label="材质占图集比例"
        >
          <circle
            className="texture-donut-track"
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            strokeWidth="16"
          />
          {segments.map((segment) => (
            <circle
              key={segment.id}
              className={`texture-donut-segment${
                segment.id === selected ? ' active' : ''
              }`}
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              stroke={atlasColor(segment.id)}
              strokeWidth={segment.id === selected ? 20 : 16}
              strokeDasharray={`${segment.dash} ${segment.rest}`}
              strokeDashoffset={segment.offset}
              transform="rotate(-90 60 60)"
              tabIndex={0}
              aria-label={`${segment.name}，占图集 ${segment.percent.toFixed(
                1,
              )}%`}
              onPointerEnter={(event) =>
                setHover({
                  id: segment.id,
                  x: event.clientX,
                  y: event.clientY,
                })
              }
              onPointerMove={(event) =>
                setHover({
                  id: segment.id,
                  x: event.clientX,
                  y: event.clientY,
                })
              }
              onPointerLeave={() => setHover(null)}
              onFocus={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setHover({
                  id: segment.id,
                  x: rect.left + rect.width / 2,
                  y: rect.top,
                });
              }}
              onBlur={() => setHover(null)}
              onClick={() => onSelect(segment.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onSelect(segment.id);
              }}
            />
          ))}
        </svg>
        <div className="texture-donut-center">
          <b>{usedPercent.toFixed(0)}%</b>
          <small>已用</small>
        </div>
      </div>

      {hover && hovered && (
        <div
          className={`texture-donut-tooltip${hover.y < 150 ? ' below' : ''}`}
          style={{ left: tooltipX, top: hover.y }}
          role="tooltip"
        >
          <span className="texture-donut-tooltip-head">
            <i style={{ background: atlasColor(hovered.id) }} />
            <b>{hovered.name}</b>
          </span>
          <span className="texture-donut-tooltip-line">{hoveredPartLabel}</span>
          <span className="texture-donut-tooltip-line">
            {hovered.pixels.toLocaleString('zh-CN')} px ·{' '}
            {hovered.percent.toFixed(1)}%
            {atlas ? ` · 图集 ${atlas.width}×${atlas.height}` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
