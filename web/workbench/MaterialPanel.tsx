import { useEffect, useRef, useState } from "react";
import type { MaterialRow, Session, Result } from "./types";

function MaterialWeightInput({
  name,
  value,
  disabled,
  onCommit,
}: {
  name: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const cancelCommit = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    if (cancelCommit.current) {
      cancelCommit.current = false;
      setDraft(String(value));
      return;
    }
    const parsed = Number(draft);
    if (
      draft.trim() !== "" &&
      Number.isFinite(parsed) &&
      parsed >= 0 &&
      parsed <= 20
    ) {
      onCommit(parsed);
      setDraft(String(parsed));
    } else {
      setDraft(String(value));
    }
  }

  return (
    <input
      className="material-weight"
      type="number"
      min={0}
      max={20}
      step={0.05}
      inputMode="decimal"
      aria-label={name + " 像素权重"}
      title="相对像素权重，默认 1；0 表示最低像素预算，材质仍会保留"
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelCommit.current = true;
          setDraft(String(value));
          e.currentTarget.blur();
        }
      }}
    />
  );
}

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
  setSelected: (name: string) => void;
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
  const activeMaterials = materials.filter((m) => !excluded.includes(m.name));
  const weight = (name: string) => materialWeights[name] ?? 1;
  const selectedMaterial = materials.find((m) => m.name === selected);
  function adjust(name: string, value: number) {
    setMaterialWeights((weights) => ({
      ...weights,
      [name]: Math.max(0, Math.min(20, Math.round(value * 10000) / 10000)),
    }));
    changed();
  }
  const coverage = result?.details?.texture?.materials?.find(
    (measurement) => measurement.name === selected,
  );
  const weightSum = activeMaterials.reduce((sum, m) => sum + weight(m.name), 0);

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
            <b>{selectedMaterial.name}</b>
            <span>相对权重 {weight(selectedMaterial.name).toFixed(2)}</span>
          </div>
          <input
            aria-label={selectedMaterial.name + " 权重滑块"}
            type="range"
            min="0"
            max="20"
            step="0.01"
            value={weight(selectedMaterial.name)}
            disabled={busy || excluded.includes(selectedMaterial.name)}
            onChange={(e) =>
              adjust(selectedMaterial.name, Number(e.target.value))
            }
          />
          <div className="weight-step">
            <button
              disabled={busy || excluded.includes(selectedMaterial.name)}
              onClick={() =>
                adjust(
                  selectedMaterial.name,
                  weight(selectedMaterial.name) - step,
                )
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
              disabled={busy || excluded.includes(selectedMaterial.name)}
              onClick={() =>
                adjust(
                  selectedMaterial.name,
                  weight(selectedMaterial.name) + step,
                )
              }
            >
              ＋
            </button>
            <button
              disabled={busy || excluded.includes(selectedMaterial.name)}
              onClick={() => adjust(selectedMaterial.name, 1)}
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
              ? ((weight(selectedMaterial.name) / weightSum) * 100).toFixed(1)
              : "0.0"}
            % · 不等于最终像素占比，实际分配还受表面积和共享 UV 影响。
          </small>
        </div>
      )}
      <div className="materials">
        {session ? (
          materials
            .filter((m) => !hideUnchecked || !excluded.includes(m.name))
            .map((material, index) => (
              <label
                key={index}
                className={
                  "material " + (selected === material.name ? "selected" : "")
                }
              >
                <input
                  disabled={busy}
                  type="checkbox"
                  checked={!excluded.includes(material.name)}
                  onChange={() => {
                    setExcluded((items) =>
                      items.includes(material.name)
                        ? items.filter((name) => name !== material.name)
                        : [...items, material.name],
                    );
                    changed();
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setSelected(material.name);
                    setMode(() => "pose");
                  }}
                >
                  {material.name || "未命名"}
                  <small>
                    {material.triangles.toLocaleString()} 面
                    {material.alpha < 1 ? " · α " + material.alpha : ""}
                  </small>
                </button>
                <button
                  type="button"
                  className={
                    "solo-button " + (solo === material.name ? "active" : "")
                  }
                  title="仅用于观察，不影响转换时保留的材质"
                  onClick={() => {
                    setSolo((current) =>
                      current === material.name ? null : material.name,
                    );
                    setSelected(material.name);
                    setMode(() => "pose");
                  }}
                >
                  {solo === material.name ? "还原" : "只看"}
                </button>
                <MaterialWeightInput
                  name={material.name}
                  value={
                    Object.hasOwn(materialWeights, material.name)
                      ? materialWeights[material.name]!
                      : 1
                  }
                  disabled={busy || excluded.includes(material.name)}
                  onCommit={(value) => {
                    setMaterialWeights((weights) => ({
                      ...weights,
                      [material.name]: value,
                    }));
                    changed();
                  }}
                />
                <span
                  className="material-dot"
                  style={{ background: `hsl(${index * 31},25%,60%)` }}
                />
              </label>
            ))
        ) : (
          <div className="empty-list">从模型管理打开模型后检查材质</div>
        )}
      </div>
      {session?.materials.some((material) => material.name === "表情") && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            setExcluded((items) => Array.from(new Set([...items, "表情"])));
            changed();
          }}
        >
          移除「表情」材质进行对照 →
        </button>
      )}
    </>
  );
}
