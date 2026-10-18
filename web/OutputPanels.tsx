import type { Result, Session } from "./types";

export function OutputPanels({
  result,
  stale, session, selected, onSelect,
}: {
  result: Result | null;
  stale: boolean;
  session: Session | null;
  selected: string | null;
  onSelect: (name:string) => void;
}) {
  const texture = result?.details?.texture;
  const total = (texture?.atlas?.width ?? 128) * (texture?.atlas?.height ?? 128);
  const measurements = new Map<string, any>((texture?.materials ?? []).map((m:any) => [m.name, m]));
  const materials = (session?.materials ?? []).map(m => ({...m, measurement:measurements.get(m.name), excluded:result?.excluded.includes(m.name)})).sort((a,b) => (b.measurement?.pixels ?? 0) - (a.measurement?.pixels ?? 0));
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
              {result.cached ? "复用上次结果；原转换用时" : result.textureOnly ? "复用模型，纹理更新用时" : "完整生成用时"}{" "}
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
            <div className="material-allocation">
              <h3>材质像素覆盖</h3>
              <p>与材质筛选逐项对应，点击选中材质。占比以整张贴图为基准；共享像素会分别计入相关材质，各项不一定合计为 100%。</p>
              {stale && <p className="inline-note">以下为上次转换结果，重新转换后更新。</p>}
              {!texture?.materials?.length && <p className="inline-note">重新转换后可查看按材质统计的像素覆盖。</p>}
              {materials.map(m => <button key={m.name} className={'allocation-row'+(selected===m.name?' selected':'')} onClick={() => onSelect(m.name)} aria-pressed={selected===m.name}>
                <span className="allocation-label">{m.name}</span><span className="allocation-track"><span style={{width: `${Math.min(100,(m.measurement?.pixels ?? 0)/total*100)}%`}}/></span>
                <span className="allocation-value">{m.excluded ? '已移除' : m.measurement ? `${m.measurement.pixels.toLocaleString()} 像素 · ${(m.measurement.pixels/total*100).toFixed(1)}%` : '待统计'}</span>
              </button>)}
            </div>
            <details>
              <summary>图集区域与尺寸明细</summary>
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
                            ((region.width * region.height) / total) *
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
