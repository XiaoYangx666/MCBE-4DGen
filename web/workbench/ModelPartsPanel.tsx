import { useMemo } from "react";
import { MaterialList } from "../shared/MaterialList";
import { PartBrowser } from "../shared/PartBrowser";
import type { StudioPart } from "../shared/texture-types";
import type { Session } from "./types";

/**
 * Model workspace left panel: part filtering/selection/deletion plus a compact
 * material include list. Texture quality and atlas diagnostics deliberately do
 * not live here.
 */
export function ModelPartsPanel({
  session,
  includedParts,
  setIncludedParts,
  selectedPart,
  setSelectedPart,
  showKeptParts,
  setShowKeptParts,
  excluded,
  setExcluded,
  selected,
  setSelected,
  busy,
  changed,
}: {
  session: Session | null;
  includedParts: ReadonlySet<string>;
  setIncludedParts: (update: (parts: Set<string>) => Set<string>) => void;
  selectedPart: string | null;
  setSelectedPart: (part: string | null) => void;
  showKeptParts: boolean;
  setShowKeptParts: (value: boolean) => void;
  excluded: string[];
  setExcluded: (update: (items: string[]) => string[]) => void;
  selected: string;
  setSelected: (key: string) => void;
  busy: boolean;
  changed: () => void;
}) {
  const materials = session?.materials ?? [];
  const parts = session?.parts ?? [];
  const studioParts = useMemo<StudioPart[]>(() => {
    const byMaterial = new Map<string, string[]>();
    for (const part of parts) {
      const list = byMaterial.get(part.materialKey) ?? [];
      list.push(part.name);
      byMaterial.set(part.materialKey, list);
    }
    return parts.map((part) => ({
      id: part.id,
      name: part.name,
      group: part.mesh?.trim() || part.node?.trim() || "模型结构",
      meta: `${part.triangles.toLocaleString("zh-CN")} 面 · ${
        part.materialName || "未命名材质"
      }`,
      materials: [part.materialName || "未命名材质"],
      materialKey: part.materialKey,
      sharedWith: (byMaterial.get(part.materialKey) ?? []).filter(
        (name) => name !== part.name,
      ),
    }));
  }, [parts]);
  const items = materials.map((material) => ({
    id: material.key,
    name: material.label ?? (material.name || "未命名"),
    meta: `${material.triangles.toLocaleString("zh-CN")} 面`,
    included: !excluded.includes(material.key),
    weight: 1,
    selected: material.key === selected,
  }));

  if (!session) {
    return <div className="empty-list">从模型管理打开模型后检查部件与材质</div>;
  }

  return (
    <div className="model-parts-panel">
      <div className="section-label">
        01 / 模型部件 <span>{parts.length || materials.length}</span>
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
        showKeptOnly={showKeptParts}
        onShowKeptOnly={(value) => {
          setShowKeptParts(value);
          changed();
        }}
        disabled={busy}
        title="模型部件"
      />
      <div className="model-material-include">
        <div className="texture-studio-section-title static">
          <span>参与转换的材质</span>
          <small>
            {materials.filter((material) => !excluded.includes(material.key)).length}/
            {materials.length}
          </small>
        </div>
        <MaterialList
          items={items}
          disabled={busy}
          showWeight={false}
          onToggle={(key) => {
            setExcluded((current) =>
              current.includes(key)
                ? current.filter((item) => item !== key)
                : [...current, key],
            );
            changed();
          }}
          onSelect={(key) => setSelected(key)}
          onWeight={() => {}}
        />
        <p className="help">
          清晰度权重、图集诊断与连续微调在「纹理」工作区。
        </p>
      </div>
    </div>
  );
}
