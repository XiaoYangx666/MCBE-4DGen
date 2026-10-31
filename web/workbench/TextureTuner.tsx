import { useEffect, useState } from 'react';
import { WeightInput } from '../shared/MaterialList';
import { atlasColor } from '../shared/atlas-colors';
import {
  QUALITY_MAX,
  formatQuality,
  qualityToSlider,
  sliderToQuality,
} from '../shared/texture-scale';
import type { Result, Session } from './types';

/** Quick absolute density steps; 1× restores the untouched budget. */
const PRESETS = [0.5, 1, 2, 4, 10];

/** Slider positions the thumb snaps to, with the exact quality they mean. */
const TICKS = PRESETS.map((quality) => ({
  quality,
  slider: Math.round(qualityToSlider(quality)),
}));
const SNAP_RADIUS = 2.5;

function snapSlider(value: number) {
  let best = value;
  let distance = SNAP_RADIUS + 1;
  for (const tick of TICKS) {
    const delta = Math.abs(value - tick.slider);
    if (delta <= SNAP_RADIUS && delta < distance) {
      best = tick.slider;
      distance = delta;
    }
  }
  return best;
}

/**
 * Density tuner that floats over the bottom centre of the preview, so the
 * material stays visible while its texture budget changes. Absolute preset
 * buttons cover the common steps without dragging the slider.
 */
export function TextureTuner({
  session,
  result,
  selected,
  materialWeights,
  setMaterialWeights,
  changed,
  busy,
  solo,
  setSolo,
  onClear,
}: {
  session: Session | null;
  result: Result | null;
  selected: string;
  materialWeights: Record<string, number>;
  setMaterialWeights: (
    update: (weights: Record<string, number>) => Record<string, number>,
  ) => void;
  changed: () => void;
  busy: boolean;
  solo: string | null;
  setSolo: (update: (current: string | null) => string | null) => void;
  /** Drop the current selection (and any isolation). */
  onClear: () => void;
}) {
  const active =
    (session?.materials ?? []).find((material) => material.key === selected) ??
    null;
  const measurements = new Map(
    (result?.details?.texture?.materials ?? []).map((material) => [
      material.key ?? material.name,
      material,
    ]),
  );
  const atlas = result?.details?.texture?.atlas ?? null;
  const atlasPixels = atlas ? atlas.width * atlas.height : 0;
  const measurement = active ? measurements.get(active.key) : null;
  const pixels = measurement?.rectPixels ?? measurement?.pixels ?? null;
  const weight = active ? (materialWeights[active.key] ?? 1) : 1;

  const setWeight = (value: number) => {
    if (!active) return;
    setMaterialWeights((weights) => ({
      ...weights,
      [active.key]: Math.max(0, Math.min(QUALITY_MAX, value)),
    }));
    changed();
  };

  // Dragging only moves a local draft; the preview recalculates on release.
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => {
    setDraft(null);
  }, [active?.key, weight]);

  const sliderValue = draft ?? qualityToSlider(weight);
  const draftQuality =
    draft === null
      ? weight
      : (TICKS.find((tick) => tick.slider === draft)?.quality ??
        sliderToQuality(draft));

  const commitDraft = () => {
    if (draft === null) return;
    const tick = TICKS.find((item) => item.slider === draft);
    const value =
      Math.round((tick ? tick.quality : sliderToQuality(draft)) * 100) / 100;
    setDraft(null);
    if (Math.abs(value - weight) < 0.001) return;
    setWeight(value);
  };

  if (!active) {
    return (
      <div className="texture-tuner-overlay">
        <div className="texture-tuner-bar empty">
          <p className="texture-tuner-empty">
            点击模型表面、图集或环形图选择材质；选中后可只看、取消选择或调节清晰度。
          </p>
        </div>
      </div>
    );
  }

  const name = active.label ?? (active.name || '未命名');
  const share =
    pixels !== null && atlasPixels > 0 ? (pixels / atlasPixels) * 100 : null;

  return (
    <div className="texture-tuner-overlay" role="group" aria-label="材质清晰度">
      <div className="texture-tuner-bar">
        <div className="texture-tuner-head">
          <i
            className="texture-tuner-swatch"
            style={{ background: atlasColor(active.key) }}
            aria-hidden="true"
          />
          <b title={name}>{name}</b>
          <small>
            {pixels !== null
              ? `${pixels.toLocaleString('zh-CN')} px${
                  share !== null ? ` · ${share.toFixed(1)}%` : ''
                }`
              : '未分配像素'}
          </small>
          <span className="grow" />
          <button
            type="button"
            className={solo === active.key ? 'active' : ''}
            disabled={busy}
            aria-pressed={solo === active.key}
            title="只显示这个材质；再次点击还原"
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
            title="取消当前材质选择"
            onClick={onClear}
          >
            取消选择
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
        <div className="texture-tuner-controls">
          <div className="texture-tuner-slider">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={sliderValue}
              disabled={busy}
              aria-label={`${name} 相对纹理密度`}
              title="拖动时只调整数值，松手后重新计算预览"
              onChange={(event) =>
                setDraft(snapSlider(Number(event.target.value)))
              }
              onPointerUp={commitDraft}
              onPointerCancel={commitDraft}
              onKeyUp={commitDraft}
              onBlur={commitDraft}
            />
            <div className="texture-tuner-ticks" aria-hidden="true">
              {TICKS.map((tick) => (
                <i
                  key={tick.quality}
                  style={{ left: `${tick.slider}%` }}
                />
              ))}
            </div>
          </div>
          <WeightInput
            value={draftQuality}
            label={name}
            disabled={busy}
            title="0.1–20×，可直接输入"
            onCommit={setWeight}
          />
          <div className="texture-tuner-presets" role="group" aria-label="快捷倍率">
            {PRESETS.map((preset) => (
              <button
                type="button"
                key={preset}
                className={Math.abs(weight - preset) < 0.001 ? 'active' : ''}
                disabled={busy}
                aria-pressed={Math.abs(weight - preset) < 0.001}
                onClick={() => setWeight(preset)}
              >
                {formatQuality(preset)}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
