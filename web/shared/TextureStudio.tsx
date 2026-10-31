import { useEffect, useMemo, useState } from 'react';
import { MaterialList, WeightInput, type MaterialListItem } from './MaterialList';
import {
  formatQuality,
  qualityToSlider,
  sliderToQuality,
} from './texture-scale';

export interface StudioPart {
  id: string;
  name: string;
  /** Structural owner (mesh / node), never a guessed body-part label. */
  group: string;
  meta: string;
  /** Materials this part samples. */
  materials: readonly string[];
  /** Stable material key, when the host has one. */
  materialKey?: string;
  /** Other part names that sample the same material. */
  sharedWith?: readonly string[];
}

export interface StudioMaterial extends MaterialListItem {
  /** Relative texture-density multiplier. */
  quality: number;
  /** Pixels from the last conversion, null before the first result. */
  lastPixels?: number | null;
  /** Change versus the previous conversion of the same model. */
  deltaPixels?: number | null;
  /** Number of UV islands clamped to the technical minimum. */
  floorCharts?: number;
  flat?: boolean;
}

export interface TextureStudioProps {
  materials: readonly StudioMaterial[];
  selectedMaterial: string | null;
  onSelectMaterial: (id: string | null) => void;
  onToggleMaterial: (id: string) => void;
  onWeight: (id: string, value: number) => void;
  onResetWeight: (id: string) => void;
  onResetAllWeights: () => void;
  parts: readonly StudioPart[];
  includedParts: ReadonlySet<string>;
  onTogglePart: (id: string) => void;
  onSetParts: (ids: readonly string[]) => void;
  selectedPart: string | null;
  onSelectPart: (id: string | null) => void;
  /** Hide dropped parts in the preview; true by default in the hosts. */
  showKeptOnly: boolean;
  onShowKeptOnly: (value: boolean) => void;
  disabled?: boolean;
  /** Extra note shown above the controls, e.g. the allocation mode. */
  note?: string;
  className?: string;
}

/** Absolute density steps; 1× restores the untouched budget. */
const PRESETS = [0.5, 1, 2, 4, 10];
/** Slider positions the thumb snaps to, with the exact density they mean. */
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

