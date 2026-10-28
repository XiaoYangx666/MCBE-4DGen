import { useState } from "react";
import type { TextureMaterialUsage } from "../../src/api-types";
import type { Result, Session } from "./types";
import { ConversionSummary } from "../shared/ConversionSummary";
import { Dialog } from "../shared/Dialog";
import { AtlasInspector } from "../shared/AtlasInspector";

export function OutputPanels({
  result,
  stale,
  session,
  selected,
  onSelect,
}: {
  result: Result | null;
  stale: boolean;
  session: Session | null;
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const [atlasOpen, setAtlasOpen] = useState(false);
  const texture = result?.details?.texture;
  const total =
    (texture?.atlas?.width ?? 128) * (texture?.atlas?.height ?? 128);
  const measurements = new Map<string, TextureMaterialUsage>(
    (texture?.materials ?? []).map((measurement) => [
      measurement.name,
      measurement,
    ]),
  );
  const materials = (session?.materials ?? [])
    .map((m) => ({
      ...m,
      measurement: measurements.get(m.name),
      excluded: result?.excluded.includes(m.name),
    }))
    .sort(
      (a, b) => (b.measurement?.pixels ?? 0) - (a.measurement?.pixels ?? 0),
    );
  const atlasRegions = (texture?.regions ?? []).map((region) => ({
    id: String(region.id),
    material: region.material,
    materials: region.materials,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    contentPixels: region.width * region.height,
    source: `${region.resized.width}×${region.resized.height}`,
  }));
  const atlasMaterials = (texture?.materials ?? []).map((measurement) => ({
    name: measurement.name,
    allocated: atlasRegions
      .filter((region) => region.materials.includes(measurement.name))
      .reduce((sum, region) => sum + region.contentPixels, 0),
    used: measurement.pixels,
    uv: measurement.uvPixels ?? null,
    weight: texture?.materialWeights?.[measurement.name],
  }));
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
              <button
                type="button"
                className="text-button"
                onClick={() => setAtlasOpen(true)}
              >
                分区查看
              </button>
            </div>
          </div>
        ) : (
          <div className="panel-empty">转换后查看实际图集</div>
        )}
      </section>
      <section className="report-panel">
        {result ? (
          <ConversionSummary
            triangles={result.report.triangles ?? 0}
            removedMaterials={result.excluded.length}
            stale={stale}
            timing={`${
              result.cached
                ? "复用上次结果；原转换用时"
                : result.textureOnly
                  ? "复用模型，纹理更新用时"
                  : "完整生成用时"
            } ${((result.conversionMs ?? 0) / 1000).toFixed(1)} 秒`}
            atlas={result.details?.texture?.atlas}
            notice={
              <>
                {stale && (
                  <p className="inline-note">
                    以下为上次转换结果，重新转换后更新。
                  </p>
                )}
                {!texture?.materials?.length && (
                  <p className="inline-note">
                    重新转换后可查看按材质统计的像素覆盖。
                  </p>
                )}
              </>
            }
            materials={materials.map((m) => ({
              name: m.name,
              pixels: m.measurement?.pixels ?? null,
              excluded: m.excluded,
            }))}
            totalPixels={total}
            selectedMaterial={selected}
            onSelectMaterial={onSelect}
          >
            <details>
              <summary>图集区域与尺寸明细</summary>
              <p>共享区域列出全部材质。面积指图集矩形，不等同于可见像素。</p>
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
                      (a, b) => b.width * b.height - a.width * a.height,
                    )
                    .map((region) => (
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
          </ConversionSummary>
        ) : (
          <>
            <div className="panel-title">
              转换报告 <span>REPORT</span>
            </div>
            <div className="panel-empty">绑定、减面和校验结果将在这里显示</div>
          </>
        )}
      </section>

      {atlasOpen && result && atlasRegions.length > 0 ? (
        <Dialog
          title="贴图分区"
          label="贴图分区"
          className="atlas-inspector-dialog"
          closeLabel="关闭贴图分区"
          onClose={() => setAtlasOpen(false)}
        >
          <AtlasInspector
            src={`/api/job/${result.id}/texture`}
            size={texture?.atlas?.width ?? 128}
            regions={atlasRegions}
            materials={atlasMaterials}
          />
        </Dialog>
      ) : null}
    </div>
  );
}
