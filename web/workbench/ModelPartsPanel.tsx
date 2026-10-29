import { useMemo } from "react";
import { PartBrowser } from "../shared/PartBrowser";
import { partDisplayNames } from "../shared/part-labels";
import type { StudioPart } from "../shared/texture-types";
import type { Session } from "./types";

/**
 * Model workspace left panel: part filtering, selection and deletion. Material
 * retention and quality deliberately live in the texture workspace so the two
 * lists do not look like duplicates.
 */
export function ModelPartsPanel({
  session,
  includedParts,
  setIncludedParts,
  selectedPart,
  setSelectedPart,
  busy,
  changed,
}: {
  session: Session | null;
  includedParts: ReadonlySet<string>;
  setIncludedParts: (update: (parts: Set<string>) => Set<string>) => void;
  selectedPart: string | null;
  setSelectedPart: (part: string | null) => void;
  busy: boolean;
  changed: () => void;
}) {
  const parts = session?.parts ?? [];
  const studioParts = useMemo<StudioPart[]>(() => {
    const byMaterial = new Map<string, string[]>();
    for (const part of parts) {
      const list = byMaterial.get(part.materialKey) ?? [];
      list.push(part.name);
      byMaterial.set(part.materialKey, list);
    }
    const thumbs = new Map(
      (session?.materials ?? []).map((material) => [material.key, material.thumbnail ?? null]),
    );
    const names = partDisplayNames(
      parts.map((part) => ({
        name: part.name,
        node: part.node,
        mesh: part.mesh,
        material: part.materialName,
      })),
    );
    return parts.map((part, index) => ({
      id: part.id,
      name: names[index]!,
      group: part.mesh?.trim() || part.node?.trim() || "模型结构",
      meta: `${part.triangles.toLocaleString("zh-CN")} 面${
        names[index] === (part.materialName || "未命名材质")
          ? ""
          : ` · ${part.materialName || "未命名材质"}`
      }`,      materials: [part.materialName || "未命名材质"],
      thumbnail: thumbs.get(part.materialKey) ?? null,
      materialKey: part.materialKey,
      sharedWith: (byMaterial.get(part.materialKey) ?? []).filter(
        (name) => name !== part.name,
      ),
    }));
  }, [parts, session?.materials]);

  if (!session) {
    return <div className="empty-list">从模型管理打开模型后检查部件</div>;
  }

  return (
    <div className="model-parts-panel">
      <div className="section-label">
        01 / 模型部件 <span>{parts.length}</span>
      </div>
      <PartBrowser
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
        disabled={busy}
      />
    </div>
  );
}
