import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { HumanoidProfile } from "../../src/humanoid";
import type { Result, Session } from "./types";
import { FACE_GREEN_MAX, FACE_YELLOW_MAX, triangleBudget } from "./estimate";

type SettingsPanelProps = {
  session: Session | null;
  busy: boolean;
  binding: string;
  setBinding: Dispatch<SetStateAction<string>>;
  changed: () => void;
  ratio: number;
  setRatio: Dispatch<SetStateAction<number>>;
  estimate: { source: number; target: number };
  result: Result | null;
  stale: boolean;
  maxError: number;
  setMaxError: Dispatch<SetStateAction<number>>;
  height: number;
  setHeight: Dispatch<SetStateAction<number>>;
  setMode: Dispatch<SetStateAction<string>>;
  profile: HumanoidProfile;
  updateProfile: (key: string, value: number) => void;
  profileText: string;
  setProfileText: Dispatch<SetStateAction<string>>;
  setProfile: Dispatch<SetStateAction<HumanoidProfile>>;
  setError: Dispatch<SetStateAction<string>>;
  convert: () => void;
  error: string;
  message: string;
  elapsed: number;
  openPacks: () => void;
};

export function SettingsPanel(props: SettingsPanelProps) {
  const { session, busy, binding, setBinding, changed, ratio, setRatio, estimate,
    result, stale, maxError, setMaxError, height, setHeight, setMode, profile,
    updateProfile, profileText, setProfileText, setProfile, setError, convert,
    error, message, elapsed, openPacks } = props;
  const budget = triangleBudget(estimate.target);
  const actual = result && !stale ? (result.report.triangles ?? null) : null;
  const [heightText, setHeightText] = useState(String(height));
  useEffect(() => setHeightText(String(height)), [height]);
  const heightValue = Number(heightText);
  const heightValid =
    heightText.trim() !== "" &&
    Number.isFinite(heightValue) &&
    heightValue >= 1 &&
    heightValue <= 128;
  const faceLabels = { green: "轻量", yellow: "可接受", red: "偏高" } as const;
  const source = Math.max(1, estimate.source);
  const zone = (faces: number) =>
    Math.max(
      0,
      Math.min(100, ((Math.min(1, faces / source) - 0.01) / 0.99) * 100),
    );
  const ratioTrack = `linear-gradient(90deg,
    color-mix(in srgb, var(--face-green) 55%, transparent) 0 ${zone(FACE_GREEN_MAX)}%,
    color-mix(in srgb, var(--face-yellow) 55%, transparent) ${zone(FACE_GREEN_MAX)}% ${zone(FACE_YELLOW_MAX)}%,
    color-mix(in srgb, var(--face-red) 55%, transparent) ${zone(FACE_YELLOW_MAX)}% 100%)`;
  const actualBudget = actual !== null ? triangleBudget(actual) : null;
  return (
    <aside className="inspector">
      <div className="section-label">02 / 转换设置</div>
      <h2>调整与生成</h2>
      <fieldset disabled={busy || !session}>
        <label className="field">
          绑定方式
          <select
        value={binding}
        onChange={(e) => {
          setBinding(e.target.value);
          setMode("pose");
          changed();
        }}
          >
        <option value="static">静态模型</option>
        <option value="humanoid">六部位人形</option>
          </select>
        </label>
        <p className="help">
          {binding === "humanoid"
        ? "使用源骨骼映射，跟随原版玩家动作。"
        : "整个模型绑定身体，适合物件与静态皮肤。"}
        </p>
        <div className="field ratio-field">
          <span className="ratio-label">
            保留面数比例 <b>{Math.round(ratio * 100)}%</b>
          </span>
          <div className="ratio-slider" style={{ background: ratioTrack }}>
            <input
              type="range"
              aria-label="保留面数比例"
              min=".01"
              max="1"
              step=".01"
              value={ratio}
              onChange={(e) => {
                setRatio(+e.target.value);
                changed();
              }}
            />
          </div>
          <div className="ratio-legend">
            <span className="green">轻量 &lt; 2 万</span>
            <span className="yellow">2–5 万</span>
            <span className="red">&gt; 5 万</span>
          </div>
        </div>
        {session && (
          <div className={"face-estimate face-" + budget.level}>
            <div className="face-row">
              <strong>目标约 {estimate.target.toLocaleString()} 面</strong>
              <span className={"face-chip " + budget.level}>
                {faceLabels[budget.level]}
              </span>
            </div>
            {actual !== null && actualBudget && (
              <div className="face-row">
                <span className="face-actual">
                  上次实际 {actual.toLocaleString()} 面
                </span>
                <span className={"face-chip " + actualBudget.level}>
                  {faceLabels[actualBudget.level]}
                </span>
              </div>
            )}
          </div>
        )}
        <details className="advanced-reduction">
          <summary>高级减面设置（通常保持默认）</summary>{" "}
          <label className="field">
        形状变化容限
        <input
          type="number"
          min="0"
          max="1"
          step=".005"
          value={maxError}
          onChange={(e) => {
            setMaxError(+e.target.value);
            changed();
          }}
        />
          </label>
          <p className="help">
        默认
        0.03。调小优先保形，可能减不到目标面数；调大允许更多减面，也更容易丢失轮廓和细节。
          </p>
        </details>
        <label className="field">
          模型高度
          <input
        type="number"
        min="1"
        max="128"
        value={heightText}
        aria-invalid={!heightValid}
        onChange={(e) => {
          const next = e.target.value;
          setHeightText(next);
          const value = Number(next);
          if (next.trim() !== "" && Number.isFinite(value) && value >= 1 && value <= 128) {
            setHeight(value);
            setMode("pose");
            changed();
          }
        }}
          />
        </label>
        {!heightValid && <p className="field-error">模型高度需为 1–128</p>}
        <div className="subheading">姿势与朝向</div>
        <label className="field">
          Y 轴旋转 <b>{profile.rotationYDegrees ?? 0}°</b>
          <input
        type="range"
        min="-180"
        max="180"
        step="5"
        value={profile.rotationYDegrees ?? 0}
        onChange={(e) =>
          updateProfile("rotationYDegrees", +e.target.value)
        }
          />
        </label>
        <div className="rotation-presets">
          {[0, 90, 180, -90].map((angle) => (
            <button key={angle} type="button" onClick={() => updateProfile("rotationYDegrees", angle)}>{angle}°</button>
          ))}
        </div>
        <p className="help">点右下角「正面检查」，让角色正面朝向绿色箭头。</p>
        {binding === "humanoid" && (
          <>
        <label className="field">
          手臂外展 <b>{profile.armSpreadDegrees ?? 0}°</b>
          <input
            type="range"
            min="0"
            max="45"
            value={profile.armSpreadDegrees ?? 0}
            onChange={(e) =>
              updateProfile("armSpreadDegrees", +e.target.value)
            }
          />
        </label>
        <label className="field">
          肩部外移
          <input
            type="number"
            min="0"
            max="8"
            step=".1"
            value={profile.shoulderOutset ?? 0}
            onChange={(e) =>
              updateProfile("shoulderOutset", +e.target.value)
            }
          />
        </label>
        <details>
          <summary>高级骨骼 / 材质配置</summary>
          <textarea
            aria-label="人形配置 JSON"
            value={profileText}
            onChange={(e) => setProfileText(e.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              try {
            const p = JSON.parse(profileText);
            if (!p || typeof p !== "object" || Array.isArray(p))
              throw Error("配置必须是对象");
            setProfile(p);
            setMode("pose");
            changed();
            setError("");
              } catch (e) {
            setError("配置无效：" + String(e));
              }
            }}
          >
            应用 JSON 配置
          </button>
          <p className="help">
            VRM / 常见 MMD 骨架自动识别；无法识别时可粘贴 boneMap 配置。
          </p>
        </details>
          </>
        )}
      </fieldset>
      <div className="generation">
        <button
          className="primary"
          disabled={busy || !session}
          onClick={() => {
            if (!heightValid) {
              setError("模型高度需为 1–128 之间的数字");
              return;
            }
            convert();
          }}
        >
          {busy ? (
        <>
          <span className="spinner" /> 处理中…
        </>
          ) : (
        stale ? "重新生成皮肤" : "生成皮肤"
          )}
        </button>
        <p>权重微调后再次生成会复用模型；姿势、减面或材质保留变化时重新处理模型。</p>
        {result && (
          <button
            type="button"
            className="download"
            onClick={openPacks}
            disabled={busy || stale}
          >
            {stale ? "参数已修改，请重新生成" : "保存皮肤…"}
          </button>
        )}
      </div>
      <div className={"status " + (error ? "error" : "")} role="status">
        {error || message}
        {busy && <span> · 已用时 {elapsed.toFixed(1)} 秒</span>}
      </div>
      <div className="notice">
        预览用于检查转换结果。游戏里的渲染与动作仍需实际验收。
      </div>
      {session && (
        <details className="warnings">
          <summary>导入提示 ({session.warnings.length})</summary>
          {session.warnings.map((w, i) => (
        <p key={i}>{w}</p>
          ))}
        </details>
      )}
    </aside>
  );
}

