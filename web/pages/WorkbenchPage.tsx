import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { SaveSkinDialog } from "../packs/SaveSkinDialog";
import { SettingsPanel } from "../workbench/SettingsPanel";
import { Viewer } from "../workbench/Viewer";
import type { Workbench } from "../workbench/use-workbench";
import { WorkspaceTabs } from "../shared/WorkspaceTabs";
import { MaterialCandidates, type MaterialCandidate } from "../shared/MaterialCandidates";
import { useResizableWidth } from "../shared/use-resizable";
import { ModelPartsPanel } from "../workbench/ModelPartsPanel";
import { TexturePanel } from "../workbench/TexturePanel";
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
    textureMode,
    setTextureMode,
    textureTarget,
    setTextureTarget,
    selectedPart,
    setSelectedPart,
    showKeptParts,
    setShowKeptParts,
    materialDeltas,
    materialWeights,
    setMaterialWeights,
    selected,
    setSelected,
    solo,
    setSolo,
    elapsed,
    busy,
    previewBusy,
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
    finalizeResult,
    estimate,
    stale,
    dirty,
  } = workbench;
  const [saveOpen, setSaveOpen] = useState(false);
  const [candidates, setCandidates] = useState<MaterialCandidate[] | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [maximizePreview, setMaximizePreview] = useState(false);
  const leftPanel = useResizableWidth(310, 250, 460, "left");
  const rightPanel = useResizableWidth(380, 300, 560, "right");

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

  function selectMaterial(key: string | null) {
    setSelected(key ?? "");
    setCandidates(null);
    if (workspace === "texture") setSolo(() => key);
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
      hint: "预览、部件与转换参数",
      badge: session?.parts?.length || null,
    },
    {
      key: "texture" as const,
      label: "纹理",
      hint: "材质、清晰度与图集",
      badge: session?.materials.length || null,
      attention: stale || previewBusy,
    },
    {
      key: "export" as const,
      label: "导出",
      hint: "结果检查与皮肤包",
      badge: stale ? "过期" : result ? (result.preview ? "预览" : "已生成") : null,
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
      showKeptParts={showKeptParts}
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

  return (
    <>
      <div className={`workspace workbench-shell${maximizePreview ? ' preview-max' : ''}`}>
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
            {dirty && <span>配置未保存</span>}
            {session && (
              <button
                type="button"
                className="text-button"
                disabled={!canSave}
                title={canSave ? "保存皮肤包" : "生成最终结果后可保存"}
                onClick={() => setSaveOpen(true)}
              >
                保存皮肤…
              </button>
            )}
          </div>
        </header>

        <div
          className={`workspace-body workbench-${workspace}`}
          style={{
            "--texture-left": leftOpen ? `${leftPanel.width}px` : "0px",
            "--texture-right": rightOpen ? `${rightPanel.width}px` : "0px",
          } as CSSProperties}
        >
          <aside className={`workspace-side left${workspace === "texture" && !leftOpen ? " closed" : ""}`}>
            {workspace === "model" && (
              <ModelPartsPanel
                session={session}
                includedParts={includedParts}
                setIncludedParts={setIncludedParts}
                selectedPart={selectedPart}
                setSelectedPart={setSelectedPart}
                showKeptParts={showKeptParts}
                setShowKeptParts={setShowKeptParts}
                excluded={excluded}
                setExcluded={setExcluded}
                selected={selected}
                setSelected={setSelected}
                busy={busy}
                changed={changed}
              />
            )}
            {workspace === "texture" && (
              <TexturePanel
                session={session}
                result={result}
                stale={stale}
                previewBusy={previewBusy}
                selected={selected}
                setSelected={setSelected}
                excluded={excluded}
                setExcluded={setExcluded}
                materialWeights={materialWeights}
                setMaterialWeights={setMaterialWeights}
                changed={changed}
                busy={busy}
                textureMode={textureMode}
                setTextureMode={setTextureMode}
                textureTarget={textureTarget}
                setTextureTarget={setTextureTarget}
                includedParts={includedParts}
                setIncludedParts={setIncludedParts}
                selectedPart={selectedPart}
                setSelectedPart={setSelectedPart}
                showKeptParts={showKeptParts}
                setShowKeptParts={setShowKeptParts}
                materialDeltas={materialDeltas}
              />
            )}
          </aside>

          <div
            className={`workspace-splitter${workspace === "texture" && leftOpen && !maximizePreview ? "" : " hidden"}`}
            aria-hidden="true"
            {...leftPanel.handleProps}
          />

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
                </>
              )}
              {workspace === "texture" && (
                <>
                  <span className={`preview-status ${previewBusy ? "running" : stale ? "stale" : ""}`}>
                    {previewBusy
                      ? "正在计算实际分配…"
                      : stale
                        ? "显示的是上一次结果"
                        : result
                          ? "预览与当前配置一致"
                          : "等待首次预览"}
                  </span>
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
                  <button type="button" onClick={() => setLeftOpen((value) => !value)}>
                    {leftOpen ? "收起材质" : "展开材质"}
                  </button>
                  <button type="button" onClick={() => setRightOpen((value) => !value)}>
                    {rightOpen ? "收起图集" : "展开图集"}
                  </button>
                  <button type="button" onClick={() => setMaximizePreview((value) => !value)}>
                    {maximizePreview ? "还原布局" : "最大化预览"}
                  </button>
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
            <div className="stage">
              {viewer}
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

          <div
            className={`workspace-splitter${workspace === "texture" && rightOpen && !maximizePreview ? "" : " hidden"}`}
            aria-hidden="true"
            {...rightPanel.handleProps}
          />

          <aside className={`workspace-side right${workspace === "texture" && !rightOpen ? " closed" : ""}`}>
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
                convert={convert}
                error={error}
                message={message}
                elapsed={elapsed}
                openPacks={() => setSaveOpen(true)}
              />
            )}
            {workspace === "texture" && (
              <AtlasPanel
                result={result}
                session={session}
                selected={selected || null}
                onSelect={selectMaterial}
                onSelectCandidates={(keys) => setCandidates(candidateItems(keys))}
                previewBusy={previewBusy}
              />
            )}
            {workspace === "export" && (
              <div className="export-side-inner">
                <div className="export-status-card">
                  <h2>结果与导出</h2>
                  <p>
                    {session
                      ? `当前配置：${height}px 高 · ${
                          binding === "humanoid" ? "六部位人形" : "静态整体"
                        } · ${
                          textureMode === "budget"
                            ? textureTarget === "density"
                              ? "预算·密度"
                              : "预算·细节保留"
                            : "旧版算法"
                        } · ${Object.keys(materialWeights).length} 项权重调整`
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
                      还没有生成结果。先在模型工作区转换，或在纹理工作区调整后回来导出。
                    </p>
                  )}
                  <div className="export-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={!session || busy}
                      onClick={() => void finalizeResult()}
                    >
                      {busy
                        ? "正在生成…"
                        : result?.preview && !stale
                          ? "打包并生成下载"
                          : stale || !result
                            ? "生成最终皮肤包"
                            : "重新生成"}
                    </button>
                    {canSave && (
                      <button
                        type="button"
                        className="download"
                        disabled={busy}
                        onClick={() => setSaveOpen(true)}
                      >
                        保存皮肤…
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
      <footer>
        <span>4DGen / 本地模型工作台</span>
        <span>文件在本机处理 · 启用皮肤包时会写入游戏目录</span>
      </footer>
    </>
  );
}
