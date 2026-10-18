import { useEffect, useRef, useState } from "react";
import { Viewer } from "./Viewer";
import { MaterialPanel } from "./MaterialPanel";
import { OutputPanels } from "./OutputPanels";
import { SettingsPanel } from "./SettingsPanel";
import { api, post } from "./api";
import { estimateTriangles } from "./estimate";
import type { Result, Session } from "./types";

export function App() {
  const [presets, setPresets] = useState<{ id: string; name: string }[]>([]),
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
    [message, setMessage] = useState("选择示例或导入模型，开始调整。"),
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
    [resultRevision, setResultRevision] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api("/api/presets")
      .then(setPresets)
      .catch((e) => setError(String(e)));
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
  function changed() {
    setRevision((v) => v + 1);
  }
  function accept(s: Session) {
    const loadedProfile = s.profile
      ? { ...s.profile, shoulderOutset: 0 }
      : { rotationYDegrees: 0, shoulderOutset: 0, armSpreadDegrees: 0 };
    setSession(s);
    setResult(null);
    setExcluded([]);
    setMaterialWeights({});
    setMode("pose");
    setFocus("all");
    setSelected("");
    setSolo(null);
    setProfile(loadedProfile);
    setProfileText(JSON.stringify(loadedProfile, null, 2));
    setBinding(s.profile ? "humanoid" : "static");
    setMessage("模型已加载，先检查材质和姿势。");
    setRevision(0);
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
  function openPreset(id: string) {
    void action(async () => {
      setMessage("正在导入模型并准备预览…");
      accept(await post("/api/load", { preset: id }));
    });
  }
  function upload(files: FileList | null) {
    if (!files?.length) return;
    void action(async () => {
      setMessage("正在上传并导入…");
      const form = new FormData();
      for (const file of Array.from(files)) {
        form.append("files", file);
        form.append("paths", file.webkitRelativePath || file.name);
      }
      accept(await api("/api/upload", { method: "POST", body: form }));
    });
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
  const stale = !!result && revision !== resultRevision;
  return (
    <div className="app">
      <header>
        <a className="brand" href="/">
          4D<span>Gen</span>
          <i>LOCAL STUDIO</i>
        </a>
        <div className="header-center">
          模型 → 玩家皮肤<span> / </span>可视化工作台
        </div>
        <span className="local">
          <b /> 本地环境运行
        </span>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="section-label">01 / 导入模型</div>
          <details className="import-controls" key={session ? "loaded" : "empty"} open={!session}>
          <summary>{session ? "更换 / 导入模型" : "选择模型文件"}</summary>
          <div className="import-box">
            <span className="upload-symbol">↥</span>
            <strong>导入你的模型</strong>
            <small>ZIP · PMX · VRM · GLB · OBJ…</small>
            <div className="button-row">
              <button disabled={busy} onClick={() => input.current?.click()}>
                选择文件
              </button>
              <button
                disabled={busy}
                onClick={() => folderInput.current?.click()}
              >
                选择文件夹
              </button>
            </div>
            <p>PMX / OBJ 请连同贴图一起选择，或导入 ZIP。</p>
          </div>
          <input
            hidden
            multiple
            type="file"
            ref={input}
            onChange={(e) => {
              upload(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            hidden
            multiple
            type="file"
            ref={folderInput}
            {...{ webkitdirectory: "" }}
            onChange={(e) => {
              upload(e.target.files);
              e.target.value = "";
            }}
          />
          {!!presets.length && (
            <div className="samples">
              <span>本地示例</span>
              {presets.map((p) => (
                <button
                  disabled={busy}
                  key={p.id}
                  onClick={() => openPreset(p.id)}
                >
                  {p.name} ↗
                </button>
              ))}
            </div>
          )}
          </details>
          <MaterialPanel
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
                  导入模型或选择左侧示例
                  <br />
                  在三维视图中检查，再生成皮肤包。
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
          <OutputPanels result={result} stale={stale} />
        </main>
        <SettingsPanel
          session={session} busy={busy} binding={binding} setBinding={setBinding}
          changed={changed} ratio={ratio} setRatio={setRatio} estimate={estimate}
          result={result} stale={stale} maxError={maxError} setMaxError={setMaxError}
          height={height} setHeight={setHeight} setMode={setMode} profile={profile}
          updateProfile={updateProfile} profileText={profileText} setProfileText={setProfileText}
          setProfile={setProfile} setError={setError} convert={convert}
          error={error} message={message} elapsed={elapsed}
        />
      </div>
      <footer>
        <span>4DGen / 本地模型工作台</span>
        <span>文件在本地环境处理 · 导出不会写入游戏目录</span>
      </footer>
    </div>
  );
}