/** Texture-density controls for the browser model studio. */
export function TextureStudio({
  materials,
  selectedMaterial,
  onSelectMaterial,
  onToggleMaterial,
  onWeight,
  onResetWeight,
  onResetAllWeights,
  parts,
  includedParts,
  onTogglePart,
  onSetParts,
  selectedPart,
  onSelectPart,
  showKeptOnly,
  onShowKeptOnly,
  disabled = false,
  note,
  className,
}: TextureStudioProps) {
  const [partsOpen, setPartsOpen] = useState(true);
  const selected = materials.find((material) => material.id === selectedMaterial) ?? null;
  const groups = useMemo(() => {
    const map = new Map<string, StudioPart[]>();
    for (const part of parts) {
      const list = map.get(part.group) ?? [];
      list.push(part);
      map.set(part.group, list);
    }
    return [...map.entries()];
  }, [parts]);
  const allPartIds = useMemo(() => parts.map((part) => part.id), [parts]);
  /** Dragging only moves a local draft; the host commits on release. */
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => {
    setDraft(null);
  }, [selected?.id, selected?.quality]);

  const sliderValue = draft ?? (selected ? qualityToSlider(selected.quality) : 0);
  const draftQuality =
    draft === null
      ? (selected?.quality ?? 1)
      : (TICKS.find((tick) => tick.slider === draft)?.quality ?? sliderToQuality(draft));

  const commitDraft = () => {
    if (draft === null || !selected) return;
    const tick = TICKS.find((item) => item.slider === draft);
    const value = Math.round((tick ? tick.quality : sliderToQuality(draft)) * 100) / 100;
    setDraft(null);
    if (Math.abs(value - selected.quality) < 0.001) return;
    onWeight(selected.id, value);
  };

  return (
    <div className={`texture-studio${className ? ` ${className}` : ''}`}>
      {note ? <div className="texture-studio-note">{note}</div> : null}

      {parts.length > 0 && (
        <div className="texture-studio-parts">
          <button
            type="button"
            className="texture-studio-section-title"
            aria-expanded={partsOpen}
            onClick={() => setPartsOpen((value) => !value)}
          >
            <span>模型部件</span>
            <small>
              {includedParts.size}/{parts.length} 保留
            </small>
            <i aria-hidden="true">{partsOpen ? '−' : '+'}</i>
          </button>
          {partsOpen && (
            <>
              <div className="texture-studio-actions">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSetParts(allPartIds)}
                >
                  全部保留
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onSetParts(allPartIds.filter((id) => !includedParts.has(id)))
                  }
                >
                  反选
                </button>
                <label className="texture-studio-check">
                  <input
                    type="checkbox"
                    checked={showKeptOnly}
                    disabled={disabled}
                    onChange={(event) => onShowKeptOnly(event.target.checked)}
                  />
                  预览隐藏已删除部件
                </label>
              </div>
              {selectedPart && (
                <p className="texture-studio-preview-note">
                  正在只显示所选部件。
                  <button type="button" onClick={() => onSelectPart(null)}>
                    显示保留结果
                  </button>
                </p>
              )}
              <div className="texture-studio-part-groups">
                {groups.map(([group, list]) => {
                  const groupIds = list.map((part) => part.id);
                  const kept = groupIds.filter((id) => includedParts.has(id)).length;
                  return (
                    <div className="texture-part-group" key={group}>
                      {(list.length > 1 || list[0]!.name !== group) && (
                        <div className="texture-part-group-head">
                          <span title={group}>{group}</span>
                          <small>{kept}/{list.length}</small>
                          <button
                            type="button"
                            disabled={disabled || kept === list.length}
                            onClick={() =>
                              onSetParts([...new Set([...includedParts, ...groupIds])])
                            }
                          >
                            全选
                          </button>
                        </div>
                      )}
                      {list.map((part) => {
                        const included = includedParts.has(part.id);
                        return (
                          <div
                            className={`texture-part-row${selectedPart === part.id ? ' selected' : ''}${included ? '' : ' dropped'}`}
                            key={part.id}
                          >
                            <input
                              type="checkbox"
                              checked={included}
                              disabled={disabled}
                              aria-label={`保留 ${part.name}`}
                              onChange={() => onTogglePart(part.id)}
                            />
                            <button
                              type="button"
                              className="texture-part-name"
                              disabled={disabled || !included}
                              title={included ? `在预览中只显示 ${part.name}` : '部件已删除'}
                              onClick={() =>
                                onSelectPart(selectedPart === part.id ? null : part.id)
                              }
                            >
                              {part.name}
                            </button>
                            <span className="texture-part-meta" title={part.meta}>
                              {part.meta}
                            </span>
                            {part.sharedWith && part.sharedWith.length > 0 && (
                              <span
                                className="texture-part-shared"
                                title={`共享材质：${part.materials.join('、')}`}
                              >
                                共享 ×{part.sharedWith.length + 1}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      <div className="texture-studio-materials">
        <div className="texture-studio-section-title static">
          <span>材质与清晰度</span>
          <small>{materials.length} 项</small>
        </div>
        <MaterialList
          items={materials.map((material) => ({
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
        {selected && (
          <div className="texture-quality-tuner">
            <div className="texture-quality-head">
              <b title={selected.name}>{selected.name}</b>
              <span>{formatQuality(draftQuality)}×</span>
            </div>
            <div className="texture-quality-slider">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={sliderValue}
                disabled={disabled || !selected.included}
                aria-label={`${selected.name} 相对纹理密度`}
                title="0.1–20×；拖动时只调整数值，松手后应用"
                onChange={(event) => setDraft(snapSlider(Number(event.target.value)))}
                onPointerUp={commitDraft}
                onPointerCancel={commitDraft}
                onKeyUp={commitDraft}
                onBlur={commitDraft}
              />
              <div className="texture-quality-ticks" aria-hidden="true">
                {TICKS.map((tick) => (
                  <i key={tick.quality} style={{ left: `${tick.slider}%` }} />
                ))}
              </div>
            </div>
            <div className="texture-quality-actions">
              <WeightInput
                value={draftQuality}
                label={selected.name}
                disabled={disabled || !selected.included}
                title="0.1–20×，可直接输入"
                onCommit={(value) => onWeight(selected.id, value)}
              />
              {PRESETS.map((value) => (
                <button
                  type="button"
                  key={value}
                  className={Math.abs(selected.quality - value) < 0.001 ? 'active' : ''}
                  disabled={disabled || !selected.included}
                  onClick={() => onWeight(selected.id, value)}
                >
                  {formatQuality(value)}×
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
              {selected.lastPixels != null ? (
                <>
                  <span>
                    上次分配 {selected.lastPixels.toLocaleString('zh-CN')} px
                    {selected.flat ? ' · 纯色采样' : ''}
                  </span>
                  {selected.deltaPixels != null && selected.deltaPixels !== 0 && (
                    <em className={selected.deltaPixels > 0 ? 'up' : 'down'}>
                      {selected.deltaPixels > 0 ? '+' : ''}
                      {selected.deltaPixels.toLocaleString('zh-CN')} px
                    </em>
                  )}
                  {selected.floorCharts && selected.floorCharts > 0 ? (
                    <small className="limited">
                      有 {selected.floorCharts} 个 UV 岛已到最小尺寸，继续降低不会更小。
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
      </div>
    </div>
  );
}
