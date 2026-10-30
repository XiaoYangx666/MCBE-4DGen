import { useMemo } from 'react';
import { WeightInput } from '../shared/MaterialList';
import { atlasColor } from '../shared/atlas-colors';
import {
  QUALITY_MAX,
  qualityToSlider,
  sliderToQuality,
} from '../shared/texture-scale';
import type { Result, Session } from './types';

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 1.4;

/**
 * Texture inspector: atlas allocation as a donut plus a compact, always
 * present tuner for the selected material. The ring segments use the same
 * colours as the atlas overlay, so a click anywhere identifies the material.
 */
export function TextureChart({
  session,
  result,
  selected,
  onSelect,
  materialWeights,
  setMaterialWeights,
  changed,
  busy,
  solo,
  setSolo,
}: {
  session: Session | null;
  result: Result | null;
  selected: string;
  onSelect: (id: string | null) => void;
  materialWeights: Record<string, number>;
  setMaterialWeights: (
    update: (weights: Record<string, number>) => Record<string, number>,
  ) => void;
  changed: () => void;
  busy: boolean;
  solo: string | null;
  setSolo: (update: (current: string | null) => string | null) => void;
}) {
  const materials = session?.materials ?? [];
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

  const active = materials.find((material) => material.key === selected) ?? null;
  const activeMeasurement = active ? measurements.get(active.key) : null;
  const activePixels =
    activeMeasurement?.rectPixels ?? activeMeasurement?.pixels ?? null;
  const weight = active ? (materialWeights[active.key] ?? 1) : 1;
  const usedPercent =
    shares.total > 0 ? (shares.used / shares.total) * 100 : 0;

  const setWeight = (value: number) => {
    if (!active) return;
    setMaterialWeights((weights) => ({
      ...weights,
      [active.key]: Math.max(0, Math.min(QUALITY_MAX, value)),
    }));
    changed();
  };

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
        <svg viewBox="0 0 120 120" role="img" aria-label="材质占图集比例">
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
              onClick={() =>
                onSelect(segment.id === selected ? null : segment.id)
              }
            >
              <title>{`${segment.name} · ${segment.percent.toFixed(1)}%`}</title>
            </circle>
          ))}
        </svg>
        <div className="texture-donut-center">
          <b>{usedPercent.toFixed(0)}%</b>
          <small>已用</small>
        </div>
      </div>

      <div className="texture-tuner">
        {active ? (
          <>
            <div className="texture-tuner-head">
              <b title={active.name}>{active.name}</b>
              <span>
                {activePixels != null && shares.total > 0
                  ? `${activePixels.toLocaleString('zh-CN')} px · ${(
                      (activePixels / shares.total) *
                      100
                    ).toFixed(1)}%`
                  : '未分配'}
              </span>
            </div>
            <div className="texture-tuner-controls">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={qualityToSlider(weight)}
                disabled={busy}
                aria-label={`${active.name} 相对纹理密度`}
                onChange={(event) =>
                  setWeight(
                    Math.round(
                      sliderToQuality(Number(event.target.value)) * 100,
                    ) / 100,
                  )
                }
              />
              <WeightInput
                value={weight}
                label={active.name}
                disabled={busy}
                title="0.1–20×，可直接输入"
                onCommit={setWeight}
              />
              <button
                type="button"
                className={solo === active.key ? 'active' : ''}
                disabled={busy}
                onClick={() =>
                  setSolo((current) =>
                    current === active.key ? null : active.key,
                  )
                }
              >
                {solo === active.key ? '还原' : '只看'}
              </button>
              <button
                type="button"
                disabled={busy}
                title="恢复此材质的默认密度"
                onClick={() => {
                  setMaterialWeights((weights) => {
                    const next = { ...weights };
                    delete next[active.key];
                    return next;
                  });
                  changed();
                }}
              >
                恢复
              </button>
            </div>
          </>
        ) : (
          <p className="texture-tuner-empty">
            选中左侧列表或环形图中的材质后，在这里调节密度。
          </p>
        )}
      </div>
    </div>
  );
}
