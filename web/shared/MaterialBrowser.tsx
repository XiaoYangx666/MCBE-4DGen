import { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialList } from './MaterialList';
import {
  QUALITY_MAX,
  QUALITY_MIN,
  formatQuality,
  qualityToSlider,
  sliderToQuality,
} from './texture-scale';
import type {
  StudioMaterial,
  TextureMode,
  TexturePixelState,
  TextureTarget,
} from './texture-types';

type MaterialFilter = 'all' | 'limited';

const FILTER_LABEL: Record<MaterialFilter, string> = {
  all: '全部',
  limited: '已到最小',
};

export interface MaterialPixelInfo {
  pixels: number | null;
  state: TexturePixelState;
  delta?: number | null;
  floorCharts?: number;
  flat?: boolean;
}

const QUALITY_STEP = 1;

/**
 * Direct numeric entry next to the slider. Typing a value and pressing Enter
 * (or leaving the field) applies it; Escape restores the current value. The
 * text only follows the slider while the field is not focused, so a running
 * preview cannot overwrite what is being typed.
 */
function QualityInput({
  value,
  unit,
  label,
  disabled,
  onCommit,
}: {
  value: number;
  unit: string;
  label: string;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(formatQuality(value));
  const [editing, setEditing] = useState(false);
  const cancel = useRef(false);

  useEffect(() => {
    if (!editing) setText(formatQuality(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (cancel.current) {
      cancel.current = false;
      setText(formatQuality(value));
      return;
    }
    const parsed = Number(text.trim().replace(',', '.'));
    if (
      text.trim() === '' ||
      !Number.isFinite(parsed) ||
      parsed < QUALITY_MIN ||
      parsed > QUALITY_MAX
    ) {
      setText(formatQuality(value));
      return;
    }
    const rounded = Math.round(parsed * 100) / 100;
    setText(formatQuality(rounded));
    if (rounded !== Math.round(value * 100) / 100) onCommit(rounded);
  };

  return (
    <span className="texture-quality-value">
      <input
        type="number"
        inputMode="decimal"
        min={QUALITY_MIN}
        max={QUALITY_MAX}
        step={0.05}
        value={text}
        disabled={disabled}
        aria-label={label}
        title={`${QUALITY_MIN}–${QUALITY_MAX}${unit}，可直接输入`}
        onFocus={() => setEditing(true)}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            cancel.current = true;
            event.currentTarget.blur();
          }
        }}
      />
      {unit && <em>{unit}</em>}
    </span>
  );
}

/**
 * The texture workspace's material browser. It owns search, filtering and the
 * quality tuner so a user can keep tuning material after material without
 * opening a dialog or leaving the workspace.
 */
export function MaterialBrowser({
  materials,
  selectedMaterial,
  onSelectMaterial,
  onWeight,
  onResetWeight,
  onResetAllWeights,
  disabled = false,
  mode,
  target,
  onMode,
  onTarget,
  pixelInfo,
  previewState = 'idle',
  previewNote,
  atlas,
}: {
  materials: readonly StudioMaterial[];
  selectedMaterial: string | null;
  onSelectMaterial: (id: string | null) => void;
  onWeight: (id: string, value: number) => void;
  onResetWeight: (id: string) => void;
  onResetAllWeights: () => void;
  disabled?: boolean;
  mode: TextureMode;
  target: TextureTarget;
  onMode: (mode: TextureMode) => void;
  onTarget: (target: TextureTarget) => void;
  pixelInfo?: (material: StudioMaterial) => MaterialPixelInfo;
  previewState?: 'idle' | 'queued' | 'running' | 'stale';
  previewNote?: string;
  atlas?: { width: number; height: number; contentUtilization: number } | null;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MaterialFilter>('all');
  const [sort, setSort] = useState<'default' | 'pixels' | 'name'>('default');
  const selected = materials.find((material) => material.id === selectedMaterial) ?? null;
  const normalized = query.trim().toLowerCase();

  const rows = useMemo(() => {
    const list = materials.filter((material) => {
      if (filter === 'limited' && !material.limited) return false;
      if (!normalized) return true;
      return (
        material.name.toLowerCase().includes(normalized) ||
        material.meta.toLowerCase().includes(normalized) ||
        material.id.toLowerCase().includes(normalized)
      );
    });
    if (sort === 'pixels')
      return [...list].sort(
        (a, b) => (b.lastPixels ?? -1) - (a.lastPixels ?? -1),
      );
    if (sort === 'name')
      return [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return list;
  }, [materials, filter, normalized, sort]);

  const qualityLabel = mode === 'budget'
    ? target === 'density'
      ? '相对纹理密度'
      : '相对细节保留'
    : '旧版像素权重';
  const qualityUnit = mode === 'budget' ? '×' : '';
  const presets = [0.5, 1, 2, 4, 10];
  const info = selected && pixelInfo ? pixelInfo(selected) : null;

  return (
    <div className="material-browser">
      <div className="material-browser-head">
        <div>
          <b>材质与清晰度</b>
          <small>
            {rows.length}/{materials.length} 项
            {previewState === 'running'
              ? ' · 正在计算预览'
              : previewState === 'queued'
                ? ' · 预览排队中'
                : previewState === 'stale'
                  ? ' · 预览已过期'
                  : ''}
          </small>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={disabled || !materials.length}
          onClick={onResetAllWeights}
        >
          全部恢复
        </button>
      </div>
      <p className="material-browser-summary">
        {atlas
          ? `输出贴图 ${atlas.width}×${atlas.height} · 已用 ${(atlas.contentUtilization * 100).toFixed(1)}% · ${materials.length} 个材质`
          : previewState === 'running'
            ? '正在计算最终贴图…'
            : '运行一次预览后显示最终贴图的占用。'}
      </p>
      {previewNote && <p className="material-browser-note">{previewNote}</p>}
      <div className="material-browser-tools">
        <input
          type="search"
          value={query}
          placeholder="搜索材质名称、标识或信息…"
          aria-label="搜索材质"
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="material-browser-filters" role="group" aria-label="材质筛选">
          {(Object.keys(FILTER_LABEL) as MaterialFilter[]).map((key) => (
            <button
              type="button"
              key={key}
              className={filter === key ? 'active' : ''}
              disabled={disabled}
              onClick={() => setFilter(key)}
            >
              {FILTER_LABEL[key]}
            </button>
          ))}
        </div>
        <label className="material-browser-sort">
          排序
          <select
            value={sort}
            disabled={disabled}
            onChange={(event) =>
              setSort(event.target.value as 'default' | 'pixels' | 'name')
            }
          >
            <option value="default">模型顺序</option>
            <option value="pixels">像素分配</option>
            <option value="name">名称</option>
          </select>
        </label>
      </div>

      {selected && (
        <div className="texture-quality-tuner" aria-live="polite">
          <div className="texture-quality-head">
            <b title={selected.name}>{selected.name}</b>
            <QualityInput
              value={selected.quality}
              unit={qualityUnit}
              label={`${selected.name} ${qualityLabel}数值`}
              disabled={disabled}
              onCommit={(value) => onWeight(selected.id, value)}
            />
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={QUALITY_STEP}
            value={qualityToSlider(selected.quality)}
            disabled={disabled}
            aria-label={`${selected.name} ${qualityLabel}`}
            onChange={(event) =>
              onWeight(selected.id, Math.round(sliderToQuality(Number(event.target.value)) * 100) / 100)
            }
          />
          <div className="texture-quality-actions">
            {presets.map((value) => (
              <button
                type="button"
                key={value}
                disabled={disabled}
                onClick={() => onWeight(selected.id, value)}
              >
                {value}×
              </button>
            ))}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onResetWeight(selected.id)}
            >
              恢复此材质
            </button>
          </div>
          <div className="texture-quality-result">
            {info && info.pixels != null ? (
              <>
                <span className={`pixel-state ${info.state}`}>
                  {info.state === 'actual'
                    ? '实际分配'
                    : info.state === 'estimate'
                      ? '预估分配'
                      : info.state === 'pending'
                        ? '正在计算'
                        : '分配'}
                  {' '}
                  {info.pixels.toLocaleString('zh-CN')} px
                  {info.flat ? ' · 纯色采样' : ''}
                </span>
                {info.delta != null && info.delta !== 0 && (
                  <em className={info.delta > 0 ? 'up' : 'down'}>
                    {info.delta > 0 ? '+' : ''}
                    {info.delta.toLocaleString('zh-CN')} px
                  </em>
                )}
                {info.floorCharts && info.floorCharts > 0 ? (
                  <small className="limited">
                    有 {info.floorCharts} 个 UV 岛已到最小尺寸，继续降低不会更小。
                  </small>
                ) : (
                  <small>未触发最小尺寸限制。</small>
                )}
              </>
            ) : (
              <small>转换后在这里显示实际像素与限制信息。</small>
            )}
          </div>
        </div>
      )}

      {rows.length ? (
        <MaterialList
          items={rows.map((material) => ({
            id: material.id,
            name: material.name,
            meta: material.meta,
            thumbnail: material.thumbnail ?? null,
            ...(material.color ? { color: material.color } : {}),
            weight: material.weight,
            selected: material.id === selectedMaterial,
            ...(material.status ? { status: material.status } : {}),
            ...(material.limited ? { limited: true } : {}),
          }))}
          disabled={disabled}
          showWeight={false}
          onSelect={(id) => onSelectMaterial(id === selectedMaterial ? null : id)}
          onWeight={onWeight}
        />
      ) : (
        <p className="workspace-empty">
          {materials.length ? '没有匹配的材质。' : '当前模型没有材质。'}
        </p>
      )}

    </div>
  );
}
