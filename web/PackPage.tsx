import { useEffect, useRef, useState } from "react";
import { api, post } from "./api";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { GameSkinsPanel } from "./GameSkinsPanel";
import { InlineName } from "./InlineName";
import {
  findActivePack,
  isPackFullyInstalled,
  isPackOutdated,
  isSkinInstalled,
} from "./pack-state";
import { PackPreview } from "./PackPreview";
import type { PersonaProfileRecipe } from "../src/persona-recipe";
import type { Contents, LibraryPack, Packs, SkinItem } from "./pack-types";

const gameSlotName = "custom";

type PackRow = {
  key: string;
  id: string;
  name: string;
  skins: number;
  revision: string;
  preset: boolean;
  pack?: LibraryPack;
  persona?: PersonaProfileRecipe;
  gameSkins?: true;
};

type MenuState = {
  x: number;
  y: number;
  pack: PackRow;
  skin?: SkinItem;
  scope: "list" | "detail";
};

type InlineEdit =
  | { kind: "pack"; pack: PackRow; scope: "list" | "detail" }
  | {
      kind: "skin";
      pack: PackRow;
      skin: SkinItem;
      scope: "list" | "detail";
    };

export function PackPage() {
  const [view, setView] = useState(
    location.hash.startsWith("#/game") ? "game" : "library",
  );
  useEffect(() => {
    const change = () => {
      const game = location.hash.startsWith("#/game");
      setView(game ? "game" : "library");
      setMenu(null);
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
    | "remove-skin"
    | "add"
    | null
  >(null);
  const [name, setName] = useState("");
  const [importPath, setImportPath] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceContents, setSourceContents] = useState<Contents | null>(null);
  const [indices, setIndices] = useState<number[]>([]);
  const [recipeBusy, setRecipeBusy] = useState(false);
  const [recipePath, setRecipePath] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<InlineEdit | null>(null);
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
  const presets: PackRow[] = Object.keys(data?.slots ?? {})
    .filter((id) => id === "custom")
    .map((id) => {
      const state = data?.status?.find((s) => s.slot === id);
      return {
        key: "@" + id,
        id,
        name: state?.name ?? "游戏皮肤",
        preset: true,
        skins: state?.skins ?? 0,
        revision: JSON.stringify(state?.active) + state?.changedOutsideManager,
      };
    });
  const personaProfiles = data?.persona?.profiles ?? [];
  const gameSkinsRow: PackRow = {
    key: "@game-skins",
    id: "game-skins",
    name: "游戏皮肤",
    skins: personaProfiles.length,
    revision: JSON.stringify(
      personaProfiles.map((profile) => [
        profile.slot,
        profile.lastUsed,
        profile.pieces.length,
      ]),
    ),
    preset: false,
    gameSkins: true,
  };
  const gameRows = [...presets, gameSkinsRow];
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
  const visible = (view === "game" ? gameRows : local).filter(matches);
  const row = visible.find((p) => p.key === selected) ?? visible[0];

  const baseUrl =
    row && !row.gameSkins
      ? `/api/${row.preset ? "preset-packs" : "packs"}/${row.id}`
      : "";
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
  const gameState = data?.status?.find((s) => s.slot === gameSlotName);
  const gameReady =
    !!data?.gameConfigured &&
    gameState?.exists !== false &&
    !gameState?.pending &&
    !gameState?.changedOutsideManager;
  const activeEntry = (packId: string) =>
    findActivePack(gameState?.active, packId);
  const skinInstalled = (packId: string, index: number) =>
    isSkinInstalled(activeEntry(packId), index);
  const packActive = (packId: string) => !!activeEntry(packId);
  const packOutdated = (pack: PackRow) =>
    isPackOutdated(activeEntry(pack.id), pack.revision);
  const packFullyInstalled = (pack: PackRow) =>
    isPackFullyInstalled(activeEntry(pack.id), pack.skins);

  useEffect(() => {
    if (!row || row.gameSkins) {
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

  async function exportRecipes() {
    setRecipeBusy(true);
    setError("");
    setNotice("");
    try {
      const result = (await post("/api/persona/export", {})) as {
        path: string;
        profiles: number;
        gameRunning: boolean;
      };
      setRecipePath(result.path);
      setNotice(
        `已导出 ${result.profiles} 个角色配方：${result.path}` +
          (result.gameRunning
            ? "（游戏正在运行，读取的是当前磁盘状态）"
            : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecipeBusy(false);
    }
  }

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
    setName("");
    if (kind === "add") setSourceId("");
  }
  function beginEdit(edit: InlineEdit) {
    if (busy) return;
    setSelected(edit.pack.key);
    if (edit.kind === "skin") setSkinIndex(edit.skin.index);
    setMenu(null);
    setError("");
    setEditing(edit);
  }
  function editPack(pack: PackRow, scope: "list" | "detail") {
    beginEdit({ kind: "pack", pack, scope });
  }
  function editSkin(pack: PackRow, skin: SkinItem, scope: "list" | "detail") {
    beginEdit({ kind: "skin", pack, skin, scope });
  }
  function commitEdit(edit: InlineEdit, raw: string) {
    setEditing(null);
    const name = raw.trim();
    if (!name) {
      setError("名称不能为空");
      return;
    }
    if (name.length > 120) {
      setError("名称需为 1–120 个字符");
      return;
    }
    const original = edit.kind === "pack" ? edit.pack.name : edit.skin.name;
    if (name === original) return;
    const preset = edit.pack.preset;
    void run(
      "正在保存名称…",
      () =>
        post(
          preset ? "/api/packs/edit-installed" : "/api/packs/rename",
          preset
            ? edit.kind === "pack"
              ? { slot: edit.pack.id, name, revision: contents?.revision }
              : {
                  slot: edit.pack.id,
                  skinIndex: edit.skin.index,
                  skinName: name,
                  revision: contents?.revision,
                }
            : edit.kind === "pack"
              ? { id: edit.pack.id, name }
              : {
                  id: edit.pack.id,
                  skinIndex: edit.skin.index,
                  skinName: name,
                },
        ),
      "名称已保存",
    );
  }
  function inlineEditor(edit: InlineEdit, className = "") {
    const initial = edit.kind === "pack" ? edit.pack.name : edit.skin.name;
    return (
      <InlineName
        initial={initial}
        className={className}
        onCommit={(value) => commitEdit(edit, value)}
        onCancel={() => setEditing(null)}
      />
    );
  }
  function menuItemsFor({ pack, skin: target, scope }: MenuState): MenuItem[] {
    const items: MenuItem[] = [];
    if (target) {
      items.push({
        label: "重命名",
        onSelect: () => editSkin(pack, target, scope),
      });
      if (pack.preset) {
        items.push({
          label: "从游戏中移除",
          danger: true,
          separate: true,
          disabled: !!busy || locked,
          onSelect: () => {
            setSelected(pack.key);
            setSkinIndex(target.index);
            show("remove-skin");
          },
        });
        return items;
      }
      const installed = skinInstalled(pack.id, target.index);
      if (!installed) {
        items.push({
          label: "安装到游戏",
          disabled: !!busy || !gameReady,
          onSelect: () =>
            void run(
              "正在安装…",
              () =>
                post("/api/packs/enable", {
                  slot: gameSlotName,
                  id: pack.id,
                  skins: [target.index],
                }),
              "已安装到游戏",
            ),
        });
      } else {
        if (packOutdated(pack)) {
          items.push({
            label: "更新到游戏",
            disabled: !!busy || !gameReady,
            onSelect: () =>
              void run(
                "正在更新…",
                () =>
                  post("/api/packs/apply-update", {
                    slot: gameSlotName,
                    id: pack.id,
                  }),
                "已更新到游戏",
              ),
          });
        }
        items.push({
          label: "从游戏中移除",
          disabled: !!busy || !gameReady,
          onSelect: () =>
            void run(
              "正在移除…",
              () =>
                post("/api/packs/disable", {
                  slot: gameSlotName,
                  id: pack.id,
                  skinIndex: target.index,
                }),
              "已从游戏中移除",
            ),
        });
      }
      items.push({
        label: "移出此包",
        danger: true,
        separate: true,
        disabled: !!busy || locked,
        onSelect: () => {
          setSelected(pack.key);
          setSkinIndex(target.index);
          show("remove-skin");
        },
      });
      return items;
    }

    items.push({
      label: "重命名皮肤包",
      onSelect: () => editPack(pack, scope),
    });
    if (pack.preset) {
      if (state?.pending) {
        items.push({
          label: "恢复中断的操作",
          disabled: !!busy,
          onSelect: () =>
            void run("正在恢复…", () =>
              post("/api/packs/recover", { slot: pack.id }),
            ),
        });
      } else {
        items.push({
          label: "恢复初始皮肤包",
          disabled:
            !!busy || !state?.managed || !state.active?.length || locked,
          onSelect: () =>
            void run(
              "正在恢复…",
              () => post("/api/packs/restore", { slot: pack.id }),
              "已恢复初始皮肤包",
            ),
        });
      }
      return items;
    }

    if (!packFullyInstalled(pack)) {
      items.push({
        label: "整包安装到游戏",
        disabled: !!busy || !gameReady || !pack.skins,
        onSelect: () =>
          void run(
            "正在安装…",
            () =>
              post("/api/packs/enable", {
                slot: gameSlotName,
                id: pack.id,
              }),
            "已整包安装到游戏",
          ),
      });
    }
    if (packActive(pack.id) && packOutdated(pack)) {
      items.push({
        label: "更新到游戏",
        disabled: !!busy || !gameReady || !pack.skins || !!pack.pack?.draft,
        onSelect: () =>
          void run(
            "正在更新…",
            () =>
              post("/api/packs/apply-update", {
                slot: gameSlotName,
                id: pack.id,
              }),
            "已更新到游戏",
          ),
      });
    }
    if (packActive(pack.id)) {
      items.push({
        label: "从游戏中移除",
        disabled: !!busy || !gameReady,
        onSelect: () =>
          void run(
            "正在移除…",
            () =>
              post("/api/packs/disable", {
                slot: gameSlotName,
                id: pack.id,
              }),
            "已从游戏中移除，本地包保留",
          ),
      });
    }
    items.push({
      label: "导出 .zip",
      separate: true,
      disabled: !pack.skins,
      onSelect: () => {
        location.href = `/api/packs/${encodeURIComponent(pack.id)}/download`;
      },
    });
    items.push({
      label: "删除皮肤包",
      danger: true,
      disabled: !!busy || packActive(pack.id),
      hint: packActive(pack.id) ? "先从游戏中移除，才能删除本地包" : undefined,
      onSelect: () => {
        setSelected(pack.key);
        show("delete");
      },
    });
    return items;
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
    const game = p.gameSkins
      ? true
      : p.preset
        ? data?.status?.find((s) => s.slot === p.id)?.exists
        : packActive(p.id);
    const personaInUse = personaProfiles.some((profile) => profile.lastUsed);
    const select = () => {
      setSelected(p.key);
      setSkinIndex(0);
      setNotice("");
      setError("");
    };
    return (
      <div
        key={p.key}
        role="button"
        tabIndex={0}
        title={p.gameSkins ? p.name : "双击重命名，右键更多操作"}
        className={
          "pack-library-row text-only" + (p.key === row?.key ? " selected" : "")
        }
        onClick={select}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select();
          }
        }}
        onDoubleClick={() => {
          if (p.gameSkins) return;
          editPack(p, "list");
        }}
        onContextMenu={(e) => {
          if (p.gameSkins) return;
          e.preventDefault();
          select();
          setMenu({ x: e.clientX, y: e.clientY, pack: p, scope: "list" });
        }}
      >
        <span className="pack-row-copy">
          {editing?.kind === "pack" &&
          editing.pack.key === p.key &&
          editing.scope === "list" ? (
            inlineEditor(editing, "inline-pack")
          ) : (
            <b>{p.name}</b>
          )}
          <small>
            {p.gameSkins ? `${p.skins} 个角色` : `${p.skins} 套皮肤`}
            {p.gameSkins
              ? " · 角色创建器"
              : p.preset
                ? " · 游戏目录"
                : p.pack?.draft
                  ? " · 空包"
                  : ""}
          </small>
        </span>
        <span className="pack-row-end">
          {game && (
            <span
              className={
                "pack-game-badge" + (p.gameSkins ? " persona" : " installed")
              }
            >
              {p.gameSkins
                ? personaInUse
                  ? "当前使用"
                  : "角色创建器"
                : "游戏中"}
            </span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="page-content pack-manager-page">
      <div className="collection-workbar">
        <nav className="collection-tabs" aria-label="皮肤包范围">
          <a className={view === "library" ? "active" : ""} href="#/packs">
            本地包 <span>{local.length}</span>
          </a>
          <a className={view === "game" ? "active" : ""} href="#/game">
            游戏中 <span>{gameRows.length}</span>
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
                row.gameSkins ? (
                  <GameSkinsPanel
                    recipe={data.persona}
                    error={data.personaError}
                    exportPath={recipePath}
                    busy={recipeBusy}
                    onExport={() => void exportRecipes()}
                    onRefresh={refresh}
                  />
                ) : (
                <>
                  <div className="pack-detail-bar">
                    <div>
                      <h2
                        title={row.gameSkins ? row.name : "双击重命名"}
                        onDoubleClick={() => {
                          if (!row.gameSkins) editPack(row, "detail");
                        }}
                      >
                        {editing?.kind === "pack" &&
                        editing.pack.key === row.key &&
                        editing.scope === "detail" ? (
                          inlineEditor(editing, "inline-title")
                        ) : (
                          <>
                            {row.name}
                            {row.preset && (
                              <span className="preset-title-badge">
                                游戏目录
                              </span>
                            )}
                          </>
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
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="皮肤包操作"
                        title="更多操作"
                        disabled={!!busy}
                        onClick={(e) => {
                          const box = e.currentTarget.getBoundingClientRect();
                          setMenu({
                            x: box.left,
                            y: box.bottom + 4,
                            pack: row,
                            scope: "detail",
                          });
                        }}
                      >
                        ⋯
                      </button>
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
                        contents.skins.map((s) => {
                          const installed =
                            !row.preset && skinInstalled(row.id, s.index);
                          const outdated = installed && packOutdated(row);
                          return (
                            <div
                              role="button"
                              tabIndex={0}
                              className={
                                "skin-item text-only" +
                                (s.index === skinIndex ? " selected" : "")
                              }
                              key={s.index}
                              onClick={() => setSkinIndex(s.index)}
                              onKeyDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSkinIndex(s.index);
                                }
                              }}
                              onDoubleClick={() => {
                                setSkinIndex(s.index);
                                editSkin(row, s, "list");
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setSkinIndex(s.index);
                                setMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  pack: row,
                                  skin: s,
                                  scope: "list",
                                });
                              }}
                            >
                              <span className="skin-order">{s.index + 1}</span>
                              <span className="skin-item-copy">
                                {editing?.kind === "skin" &&
                                editing.pack.key === row.key &&
                                editing.skin.index === s.index &&
                                editing.scope === "list" ? (
                                  inlineEditor(editing, "inline-skin")
                                ) : (
                                  <b>{s.name}</b>
                                )}
                              </span>
                              {!row.preset && (
                                <span className="skin-item-state">
                                  {installed ? (
                                    outdated ? (
                                      <button
                                        type="button"
                                        className="mini-button"
                                        disabled={!!busy || !gameReady}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void run(
                                            "正在更新…",
                                            () =>
                                              post("/api/packs/apply-update", {
                                                slot: gameSlotName,
                                                id: row.id,
                                              }),
                                            "已更新到游戏",
                                          );
                                        }}
                                      >
                                        更新
                                      </button>
                                    ) : (
                                      <span className="skin-installed-badge">
                                        游戏中
                                      </span>
                                    )
                                  ) : (
                                    <button
                                      type="button"
                                      className="mini-button"
                                      disabled={!!busy || !gameReady}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void run(
                                          "正在安装…",
                                          () =>
                                            post("/api/packs/enable", {
                                              slot: gameSlotName,
                                              id: row.id,
                                              skins: [s.index],
                                            }),
                                          "已安装到游戏",
                                        );
                                      }}
                                    >
                                      安装
                                    </button>
                                  )}
                                </span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                    <div className="skin-detail-pane">
                      {skin ? (
                        <>
                          <div className="skin-title">
                            <h3
                              title="双击重命名"
                              onDoubleClick={() => editSkin(row, skin, "detail")}
                            >
                              {editing?.kind === "skin" &&
                              editing.pack.key === row.key &&
                              editing.skin.index === skin.index &&
                              editing.scope === "detail" ? (
                                inlineEditor(editing, "inline-title")
                              ) : (
                                skin.name
                              )}
                            </h3>
                            <div className="selected-skin-actions">
                              <button
                                type="button"
                                className="icon-button"
                                title="重命名皮肤"
                                aria-label="重命名皮肤"
                                disabled={!!busy || locked}
                                onClick={() => editSkin(row, skin, "detail")}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="icon-button"
                                title="皮肤操作"
                                aria-label="皮肤操作"
                                disabled={!!busy}
                                onClick={(e) => {
                                  const box =
                                    e.currentTarget.getBoundingClientRect();
                                  setMenu({
                                    x: box.left,
                                    y: box.bottom + 4,
                                    pack: row,
                                    skin,
                                    scope: "detail",
                                  });
                                }}
                              >
                                ⋯
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
                              <span
                                className={
                                  skinInstalled(row.id, skin.index)
                                    ? "enabled-label"
                                    : ""
                                }
                              >
                                {skinInstalled(row.id, skin.index)
                                  ? "游戏中"
                                  : "未安装到游戏"}
                              </span>
                              {!skinInstalled(row.id, skin.index) ? (
                                <button
                                  className="primary"
                                  disabled={!!busy || !gameReady}
                                  onClick={() =>
                                    void run(
                                      "正在安装…",
                                      () =>
                                        post("/api/packs/enable", {
                                          slot: gameSlotName,
                                          id: row.id,
                                          skins: [skin.index],
                                        }),
                                      "已安装到游戏",
                                    )
                                  }
                                >
                                  安装到游戏
                                </button>
                              ) : (
                                packOutdated(row) && (
                                  <button
                                    disabled={!!busy || !gameReady}
                                    onClick={() =>
                                      void run(
                                        "正在更新…",
                                        () =>
                                          post("/api/packs/apply-update", {
                                            slot: gameSlotName,
                                            id: row.id,
                                          }),
                                        "已更新到游戏",
                                      )
                                    }
                                  >
                                    更新到游戏
                                  </button>
                                )
                              )}
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
                )
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
                      : "皮肤包操作"
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
                          : "皮肤包操作"}
              </h2>
              <button
                disabled={!!busy}
                aria-label="关闭弹窗"
                onClick={() => setDialog(null)}
              >
                ×
              </button>
            </div>
            {dialog === "create" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    "正在保存…",
                    async () => {
                      const p = await post("/api/packs/create", { name });
                      setQuery("");
                      setSelected(p.id);
                      setDialog(null);
                    },
                    "皮肤包已创建，可以开始添加皮肤",
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
                <p>先创建一个空包，再选择要放进去的皮肤。</p>
                <div className="pick-actions">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => setDialog(null)}
                  >
                    取消
                  </button>
                  <button className="primary" disabled={!!busy || !name.trim()}>
                    创建皮肤包
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
                    ? "选择一个本地包，勾选要安装到游戏的皮肤。写入前请退出游戏。"
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
                          disabled={!!busy}
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
                              ? {
                                  slot: gameSlotName,
                                  id: sourceId,
                                  skins: indices,
                                }
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItemsFor(menu)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
