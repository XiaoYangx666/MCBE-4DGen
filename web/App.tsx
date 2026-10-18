import { TemplatesPage } from "./TemplatesPage";
import { StorageDialog } from "./StorageDialog";
import { useEffect, useState } from "react";
import { SaveSkinDialog } from "./SaveSkinDialog";
import { Viewer } from "./Viewer";
import { MaterialPanel } from "./MaterialPanel";
import { OutputPanels } from "./OutputPanels";
import { SettingsPanel } from "./SettingsPanel";
import { LibraryPage } from "./LibraryPage";
import { PackPage } from "./PackPage";
import { api, post } from "./api";
import { estimateTriangles } from "./estimate";
import type { Result, Session } from "./types";

export function App() {
  const [storageOpen,setStorageOpen] = useState(false),
    [saveOpen, setSaveOpen] = useState(false),
    [savedRevision, setSavedRevision] = useState(0),
    [session, setSession] = useState<Session | null>(null),
    [result, setResult] = useState<Result | null>(null),
    [mode, setMode] = useState("pose"),
    [excluded, setExcluded] = useState<string[]>([]),
    [materialWeights, setMaterialWeights] = useState<Record<string, number>>(
      {},
    ),
    [selected, setSelected] = useState(""),
    [solo, setSolo] = useState<string | null>(null),
    [elapsed, setElapsed] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("从模型管理打开模型，开始调整。"),
    [error, setError] = useState(""),
    [wire, setWire] = useState(false),
    [unlit, setUnlit] = useState(true),
    [focus, setFocus] = useState("all"),
    [ratio, setRatio] = useState(0.2),
    [maxError, setMaxError] = useState(0.03),
    [height, setHeight] = useState(32),
    [binding, setBinding] = useState("humanoid"),
    [profile, setProfile] = useState<any>({
      rotationYDegrees: 0,
      shoulderOutset: 0,
      armSpreadDegrees: 0,
    }),
    [profileText, setProfileText] = useState(""),
    [revision, setRevision] = useState(0),
    [resultRevision, setResultRevision] = useState(0),
    [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const change = () => {
      setHash(location.hash);
      const label = location.hash.startsWith("#/templates") ? "皮肤模板" : location.hash.startsWith("#/models") ? "源模型" : location.hash.startsWith("#/game") ? "游戏中的皮肤" : location.hash.startsWith("#/packs") ? "皮肤包" : location.hash.startsWith("#/workbench") ? "工作台" : "首页";
      document.title = `4DGen · ${label}`;
    };
    change();
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed((Date.now() - started) / 1000),
      250,
    );
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    const blockFileDrop = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", blockFileDrop);
    window.addEventListener("drop", blockFileDrop);
    return () => { window.removeEventListener("dragover", blockFileDrop); window.removeEventListener("drop", blockFileDrop); };
  }, []);

  function changed() {
    setRevision((v) => v + 1);
  }
  function accept(s: Session, fromVersion = false) {
    const saved = s.settings;
    const loadedProfile = saved?.profile ?? (s.profile
      ? { ...s.profile, shoulderOutset: 0 }
      : { rotationYDegrees: 0, shoulderOutset: 0, armSpreadDegrees: 0 });
    setSession(s);
    setResult(null);
    setExcluded(saved?.excluded ?? []);
    setMaterialWeights(saved?.materialWeights ?? {});
    setRatio(saved?.ratio ?? 0.2);
    setMaxError(saved?.maxError ?? 0.03);
    setHeight(saved?.height ?? 32);
    setMode("pose");
    setFocus("all");
    setSelected("");
    setSolo(null);
    setProfile(loadedProfile);
    setProfileText(JSON.stringify(loadedProfile, null, 2));
    setBinding(saved?.binding ?? (s.profile ? "humanoid" : "static"));
    setMessage("模型已加载，先检查材质和姿势。");
    setRevision(0);
    setSavedRevision(fromVersion ? -1 : 0);
    setSaveOpen(false);
    location.hash = "#/workbench";
  }
  async function action(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessage("操作未完成");
    } finally {
      setBusy(false);
    }
  }
  function convert() {
    void action(async () => {
      setMessage("提交转换任务…");
      const j = await post("/api/convert", {
        session: session!.id,
        excluded,
        materialWeights,
        binding,
        ratio,
        maxError,
        height,
        profile,
      });
      for (;;) {
        const state = await api("/api/job/" + j.id);
        setMessage(state.message);
        if (state.status === "error") throw Error(state.message);
        if (state.status === "done") {
          setResult({ id: j.id, ...state.result, cached: !!j.cached });
          setResultRevision(revision);
          setSavedRevision(revision);
          setMode("result");
          setFocus("all");
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    });
  }
  function updateProfile(key: string, value: number) {
    setMode("pose");
    setProfile((p: any) => ({ ...p, [key]: value }));
    changed();
  }
  const estimate = estimateTriangles(
    session?.materials ?? [],
    excluded,
    ratio,
    binding,
  );
  const settings = {binding, ratio, maxError, height, excluded, materialWeights, profile};
  const dirty = !!session && revision !== savedRevision;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function saveSettings() {
    if (!session?.modelId) return;
    await post("/api/models/update", {id: session.modelId, settings});
    setSavedRevision(revision); setMessage("编辑配置已保存");
  }
  const stale = !!result && revision !== resultRevision;
  const page = hash.startsWith("#/templates") ? "templates" : hash.startsWith("#/models") ? "models" : (hash.startsWith("#/packs") || hash.startsWith("#/game")) ? "packs" : hash.startsWith("#/workbench") ? "workbench" : "home";
  const navigation = <><header className="app-nav"><a className="brand" href="#/">4D<span>Gen</span><i>LOCAL STUDIO</i></a><nav aria-label="主导航">{[["home","概览","#/"],["models","源模型","#/models"],["workbench","工作台","#/workbench"],["templates","皮肤模板","#/templates"],["packs","皮肤包","#/packs"]].map(([key,label,to])=><a key={key} className={page===key?"active":""} aria-current={page===key?"page":undefined} href={to}>{label}</a>)}</nav><div className="header-right"><button onClick={()=>setStorageOpen(true)}>数据目录</button>{session&&<span className="current-model" title={session.name}>{session.name}</span>}{page==="workbench"&&session?.modelId&&<button disabled={busy} onClick={()=>void action(async()=>{await saveSettings();})}>{dirty ? "保存配置 ●" : "配置已保存"}</button>}<span className="local"><b/> 本地环境运行</span></div></header>{storageOpen&&<StorageDialog onClose={()=>setStorageOpen(false)}/>}</>;
  if (page !== "workbench") return <div className="app">{navigation}{page === "packs" ? <PackPage/> : page === "templates" ? <TemplatesPage/> : <LibraryPage key={page} home={page==="home"} onOpen={(s,settings)=>{if(busy)return;if(dirty&&!window.confirm("当前模型的配置尚未保存，仍要打开另一个模型吗？"))return;accept(settings?{...s,settings}:s,!!settings);}}/>}</div>;

  return (
    <div className="app">
      {navigation}
      <div className="workflow-strip"><a href="#/models">01 源模型</a><span>→</span><b>02 调整与生成</b><span>→</span><button disabled={!result || stale || busy} onClick={() => setSaveOpen(true)}>03 保存皮肤</button><span>→</span><a href="#/packs">04 整理与使用</a><small>{busy ? "正在生成，请稍候" : dirty ? "编辑配置未保存" : session ? "配置已保存" : "先选择一个源模型"}</small></div>
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
                  <br /><a href="#/models">打开模型管理 →</a>
                </p>
              </div>
            )}
            <div className="stage-badge">
              {mode === "pose"
                  ? "调整预览 / 原始贴图"
                  : "128 × 128 / BEDROCK"}
              {selected && <span> / {selected}</span>}
            </div>
          </div>
          <div className="toolbar">
            <label>
              <input
                type="checkbox"
                checked={unlit}
                onChange={(e) => setUnlit(e.target.checked)}
              />{" "}
              无光照
            </label>
            <label>
              <input
                type="checkbox"
                checked={wire}
                onChange={(e) => setWire(e.target.checked)}
              />{" "}
              线框
            </label>
            {mode === "result" && (
              <select value={focus} onChange={(e) => setFocus(e.target.value)}>
                <option value="all">全部部位</option>
                {[
                  "head",
                  "body",
                  "leftArm",
                  "rightArm",
                  "leftLeg",
                  "rightLeg",
                ].map((p, i) => (
                  <option key={p} value={p}>
                    {["头部", "身体", "左臂", "右臂", "左腿", "右腿"][i]}
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
          <OutputPanels result={result} stale={stale} session={session} selected={selected} onSelect={setSelected} />
        </main>
        <SettingsPanel
          session={session} busy={busy} binding={binding} setBinding={setBinding}
          changed={changed} ratio={ratio} setRatio={setRatio} estimate={estimate}
          result={result} stale={stale} maxError={maxError} setMaxError={setMaxError}
          height={height} setHeight={setHeight} setMode={setMode} profile={profile}
          updateProfile={updateProfile} profileText={profileText} setProfileText={setProfileText}
          setProfile={setProfile} setError={setError} convert={convert}
          error={error} message={message} elapsed={elapsed}
          openPacks={() => setSaveOpen(true)}
        />
      </div>
      {saveOpen && result && !stale && <SaveSkinDialog jobId={result.id} modelName={session?.name ?? "新皮肤"} onClose={() => setSaveOpen(false)} onSaved={id => { setSaveOpen(false); location.hash = "#/packs?pack=" + encodeURIComponent(id); }} />}
      <footer>
        <span>4DGen / 本地模型工作台</span>
        <span>文件在本地环境处理 · 启用皮肤包时会写入游戏目录</span>
      </footer>

    </div>
  );
}

