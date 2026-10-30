import type { Result } from './types';

/**
 * Collapsed per-material statistics for the texture inspector. It sits at the
 * very bottom of the column so it never pushes the atlas or the donut around.
 */
export function AtlasDetails({ result }: { result: Result | null }) {
  const materials = result?.details?.texture?.materials ?? [];
  if (!materials.length) return null;
  return (
    <details className="atlas-inspector-advanced texture-details">
      <summary>详细统计</summary>
      <table>
        <thead>
          <tr>
            <th>材质</th>
            <th>分配</th>
            <th>三角采样</th>
            <th>共享</th>
            <th>内容未用</th>
            <th>限制</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((material) => (
            <tr key={material.key ?? material.name}>
              <td>{material.name}</td>
              <td>
                {(material.rectPixels ?? material.pixels).toLocaleString('zh-CN')} px
              </td>
              <td>{(material.uvPixels ?? material.pixels).toLocaleString('zh-CN')} px</td>
              <td>{(material.sharedPixels ?? 0).toLocaleString('zh-CN')} px</td>
              <td>{(material.wastePixels ?? 0).toLocaleString('zh-CN')} px</td>
              <td>
                {(material.floorCharts ?? 0) > 0
                  ? `已到最小 ×${material.floorCharts}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
