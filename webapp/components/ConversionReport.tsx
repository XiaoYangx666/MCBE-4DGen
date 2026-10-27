import { ConversionSummary } from '../../web/shared/ConversionSummary';
import type { ConvertResult } from '../engine/convert';
import { WarningList } from './Common';

export function ConversionReport({
  result,
  warnings,
  stale,
  selectedMaterial,
  onSelectMaterial,
}: {
  result: ConvertResult;
  warnings: string[];
  stale: boolean;
  selectedMaterial?: string | null;
  onSelectMaterial?: (name: string) => void;
}) {
  const report = result.textureReport;
  const size = report.size || 128;
  const area = size * size;
  const removed = result.excludedMaterials ?? [];
  const materials = [...report.materials].sort((a, b) => b.pixels - a.pixels);
  const ratio = result.report.sourceTriangles > 0
    ? `${Math.round((result.report.triangles / result.report.sourceTriangles) * 100)}%`
    : '—';
  const uvCoverage = report.uvUtilization ?? result.textureCoverage;
  return (
    <ConversionSummary
      className="report-panel conversion-report"
      triangles={result.report.triangles}
      removedMaterials={removed.length}
      stale={stale}
      timing={result.elapsedMs !== undefined
        ? `完整生成用时 ${(result.elapsedMs / 1000).toFixed(1)} 秒`
        : undefined}
      atlas={report}
      facts={(
        <>
          源三角面 {result.report.sourceTriangles.toLocaleString('zh-CN')} · 转换后比例 {ratio} · 材质{' '}
          {result.report.materials.length} · 有效 UV 覆盖 {Math.round(uvCoverage * 100)}%
          {result.binding === 'humanoid' ? ' · 六部位人形绑定' : ' · 静态整体绑定'}
        </>
      )}
      materials={[
        ...materials.map((material) => ({ name: material.name, pixels: material.pixels })),
        ...removed.map((name) => ({ name, pixels: null, excluded: true })),
      ]}
      totalPixels={area}
      selectedMaterial={selectedMaterial ?? null}
      onSelectMaterial={onSelectMaterial}
    >
      <WarningList warnings={warnings} />
    </ConversionSummary>
  );
}
