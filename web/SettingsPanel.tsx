import type { Dispatch, SetStateAction } from "react";
import type { Result, Session } from "./types";
import { triangleBudget } from "./estimate";

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
  profile: any;
  updateProfile: (key: string, value: number) => void;
  profileText: string;
  setProfileText: Dispatch<SetStateAction<string>>;
  setProfile: Dispatch<SetStateAction<any>>;
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
  const actual = result && !stale ? result.report.triangles : null;
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
        <label className="field">
          保留面数比例 <b>{Math.round(ratio * 100)}%</b>
          <input
        type="range"
        min=".01"
        max="1"
        step=".01"
        value={ratio}
        onChange={(e) => {
          setRatio(+e.target.value);
          changed();
        }}
          />
        </label>
        {session && (
          <div className={"face-estimate " + (budget.warning !== "none" ? "over-budget" : "")}>
        <strong>目标约 {estimate.target.toLocaleString()} 面</strong>
        <small>建议参考约 3.5 万三角面（样本 B轻量版 {budget.recommendedMax.toLocaleString()} 面）；已验收 Shino 为 {budget.observedMax.toLocaleString()} 面，5 万面左右不视为超量。</small>
        {budget.warning !== "none" && (
          <p className="budget-warning" role="status">
            已超出已验收样本的 {budget.observedMax.toLocaleString()} 面参考范围，建议实机确认加载与多人同屏表现；不代表无法加载。
          </p>
        )}
        {budget.warning !== "none" && budget.recommendedMax / estimate.source >= 0.01 && (
          <small>如需接近样本 B轻量版，保留比例可先尝试 {Math.floor(budget.recommendedMax / estimate.source * 100)}% 左右，再检查轮廓。</small>
        )}
        {actual !== null && triangleBudget(actual).warning !== "none" && (
          <p className="budget-warning">实际成品 {actual.toLocaleString()} 面，超出已验收样本参考范围，需实机确认。若希望继续减面但比例不再生效，可适当增加高级设置中的形状变化容限。</p>
        )}
        <small>
          含双面输出；原始保留部分 {estimate.source.toLocaleString()}{" "}
          面。误差限制可能使成品面数高于目标。
        </small>
        {result && (
          <small>
            上次实际：{result.report.triangles.toLocaleString()} 面
            {stale ? "（参数已修改）" : ""}
          </small>
        )}
          </div>
        )}
        <div className="range-labels">
          <span>更轻</span>
          <span>更多细节</span>
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
        value={height}
        onChange={(e) => {
          setHeight(+e.target.value);
          setMode("pose");
          changed();
        }}
          />
        </label>
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
        <p className="help">点预览右下角「正面检查」，脸和胸前应正对你；看到后脑就转 180°，看到侧脸就尝试 ±90°。绿色箭头固定表示玩家正前方，拖动视角不会改变它。</p>
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
          onClick={convert}
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

