import { useEffect, useRef, useState } from "react";
import { api, post } from "./api";
import { PackPreview } from "./PackPreview";
import type { Contents, LibraryPack, Packs, SkinItem } from "./pack-types";

const gameSlot = (slot: string) =>
  ({ custom: "自定义皮肤", persona: "角色皮肤" })[slot] ?? slot;

type PackRow = {
  key: string;
  id: string;
  name: string;
  skins: number;
  revision: string;
  preset: boolean;
  pack?: LibraryPack;
};

export function PackPage() {
  const [view, setView] = useState(
    location.hash.startsWith("#/game") ? "game" : "library",
  );
  useEffect(() => {
    const change = () => {
      const game = location.hash.startsWith("#/game");
      setView(game ? "game" : "library");
      const pack = new URLSearchParams(location.hash.split("?")[1]).get("pack");
      setSelected(pack ?? (game ? "@custom" : ""));
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const [data, setData] = useState<Packs | null>(null);
  const [selected, setSelected] = useState(
    new URLSearchParams(location.hash.split("?")[1]).get("pack") ??
      (location.hash.startsWith("#/game") ? "@custom" : ""),
  );
  const [models, setModels] = useState<
    { id: string; name: string; path: string; packIds?: string[] }[]
  >([]);
  const [query, setQuery] = useState("");
  const [contents, setContents] = useState<Contents | null>(null);
  const [skinIndex, setSkinIndex] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<
    | "create"
    | "import"
    | "delete"
    | "rename-pack"
    | "rename-skin"
    | "remove-skin"
    | "add"
    | null
  >(null);
  const [name, setName] = useState("");
  const [importPath, setImportPath] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceContents, setSourceContents] = useState<Contents | null>(null);
  const [indices, setIndices] = useState<number[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    const [packs, sources] = await Promise.all([
      api("/api/packs"),
      api("/api/models"),
    ]);
    setData(packs);
    setModels(sources);
    setTick((v) => v + 1);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, []);
  const library = data?.library?.filter((p) => !p.removed) ?? [];
  const presets: PackRow[] = ["custom", "persona"]
    .filter((id) => data?.slots?.[id])
    .map((id) => {
      const state = data?.status?.find((s) => s.slot === id);
      return {
        key: "@" + id,
        id,
        name: state?.name ?? gameSlot(id),
        preset: true,
        skins: state?.skins ?? 0,
        revision: JSON.stringify(state?.active) + state?.changedOutsideManager,
      };
    });
  const presetSourceIds = new Set(
    data?.status?.flatMap((s) => s.presetSources ?? []) ?? [],
  );
  const local: PackRow[] = library
    .filter((p) => !presetSourceIds.has(p.id))
    .map((pack) => ({
      key: pack.id,
      id: pack.id,
      name: pack.name,
      skins: pack.skins,
      revision: pack.revision,
      preset: false,
      pack,
    }));
  const matches = (p: PackRow) =>
    !query || p.name.toLowerCase().includes(query.toLowerCase());
  const visible = (view === "game" ? presets : local).filter(matches);
  const row = visible.find((p) => p.key === selected) ?? visible[0];

  const baseUrl = row
    ? `/api/${row.preset ? "preset-packs" : "packs"}/${row.id}`
    : "";
  const enabled = (id: string) =>
    data?.status?.filter((s) => (s.active ?? []).some((p) => p.id === id)) ??
    [];
  const state = row?.preset
    ? data?.status?.find((s) => s.slot === row.id)
    : undefined;
  const locked = !!state?.pending || !!state?.changedOutsideManager;
  const skin =
    contents && row && contents.id === row.id
      ? contents.skins.find((s) => s.index === skinIndex)
      : undefined;
  const sourceModel = skin?.origin?.modelId
    ? models.find((m) => m.id === skin.origin?.modelId)
    : undefined;

  useEffect(() => {
    if (!row) {
      setContents(null);
      return;
    }
    if (row.preset && !state?.exists) {
      setContents({
        id: row.id,
        name: row.name,
        revision: row.revision,
        skins: [],
      });
      return;
    }
    let cancelled = false;
    setContents(null);
    api(baseUrl + "/skins")
      .then((c) => {
        if (!cancelled) {
          setContents(c);
          setSkinIndex((i) =>
            c.skins.some((s: SkinItem) => s.index === i) ? i : 0,
          );
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [row?.key, row?.revision, tick]);
  useEffect(() => {
    setSourceContents(null);
    setIndices([]);
    if (!sourceId || dialog !== "add") return;
    let cancelled = false;
    api(`/api/packs/${sourceId}/skins`)
      .then((c) => {
        if (!cancelled) {
          setSourceContents(c);
          setIndices(c.skins.map((s: SkinItem) => s.index));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId, dialog]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setDialog(null);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy]);

  async function run(
    label: string,
    fn: () => Promise<unknown>,
    message = "操作已完成",
  ) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  function show(kind: NonNullable<typeof dialog>) {
    setDialog(kind);
    setError("");
    setName(
      kind === "rename-pack"
        ? (row?.name ?? "")
        : kind === "rename-skin"
          ? (skin?.name ?? "")
          : "",
    );
    if (kind === "add") setSourceId("");
  }
  async function importFile(file?: File) {
    if (!file) return;
    await run(
      "正在导入皮肤包…",
      async () => {
        const form = new FormData();
        form.append("file", file);
        const pack = await api("/api/packs/import", {
          method: "POST",
          body: form,
        });
        setQuery("");
        setSelected(pack.id);
        setDialog(null);
      },
      "皮肤包已导入",
    );
  }
  const sourceOptions = library.filter(
    (p) => p.skins > 0 && p.id !== row?.id,
  );
  function packageButton(p: PackRow) {
    const game = p.preset
      ? data?.status?.find((s) => s.slot === p.id)?.exists
      : enabled(p.id).length > 0;
    return (
      <button
        key={p.key}
        title={p.name}
        className={
          "pack-library-row text-only" + (p.key === row?.key ? " selected" : "")
        }
        onClick={() => {
          setSelected(p.key);
          setSkinIndex(0);
          setNotice("");
          setError("");
        }}
      >
        <span>
          <b>{p.name}</b>
          <small>
            {p.skins} 套皮肤
            {p.preset ? " · " + p.id : p.pack?.draft ? " · 空包" : ""}
          </small>
        </span>
        {game && (
          <span className="pack-game-badge">
            {p.preset
              ? "游戏中"
              : "游戏中 · " +
                enabled(p.id)
                  .map((s) => s.slot)
                  .join(" / ")}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="page-content pack-manager-page">
      <div className="collection-workbar">
        <h1>皮肤包</h1>
        <nav className="collection-tabs" aria-label="皮肤包范围">
          <a className={view === "library" ? "active" : ""} href="#/packs">
            本地包 <span>{local.length}</span>
          </a>
          <a className={view === "game" ? "active" : ""} href="#/game">
            游戏中 <span>{presets.length}</span>
          </a>
        </nav>
        <div className="pack-top-actions">
          <button
            disabled={!!busy}
            onClick={() => void run("正在刷新…", refresh)}
          >
            刷新
          </button>
          {view === "library" && (
            <>
              <button
                disabled={!!busy || !data?.configured}
                onClick={() => show("import")}
              >
                导入
              </button>
              <button
                className="primary"
                disabled={!!busy || !data?.configured}
                onClick={() => show("create")}
              >
                ＋ 新建包
              </button>
            </>
          )}
          <details className="pack-connection">
            <summary>目录信息</summary>
            <div>
              <a href="#/settings">打开设置 →</a>
              <b>游戏目录</b>
              <p>{data?.root ?? "未配置"}</p>
              <b>本地管理</b>
              <p>{data?.stateDir}</p>
              <p>写入游戏前请完全退出 Minecraft。</p>
            </div>
          </details>
        </div>
      </div>
      {view === "game" && data?.gameConfigured === false && (
        <div className="pack-message">
          尚未配置游戏目录，请先配置 skin-manager.local.json。
        </div>
      )}
      {error && (
        <div role="alert" className="pack-message error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="pack-message">
          {notice}
        </div>
      )}
      {busy && (
        <div role="status" className="busy-line">
          <span className="spinner" />
          {busy}
        </div>
      )}
      {!data ? (
        <div className="empty-state">正在读取皮肤包…</div>
      ) : !data.configured ? (
        <div className="empty-state">
          <h2>尚未配置游戏目录</h2>
          <p>{data.error}</p>
        </div>
      ) : (
        <>
          <div className="pack-browser">
            <aside className="pack-list-pane organized-packs">
              <div className="pack-sidebar-head">
                <input
                  aria-label="搜索皮肤包"
                  placeholder="搜索皮肤包…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="pack-sidebar-scroll">
                {visible.map(packageButton)}
                {!visible.length && (
                  <div className="small-empty">
                    {query ? "没有匹配的本地包" : "新建或导入你的皮肤包"}
                  </div>
                )}
              </div>
            </aside>
            <section className="pack-content-pane">
              {row ? (
                <>
                  <div className="pack-detail-bar">
                    <div>
                      <h2 title={row.name}>
                        {row.name}
                        {row.preset && (
                          <span className="preset-title-badge">游戏预制</span>
                        )}
                      </h2>
                      <span>
                        {contents?.skins.length ?? row.skins} 套皮肤
                        {row.preset ? " · 来自游戏目录" : " · 本地皮肤包"}
                      </span>
                    </div>
                    <div className="pack-detail-actions">
                      <button
                        disabled={!!busy || locked}
                        onClick={() => show("add")}
                      >
                        ＋ 添加皮肤
                      </button>
                      {row.preset && (
                        <button
                          disabled={!!busy || locked}
                          onClick={() => show("rename-pack")}
                        >
                          修改包名
                        </button>
                      )}
                      {row.preset ? (
                        <>
                          <button
                            disabled={
                              !!busy ||
                              !state?.managed ||
                              !state.active?.length ||
                              locked
                            }
                            onClick={() =>
                              void run(
                                "正在恢复…",
                                () =>
                                  post("/api/packs/restore", { slot: row.id }),
                                "已恢复初始皮肤包",
                              )
                            }
                          >
                            恢复初始
                          </button>
                          {!!state?.pending && (
                            <button
                              disabled={!!busy}
                              onClick={() =>
                                void run("正在恢复…", () =>
                                  post("/api/packs/recover", { slot: row.id }),
                                )
                              }
                            >
                              恢复中断
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <a
                            className="button-link"
                            href={
                              row.skins
                                ? `/api/packs/${encodeURIComponent(row.id)}/download`
                                : undefined
                            }
                            aria-disabled={!row.skins}
                            title={
                              row.skins ? "下载完整皮肤包" : "先添加皮肤再导出"
                            }
                            download
                          >
                            导出 .zip
                          </a>
                          <button
                            disabled={!!busy}
                            onClick={() => show("rename-pack")}
                          >
                            修改包名
                          </button>
                          <button
                            className="danger-button"
                            disabled={!!busy || enabled(row.id).length > 0}
                            title={
                              enabled(row.id).length
                                ? "先从游戏中移除，才能删除本地包"
                                : ""
                            }
                            onClick={() => show("delete")}
                          >
                            {enabled(row.id).length
                              ? "游戏中，暂不可删除"
                              : "删除包"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {state?.changedOutsideManager && (
                    <p className="inline-note">
                      游戏目录有外部改动，已暂停写入。你仍可查看包内皮肤。
                    </p>
                  )}
                  {!!row.pack?.meta?.importWarnings?.length && (
                    <details className="inline-note">
                      <summary>
                        导入提示：{row.pack?.meta.importWarnings.length}{" "}
                        条无效皮肤未导入
                      </summary>
                      {row.pack?.meta.importWarnings.map((message, index) => (
                        <p key={index}>{message}</p>
                      ))}
                    </details>
                  )}
                  <div className="skin-content-layout">
                    <div className="skin-list-pane">
                      <div className="pane-caption">包内皮肤</div>
                      {!contents ? (
                        <p className="muted">正在读取…</p>
                      ) : (
                        contents.skins.map((s) => (
                          <button
                            className={
                              "skin-item text-only" +
                              (s.index === skinIndex ? " selected" : "")
                            }
                            key={s.index}
                            onClick={() => setSkinIndex(s.index)}
                          >
                            <span className="skin-order">{s.index + 1}</span>
                            <span>
                              <b>{s.name}</b>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                    <div className="skin-detail-pane">
                      {skin ? (
                        <>
                          <div className="skin-title">
                            <h3>{skin.name}</h3>
                            <div className="selected-skin-actions">
                              <button
                                disabled={!!busy || locked}
                                onClick={() => show("rename-skin")}
                              >
                                重命名
                              </button>
                              <button
                                className="danger-button"
                                disabled={!!busy || locked}
                                onClick={() => show("remove-skin")}
                              >
                                {row.preset ? "从游戏中移除" : "移出此包"}
                              </button>
                            </div>
                          </div>
                          <div className="skin-origin-bar">
                            <span>皮肤来源</span>
                            {sourceModel ? (
                              <a
                                href={
                                  "#/models?model=" +
                                  encodeURIComponent(sourceModel.id)
                                }
                              >
                                {sourceModel.name} ↗
                              </a>
                            ) : skin.origin?.template === "image" ? (
                              <a
                                href={
                                  "#/templates?pack=" +
                                  encodeURIComponent(skin.origin.packId)
                                }
                              >
                                图片模板 · 继续编辑 ↗
                              </a>
                            ) : (
                              <span>未记录来源</span>
                            )}
                          </div>
                          <PackPreview
                            packId={row.id}
                            baseUrl={baseUrl}
                            skinIndex={skinIndex}
                            revision={contents?.revision ?? row.revision}
                          />
                          {row.preset ? (
                            <details className="preset-sources">
                              <summary>已加入的本地包</summary>
                              {state?.active
                                ?.filter((p) => !presetSourceIds.has(p.id))
                                .map((p) => (
                                  <button
                                    key={p.id}
                                    onClick={() => {
                                      location.hash =
                                        "#/packs?pack=" +
                                        encodeURIComponent(p.id);
                                      setQuery("");
                                    }}
                                  >
                                    {library.find((x) => x.id === p.id)?.name ??
                                      p.id}{" "}
                                    →
                                  </button>
                                ))}
                              {!state?.active?.some(
                                (p) => !presetSourceIds.has(p.id),
                              ) && <span>预制皮肤</span>}
                            </details>
                          ) : (
                            <div className="skin-actions">
                              <span>整包安装</span>
                              {presets.map((p) => {
                                const slot = data.status?.find(
                                  (s) => s.slot === p.id,
                                );
                                const active = slot?.active?.find(
                                  (x) => x.id === row.id,
                                );
                                const pendingUpdate =
                                  active && active.revision !== row.revision;
                                const disabled =
                                  !!busy ||
                                  !!slot?.pending ||
                                  !!slot?.changedOutsideManager;
                                return (
                                  <div key={p.id} className="skin-action-group">
                                    {active ? (
                                      <>
                                        <span className="enabled-label">
                                          游戏中 · {p.id}
                                        </span>
                                        {pendingUpdate && (
                                          <button
                                            disabled={disabled}
                                            onClick={() =>
                                              void run(
                                                "正在更新…",
                                                () =>
                                                  post(
                                                    "/api/packs/apply-update",
                                                    { slot: p.id, id: row.id },
                                                  ),
                                                "已更新到游戏",
                                              )
                                            }
                                          >
                                            更新到游戏
                                          </button>
                                        )}
                                        <button
                                          disabled={disabled}
                                          onClick={() =>
                                            void run(
                                              "正在移除…",
                                              () =>
                                                post("/api/packs/disable", {
                                                  slot: p.id,
                                                  id: row.id,
                                                }),
                                              "已从游戏中移除，本地包保留",
                                            )
                                          }
                                        >
                                          从 {p.id} 移除
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        disabled={disabled || !row.skins}
                                        onClick={() =>
                                          void run(
                                            "正在加入游戏…",
                                            () =>
                                              post("/api/packs/enable", {
                                                slot: p.id,
                                                id: row.id,
                                              }),
                                            "已加入游戏",
                                          )
                                        }
                                      >
                                        加入 {p.id}
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <p className="game-write-note">
                            写入或恢复游戏皮肤前，请完全退出 Minecraft。
                            {row.preset
                              ? "改名与移除只影响游戏中的副本。"
                              : "修改本地包后，可手动更新到游戏。"}
                          </p>
                        </>
                      ) : (
                        contents && (
                          <div className="empty-state empty-pack">
                            <h2>
                              {row.preset
                                ? "此预制包暂无皮肤"
                                : "这是一个空皮肤包"}
                            </h2>
                            <p>添加已有皮肤，或先到工作台生成新皮肤。</p>
                            <div className="button-row">
                              <button
                                className="primary"
                                disabled={!!busy || locked}
                                onClick={() => show("add")}
                              >
                                添加已有皮肤
                              </button>
                              <a className="button-link" href="#/models">
                                去生成皮肤 →
                              </a>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state">没有匹配的皮肤包。</div>
              )}
            </section>
          </div>
        </>
      )}
      {dialog && (
        <div
          className="pick-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={
            dialog === "create"
              ? "新建皮肤包"
              : dialog === "import"
                ? "导入皮肤包"
                : dialog === "remove-skin"
                  ? "移除皮肤"
                  : dialog === "delete"
                    ? "删除皮肤包"
                    : dialog === "add"
                      ? "添加皮肤"
                      : "修改名称"
          }
        >
          <div className="pick-box pack-operation-dialog">
            <div className="card-top">
              <h2>
                {dialog === "create"
                  ? "新建皮肤包"
                  : dialog === "import"
                    ? "导入皮肤包"
                    : dialog === "remove-skin"
                      ? "移除这个皮肤？"
                      : dialog === "delete"
                        ? "删除皮肤包？"
                        : dialog === "add"
                          ? "添加皮肤"
                          : dialog === "rename-pack"
                            ? "修改包名"
                            : "修改皮肤名"}
              </h2>
              <button
                disabled={!!busy}
                aria-label="关闭弹窗"
                onClick={() => setDialog(null)}
              >
                ×
              </button>
            </div>
            {["create", "rename-pack", "rename-skin"].includes(dialog) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    "正在保存…",
                    async () => {
                      if (dialog === "create") {
                        const p = await post("/api/packs/create", { name });
                        setQuery("");
                        setSelected(p.id);
                      } else if (row)
                        await post(
                          row.preset
                            ? "/api/packs/edit-installed"
                            : "/api/packs/rename",
                          dialog === "rename-pack"
                            ? {
                                id: row.id,
                                slot: row.id,
                                name,
                                revision: contents?.revision,
                              }
                            : {
                                id: row.id,
                                slot: row.id,
                                skinIndex,
                                skinName: name,
                                revision: contents?.revision,
                              },
                        );
                      setDialog(null);
                    },
                    dialog === "create"
                      ? "皮肤包已创建，可以开始添加皮肤"
                      : "名称已保存",
                  );
                }}
              >
                <label>
                  名称
                  <input
                    aria-label="名称"
                    autoFocus
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                {dialog === "create" && (
                  <p>先创建一个空包，再选择要放进去的皮肤。</p>
                )}
                <div className="pick-actions">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => setDialog(null)}
                  >
                    取消
                  </button>
                  <button className="primary" disabled={!!busy || !name.trim()}>
                    {dialog === "create" ? "创建皮肤包" : "保存名称"}
                  </button>
                </div>
              </form>
            )}
            {dialog === "import" && (
              <>
                <p>支持 .mcpack、皮肤包 ZIP，或本地皮肤包文件夹。</p>
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() => fileInput.current?.click()}
                >
                  选择皮肤包文件
                </button>
                <input
                  hidden
                  ref={fileInput}
                  type="file"
                  accept=".mcpack,.zip"
                  onChange={(e) => {
                    void importFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <label className="import-path-label">
                  也可以输入本地路径
                  <input
                    aria-label="皮肤包本地路径"
                    placeholder="E:/下载/角色.mcpack"
                    value={importPath}
                    onChange={(e) => setImportPath(e.target.value)}
                  />
                </label>
                <div className="pick-actions">
                  <button disabled={!!busy} onClick={() => setDialog(null)}>
                    取消
                  </button>
                  <button
                    disabled={!!busy || !importPath.trim()}
                    onClick={() =>
                      void run(
                        "正在导入…",
                        async () => {
                          const p = await post("/api/packs/import", {
                            path: importPath.trim(),
                          });
                          setSelected(p.id);
                          setQuery("");
                          setDialog(null);
                        },
                        "皮肤包已导入",
                      )
                    }
                  >
                    从本地导入
                  </button>
                </div>
              </>
            )}
            {dialog === "remove-skin" && row && skin && (
              <>
                <p>
                  将「{skin.name}」从
                  {row.preset ? "游戏中的皮肤包" : "当前皮肤包"}
                  移除。其他皮肤和来源包保留。
                  {row.preset ? "写入前请完全退出 Minecraft。" : ""}
                </p>
                <div className="pick-actions">
                  <button disabled={!!busy} onClick={() => setDialog(null)}>
                    取消
                  </button>
                  <button
                    className="danger-button"
                    disabled={!!busy}
                    onClick={() =>
                      void run(
                        "正在移除皮肤…",
                        async () => {
                          await post(
                            row.preset
                              ? "/api/packs/edit-installed"
                              : "/api/packs/remove-skin",
                            {
                              id: row.id,
                              slot: row.id,
                              skinIndex,
                              remove: true,
                              revision: contents?.revision,
                            },
                          );
                          setDialog(null);
                        },
                        "皮肤已移除",
                      )
                    }
                  >
                    确认移除
                  </button>
                </div>
              </>
            )}
            {dialog === "delete" && row && (
              <>
                <p>
                  永久删除本地皮肤包「{row.name}
                  」及其中的皮肤副本。来源模型和其他包不受影响。
                </p>
                <div className="pick-actions">
                  <button disabled={!!busy} onClick={() => setDialog(null)}>
                    取消
                  </button>
                  <button
                    className="danger-button"
                    disabled={!!busy}
                    onClick={() =>
                      void run(
                        "正在删除…",
                        async () => {
                          await post("/api/packs/delete", { id: row.id });
                          setDialog(null);
                          setSelected("");
                        },
                        "本地皮肤包已删除",
                      )
                    }
                  >
                    确认删除
                  </button>
                </div>
              </>
            )}
            {dialog === "add" && row && (
              <>
                <p>
                  {row.preset
                    ? `选择一个本地包，将其中全部皮肤加入 ${row.id}。写入前请退出游戏。`
                    : `从已有包中选择皮肤，复制到「${row.name}」。来源包保持不变。`}
                </p>
                <label>
                  来源皮肤包
                  <select
                    aria-label="来源皮肤包"
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                  >
                    <option value="">请选择</option>
                    {sourceOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}（{p.skins} 套）
                      </option>
                    ))}
                  </select>
                </label>
                {sourceContents && (
                  <div className="skin-copy-list">
                    {sourceContents.skins.map((s) => (
                      <label key={s.index}>
                        <input
                          type="checkbox"
                          checked={indices.includes(s.index)}
                          disabled={row.preset || !!busy}
                          onChange={(e) =>
                            setIndices((a) =>
                              e.target.checked
                                ? [...a, s.index]
                                : a.filter((i) => i !== s.index),
                            )
                          }
                        />
                        {s.name}
                      </label>
                    ))}
                  </div>
                )}
                {!sourceOptions.length && (
                  <p>
                    没有可添加的本地皮肤。先导入皮肤包，或在工作台生成皮肤。
                  </p>
                )}
                <div className="pick-actions">
                  <button disabled={!!busy} onClick={() => setDialog(null)}>
                    取消
                  </button>
                  <button
                    className="primary"
                    disabled={!!busy || !sourceId || !indices.length}
                    onClick={() =>
                      void run(
                        "正在添加皮肤…",
                        async () => {
                          await post(
                            row.preset
                              ? "/api/packs/enable"
                              : "/api/packs/add-skins",
                            row.preset
                              ? { slot: row.id, id: sourceId }
                              : { target: row.id, source: sourceId, indices },
                          );
                          setDialog(null);
                        },
                        "皮肤已添加",
                      )
                    }
                  >
                    添加 {indices.length || ""} 套皮肤
                  </button>
                </div>
              </>
            )}
            {busy && <p role="status">{busy}</p>}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
