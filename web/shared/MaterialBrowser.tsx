import { useMemo, useState } from 'react';
import { MaterialList } from './MaterialList';
import type {
  StudioMaterial,
  TextureMode,
  TexturePixelState,
  TextureTarget,
} from './texture-types';

type MaterialFilter = 'all' | 'included' | 'excluded' | 'limited';

const FILTER_LABEL: Record<MaterialFilter, string> = {
  all: '全部',
  included: '保留',
  excluded: '已排除',
  limited: '触底',
};

export interface MaterialPixelInfo {
  pixels: number | null;
  state: TexturePixelState;
  delta?: number | null;
  floorCharts?: number;
  flat?: boolean;
}

const QUALITY_MIN = 0.1;
const QUALITY_MAX = 4;
const QUALITY_STEP = 0.05;

/**
 * The texture workspace's material browser. It owns search, filtering and the
 * quality tuner so a user can keep tuning material after material without
 * opening a dialog or leaving the workspace.
 */
export function MaterialBrowser({
  materials,
  selectedMaterial,
  onSelectMaterial,
  onToggleMaterial,
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
}: {
  materials: readonly StudioMaterial[];
  selectedMaterial: string | null;
  onSelectMaterial: (id: string | null) => void;
  onToggleMaterial: (id: string) => void;
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
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MaterialFilter>('all');
  const [sort, setSort] = useState<'default' | 'pixels' | 'name'>('default');
  const selected = materials.find((material) => material.id === selectedMaterial) ?? null;
  const normalized = query.trim().toLowerCase();

  const rows = useMemo(() => {
    const list = materials.filter((material) => {
      if (filter === 'included' && !material.included) return false;
      if (filter === 'excluded' && material.included) return false;
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
  const presets = mode === 'budget' ? [0.5, 1, 1.5, 2] : [0.5, 1, 2, 4];
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
            <span>
              {selected.quality.toFixed(2)}
              {qualityUnit}
            </span>
          </div>
          <input
            type="range"
            min={QUALITY_MIN}
            max={QUALITY_MAX}
            step={QUALITY_STEP}
            value={Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, selected.quality))}
            disabled={disabled || !selected.included}
            aria-label={`${selected.name} ${qualityLabel}`}
            onChange={(event) => onWeight(selected.id, Number(event.target.value))}
          />
          <div className="texture-quality-actions">
            {presets.map((value) => (
              <button
                type="button"
                key={value}
                disabled={disabled || !selected.included}
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
          <div className="texture-quality-actions footer">
            <button type="button" disabled={disabled} onClick={onResetAllWeights}>
              全部恢复默认
            </button>
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
            included: material.included,
            weight: material.weight,
            selected: material.id === selectedMaterial,
            ...(material.status ? { status: material.status } : {}),
            ...(material.limited ? { limited: true } : {}),
          }))}
          disabled={disabled}
          showWeight={false}
          onToggle={onToggleMaterial}
          onSelect={(id) => onSelectMaterial(id === selectedMaterial ? null : id)}
          onWeight={onWeight}
        />
      ) : (
        <p className="workspace-empty">
          {materials.length ? '没有匹配的材质。' : '当前模型没有材质。'}
        </p>
      )}

      <details className="texture-algorithm">
        <summary>分配算法：{mode === 'budget' ? '纹理预算' : '旧版算法'}</summary>
        <div className="texture-studio-mode" role="group" aria-label="纹理分配模式">
          <button
            type="button"
            className={mode === 'legacy' ? 'active' : ''}
            disabled={disabled}
            onClick={() => onMode('legacy')}
          >
            旧版算法
          </button>
          <button
            type="button"
            className={mode === 'budget' ? 'active' : ''}
            disabled={disabled}
            onClick={() => onMode('budget')}
          >
            纹理预算
          </button>
        </div>
        {mode === 'budget' && (
          <div className="texture-studio-target" role="group" aria-label="预算目标">
            <button
              type="button"
              className={target === 'density' ? 'active' : ''}
              disabled={disabled}
              onClick={() => onTarget('density')}
              title="按表面积分配像素，适合整体轮廓"
            >
              密度
            </button>
            <button
              type="button"
              className={target === 'retention' ? 'active' : ''}
              disabled={disabled}
              onClick={() => onTarget('retention')}
              title="按原始 UV 细节分配像素，适合脸部与小装饰"
            >
              细节保留
            </button>
          </div>
        )}
        {previewNote && <p className="texture-studio-note">{previewNote}</p>}
      </details>
    </div>
  );
}
