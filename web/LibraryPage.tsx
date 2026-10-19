import { useEffect, useMemo, useRef, useState } from "react";
import { api, post } from "./api";
import { ModelSources } from "./ModelSources";
import { Viewer } from "./Viewer";
import { PackPreview } from "./PackPreview";
import type { LibraryPack, Packs } from "./pack-types";
import type { Session } from "./types";

type Model = {
  sourceAvailable?: boolean;
  id: string;
  name: string;
  path: string;
  created: string;
  updated: string;
  previewKey?: string;
  settings?: any;
  profile?: any;
  packIds?: string[];
  stats?: { triangles: number; materials: number; bytes: number };
};
type Row = {
  id: string;
  name: string;
  model: Model | null;
  packs: LibraryPack[];
};
const when = (v: string) =>
  new Date(v).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const num = (v?: number) => (v === undefined ? "—" : v.toLocaleString("zh-CN"));

export function LibraryPage({
  onOpen,
}: {
  onOpen: (s: Session, settings?: any) => void;
}) {
  const [models, setModels] = useState<Model[]>([]),
    [packs, setPacks] = useState<Packs | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("recent"),
    [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(
    new URLSearchParams(location.hash.split("?")[1]).get("model") ?? "",
  );
  const [tab, setTab] = useState("source"),
    [version, setVersion] = useState("");
  const [rename, setRename] = useState<string | null>(null),
    [name, setName] = useState("");
  const [deleting, setDeleting] = useState<Row | null>(null),
    [removeVersion, setRemoveVersion] = useState<string | null>(null);
  const [importing, setImporting] = useState(false),
    [path, setPath] = useState(""),
    [candidates, setCandidates] = useState<string[]>([]),
    [main, setMain] = useState(""),
    [pending, setPending] = useState("");
  const [linkTarget, setLinkTarget] = useState("");
  const [deleteSource, setDeleteSource] = useState(true);
  const [sources, setSources] = useState(false);
  const [relink, setRelink] = useState(false),
    [sourcePath, setSourcePath] = useState("");
  const files = useRef<HTMLInputElement>(null),
    folder = useRef<HTMLInputElement>(null);
  async function refresh() {
    const [m, p] = await Promise.all([
      api("/api/models"),
      api("/api/packs").catch((e) => ({ configured: false, error: String(e) })),
    ]);
    setModels(m);
    setPacks(p);
    setLoading(false);
  }
  useEffect(() => {
    void refresh().catch((e) => {
      setError(String(e));
      setLoading(false);
    });
  }, []);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setImporting(false);
        setRename(null);
        setDeleting(null);
        setRemoveVersion(null);
        setRelink(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy]);
  const rows = useMemo(() => {
    const byId = new Map(
      models.map((m) => [
        m.id,
        { id: m.id, name: m.name, model: m, packs: [] as LibraryPack[] },
      ]),
    );
    for (const p of packs?.library ?? []) {
      if (p.removed || p.draft) continue;
      const explicit = models.find((m) => m.packIds?.includes(p.id));
      let row = byId.get(explicit?.id ?? p.meta?.modelId ?? "");
      if (!row && !p.meta?.modelId) {
        const matches = models.filter((m) =>
          [m.name, m.path.split(/[\\/]/).pop()].includes(p.meta?.source ?? ""),
        );
        if (matches.length === 1) row = byId.get(matches[0].id);
      }
      if (row) row.packs.push(p);
    }
    return [...byId.values()];
  }, [models, packs]);
  const visible = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            (!query ||
              `${r.name} ${r.model?.path ?? ""} ${r.packs.map((p) => p.id).join(" ")}`
                .toLowerCase()
                .includes(query.toLowerCase())) &&
            (filter !== "source" || !r.packs.length) &&
            (filter !== "skin" || r.packs.length),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name, "zh-CN")
            : (b.model?.updated ?? b.packs[0]?.imported ?? "").localeCompare(
                a.model?.updated ?? a.packs[0]?.imported ?? "",
              ),
        ),
    [rows, query, sort, filter],
  );
  const row = visible.find((r) => r.id === selected) ?? visible[0] ?? null;
  const pack = row?.packs.find((p) => p.id === version) ?? row?.packs[0];
  useEffect(() => {
    setTab(
      new URLSearchParams(location.hash.split("?")[1]).get("tab") === "skins"
        ? "skins"
        : row?.model
          ? "source"
          : "skins",
    );
    setVersion("");
    setName(row?.name ?? "");
  }, [row?.id]);
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  async function open(m: Model, settings?: any) {
    await run("正在打开模型…", async () => {
      onOpen(await post("/api/models/open", { id: m.id }), settings);
    });
  }
  function acceptImport(data: any) {
    if (data.pending || data.local) {
      setCandidates(data.candidates);
      setMain(
        data.candidates.find((c: string) => !/(weapon|闭眼)/i.test(c)) ??
          data.candidates[0],
      );
      setPending(data.pending ?? "");
    } else {
      setImporting(false);
      onOpen(data);
    }
  }
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    await run("正在导入文件…", async () => {
      const form = new FormData();
      for (const f of Array.from(list)) {
        form.append("files", f);
        form.append("paths", f.webkitRelativePath || f.name);
      }
      acceptImport(await api("/api/upload", { method: "POST", body: form }));
    });
  }
  const active = (id: string) =>
    packs?.status
      ?.filter((s) => (s.active ?? []).some((p) => p.id === id))
      .map((s) => s.slot) ?? [];
  useEffect(() => {
    const change = () => {
      const params = new URLSearchParams(location.hash.split("?")[1]);
      if (params.get("model")) setSelected(params.get("model")!);
      if (params.get("tab") === "skins") setTab("skins");
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const choose = (r: Row) => {
    setSelected(r.id);
    location.hash = "#/models?model=" + encodeURIComponent(r.id);
  };
  return (
    <div className="page-content library-page">
      <div className="page-heading">
        <div>
          <h1>源模型</h1>
        </div>
        <div className="button-row">
          <button
            disabled={!!busy}
            onClick={() => void run("刷新中…", refresh)}
          >
            刷新
          </button>
          <button onClick={() => setSources(true)}>获取模型 ↗</button>
          <button
            className="primary"
            onClick={() => {
              setImporting(true);
              setCandidates([]);
              setPending("");
            }}
          >
            ＋ 导入模型
          </button>
        </div>
      </div>
      {error && (
        <div className="pack-message error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="pack-message" role="status">
          {notice}
        </div>
      )}
      {busy && (
        <div className="busy-line" role="status">
          <span className="spinner" />
          {busy}
        </div>
      )}
      {loading ? (
        <div className="empty-state">正在读取本地模型…</div>
      ) : (
        <>
          <div className="model-browser">
            <aside className="model-list">
              <div className="model-list-tools">
                <div className="library-toolbar">
                  <input
                    aria-label="搜索模型"
                    placeholder="搜索模型名称、路径或皮肤版本…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <select
                    aria-label="筛选模型"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">全部源模型</option>
                    <option value="source">未生成皮肤版本</option>
                    <option value="skin">有皮肤版本</option>
                  </select>
                  <select
                    aria-label="模型排序"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="recent">最近编辑</option>
                    <option value="name">名称排序</option>
                  </select>
                  <span>{visible.length} 项</span>
                </div>
              </div>
              <div className="model-list-scroll">
                {visible.map((r) => (
                  <button
                    className={
                      "model-row" + (r.id === row?.id ? " selected" : "")
                    }
                    key={r.id}
                    onClick={() => choose(r)}
                  >
                    <span className="model-avatar small">
                      {r.name.replace(/[【】]/g, "").slice(0, 1)}
                    </span>
                    <span className="model-row-copy">
                      <b>{r.name}</b>
                      <small>
                        {r.model
                          ? `${num(r.model.stats?.triangles)} 面`
                          : "待关联源模型"}{" "}
                        · {r.packs.length} 版本
                        {r.model?.sourceAvailable === false
                          ? " · 源文件丢失"
                          : ""}
                      </small>
                    </span>
                    {r.packs.some((p) => active(p.id).length > 0) && (
                      <span className="status-dot" title="已启用" />
                    )}
                  </button>
                ))}
                {!visible.length && (
                  <div className="empty-state">
                    <h3>{rows.length ? "没有匹配的模型" : "模型库为空"}</h3>
                    <p>
                      {rows.length
                        ? "试试其他名称或筛选条件。"
                        : "导入模型后会显示在这里。"}
                    </p>
                  </div>
                )}
              </div>
            </aside>
            <section className="model-detail">
              {row ? (
                <>
                  <div className="detail-heading">
                    <div>
                      <h2>{row.name}</h2>
                      <p>
                        {row.model
                          ? `最近编辑 ${when(row.model.updated)}`
                          : "历史皮肤版本 · 可关联源模型"}
                      </p>
                    </div>
                    <div className="button-row">
                      {row.model && (
                        <>
                          <button
                            disabled={!!busy}
                            onClick={() => {
                              setName(row.name);
                              setRename(row.id);
                            }}
                          >
                            重命名
                          </button>
                          <button
                            className="danger-button"
                            disabled={!!busy}
                            onClick={() => {
                              setDeleteSource(true);
                              setDeleting(row);
                            }}
                          >
                            删除模型
                          </button>
                          <button
                            className="primary"
                            disabled={!!busy}
                            onClick={() => void open(row.model!)}
                          >
                            继续编辑 →
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {row.model?.sourceAvailable === false && (
                    <div className="pack-message error">
                      源文件已移动或删除。重新定位文件后可以继续编辑，已生成的皮肤仍可使用。
                      <button
                        disabled={!!busy}
                        onClick={() => {
                          setSourcePath(row.model!.path);
                          setRelink(true);
                        }}
                      >
                        重新定位源文件
                      </button>
                    </div>
                  )}
                  <div className="detail-tabs">
                    <button
                      className={tab === "source" ? "active" : ""}
                      disabled={!row.model}
                      onClick={() => setTab("source")}
                    >
                      源模型
                    </button>
                    <button
                      className={tab === "skins" ? "active" : ""}
                      onClick={() => setTab("skins")}
                    >
                      皮肤版本 <span>{row.packs.length}</span>
                    </button>
                    <button
                      className={tab === "info" ? "active" : ""}
                      onClick={() => setTab("info")}
                    >
                      模型信息
                    </button>
                  </div>
                  {tab === "source" && row.model && (
                    <>
                      <div className="library-preview">
                        {row.model.previewKey ? (
                          <Viewer
                            session={{
                              id: row.id,
                              name: row.name,
                              profile: null,
                              materials: [],
                              warnings: [],
                            }}
                            previewUrl={"/api/models/" + row.id + "/preview"}
                            result={null}
                            mode="source"
                            excluded={[]}
                            wire={false}
                            unlit={true}
                            focus="all"
                            solo={null}
                            profile={
                              row.model.settings?.profile ??
                              row.model.profile ??
                              {}
                            }
                            height={32}
                            binding="static"
                            onSelect={() => {}}
                          />
                        ) : (
                          <div className="empty-state">
                            <p>打开工作台后即可生成模型预览。</p>
                            <button onClick={() => void open(row.model!)}>
                              打开模型
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="detail-stats">
                        <div>
                          <b>{num(row.model.stats?.triangles)}</b>
                          <small>源三角面</small>
                        </div>
                        <div>
                          <b>{num(row.model.stats?.materials)}</b>
                          <small>材质</small>
                        </div>
                        <div>
                          <b>{row.packs.length}</b>
                          <small>皮肤版本</small>
                        </div>
                        <div>
                          <b>{row.model.settings ? "已保存" : "未调整"}</b>
                          <small>编辑配置</small>
                        </div>
                      </div>
                    </>
                  )}
                  {tab === "skins" && (
                    <div className="versions-panel">
                      {!!row.packs.length ? (
                        <>
                          <div className="version-picker">
                            {row.packs.map((p) => (
                              <button
                                className={p.id === pack?.id ? "active" : ""}
                                key={p.id}
                                onClick={() => setVersion(p.id)}
                              >
                                <b>{p.meta?.versionName ?? p.id}</b>
                                <small>
                                  {when(p.imported)}
                                  {active(p.id).length ? " · 已启用" : ""}
                                </small>
                              </button>
                            ))}
                          </div>
                          {pack && (
                            <>
                              <PackPreview packId={pack.id} />
                              <div className="detail-stats">
                                <div>
                                  <b>{num(pack.stats?.triangles)}</b>
                                  <small>输出三角面</small>
                                </div>
                                <div>
                                  <b>
                                    {pack.stats?.texture
                                      ? `${pack.stats.texture.width}×${pack.stats.texture.height}`
                                      : "—"}
                                  </b>
                                  <small>贴图</small>
                                </div>
                                <div>
                                  <b>
                                    {pack.meta?.ratio
                                      ? `${Math.round(pack.meta.ratio * 100)}%`
                                      : "—"}
                                  </b>
                                  <small>保留面数比例</small>
                                </div>
                              </div>
                              <div className="version-actions">
                                <a
                                  className="button-link"
                                  href={
                                    "#/packs?pack=" +
                                    encodeURIComponent(pack.id)
                                  }
                                >
                                  在皮肤包管理中查看 →
                                </a>
                                {row.model && pack.meta && (
                                  <button
                                    disabled={!!busy}
                                    onClick={() =>
                                      void open(row.model!, {
                                        ...row.model?.settings,
                                        ...pack.meta,
                                      })
                                    }
                                  >
                                    以此版本配置编辑
                                  </button>
                                )}
                                <button
                                  className="danger-button"
                                  disabled={
                                    !!busy || active(pack.id).length > 0
                                  }
                                  onClick={() => setRemoveVersion(pack.id)}
                                >
                                  {active(pack.id).length
                                    ? "先停用才能删除"
                                    : "删除此版本"}
                                </button>
                              </div>
                              {!row.model && (
                                <div className="associate">
                                  <label>
                                    关联到源模型
                                    <select
                                      aria-label="关联源模型"
                                      value={linkTarget}
                                      onChange={(e) =>
                                        setLinkTarget(e.target.value)
                                      }
                                    >
                                      <option value="">选择模型</option>
                                      {models.map((m) => (
                                        <option key={m.id} value={m.id}>
                                          {m.name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <button
                                    disabled={!linkTarget || !!busy}
                                    onClick={() =>
                                      void run("正在关联…", async () => {
                                        await post("/api/models/update", {
                                          id: linkTarget,
                                          packId: pack.id,
                                        });
                                        setSelected(linkTarget);
                                        await refresh();
                                        setNotice("皮肤版本已关联");
                                      })
                                    }
                                  >
                                    确认关联
                                  </button>
                                </div>
                              )}
                              {pack.warnings.map((w) => (
                                <p key={w} className="inline-note">
                                  {w}
                                </p>
                              ))}
                            </>
                          )}
                        </>
                      ) : (
                        <div className="empty-state">
                          <h3>还没有皮肤版本</h3>
                          <p>在工作台生成皮肤后，将结果保存到当前模型。</p>
                          {row.model && (
                            <button onClick={() => void open(row.model!)}>
                              前往工作台
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {tab === "info" && (
                    <div className="model-information">
                      <dl>
                        <dt>源文件位置</dt>
                        <dd>{row.model?.path ?? "没有关联源模型"}</dd>
                        <dt>保存方式</dt>
                        <dd>
                          导入时将源模型与贴图复制到统一数据目录，原始下载文件可独立管理。
                        </dd>
                        <dt>导入时间</dt>
                        <dd>
                          {row.model ? when(row.model.created) : "历史导入"}
                        </dd>
                        <dt>模型 ID</dt>
                        <dd>{row.id}</dd>
                      </dl>
                      {row.model?.settings && (
                        <details>
                          <summary>已保存的编辑配置</summary>
                          <pre>
                            {JSON.stringify(row.model.settings, null, 2)}
                          </pre>
                        </details>
                      )}
                      {row.model && (
                        <button
                          disabled={!!busy}
                          onClick={() => {
                            setSourcePath(row.model!.path);
                            setRelink(true);
                          }}
                        >
                          重新定位源文件
                        </button>
                      )}
                      {row.model && (
                        <div className="danger-zone">
                          <p>
                            删除模型管理记录，可同时删除程序归档的源文件。已生成皮肤版本保留。
                          </p>
                          <button
                            className="danger-button"
                            onClick={() => {
                              setDeleteSource(true);
                              setDeleting(row);
                            }}
                          >
                            删除模型
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  选择一个模型查看预览和编辑记录。
                </div>
              )}
            </section>
          </div>
        </>
      )}
      {!packs?.configured && !loading && (
        <p className="inline-note">
          源模型可以正常管理。皮肤包路径配置完成前，可在工作台下载生成结果。
        </p>
      )}
      {relink && row?.model && (
        <div
          className="pick-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="重新定位源文件"
        >
          <form
            className="pick-box"
            onSubmit={(e) => {
              e.preventDefault();
              void run("正在更新源文件路径…", async () => {
                await post("/api/models/relink", {
                  id: row.id,
                  path: sourcePath.trim(),
                });
                setRelink(false);
                await refresh();
                setNotice("源文件位置已更新，打开工作台检查模型和贴图");
              });
            }}
          >
            <h2>重新定位源文件</h2>
            <p>
              选择同一个模型的新位置，编辑配置和历史版本会保留。贴图需随模型一起移动。
            </p>
            <label>
              模型文件绝对路径
              <input
                autoFocus
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
              />
            </label>
            <div className="pick-actions">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => setRelink(false)}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={!!busy || !sourcePath.trim()}
              >
                更新位置
              </button>
            </div>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </form>
        </div>
      )}
      {sources && <ModelSources onClose={() => setSources(false)} />}
      {importing && (
        <div
          className="pick-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="导入模型"
        >
          <div className="pick-box import-dialog">
            <div className="card-top">
              <h2>导入模型</h2>
              <button
                disabled={!!busy}
                aria-label="关闭导入"
                onClick={() => setImporting(false)}
              >
                ×
              </button>
            </div>
            <p>
              将模型与贴图一起复制到数据目录。支持本地环境路径、ZIP
              或完整模型文件夹。
            </p>
            <label>
              本地 ZIP / 模型 / 文件夹路径
              <input
                aria-label="本地模型路径"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  setCandidates([]);
                  setPending("");
                }}
                placeholder="E:\\下载\\角色.zip"
              />
            </label>
            <div className="button-row">
              <button
                disabled={!!busy || !path.trim()}
                onClick={() =>
                  void run("本地服务器正在导入…", async () =>
                    acceptImport(
                      await post("/api/local-import", { path: path.trim() }),
                    ),
                  )
                }
              >
                读取本地路径
              </button>
              <button disabled={!!busy} onClick={() => files.current?.click()}>
                选择文件
              </button>
              <button disabled={!!busy} onClick={() => folder.current?.click()}>
                选择文件夹
              </button>
            </div>
            <input
              hidden
              multiple
              ref={files}
              type="file"
              accept=".zip,.pmx,.vrm,.glb,.gltf,.obj,.fbx,.dae,.stl,.ply,.png,.jpg,.tga,.bin,.mtl"
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              hidden
              multiple
              ref={folder}
              type="file"
              {...{ webkitdirectory: "" }}
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = "";
              }}
            />
            {!!candidates.length && (
              <>
                <h3>选择包内模型</h3>
                <div className="pick-list">
                  {candidates.map((c) => (
                    <label key={c}>
                      <input
                        type="radio"
                        checked={main === c}
                        onChange={() => setMain(c)}
                      />
                      <span>{c}</span>
                    </label>
                  ))}
                </div>
                <button
                  className="primary"
                  disabled={!!busy || !main}
                  onClick={() =>
                    void run("正在导入所选模型…", async () =>
                      acceptImport(
                        await post(
                          pending ? "/api/upload/select" : "/api/local-import",
                          pending
                            ? { pending, main }
                            : { path: path.trim(), main },
                        ),
                      ),
                    )
                  }
                >
                  导入所选模型
                </button>
              </>
            )}
            {busy && <p role="status">{busy}</p>}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
      {rename && (
        <div
          className="pick-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="重命名模型"
        >
          <form
            className="pick-box"
            onSubmit={(e) => {
              e.preventDefault();
              void run("正在保存名称…", async () => {
                await post("/api/models/update", { id: rename, name });
                setRename(null);
                await refresh();
                setNotice("名称已更新");
              });
            }}
          >
            <h2>重命名模型</h2>
            <input
              autoFocus
              aria-label="模型名称"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="pick-actions">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => setRename(null)}
              >
                取消
              </button>
              <button className="primary" disabled={!!busy || !name.trim()}>
                保存名称
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </form>
        </div>
      )}
      {(deleting || removeVersion) && (
        <div
          className="pick-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="确认删除"
        >
          <div className="pick-box">
            <h2>{deleting ? "删除源模型？" : "删除皮肤版本？"}</h2>
            <p>
              {deleting
                ? `删除「${deleting.name}」的模型管理记录和编辑配置，已生成的皮肤包保留。`
                : "此皮肤版本将从本地存储中永久删除。"}
            </p>
            <div>
              {deleting && (
                <label className="delete-source-choice">
                  <input
                    type="checkbox"
                    checked={deleteSource}
                    onChange={(e) => setDeleteSource(e.target.checked)}
                  />
                  同时删除程序归档的源文件与独占贴图（原始下载文件保留）
                </label>
              )}
            </div>
            <div className="pick-actions">
              <button
                disabled={!!busy}
                onClick={() => {
                  setDeleting(null);
                  setRemoveVersion(null);
                }}
              >
                取消
              </button>
              <button
                className="danger-button"
                disabled={!!busy}
                onClick={() =>
                  void run("正在删除…", async () => {
                    await post(
                      deleting ? "/api/models/delete" : "/api/packs/delete",
                      {
                        id: deleting?.id ?? removeVersion,
                        deleteSource: !!deleting && deleteSource,
                      },
                    );
                    setDeleting(null);
                    setRemoveVersion(null);
                    setSelected("");
                    await refresh();
                    setNotice("已删除");
                  })
                }
              >
                确认删除
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
