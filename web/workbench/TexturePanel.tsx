import { useMemo } from "react";
import { MaterialBrowser, type MaterialPixelInfo } from "../shared/MaterialBrowser";
import type {
  StudioMaterial,
  TextureMode,
  TextureTarget,
} from "../shared/texture-types";
import type { Result, Session } from "./types";

/**
 * Texture workspace left panel: material search, filtering, selection and the
 * quality tuner stay visible while the preview and atlas update.
 */
export function TexturePanel({
  session,
  result,
  stale,
  previewBusy,
  selected,
  setSelected,
  materialWeights,
  setMaterialWeights,
  changed,
  busy,
  textureMode,
  setTextureMode,
  textureTarget,
  setTextureTarget,
  includedParts,
  materialDeltas,
}: {
  session: Session | null;
  result: Result | null;
  stale: boolean;
  previewBusy: boolean;
  selected: string;
  setSelected: (key: string) => void;
  materialWeights: Record<string, number>;
  setMaterialWeights: (
    update: (weights: Record<string, number>) => Record<string, number>,
  ) => void;
  changed: () => void;
  busy: boolean;
  textureMode: TextureMode;
  setTextureMode: (mode: TextureMode) => void;
  textureTarget: TextureTarget;
  setTextureTarget: (target: TextureTarget) => void;
  includedParts: ReadonlySet<string>;
  materialDeltas: Map<string, number>;
}) {
  const materials = session?.materials ?? [];
  const parts = session?.parts ?? [];
  const labels = useMemo(() => {
    const totals = new Map<string, number>();
    for (const material of materials)
      totals.set(material.name, (totals.get(material.name) ?? 0) + 1);
    const seen = new Map<string, number>();
    const map = new Map<string, string>();
    for (const material of materials) {
      if (material.label) {
        map.set(material.key, material.label);
        continue;
      }
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
  const atlas = result?.details?.texture?.atlas ?? null;
  const atlasPixels = atlas ? atlas.width * atlas.height : 0;
  const studioMaterials: StudioMaterial[] = materials.map((material) => {
    const measurement = measurements.get(material.key);
    const related = parts.filter((part) => part.materialKey === material.key);
    const kept = related.filter((part) => includedParts.has(part.id)).length;
    const partText = related.length
      ? kept === related.length
        ? ` · ${related.length} 部件`
        : ` · 保留 ${kept}/${related.length} 部件`
      : "";
    const pixels = measurement?.rectPixels ?? measurement?.pixels ?? null;
    return {
      id: material.key,
      name: labels.get(material.key) ?? (material.name || "未命名"),
      meta: `${material.triangles.toLocaleString("zh-CN")} 面${partText}${
        material.alpha < 1 ? ` · α ${material.alpha}` : ""
      }${related.length > 0 && kept === 0 ? " · 无保留部件" : ""}${
        (measurement?.floorCharts ?? 0) > 0 ? " · 已到最小" : ""
      }`,
      thumbnail: material.thumbnail ?? null,
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
              atlasPixels > 0 ? ` · ${((pixels / atlasPixels) * 100).toFixed(1)}%` : ""
            }`,
          }
        : {}),
    };
  });
  const resultWeights = result?.details?.texture?.materialWeights ?? {};

  function pixelInfo(material: StudioMaterial): MaterialPixelInfo {
    if (material.lastPixels == null) return { pixels: null, state: "none" };
    if (result && !stale) {
      return {
        pixels: material.lastPixels,
        state: "actual",
        delta: material.deltaPixels ?? null,
        floorCharts: material.floorCharts ?? 0,
        flat: material.flat === true,
      };
    }
    const previous = resultWeights[material.id] ?? 1;
    const current = materialWeights[material.id] ?? 1;
    const ratio = previous > 0 ? current / previous : 1;
    return {
      pixels: Math.max(0, Math.round(material.lastPixels * Math.max(0.05, ratio))),
      state: previewBusy ? "pending" : "estimate",
      delta: material.deltaPixels ?? null,
      floorCharts: material.floorCharts ?? 0,
      flat: material.flat === true,
    };
  }

  if (!session) {
    return <div className="empty-list">从模型管理打开模型后调整材质清晰度</div>;
  }

  return (
    <div className="texture-panel">
      <MaterialBrowser
        materials={studioMaterials}
        selectedMaterial={selected || null}
        onSelectMaterial={(key) => setSelected(key ?? "")}
        onWeight={(key, value) => {
          setMaterialWeights((weights) => ({
            ...weights,
            [key]: Math.max(0, Math.min(20, Math.round(value * 10000) / 10000)),
          }));
          changed();
        }}
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
        disabled={busy}
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
        pixelInfo={pixelInfo}
        previewState={previewBusy ? "running" : stale ? "stale" : "idle"}
        previewNote={
          result
            ? `上次转换：${
                result.details?.texture?.allocation === "texel-density"
                  ? "预算·密度"
                  : result.details?.texture?.allocation === "texel-retention"
                    ? "预算·细节保留"
                    : "旧版算法"
              }${result.preview ? " · 预览" : ""}`
            : undefined
        }
        atlas={atlas}
      />
    </div>
  );
}
