export interface MaterialCoverageItem {
  /** Stable material key; falls back to the display name for legacy callers. */
  id?: string;
  name: string;
  /** Measured atlas pixels; null/undefined when not measured yet. */
  pixels?: number | null;
  excluded?: boolean;
}

export interface MaterialCoverageProps {
  materials: readonly MaterialCoverageItem[];
  /** Atlas pixel count used as the percentage base. */
  total: number;
  selected?: string | null;
  onSelect?: (name: string) => void;
}

/**
 * Desktop report's per-material pixel rows, shared with the browser studio.
 * Shared pixels count for every material, so the percentages may overlap.
 */
export function MaterialCoverage({
  materials,
  total,
  selected,
  onSelect,
}: MaterialCoverageProps) {
  if (!materials.length) return null;
  return (
    <div className="material-allocation">
      <h3>材质像素覆盖</h3>
      <p>
        与材质筛选逐项对应，点击选中材质。占比以整张贴图为基准；共享像素会分别计入相关材质，各项不一定合计为
        100%。
      </p>
      {materials.map((material) => {
        const id = material.id ?? material.name;
        const percent = total > 0 && material.pixels != null
          ? (material.pixels / total) * 100
          : 0;
        return (
          <button
            type="button"
            key={id}
            className={'allocation-row' + (selected === id ? ' selected' : '')}
            aria-pressed={selected === id}
            disabled={!onSelect}
            onClick={() => onSelect?.(id)}
          >
            <span className="allocation-label">{material.name}</span>
            <span className="allocation-track">
              <span style={{ width: `${Math.min(100, percent)}%` }} />
            </span>
            <span className="allocation-value">
              {material.excluded
                ? '已移除'
                : material.pixels != null
                  ? `${material.pixels.toLocaleString()} 像素 · ${percent.toFixed(1)}%`
                  : '待统计'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
