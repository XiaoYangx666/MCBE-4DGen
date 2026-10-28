import { useMemo } from "react";
import type { MaterialRow, Session, Result } from "./types";
import {
  TextureStudio,
  type StudioMaterial,
  type StudioPart,
  type TextureMode,
  type TextureTarget,
} from "../shared/TextureStudio";

/**
 * Desktop material + part controls. All state keys are stable material/part
 * ids, so duplicate display names stay independent.
 */
export function MaterialPanel({
  session,
  busy,
  excluded,
  setExcluded,
  selected,
  setSelected,
  solo,
  setSolo,
  mode,
  setMode,
  materialWeights,
  setMaterialWeights,
  changed,
  result,
  stale,
  convert,
  includedParts,
  setIncludedParts,
  textureMode,
  setTextureMode,
  textureTarget,
  setTextureTarget,
  selectedPart,
  setSelectedPart,
  showKeptParts,
  setShowKeptParts,
  materialDeltas,
}: {
  session: Session | null;
  result: Result | null;
  stale: boolean;
  convert: () => void;
  busy: boolean;
  excluded: string[];
  setExcluded: (update: (items: string[]) => string[]) => void;
  selected: string;
  setSelected: (key: string) => void;
  solo: string | null;
  setSolo: (update: (value: string | null) => string | null) => void;
  mode: string;
  setMode: (update: (mode: string) => string) => void;
  materialWeights: Record<string, number>;
  setMaterialWeights: (
    update: (weights: Record<string, number>) => Record<string, number>,
  ) => void;
  changed: () => void;
  includedParts: ReadonlySet<string>;
  setIncludedParts: (update: (parts: Set<string>) => Set<string>) => void;
  textureMode: TextureMode;
  setTextureMode: (mode: TextureMode) => void;
  textureTarget: TextureTarget;
  setTextureTarget: (target: TextureTarget) => void;
  selectedPart: string | null;
  setSelectedPart: (part: string | null) => void;
  showKeptParts: boolean;
  setShowKeptParts: (value: boolean) => void;
  materialDeltas: Map<string, number>;
}) {
  const materials: MaterialRow[] = session?.materials ?? [];
  const parts = session?.parts ?? [];
  const labels = useMemo(() => {
    const totals = new Map<string, number>();
    for (const material of materials)
      totals.set(material.name, (totals.get(material.name) ?? 0) + 1);
    const seen = new Map<string, number>();
    const map = new Map<string, string>();
    for (const material of materials) {
      if ((totals.get(material.name) ?? 1) <= 1) {
        map.set(material.key, material.name || "未命名");
        continue;
      }
      const index = (seen.get(material.name) ?? 0) + 1;
      seen.set(material.name, index);
      map.set(material.key, `${material.name || "未命名"} #${index}`);
    }
    return map;
  }, [materials]);
  const measurements = new Map(
    (result?.details?.texture?.materials ?? []).map((material) => [
      material.key ?? material.name,
      material,
    ]),
  );
  const materialParts = new Map<string, string[]>();
  for (const part of parts) {
    const list = materialParts.get(part.materialKey) ?? [];
    list.push(part.name);
    materialParts.set(part.materialKey, list);
  }
  const studioParts: StudioPart[] = parts.map((part) => ({
    id: part.id,
    name: part.name,
    group: part.mesh?.trim() || part.node?.trim() || "模型结构",
    meta: `${part.triangles.toLocaleString("zh-CN")} 面 · ${labels.get(part.materialKey) ?? part.materialName}`,
    materials: [labels.get(part.materialKey) ?? part.materialName],
    materialKey: part.materialKey,
    sharedWith: (materialParts.get(part.materialKey) ?? []).filter(
      (name) => name !== part.name,
    ),
  }));
  const studioMaterials: StudioMaterial[] = materials.map((material) => {
    const measurement = measurements.get(material.key);
    const related = parts.filter((part) => part.materialKey === material.key);
    const kept = related.filter((part) => includedParts.has(part.id)).length;
    const partText = related.length
      ? kept === related.length
        ? ` · ${related.length} 部件`
        : ` · 保留 ${kept}/${related.length} 部件`
      : "";
    const pixels = measurement?.pixels ?? null;
    return {
      id: material.key,
      name: labels.get(material.key) ?? material.name || "未命名",
      meta: `${material.triangles.toLocaleString("zh-CN")} 面${partText}${
        material.alpha < 1 ? ` · α ${material.alpha}` : ""
      }${related.length > 0 && kept === 0 ? " · 无保留部件" : ""}`,
      included: !excluded.includes(material.key),
      weight: materialWeights[material.key] ?? 1,
      quality: materialWeights[material.key] ?? 1,
      selected: selected === material.key,
      lastPixels: pixels,
      deltaPixels: materialDeltas.get(material.key) ?? null,
      floorCharts: measurement?.floorCharts ?? 0,
      limited: (measurement?.floorCharts ?? 0) > 0,
      ...(pixels !== null
        ? {
            status: `${pixels.toLocaleString("zh-CN")} px${
              (measurement?.floorCharts ?? 0) > 0 ? " · 触底" : ""
            }`,
          }
        : {}),
    };
  });
  const weightSum = studioMaterials
    .filter((material) => material.included)
    .reduce((sum, material) => sum + material.quality, 0);

  function adjust(key: string, value: number) {
    setMaterialWeights((weights) => ({
      ...weights,
      [key]: Math.max(0, Math.min(20, Math.round(value * 10000) / 10000)),
    }));
    changed();
  }

  return (
    <>
      <div className="section-label">
        01 / 纹理与部件 <span>{parts.length || materials.length}</span>
      </div>
      {session ? (
        <TextureStudio
          mode={textureMode}
          target={textureTarget}
          onMode={(next) => {
            setTextureMode(next);
            changed();
          }}
          onTarget={(next) => {
            setTextureTarget(next);
            changed();
          }}
          materials={studioMaterials}
          selectedMaterial={selected || null}
          onSelectMaterial={(key) => {
            setSelected(key ?? "");
            setMode(() => "pose");
          }}
          onToggleMaterial={(key) => {
            setExcluded((items) =>
              items.includes(key)
                ? items.filter((item) => item !== key)
                : [...items, key],
            );
            if (excluded.includes(key) && solo === key) setSolo(() => null);
            changed();
          }}
          onWeight={adjust}
          onResetWeight={(key) => {
            setMaterialWeights((weights) => {
              const next = { ...weights };
              delete next[key];
              return next;
            });
            changed();
          }}
          onResetAllWeights={() => {
            setMaterialWeights(() => ({}));
            changed();
          }}
          parts={studioParts}
          includedParts={includedParts}
          onTogglePart={(id) => {
            setIncludedParts((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
            if (selectedPart === id) setSelectedPart(null);
            changed();
          }}
          onSetParts={(ids) => {
            setIncludedParts(() => new Set(ids));
            if (selectedPart && !ids.includes(selectedPart)) setSelectedPart(null);
            changed();
          }}
          selectedPart={selectedPart}
          onSelectPart={setSelectedPart}
          showKeptOnly={showKeptParts}
          onShowKeptOnly={(value) => {
            setShowKeptParts(value);
            changed();
          }}
          disabled={busy}
          note={
            result?.details?.texture?.allocation
              ? `上次转换：${
                  result.details.texture.allocation === "texel-density"
                    ? "预算·密度"
                    : result.details.texture.allocation === "texel-retention"
                      ? "预算·细节保留"
                      : "旧版算法"
                }`
              : undefined
          }
        />
      ) : (
        <div className="empty-list">从模型管理打开模型后检查材质与部件</div>
      )}
      {session && (
        <div className="material-actions">
          {solo && (
            <button type="button" className="text-button" onClick={() => setSolo(() => null)}>
              显示全部材质
            </button>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy || !Object.keys(materialWeights).length}
            onClick={() => {
              setMaterialWeights(() => ({}));
              changed();
            }}
          >
            重置全部权重
          </button>
          <span className="material-caption">
            权重占比{" "}
            {weightSum
              ? (
                  ((studioMaterials.find((material) => material.selected)?.quality ?? 1) /
                    weightSum) *
                  100
                ).toFixed(1)
              : "0.0"}
            %（仅供参考，不是最终像素占比）
          </span>
        </div>
      )}
      <button
        className="tuner-apply"
        disabled={busy || !stale}
        onClick={convert}
      >
        {busy ? "更新中…" : stale ? "生成4D皮肤 · 查看调整" : "结果已是最新"}
      </button>
    </>
  );
}
