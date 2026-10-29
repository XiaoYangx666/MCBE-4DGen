import type { Result, Session } from "./types";
import { ConversionSummary } from "../shared/ConversionSummary";
import { AtlasPanel } from "./AtlasPanel";

/**
 * Result workspace: conversion report, atlas diagnostics and download links.
 * The atlas is inline (no blocking dialog) so users can inspect the exact
 * result without leaving the workspace.
 */
export function OutputPanels({
  result,
  stale,
  session,
  selected,
  onSelect,
  onSelectCandidates,
  previewBusy,
}: {
  result: Result | null;
  stale: boolean;
  session: Session | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onSelectCandidates?: (ids: readonly string[]) => void;
  previewBusy?: boolean;
}) {
  const texture = result?.details?.texture;
  const total =
    (texture?.atlas?.width ?? 128) * (texture?.atlas?.height ?? 128);
  const measurements = new Map(
    (texture?.materials ?? []).map((measurement) => [
      measurement.key ?? measurement.name,
      measurement,
    ]),
  );
  const excludedKeys = new Set(result?.excluded ?? []);
  const materials = (session?.materials ?? [])
    .map((m) => ({
      ...m,
      measurement: measurements.get(m.key),
      excluded: excludedKeys.has(m.key),
    }))
    .sort(
      (a, b) => (b.measurement?.pixels ?? 0) - (a.measurement?.pixels ?? 0),
    );
  return (
    <div className="bottom-panels export-panels">
      <section className="atlas-panel">
        <div className="panel-title">
          纹理图集 <span>ATLAS</span>
        </div>
        {result ? (
          <div className="atlas-body inline">
            <AtlasPanel
              result={result}
              session={session}
              selected={selected}
              onSelect={(key) => onSelect(key ?? "")}
              {...(onSelectCandidates ? { onSelectCandidates } : {})}
              previewBusy={previewBusy}
            />
            <div className="atlas-actions">
              {stale ? (
                <small>结果已过期，重新生成后可下载当前配置的图集与皮肤包。</small>
              ) : (
                <>
                  <a href={`/api/job/${result.id}/texture`} download="skin0.png">
                    下载贴图 ↗
                  </a>
                  {result.preview ? (
                    <small>这是纹理预览；生成最终皮肤包后可下载完整 ZIP。</small>
                  ) : (
                    <a href={`/api/job/${result.id}/download`} download>
                      下载皮肤包 ZIP ↗
                    </a>
                  )}
                </>
              )}
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
                : result.preview
                  ? "纹理预览用时"
                  : result.textureOnly
                    ? "复用模型，纹理更新用时"
                    : "完整生成用时"
            } ${((result.conversionMs ?? 0) / 1000).toFixed(1)} 秒`}
            atlas={result.details?.texture?.atlas}
            notice={
              <>
                {result.preview && (
                  <p className="inline-note">
                    这是纹理预览，尚未打包；在导出工作区生成最终皮肤包。
                  </p>
                )}
                {stale && (
                  <p className="inline-note">
                    以下为上次转换结果，重新生成后更新。
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
              id: m.key,
              name: m.label ?? (m.name || "未命名"),
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
    </div>
  );
}
