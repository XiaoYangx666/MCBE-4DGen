import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { HumanoidProfile } from "../../src/humanoid";
import type { Result, Session } from "./types";
import { PoseControls } from "../shared/PoseControls";
import { RatioField } from "../shared/RatioField";

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
  retryPreview: () => void;
  previewBusy: boolean;
  error: string;
};

export function SettingsPanel(props: SettingsPanelProps) {
  const { session, busy, binding, setBinding, changed, ratio, setRatio, estimate,
    result, stale, maxError, setMaxError, height, setHeight, setMode, profile,
    updateProfile, profileText, setProfileText, setProfile, setError,
    retryPreview, previewBusy, error } = props;
  const actual = result && !stale ? (result.report.triangles ?? null) : null;
  const [heightText, setHeightText] = useState(String(height));
  useEffect(() => setHeightText(String(height)), [height]);
  const heightValue = Number(heightText);
  const heightValid =
    heightText.trim() !== "" &&
    Number.isFinite(heightValue) &&
    heightValue >= 1 &&
    heightValue <= 128;
  return (
    <aside className="inspector">
      <div className="section-label">02 / 转换设置</div>
      <h2>绑定、减面与姿势</h2>
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
        <div className="field">
          <RatioField
            ratio={ratio}
            onChange={(value) => {
              setRatio(value);
              changed();
            }}
            sourceTriangles={estimate.source}
            targetFaces={estimate.target}
            actualFaces={actual}
            disabled={busy || !session}
            showBudget={!!session}
          />
        </div>
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
        <PoseControls
          rotationY={profile.rotationYDegrees ?? 0}
          onRotationY={(value) => {
            updateProfile("rotationYDegrees", value);
            changed();
          }}
          armSpread={profile.armSpreadDegrees ?? 0}
          onArmSpread={(value) => {
            updateProfile("armSpreadDegrees", value);
            changed();
          }}
          showArm={binding === "humanoid"}
          armMin={0}
          armMax={45}
          armLabel="手臂外展"
          disabled={busy || !session}
          rotationHelp="点右下角「正面检查」，让角色正面朝向绿色箭头。"
          armHelp="0° 为自然下垂，数值越大手臂越向外展开。"
        />
        {binding === "humanoid" && (
          <>
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
        <p className="help">
          调整后预览会自动重新计算；最终皮肤包在「导出」页生成并保存。
        </p>
        {error && (
          <button
            type="button"
            className="download"
            disabled={previewBusy || !session}
            onClick={retryPreview}
          >
            {previewBusy ? "正在计算…" : "重试预览"}
          </button>
        )}
      </div>
      {error && (
        <div className="status error" role="status">
          {error}
        </div>
      )}
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

