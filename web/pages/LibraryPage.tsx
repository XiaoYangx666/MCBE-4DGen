import { useEffect, useMemo, useState } from "react";
import { api, post } from "../lib/api";
import { ModelSources } from "./ModelSources";
import { PackPreview } from "../packs/PackPreview";
import { Viewer } from "../workbench/Viewer";
import { findActivePack } from "../packs/pack-state";
import type { LibraryPack, Packs } from "../packs/pack-types";
import type { EditSettings } from "../../src/api-types";
import type { Session } from "../workbench/types";
import { DeleteModelDialog } from "../library/DeleteModelDialog";
import { ImportModelDialog } from "../library/ImportModelDialog";
import { ModelListPane } from "../library/ModelListPane";
import { RelinkModelDialog } from "../library/RelinkModelDialog";
import { RenameModelDialog } from "../library/RenameModelDialog";
import {
  errorMessage,
  num,
  when,
  type Model,
  type Row,
} from "../library/model-types";

export function LibraryPage({
  onOpen,
}: {
  onOpen: (session: Session, settings?: Partial<EditSettings>) => void;
}) {
  const [models, setModels] = useState<Model[]>([]);
  const [packs, setPacks] = useState<Packs | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(
    new URLSearchParams(location.hash.split("?")[1]).get("model") ?? "",
  );
  const [tab, setTab] = useState("source");
  const [version, setVersion] = useState("");
  const [linkTarget, setLinkTarget] = useState("");
  const [sources, setSources] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rename, setRename] = useState<Model | null>(null);
  const [deleting, setDeleting] = useState<Model | null>(null);
  const [removeVersion, setRemoveVersion] = useState<string | null>(null);
  const [relink, setRelink] = useState<Model | null>(null);

  async function refresh() {
    const [modelList, packList] = await Promise.all([
      api<Model[]>("/api/models"),
      api<Packs>("/api/packs").catch((reason) => ({
        configured: false,
        error: String(reason),
      })),
    ]);
    setModels(modelList);
    setPacks(packList);
    setLoading(false);
  }

  useEffect(() => {
    void refresh().catch((reason) => {
      setError(String(reason));
      setLoading(false);
    });
  }, []);

  const rows = useMemo(() => {
    const byId = new Map(
      models.map((model) => [
        model.id,
        {
          id: model.id,
          name: model.name,
          model,
          packs: [] as LibraryPack[],
        },
      ]),
    );
    for (const pack of packs?.library ?? []) {
      if (pack.removed || pack.draft) continue;
      const explicit = models.find((model) => model.packIds?.includes(pack.id));
      let row = byId.get(explicit?.id ?? pack.meta?.modelId ?? "");
      if (!row && !pack.meta?.modelId) {
        const matches = models.filter((model) =>
          [model.name, model.path.split(/[\\/]/).pop()].includes(
            pack.meta?.source ?? "",
          ),
        );
        if (matches.length === 1) row = byId.get(matches[0]!.id);
      }
      if (row) row.packs.push(pack);
    }
    return [...byId.values()];
  }, [models, packs]);

  const visible = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            (!query ||
              `${row.name} ${row.model?.path ?? ""} ${row.packs.map((pack) => pack.id).join(" ")}`
                .toLowerCase()
                .includes(query.toLowerCase())) &&
            (filter !== "source" || !row.packs.length) &&
            (filter !== "skin" || row.packs.length),
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
  const row = visible.find((item) => item.id === selected) ?? visible[0] ?? null;
  const pack =
    row?.packs.find((item) => item.id === version) ?? row?.packs[0];

  useEffect(() => {
    setTab(
      new URLSearchParams(location.hash.split("?")[1]).get("tab") === "skins"
        ? "skins"
        : row?.model
          ? "source"
          : "skins",
    );
    setVersion("");
  }, [row?.id]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  async function open(model: Model, settings?: Partial<EditSettings>) {
    await run("正在打开模型…", async () => {
      onOpen(await post<Session>("/api/models/open", { id: model.id }), settings);
    });
  }

  function active(packId: string) {
    return (
      packs?.status
        ?.filter((status) => findActivePack(status.active, packId))
        .map((status) => status.slot) ?? []
    );
  }

  useEffect(() => {
    const change = () => {
      const params = new URLSearchParams(location.hash.split("?")[1]);
      if (params.get("model")) setSelected(params.get("model")!);
      if (params.get("tab") === "skins") setTab("skins");
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);

  function choose(next: Row) {
    setSelected(next.id);
    location.hash = "#/models?model=" + encodeURIComponent(next.id);
  }

  async function refreshAfterDelete() {
    setDeleting(null);
    setRemoveVersion(null);
    setSelected("");
    try {
      await refresh();
      setNotice("已删除");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <div className="page-content library-page">
      <div className="page-heading actions-only">
        <div className="button-row">
          <button disabled={!!busy} onClick={() => void run("刷新中…", refresh)}>
            刷新
          </button>
          <button onClick={() => setSources(true)}>获取模型 ↗</button>
          <button className="primary" onClick={() => setImporting(true)}>
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
        <div className="model-browser">
          <ModelListPane
            rows={rows}
            visible={visible}
            selectedId={row?.id}
            query={query}
            filter={filter}
            sort={sort}
            onQueryChange={setQuery}
            onFilterChange={setFilter}
            onSortChange={setSort}
            onChoose={choose}
            activeSlots={active}
          />
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
                          onClick={() => setRename(row.model)}
                        >
                          重命名
                        </button>
                        <button
                          className="danger-button"
                          disabled={!!busy}
                          onClick={() => setDeleting(row.model)}
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
                      onClick={() => setRelink(row.model!)}
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
                            row.model.settings?.profile ?? row.model.profile ?? {}
                          }
                          height={32}
                          binding="static"
                          includedParts={new Set()}
                          selectedPart={null}
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
                          {row.packs.map((item) => (
                            <button
                              className={item.id === pack?.id ? "active" : ""}
                              key={item.id}
                              onClick={() => setVersion(item.id)}
                            >
                              <b>{item.meta?.versionName ?? item.id}</b>
                              <small>
                                {when(item.imported)}
                                {active(item.id).length ? " · 已启用" : ""}
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
                                  "#/packs?pack=" + encodeURIComponent(pack.id)
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
                                    onChange={(event) =>
                                      setLinkTarget(event.target.value)
                                    }
                                  >
                                    <option value="">选择模型</option>
                                    {models.map((model) => (
                                      <option key={model.id} value={model.id}>
                                        {model.name}
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
                            {pack.warnings.map((warning) => (
                              <p key={warning} className="inline-note">
                                {warning}
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
                        <pre>{JSON.stringify(row.model.settings, null, 2)}</pre>
                      </details>
                    )}
                    {row.model && (
                      <button
                        disabled={!!busy}
                        onClick={() => setRelink(row.model!)}
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
                          onClick={() => setDeleting(row.model)}
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
      )}
      {!packs?.configured && !loading && (
        <p className="inline-note">
          源模型可以正常管理。皮肤包路径配置完成前，可在工作台下载生成结果。
        </p>
      )}
      {importing && (
        <ImportModelDialog
          onClose={() => setImporting(false)}
          onImported={(session) => {
            setImporting(false);
            onOpen(session);
          }}
        />
      )}
      {rename && (
        <RenameModelDialog
          model={rename}
          onClose={() => setRename(null)}
          onSaved={async () => {
            await refresh();
            setNotice("名称已更新");
          }}
        />
      )}
      {relink && (
        <RelinkModelDialog
          model={relink}
          onClose={() => setRelink(null)}
          onSaved={async () => {
            await refresh();
            setNotice("源文件位置已更新，打开工作台检查模型和贴图");
          }}
        />
      )}
      {(deleting || removeVersion) && (
        <DeleteModelDialog
          target={
            deleting
              ? { kind: "model", model: deleting }
              : { kind: "version", id: removeVersion! }
          }
          onClose={() => {
            setDeleting(null);
            setRemoveVersion(null);
          }}
          onDeleted={refreshAfterDelete}
        />
      )}
      {sources && <ModelSources onClose={() => setSources(false)} />}
    </div>
  );
}
