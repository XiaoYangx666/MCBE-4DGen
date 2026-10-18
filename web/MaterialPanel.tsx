import { useEffect, useRef, useState } from "react";
import type { MaterialRow, Session } from "./types";

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
    if (draft.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 20) {
      onCommit(parsed);
      setDraft(String(parsed));
    } else {
      setDraft(String(value));
    }
  }

  return (
    <input
      className="material-weight"
      type="text"
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
}: {
  session: Session | null;
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
  setMaterialWeights: (update: (weights: Record<string, number>) => Record<string, number>) => void;
  changed: () => void;
}) {
  const materials: MaterialRow[] = session?.materials ?? [];
  return (
    <>
      <div className="section-label separated">
        02 / 材质筛选 <span>{materials.length}</span>
      </div>
      <div className="material-caption">
        取消勾选可移除材质。权重影响成品贴图像素分配，调整后需重新转换；1 为默认，0 使用最低采样且材质仍保留。
      </div>
      <div className="materials">
        {session ? (
          materials.map((material, index) => (
            <label
              key={index}
              className={"material " + (selected === material.name ? "selected" : "")}
            >
              <input
                disabled={busy}
                type="checkbox"
                checked={!excluded.includes(material.name)}
                onChange={() => {
                  setExcluded((items) => items.includes(material.name)
                    ? items.filter((name) => name !== material.name)
                    : [...items, material.name]);
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
                className={"solo-button " + (solo === material.name ? "active" : "")}
                title="仅用于观察，不影响转换时保留的材质"
                onClick={() => {
                  setSolo((current) => current === material.name ? null : material.name);
                  setSelected(material.name);
                  setMode(() => "pose");
                }}
              >
                {solo === material.name ? "还原" : "只看"}
              </button>
              <MaterialWeightInput
                name={material.name}
                value={Object.hasOwn(materialWeights, material.name) ? materialWeights[material.name]! : 1}
                disabled={busy || excluded.includes(material.name)}
                onCommit={(value) => {
                  setMaterialWeights((weights) => ({ ...weights, [material.name]: value }));
                  changed();
                }}
              />
              <span className="material-dot" style={{ background: `hsl(${index * 31},25%,60%)` }} />
            </label>
          ))
        ) : (
          <div className="empty-list">导入后可逐项检查材质</div>
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
