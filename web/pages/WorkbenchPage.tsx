import { useEffect, useState } from "react";
import { SaveSkinDialog } from "../packs/SaveSkinDialog";
import { SettingsPanel } from "../workbench/SettingsPanel";
import { Viewer } from "../workbench/Viewer";
import type { Workbench } from "../workbench/use-workbench";
import { WorkspaceTabs } from "../shared/WorkspaceTabs";
import { MaterialCandidates, type MaterialCandidate } from "../shared/MaterialCandidates";
import { partDisplayNames } from "../shared/part-labels";
import { ModelPartsPanel } from "../workbench/ModelPartsPanel";
import { TexturePanel } from "../workbench/TexturePanel";
import { TextureChart } from "../workbench/TextureChart";
import { TextureTuner } from "../workbench/TextureTuner";
import { AtlasDetails } from "../workbench/AtlasDetails";
import { AtlasPanel } from "../workbench/AtlasPanel";
import { OutputPanels } from "../workbench/OutputPanels";
import type { StudioWorkspace } from "../shared/WorkspaceTabs";

export function WorkbenchPage({ workbench }: { workbench: Workbench }) {
  const {
    session,
    result,
    workspace,
    setWorkspace,
    mode,
    setMode,
    excluded,
    setExcluded,
    includedParts,
    setIncludedParts,
    selectedPart,
    setSelectedPart,
    materialDeltas,
    materialWeights,
    setMaterialWeights,
    selected,
    setSelected,
    solo,
    setSolo,
    busy,
    previewBusy,
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
    preview,
    finalizeResult,
    estimate,
    stale,
  } = workbench;
  const [saveOpen, setSaveOpen] = useState(false);
  const [candidates, setCandidates] = useState<MaterialCandidate[] | null>(null);

  // Preview meshes are matched by source material name; stored selections use
  // stable keys. Ambiguous duplicate names are never guessed for preview solo.
  const nameByKey = new Map(
    (session?.materials ?? []).map((material) => [material.key, material.name]),
  );
  const keysByName = new Map<string, string[]>();
  for (const material of session?.materials ?? []) {
    const list = keysByName.get(material.name) ?? [];
    list.push(material.key);
    keysByName.set(material.name, list);
  }
  const excludedNames = excluded
    .map((key) => nameByKey.get(key))
    .filter((name): name is string => !!name);
  const soloName = (() => {
    if (!solo) return null;
    const name = nameByKey.get(solo);
    if (!name) return null;
    // A duplicate display name would isolate every material with that name.
    return (keysByName.get(name)?.length ?? 0) === 1 ? name : null;
  })();
  const selectedPartName = (() => {
    const parts = session?.parts ?? [];
    const index = parts.findIndex((part) => part.id === selectedPart);
    if (index < 0) return null;
    return partDisplayNames(
      parts.map((part) => ({
        name: part.name,
        node: part.node,
        mesh: part.mesh,
        material: part.materialName,
      })),
    )[index]!;
  })();

  useEffect(() => {
    // Entering the model workspace should show the whole model again.
    if (workspace === "model") setSolo(() => null);
  }, [workspace, setSolo]);

  function candidateItems(keys: readonly string[]): MaterialCandidate[] {
    return keys.map((key) => {
      const material = session?.materials.find((item) => item.key === key);
      return {
        id: key,
        name: material?.label ?? (material?.name || key),
        ...(material ? { meta: `${material.triangles.toLocaleString("zh-CN")} 面` } : {}),
      };
    });
  }

  function clearMaterialSelection() {
    setSelected("");
    setSolo(() => null);
    setCandidates(null);
  }

  function selectMaterial(key: string | null) {
    setCandidates(null);
    if (!key) {
      clearMaterialSelection();
      return;
    }
    if (workspace === "texture") {
      // A second click on the selected material toggles isolation instead of
      // dropping the selection, so editing a weight never changes the view.
      if (key === selected) {
        setSolo((current) => (current === key ? null : key));
        return;
      }
      setSelected(key);
      // An active isolation follows the new selection.
      setSolo((current) => (current ? key : null));
      return;
    }
    setSelected(key === selected ? "" : key);
  }

  function chooseNames(names: string[]) {
    const keys = [
      ...new Set(names.flatMap((name) => keysByName.get(name) ?? [])),
    ];
    if (!keys.length) return;
    if (keys.length === 1) {
      selectMaterial(keys[0]!);
      return;
    }
    setCandidates(candidateItems(keys));
  }

  const tabs = [
    {
      key: "model" as const,
      label: "模型",
      hint: "部件、减面与姿势",
    },
    {
      key: "texture" as const,
      label: "纹理",
      hint: "材质清晰度与图集",
    },
    {
      key: "export" as const,
      label: "导出",
      hint: "生成并保存皮肤包",
      attention: stale,
    },
  ];

  const viewer = (
    <Viewer
      session={session}
      result={result}
      mode={mode}
      excluded={excludedNames}
      wire={wire}
      unlit={unlit}
      focus={focus}
      solo={soloName}
      profile={profile}
      height={height}
      binding={binding}
      parts={session?.parts ?? []}
      includedParts={includedParts}
      selectedPart={selectedPart}
      onUnlitChange={setUnlit}
      onSelect={(name) => {
        if (mode === "result") return;
        chooseNames([name]);
      }}
      onSelectCandidates={(names) => chooseNames(names)}
    />
  );

  const switchWorkspace = (next: StudioWorkspace) => {
    setWorkspace(next);
    setCandidates(null);
    if (next === "export" && result) {
      setMode("result");
      setFocus("all");
    }
    if (next === "model") setMode("pose");
  };

  const canSave = !!result && !result.preview && !stale && !busy;

  const previewStatus = (
    <span
      className={`preview-status ${previewBusy ? "running" : stale ? "stale" : ""}`}
    >
      {previewBusy
        ? "正在更新预览…"
        : stale
          ? "预览待更新"
          : result
            ? "预览已是最新"
            : "尚未生成预览"}
    </span>
  );

  return (
    <>
      <div className="workspace workbench-shell">
        <header className="workspace-header">
          <div className="workspace-project">
            <span className="eyebrow">4DGen / 本地模型工作台</span>
            <h2>{session?.name ?? "预览你的下一个角色"}</h2>
            <small>
              {session
                ? `${session.materials.length} 材质 · ${session.parts?.length ?? 0} 部件 · 切换工作区不会丢失配置`
                : "从模型管理打开模型后开始编辑。"}
            </small>
          </div>
          <WorkspaceTabs value={workspace} tabs={tabs} onChange={switchWorkspace} />
          <div className="workspace-global">
            {stale && <span className="workspace-stale">结果已过期</span>}
            {previewBusy && <span className="workspace-working">正在更新预览…</span>}
          </div>
        </header>

        <div className={`workspace-body workbench-${workspace}`}>
          <aside className="workspace-side left">
            {workspace === "model" && (
              <ModelPartsPanel
                session={session}
                includedParts={includedParts}
                setIncludedParts={setIncludedParts}
                selectedPart={selectedPart}
                setSelectedPart={setSelectedPart}
                busy={busy}
                changed={changed}
              />
            )}
            {workspace === "texture" && (
              <TexturePanel
                session={session}
                result={result}
                previewBusy={previewBusy}
                stale={stale}
                selected={selected}
                onSelect={selectMaterial}
                includedParts={includedParts}
                busy={busy}
              />
            )}
          </aside>

          <section className="workspace-preview">
            <div className="workspace-toolbar">
              <span>
                {mode === "result" && result
                  ? "4D 输出预览"
                  : session
                    ? "源模型预览"
                    : "模型预览"}
              </span>
              <span className="grow" />
              <button
                type="button"
                className={mode === "pose" ? "active" : ""}
                disabled={!session}
                onClick={() => {
                  setMode("pose");
                  setFocus("all");
                }}
              >
                源模型
              </button>
              <button
                type="button"
                className={mode === "result" ? "active" : ""}
                disabled={!result}
                onClick={() => setMode("result")}
              >
                4D 输出
              </button>
              {workspace === "model" && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={wire}
                      onChange={(event) => setWire(event.target.checked)}
                    />{" "}
                    线框
                  </label>
                  {previewStatus}
                </>
              )}
              {workspace === "texture" && (
                <>
                  {previewStatus}
                  {soloName && (
                    <button type="button" onClick={() => setSolo(() => null)}>
                      显示全部材质
                    </button>
                  )}
                  {selected && (
                    <span className="selected-material">
                      已选：{nameByKey.get(selected) ?? selected}
                    </span>
                  )}
                </>
              )}
              {workspace === "export" && (
                <select
                  value={focus}
                  disabled={mode !== "result"}
                  onChange={(event) => setFocus(event.target.value)}
                >
                  <option value="all">全部部位</option>
                  {[
                    ["head", "头部"],
                    ["body", "身体"],
                    ["leftArm", "左臂"],
                    ["rightArm", "右臂"],
                    ["leftLeg", "左腿"],
                    ["rightLeg", "右腿"],
                  ].map(([part, label]) => (
                    <option key={part} value={part}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className={`stage${workspace === "texture" ? " has-tuner" : ""}`}>
              {viewer}
              {workspace === "texture" && (
                <TextureTuner
                  session={session}
                  result={result}
                  selected={selected}
                  materialWeights={materialWeights}
                  setMaterialWeights={setMaterialWeights}
                  changed={changed}
                  busy={busy}
                  solo={solo}
                  setSolo={setSolo}
                  onClear={clearMaterialSelection}
                />
              )}
              {!session && workspace === "model" && (
                <div className="welcome">
                  <div className="cube">◈</div>
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
              {selectedPart && (
                <div className="part-selection-note">
                  正在只看部件「{selectedPartName ?? selectedPart}」。
                  <button type="button" onClick={() => setSelectedPart(null)}>
                    显示全部部件
                  </button>
                </div>
              )}
              {candidates && (
                <MaterialCandidates
                  candidates={candidates}
                  onPick={(key) => selectMaterial(key)}
                  onClose={() => setCandidates(null)}
                />
              )}
              {workspace === "model" && (
                <div className="stage-badge">
                  {mode === "pose" ? "调整预览 / 原始贴图" : "128 × 128 / BEDROCK"}
                  {selected && <span> / {nameByKey.get(selected) ?? selected}</span>}
                </div>
              )}
            </div>
          </section>

          <aside className="workspace-side right">
            {workspace === "model" && (
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
                retryPreview={preview}
                previewBusy={previewBusy}
                error={error}
              />
            )}
            {workspace === "texture" && (
              <div className="texture-side-inner">
                <AtlasPanel
                  result={result}
                  session={session}
                  selected={selected || null}
                  onSelect={selectMaterial}
                  onSelectCandidates={(keys) =>
                    setCandidates(candidateItems(keys))
                  }
                  previewBusy={previewBusy}
                  showList={false}
                  showAdvanced={false}
                />
                <TextureChart
                  session={session}
                  result={result}
                  selected={selected}
                  onSelect={selectMaterial}
                />
                <AtlasDetails result={result} />
              </div>
            )}
            {workspace === "export" && (
              <div className="export-side-inner">
                <div className="export-status-card">
                  <h2>结果与导出</h2>
                  <p>
                    {session
                      ? `当前配置：${height}px 高 · ${
                          binding === "humanoid" ? "六部位人形" : "静态整体"
                        } · 预算·密度 · ${Object.keys(materialWeights).length} 项权重调整`
                      : "打开模型后开始。"}
                  </p>
                  {result ? (
                    <>
                      <div className={`result-kind ${result.preview ? "preview" : "final"}`}>
                        {result.preview ? "预览结果" : "最终结果"}
                        {stale ? " · 配置已改变" : " · 与当前配置一致"}
                      </div>
                      {stale && (
                        <p className="stale-note" role="status">
                          当前配置已改变，下面的图集和报告来自上一次计算。请重新生成后再导出。
                        </p>
                      )}
                      {result.preview && !stale && (
                        <p className="inline-note">
                          纹理预览已经更新，但尚未打包。生成最终皮肤包会直接复用这张图集，不会重新计算。
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="inline-note">
                      还没有结果。先在「模型」或「纹理」页调整，预览会自动更新；回到这里生成最终皮肤包。
                    </p>
                  )}
                  <div className="export-actions">
                    {canSave ? (
                      <>
                        <button
                          type="button"
                          className="primary"
                          disabled={busy}
                          onClick={() => setSaveOpen(true)}
                        >
                          保存皮肤…
                        </button>
                        <button
                          type="button"
                          className="download"
                          disabled={busy}
                          onClick={() => void finalizeResult()}
                        >
                          重新生成
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="primary"
                        disabled={!session || busy}
                        onClick={() => void finalizeResult()}
                      >
                        {busy ? "正在生成…" : "生成皮肤包"}
                      </button>
                    )}
                  </div>
                  {error && <p className="error-message">{error}</p>}
                </div>
                <OutputPanels
                  result={result}
                  stale={stale}
                  session={session}
                  selected={selected || null}
                  onSelect={selectMaterial}
                  onSelectCandidates={(keys) => setCandidates(candidateItems(keys))}
                  previewBusy={previewBusy}
                />
              </div>
            )}
          </aside>
        </div>
      </div>
      {saveOpen && result && !stale && !result.preview && (
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
    </>
  );
}
