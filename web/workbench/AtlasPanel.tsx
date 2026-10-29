import { useMemo } from "react";
import { AtlasInspector } from "../shared/AtlasInspector";
import type { AtlasInspectorMaterial } from "../shared/AtlasInspector";
import type { Result, Session } from "./types";

/**
 * Inline atlas panel for the texture workspace and the export workspace. It is
 * never a blocking dialog, so zooming/panning and material selection stay part
 * of the same editing flow.
 */
export function AtlasPanel({
  result,
  session,
  selected,
  onSelect,
  onSelectCandidates,
  previewBusy,
  showList = true,
}: {
  result: Result | null;
  session: Session | null;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onSelectCandidates?: (keys: readonly string[]) => void;
  previewBusy?: boolean;
  showList?: boolean;
}) {
  const texture = result?.details?.texture;
  const materialByKey = useMemo(
    () => new Map((session?.materials ?? []).map((material) => [material.key, material])),
    [session],
  );
  const regions = useMemo(
    () =>
      (texture?.regions ?? []).map((region) => ({
        id: String(region.id),
        material: region.material,
        ...(region.materialKey ? { materialKey: region.materialKey } : {}),
        ...(region.materialKeys ? { materialKeys: region.materialKeys } : {}),
        ...(region.materials ? { materials: region.materials } : {}),
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        contentPixels: region.width * region.height,
        shared: (region.materialKeys?.length ?? 0) > 1,
        source: `${region.resized.width}×${region.resized.height}`,
      })),
    [texture],
  );
  const materials = useMemo<AtlasInspectorMaterial[]>(
    () =>
      (texture?.materials ?? []).map((measurement) => {
        const key = measurement.key ?? measurement.name;
        return {
          id: key,
          name: materialByKey.get(key)?.label ?? measurement.name,
          allocated: measurement.rectPixels ?? measurement.pixels,
          used: measurement.pixels,
          uv: measurement.uvPixels ?? null,
          shared: measurement.sharedPixels ?? null,
          weight: texture?.materialWeights?.[key],
          floorCharts: measurement.floorCharts,
          rectPixels: measurement.rectPixels,
          wastePixels: measurement.wastePixels,
          mode:
            texture?.allocation === "texel-density" ||
            texture?.allocation === "texel-retention"
              ? "budget"
              : "legacy",
        };
      }),
    [texture, regions, materialByKey],
  );

  if (!result) {
    return (
      <div className="workspace-empty">
        {previewBusy
          ? "正在生成第一张图集预览…"
          : "进入纹理工作区后会自动生成图集；也可以先在模型工作区转换。"}
      </div>
    );
  }

  return (
    <AtlasInspector
      src={`/api/job/${result.id}/texture`}
      size={texture?.atlas?.width ?? 128}
      regions={regions}
      materials={materials}
      {...(texture?.atlas ? { summary: texture.atlas } : {})}
      selected={selected}
      onSelect={onSelect}
      {...(onSelectCandidates ? { onSelectCandidates } : {})}
      variant="panel"
      showList={showList}
    />
  );
}
