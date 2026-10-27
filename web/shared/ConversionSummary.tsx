import type { ReactNode } from 'react';
import { MaterialCoverage, type MaterialCoverageItem } from './MaterialCoverage.tsx';

export interface ConversionSummaryProps {
  /** Final output triangle count, including backfaces. */
  triangles: number;
  /** Materials excluded before conversion. */
  removedMaterials: number;
  /** Whether the current settings already differ from this result. */
  stale: boolean;
  /** Timing sentence, e.g. "完整生成用时 1.2 秒". */
  timing?: ReactNode;
  /** Atlas utilization, 0..1. Omit when the host has no atlas report. */
  atlas?: {
    allocatedUtilization: number;
    sampledUtilization?: number | null;
    /** Optional; includes transparent texels sampled by UV triangles. */
    uvUtilization?: number | null;
  } | null;
  /** Host-specific facts kept as one sentence after utilization. */
  facts?: ReactNode;
  /** Additional notes shown between the facts and the material rows. */
  notice?: ReactNode;
  materials: readonly MaterialCoverageItem[];
  /** Atlas pixel count used as the percentage base. */
  totalPixels: number;
  selectedMaterial?: string | null;
  onSelectMaterial?: (name: string) => void;
  /** Host-specific sections shown below the shared summary. */
  children?: ReactNode;
  className?: string;
}

/**
 * Conversion report summary shared by the desktop workbench and the browser
 * web app. Each host keeps its own data source and extra report sections.
 */
export function ConversionSummary({
  triangles,
  removedMaterials,
  stale,
  timing,
  atlas,
  facts,
  notice,
  materials,
  totalPixels,
  selectedMaterial,
  onSelectMaterial,
  children,
  className,
}: ConversionSummaryProps) {
  return (
    <div className={`conversion-summary${className ? ` ${className}` : ''}`}>
      <div className="panel-title">转换报告 <span>REPORT</span></div>
      <div className="metric">
        <strong>{triangles.toLocaleString('zh-CN')}</strong>
        <span>输出三角面</span>
      </div>
      <p>
        {removedMaterials ? `已移除 ${removedMaterials} 个材质` : '未移除材质'} ·{' '}
        {stale ? '参数已修改，请重新转换' : '结果与本次参数一致'}
      </p>
      {timing && <p>{timing}</p>}
      {atlas && (
        <p>
          包间空白 {(Math.max(0, 1 - atlas.allocatedUtilization) * 100).toFixed(1)}%
          {atlas.uvUtilization !== undefined && atlas.uvUtilization !== null
            ? ` · 有效 UV 覆盖 ${(atlas.uvUtilization * 100).toFixed(1)}%`
            : ''}
          {' · '}非透明 UV 覆盖 {((atlas.sampledUtilization ?? 0) * 100).toFixed(1)}%
        </p>
      )}
      {facts && <p>{facts}</p>}
      {notice}
      <MaterialCoverage
        materials={materials}
        total={totalPixels}
        {...(selectedMaterial !== undefined ? { selected: selectedMaterial } : {})}
        {...(onSelectMaterial ? { onSelect: onSelectMaterial } : {})}
      />
      {children}
    </div>
  );
}
