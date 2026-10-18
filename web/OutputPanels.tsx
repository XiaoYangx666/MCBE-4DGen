import type { Result } from "./types";

export function OutputPanels({
  result,
  stale,
}: {
  result: Result | null;
  stale: boolean;
}) {
  return (
    <div className="bottom-panels">
      <section className="atlas-panel">
        <div className="panel-title">
          纹理图集 <span>ATLAS</span>
        </div>
        {result ? (
          <div className="atlas-body">
            <img
              src={`/api/job/${result.id}/texture`}
              alt="最终 128×128 纹理图集"
            />
            <div>
              <strong>128 × 128</strong>
              <p>最终输出纹理</p>
              <small>
                放大检查像素分配。
                <br />
                矩形占用率不代表视觉质量。
              </small>
              <a href={`/api/job/${result.id}/texture`} download="skin0.png">
                下载贴图 ↗
              </a>
            </div>
          </div>
        ) : (
          <div className="panel-empty">转换后查看实际图集</div>
        )}
      </section>
      <section className="report-panel">
        <div className="panel-title">
          转换报告 <span>REPORT</span>
        </div>
        {result ? (
          <>
            <div className="metric">
              <strong>{result.report.triangles?.toLocaleString()}</strong>
              <span>输出三角面</span>
            </div>
            <p>
              已移除 {result.excluded.length} 个材质 ·{" "}
              {stale ? "参数已修改，请重新转换" : "结果与本次参数一致"}
            </p>
            <p>
              {result.cached ? "复用上次结果；原转换用时" : "转换用时"}{" "}
              {((result.conversionMs ?? 0) / 1000).toFixed(1)} 秒
            </p>
            {result.details?.texture?.atlas && (
              <p>
                包间空白{" "}
                {(
                  (1 - result.details.texture.atlas.allocatedUtilization) *
                  100
                ).toFixed(1)}
                % · 实际非透明 UV 覆盖{" "}
                {(
                  (result.details.texture.atlas.sampledUtilization ?? 0) * 100
                ).toFixed(1)}
                %
              </p>
            )}
            <details>
              <summary>各区域实际像素分配</summary>
              <p>
                共享区域列出全部材质。面积指图集矩形，不等同于可见像素。
              </p>
              <table className="budget-table">
                <thead>
                  <tr>
                    <th>材质</th>
                    <th>尺寸</th>
                    <th>像素 / 占比</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.details?.texture?.regions ?? [])
                    .slice()
                    .sort(
                      (a: any, b: any) =>
                        b.width * b.height - a.width * a.height,
                    )
                    .map((region: any) => (
                      <tr key={region.id}>
                        <td>{region.material}</td>
                        <td>
                          {region.width}×{region.height}
                        </td>
                        <td>
                          {region.width * region.height} /{" "}
                          {(
                            ((region.width * region.height) / 16384) *
                            100
                          ).toFixed(1)}
                          %
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
            <details>
              <summary>详细报告与警告</summary>
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </details>
          </>
        ) : (
          <div className="panel-empty">绑定、减面和校验结果将在这里显示</div>
        )}
      </section>
    </div>
  );
}
