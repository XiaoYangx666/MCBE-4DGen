import { useState } from "react";
import { MaterialPanel } from "../workbench/MaterialPanel";
import { OutputPanels } from "../workbench/OutputPanels";
import { SaveSkinDialog } from "../packs/SaveSkinDialog";
import { SettingsPanel } from "../workbench/SettingsPanel";
import { Viewer } from "../workbench/Viewer";
import type { Workbench } from "../workbench/use-workbench";

export function WorkbenchPage({ workbench }: { workbench: Workbench }) {
  const {
    session,
    result,
    mode,
    setMode,
    excluded,
    setExcluded,
    materialWeights,
    setMaterialWeights,
    selected,
    setSelected,
    solo,
    setSolo,
    elapsed,
    busy,
    message,
    error,
    setError,
    wire,
    setWire,
    unlit,
    setUnlit,
    focus,
    setFocus,
    ratio,
    setRatio,
    maxError,
    setMaxError,
    height,
    setHeight,
    binding,
    setBinding,
    profile,
    setProfile,
    profileText,
    setProfileText,
    updateProfile,
    changed,
    convert,
    estimate,
    stale,
  } = workbench;
  const [saveOpen, setSaveOpen] = useState(false);

  return (
    <>
      <div className="workspace">
        <aside className="sidebar">
          <MaterialPanel
            result={result}
            stale={stale}
            convert={convert}
            session={session}
            busy={busy}
            excluded={excluded}
            setExcluded={setExcluded}
            selected={selected}
            setSelected={setSelected}
            solo={solo}
            setSolo={setSolo}
            mode={mode}
            setMode={setMode}
            materialWeights={materialWeights}
            setMaterialWeights={setMaterialWeights}
            changed={changed}
          />
        </aside>
        <main>
          <div className="stage-top">
            <div>
              <span className="eyebrow">MODEL VIEWPORT</span>
              <h2>{session?.name ?? "预览你的下一个角色"}</h2>
            </div>
            <div className="tabs">
              <button
                disabled={!session}
                className={mode === "pose" ? "active" : ""}
                onClick={() => {
                  setMode("pose");
                  setFocus("all");
                }}
              >
                调整预览
              </button>
              <button
                disabled={!result}
                className={mode === "result" ? "active" : ""}
                onClick={() => setMode("result")}
              >
                转换结果{stale ? " *" : ""}
              </button>
            </div>
          </div>
          <div className="stage">
            <Viewer
              session={session}
              result={result}
              mode={mode}
              excluded={excluded}
              wire={wire}
              unlit={unlit}
              focus={focus}
              solo={solo}
              profile={profile}
              height={height}
              binding={binding}
              onSelect={(name) => setSelected(name)}
            />
            {!session && (
              <div className="welcome">
                <div className="cube">◇</div>
                <h3>让细节，看得见。</h3>
                <p>
                  先从模型管理选择一个模型
                  <br />
                  在三维视图中检查，再生成皮肤包。
                  <br />
                  <a href="#/models">打开模型管理 →</a>
                </p>
              </div>
            )}
            <div className="stage-badge">
              {mode === "pose" ? "调整预览 / 原始贴图" : "128 × 128 / BEDROCK"}
              {selected && <span> / {selected}</span>}
            </div>
          </div>
          <div className="toolbar">
            <label>
              <input
                type="checkbox"
                checked={unlit}
                onChange={(event) => setUnlit(event.target.checked)}
              />{" "}
              无光照
            </label>
            <label>
              <input
                type="checkbox"
                checked={wire}
                onChange={(event) => setWire(event.target.checked)}
              />{" "}
              线框
            </label>
            {mode === "result" && (
              <select
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
              >
                <option value="all">全部部位</option>
                {[
                  "head",
                  "body",
                  "leftArm",
                  "rightArm",
                  "leftLeg",
                  "rightLeg",
                ].map((part, index) => (
                  <option key={part} value={part}>
                    {["头部", "身体", "左臂", "右臂", "左腿", "右腿"][index]}
                  </option>
                ))}
              </select>
            )}
            <span className="toolbar-note">
              {mode === "pose"
                ? "姿势即时预览 · 减面和贴图权重需转换后查看"
                : "实际导出几何 · 最近邻纹理采样"}
            </span>
          </div>
          <OutputPanels
            result={result}
            stale={stale}
            session={session}
            selected={selected}
            onSelect={setSelected}
          />
        </main>
        <SettingsPanel
          session={session}
          busy={busy}
          binding={binding}
          setBinding={setBinding}
          changed={changed}
          ratio={ratio}
          setRatio={setRatio}
          estimate={estimate}
          result={result}
          stale={stale}
          maxError={maxError}
          setMaxError={setMaxError}
          height={height}
          setHeight={setHeight}
          setMode={setMode}
          profile={profile}
          updateProfile={updateProfile}
          profileText={profileText}
          setProfileText={setProfileText}
          setProfile={setProfile}
          setError={setError}
          convert={convert}
          error={error}
          message={message}
          elapsed={elapsed}
          openPacks={() => setSaveOpen(true)}
        />
      </div>
      {saveOpen && result && !stale && (
        <SaveSkinDialog
          jobId={result.id}
          modelName={session?.name ?? "新皮肤"}
          onClose={() => setSaveOpen(false)}
          onSaved={(id) => {
            setSaveOpen(false);
            location.hash = "#/packs?pack=" + encodeURIComponent(id);
          }}
        />
      )}
      <footer>
        <span>4DGen / 本地模型工作台</span>
        <span>文件在本地环境处理 · 启用皮肤包时会写入游戏目录</span>
      </footer>
    </>
  );
}
