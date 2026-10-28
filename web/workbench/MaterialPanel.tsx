import { useState } from "react";
import type { MaterialRow, Session, Result } from "./types";
import { MaterialList, type MaterialListItem } from "../shared/MaterialList";

/**
 * Material controls address stable keys, never display names: two materials
 * named "Body" stay independent for exclusion, solo and quality settings.
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
}) {
  const [hideUnchecked, setHideUnchecked] = useState(false);
  const [step, setStep] = useState(0.05);
  const materials: MaterialRow[] = session?.materials ?? [];
  const activeMaterials = materials.filter((m) => !excluded.includes(m.key));
  const weight = (key: string) => materialWeights[key] ?? 1;
  const selectedMaterial = materials.find((m) => m.key === selected);
  function adjust(key: string, value: number) {
    setMaterialWeights((weights) => ({
      ...weights,
      [key]: Math.max(0, Math.min(20, Math.round(value * 10000) / 10000)),
    }));
    changed();
  }
  const coverage = result?.details?.texture?.materials?.find(
    (measurement) => measurement.key === selected ||
      (measurement.name === selectedMaterial?.name &&
        !result?.details?.texture?.materials?.some((entry) => entry.key === selected)),
  );
  const weightSum = activeMaterials.reduce((sum, m) => sum + weight(m.key), 0);

  return (
    <>
      <div className="section-label">
        01 / 材质筛选 <span>{materials.length}</span>
      </div>
      <div className="material-caption">
        权重是像素分配的优先级，不是百分比。1 为默认，0
        保留最低采样；只调整权重时复用模型，仅更新纹理与 UV。
      </div>
      <div className="material-tools">
        <label>
          <input
            type="checkbox"
            checked={hideUnchecked}
            onChange={(e) => setHideUnchecked(e.target.checked)}
          />
          隐藏未勾选项（{excluded.length}）
        </label>
        <button
          disabled={busy || !Object.keys(materialWeights).length}
          onClick={() => {
            setMaterialWeights(() => ({}));
            changed();
          }}
        >
          重置权重
        </button>
      </div>
      {selectedMaterial && (
        <div className="weight-tuner">
          <div>
            <b>{selectedMaterial.name || "未命名"}</b>
            <span>相对权重 {weight(selectedMaterial.key).toFixed(2)}</span>
          </div>
          <input
            aria-label={(selectedMaterial.name || "未命名") + " 权重滑块"}
            type="range"
            min="0"
            max="20"
            step="0.01"
            value={weight(selectedMaterial.key)}
            disabled={busy || excluded.includes(selectedMaterial.key)}
            onChange={(e) => adjust(selectedMaterial.key, Number(e.target.value))}
          />
          <div className="weight-step">
            <button
              disabled={busy || excluded.includes(selectedMaterial.key)}
              onClick={() =>
                adjust(selectedMaterial.key, weight(selectedMaterial.key) - step)
              }
            >
              −
            </button>
            <select
              aria-label="权重微调步长"
              value={step}
              onChange={(e) => setStep(Number(e.target.value))}
            >
              {[0.01, 0.05, 0.1, 0.5, 1].map((v) => (
                <option key={v} value={v}>
                  步长 {v}
                </option>
              ))}
            </select>
            <button
              disabled={busy || excluded.includes(selectedMaterial.key)}
              onClick={() =>
                adjust(selectedMaterial.key, weight(selectedMaterial.key) + step)
              }
            >
              ＋
            </button>
            <button
              disabled={busy || excluded.includes(selectedMaterial.key)}
              onClick={() => adjust(selectedMaterial.key, 1)}
            >
              默认
            </button>
          </div>
          {coverage && (
            <small>
              上次实际覆盖：{coverage.pixels.toLocaleString()} 像素 ·{" "}
              {(
                (coverage.pixels /
                  ((result?.details?.texture?.atlas?.width ?? 128) *
                    (result?.details?.texture?.atlas?.height ?? 128))) *
                100
              ).toFixed(1)}
              %{stale ? "（待更新）" : ""}
            </small>
          )}
          <button
            className="tuner-apply"
            disabled={busy || !stale}
            onClick={convert}
          >
            {busy ? "更新中…" : "生成4D皮肤 · 查看调整"}
          </button>
          <small>
            权重占比{" "}
            {weightSum
              ? ((weight(selectedMaterial.key) / weightSum) * 100).toFixed(1)
              : "0.0"}
            % · 不等于最终像素占比，实际分配还受表面积和共享 UV 影响。
          </small>
        </div>
      )}
      <div className="materials">
        {session ? (
          <MaterialList
            items={materials
              .filter((m) => !hideUnchecked || !excluded.includes(m.key))
              .map((material, index): MaterialListItem => ({
                id: material.key,
                name: material.name || "未命名",
                meta: `${material.triangles.toLocaleString()} 面${
                  material.partIds.length > 1
                    ? ` · ${material.partIds.length} 个部件`
                    : ""
                }${material.alpha < 1 ? ` · α ${material.alpha}` : ""}`,
                color: `hsl(${index * 31},25%,60%)`,
                included: !excluded.includes(material.key),
                weight: Object.hasOwn(materialWeights, material.key)
                  ? materialWeights[material.key]!
                  : 1,
                soloed: solo === material.key,
                selected: selected === material.key,
              }))}
            disabled={busy}
            onToggle={(key) => {
              setExcluded((items) =>
                items.includes(key)
                  ? items.filter((item) => item !== key)
                  : [...items, key],
              );
              changed();
            }}
            onSelect={(key) => {
              setSelected(key);
              setMode(() => "pose");
            }}
            onSolo={(key) => {
              setSolo((current) => (current === key ? null : key));
              setSelected(key);
              setMode(() => "pose");
            }}
            onWeight={(key, value) => {
              setMaterialWeights((weights) => ({ ...weights, [key]: value }));
              changed();
            }}
          />
        ) : (
          <div className="empty-list">从模型管理打开模型后检查材质</div>
        )}
      </div>
      {session?.materials.some((material) => material.name === "表情") && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            const keys = session.materials
              .filter((material) => material.name === "表情")
              .map((material) => material.key);
            setExcluded((items) => Array.from(new Set([...items, ...keys])));
            changed();
          }}
        >
          移除「表情」材质进行对照 →
        </button>
      )}
    </>
  );
}
