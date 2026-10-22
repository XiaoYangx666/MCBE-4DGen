import { useEffect, useRef, useState } from "react";
import { api, post } from "../lib/api";
import { ContextMenu, type MenuItem } from "../ui/ContextMenu";
import { GameSkinsPanel } from "../packs/GameSkinsPanel";
import { PackDialogs } from "../packs/PackDialogs";
import { PackHeader } from "../packs/PackHeader";
import { PackSidebar } from "../packs/PackSidebar";
import { SkinDetail } from "../packs/SkinDetail";
import { SkinList } from "../packs/SkinList";
import {
  findActivePack,
  isPackFullyInstalled,
  isPackOutdated,
  isSkinInstalled,
} from "../packs/pack-state";
import {
  buildPackMenu,
  type PackMenuActions,
} from "../packs/pack-menu";
import type { Contents, LibraryPack, Packs, SkinItem } from "../packs/pack-types";
import {
  gameSlotName,
  type InlineEdit,
  type MenuState,
  type PackDialogKind,
  type PackRow,
} from "../packs/pack-ui";

export function PackPage() {
  const [view, setView] = useState(
    location.hash.startsWith("#/game") ? "game" : "library",
  );
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
  const [dialog, setDialog] = useState<PackDialogKind>(null);
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

  useEffect(() => {
    const change = () => {
      const game = location.hash.startsWith("#/game");
      setView(game ? "game" : "library");
      setMenu(null);
      setEditing(null);
      const pack = new URLSearchParams(location.hash.split("?")[1]).get("pack");
      setSelected(pack ?? (game ? "@custom" : ""));
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);

  async function refresh() {
    const [packs, sources] = await Promise.all([
      api("/api/packs"),
      api("/api/models"),
    ]);
    setData(packs);
    setModels(sources);
    setTick((value) => value + 1);
  }
  useEffect(() => {
    void refresh().catch((reason) => setError(String(reason)));
  }, []);

  const library = data?.library?.filter((pack) => !pack.removed) ?? [];
  const presets: PackRow[] = Object.keys(data?.slots ?? {})
    .filter((id) => id === gameSlotName)
    .map((id) => {
      const state = data?.status?.find((status) => status.slot === id);
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
    data?.status?.flatMap((status) => status.presetSources ?? []) ?? [],
  );
  const local: PackRow[] = library
    .filter((pack) => !presetSourceIds.has(pack.id))
    .map((pack) => ({
      key: pack.id,
      id: pack.id,
      name: pack.name,
      skins: pack.skins,
      revision: pack.revision,
      preset: false,
      pack,
    }));
  const matches = (pack: PackRow) =>
    !query || pack.name.toLowerCase().includes(query.toLowerCase());
  const visible = (view === "game" ? gameRows : local).filter(matches);
  const row = visible.find((item) => item.key === selected) ?? visible[0];

  const baseUrl =
    row && !row.gameSkins
      ? `/api/${row.preset ? "preset-packs" : "packs"}/${row.id}`
      : "";
  const state = row?.preset
    ? data?.status?.find((status) => status.slot === row.id)
    : undefined;
  const locked = !!state?.pending || !!state?.changedOutsideManager;
  const skin =
    contents && row && contents.id === row.id
      ? contents.skins.find((item) => item.index === skinIndex)
      : undefined;
  const sourceModel = skin?.origin?.modelId
    ? models.find((model) => model.id === skin.origin?.modelId)
    : undefined;
  const gameState = data?.status?.find(
    (status) => status.slot === gameSlotName,
  );
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
  const isGameActive = (pack: PackRow) =>
    pack.gameSkins
      ? true
      : pack.preset
        ? !!data?.status?.find((status) => status.slot === pack.id)?.exists
        : packActive(pack.id);
  const personaInUse = personaProfiles.some((profile) => profile.lastUsed);

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
      .then((result) => {
        if (!cancelled) {
          setContents(result);
          setSkinIndex((index) =>
            result.skins.some((item: SkinItem) => item.index === index)
              ? index
              : 0,
          );
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
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
      .then((result) => {
        if (!cancelled) {
          setSourceContents(result);
          setIndices(result.skins.map((item: SkinItem) => item.index));
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId, dialog]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setDialog(null);
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRecipeBusy(false);
    }
  }

  async function run(
    label: string,
    action: () => Promise<unknown>,
    message = "操作已完成",
  ) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  }

  function selectPack(pack: PackRow) {
    setSelected(pack.key);
    setSkinIndex(0);
    setNotice("");
    setError("");
  }
  function show(kind: NonNullable<PackDialogKind>) {
    setDialog(kind);
    setError("");
    setName("");
    if (kind === "add") setSourceId("");
  }
  function editPack(pack: PackRow, scope: "list" | "detail") {
    if (busy) return;
    setSelected(pack.key);
    setMenu(null);
    setError("");
    setEditing({ kind: "pack", pack, scope });
  }
  function editSkin(pack: PackRow, target: SkinItem, scope: "list" | "detail") {
    if (busy) return;
    setSelected(pack.key);
    setSkinIndex(target.index);
    setMenu(null);
    setError("");
    setEditing({ kind: "skin", pack, skin: target, scope });
  }
  function commitEdit(edit: InlineEdit, raw: string) {
    setEditing(null);
    const nextName = raw.trim();
    if (!nextName) {
      setError("名称不能为空");
      return;
    }
    if (nextName.length > 120) {
      setError("名称需为 1–120 个字符");
      return;
    }
    const original = edit.kind === "pack" ? edit.pack.name : edit.skin.name;
    if (nextName === original) return;
    const preset = edit.pack.preset;
    void run(
      "正在保存名称…",
      () =>
        post(
          preset ? "/api/packs/edit-installed" : "/api/packs/rename",
          preset
            ? edit.kind === "pack"
              ? {
                  slot: edit.pack.id,
                  name: nextName,
                  revision: contents?.revision,
                }
              : {
                  slot: edit.pack.id,
                  skinIndex: edit.skin.index,
                  skinName: nextName,
                  revision: contents?.revision,
                }
            : edit.kind === "pack"
              ? { id: edit.pack.id, name: nextName }
              : {
                  id: edit.pack.id,
                  skinIndex: edit.skin.index,
                  skinName: nextName,
                },
        ),
      "名称已保存",
    );
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
  function createPack() {
    void run(
      "正在保存…",
      async () => {
        const pack = await post("/api/packs/create", { name });
        setQuery("");
        setSelected(pack.id);
        setDialog(null);
      },
      "皮肤包已创建，可以开始添加皮肤",
    );
  }
  function importByPath() {
    const path = importPath.trim();
    void run(
      "正在导入…",
      async () => {
        const pack = await post("/api/packs/import", { path });
        setSelected(pack.id);
        setQuery("");
        setDialog(null);
      },
      "皮肤包已导入",
    );
  }
  function removeSkinFromPack() {
    if (!row || !skin) return;
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
            skinIndex: skin.index,
            remove: true,
            revision: contents?.revision,
          },
        );
        setDialog(null);
      },
      "皮肤已移除",
    );
  }
  function deletePack() {
    if (!row) return;
    void run(
      "正在删除…",
      async () => {
        await post("/api/packs/delete", { id: row.id });
        setDialog(null);
        setSelected("");
      },
      "本地皮肤包已删除",
    );
  }
  function addSkins() {
    if (!row || !sourceId || !indices.length) return;
    void run(
      "正在添加皮肤…",
      async () => {
        await post(
          row.preset ? "/api/packs/enable" : "/api/packs/add-skins",
          row.preset
            ? { slot: gameSlotName, id: sourceId, skins: indices }
            : { target: row.id, source: sourceId, indices },
        );
        setDialog(null);
      },
      "皮肤已添加",
    );
  }

  const menuActions: PackMenuActions = {
    renamePack: editPack,
    renameSkin: editSkin,
    installSkin: (pack, target) =>
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
    updatePack: (pack) =>
      void run(
        "正在更新…",
        () =>
          post("/api/packs/apply-update", {
            slot: gameSlotName,
            id: pack.id,
          }),
        "已更新到游戏",
      ),
    disableSkin: (pack, target) =>
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
    removeSkin: (pack, target) => {
      setSelected(pack.key);
      setSkinIndex(target.index);
      show("remove-skin");
    },
    installPack: (pack) =>
      void run(
        "正在安装…",
        () =>
          post("/api/packs/enable", {
            slot: gameSlotName,
            id: pack.id,
          }),
        "已整包安装到游戏",
      ),
    disablePack: (pack) =>
      void run(
        "正在移除…",
        () =>
          post("/api/packs/disable", {
            slot: gameSlotName,
            id: pack.id,
          }),
        "已从游戏中移除，本地包保留",
      ),
    exportPack: (pack) => {
      location.href = `/api/packs/${encodeURIComponent(pack.id)}/download`;
    },
    deletePack: (pack) => {
      setSelected(pack.key);
      show("delete");
    },
    restorePack: (pack) =>
      void run(
        "正在恢复…",
        () => post("/api/packs/restore", { slot: pack.id }),
        "已恢复初始皮肤包",
      ),
    recoverPack: (pack) =>
      void run("正在恢复…", () => post("/api/packs/recover", { slot: pack.id })),
  };
  function menuItemsFor(target: MenuState): MenuItem[] {
    return buildPackMenu(
      target,
      {
        busy,
        locked,
        gameReady,
        state,
        isActive: packActive,
        isOutdated: packOutdated,
        isFullyInstalled: packFullyInstalled,
        isSkinInstalled: skinInstalled,
      },
      menuActions,
    );
  }
  function openPack(id: string) {
    location.hash = "#/packs?pack=" + encodeURIComponent(id);
    setQuery("");
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
        <div className="pack-browser">
          <PackSidebar
            rows={visible}
            selectedKey={row?.key}
            query={query}
            editing={editing}
            personaInUse={personaInUse}
            isGameActive={isGameActive}
            onQueryChange={setQuery}
            onSelect={selectPack}
            onRename={(pack) => editPack(pack, "list")}
            onMenu={(event, pack) =>
              setMenu({
                x: event.clientX,
                y: event.clientY,
                pack,
                scope: "list",
              })
            }
            onCommit={commitEdit}
            onCancel={() => setEditing(null)}
          />
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
                  <PackHeader
                    row={row}
                    contents={contents}
                    busy={busy}
                    locked={locked}
                    editing={editing}
                    onRename={() => editPack(row, "detail")}
                    onAdd={() => show("add")}
                    onMenu={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      setMenu({
                        x: box.left,
                        y: box.bottom + 4,
                        pack: row,
                        scope: "detail",
                      });
                    }}
                    onCommit={commitEdit}
                    onCancel={() => setEditing(null)}
                  />
                  {state?.changedOutsideManager && (
                    <p className="inline-note">
                      游戏目录有外部改动，已暂停写入。你仍可查看包内皮肤。
                    </p>
                  )}
                  {!!row.pack?.meta?.importWarnings?.length && (
                    <details className="inline-note">
                      <summary>
                        导入提示：{row.pack.meta.importWarnings.length}{" "}
                        条无效皮肤未导入
                      </summary>
                      {row.pack.meta.importWarnings.map((message, index) => (
                        <p key={index}>{message}</p>
                      ))}
                    </details>
                  )}
                  <div className="skin-content-layout">
                    <SkinList
                      pack={row}
                      skins={contents ? contents.skins : null}
                      selectedIndex={skinIndex}
                      editing={editing}
                      busy={busy}
                      gameReady={gameReady}
                      installed={(index) => skinInstalled(row.id, index)}
                      outdated={packOutdated(row)}
                      onSelect={setSkinIndex}
                      onRename={(target) => editSkin(row, target, "list")}
                      onMenu={(event, target) => {
                        setSelected(row.key);
                        setSkinIndex(target.index);
                        setMenu({
                          x: event.clientX,
                          y: event.clientY,
                          pack: row,
                          skin: target,
                          scope: "list",
                        });
                      }}
                      onInstall={(index) =>
                        void run(
                          "正在安装…",
                          () =>
                            post("/api/packs/enable", {
                              slot: gameSlotName,
                              id: row.id,
                              skins: [index],
                            }),
                          "已安装到游戏",
                        )
                      }
                      onUpdate={() => menuActions.updatePack(row)}
                      onCommit={commitEdit}
                      onCancel={() => setEditing(null)}
                    />
                    <SkinDetail
                      row={row}
                      skin={skin}
                      skinIndex={skinIndex}
                      baseUrl={baseUrl}
                      contents={contents}
                      sourceModel={sourceModel}
                      state={state}
                      presetSourceIds={presetSourceIds}
                      library={library}
                      busy={busy}
                      locked={locked}
                      gameReady={gameReady}
                      installed={!!skin && skinInstalled(row.id, skin.index)}
                      outdated={packOutdated(row)}
                      editing={editing}
                      onRename={() => {
                        if (skin) editSkin(row, skin, "detail");
                      }}
                      onMenu={(event) => {
                        if (!skin) return;
                        const box =
                          event.currentTarget.getBoundingClientRect();
                        setMenu({
                          x: box.left,
                          y: box.bottom + 4,
                          pack: row,
                          skin,
                          scope: "detail",
                        });
                      }}
                      onInstall={() => {
                        if (skin) menuActions.installSkin(row, skin);
                      }}
                      onUpdate={() => menuActions.updatePack(row)}
                      onOpenPack={openPack}
                      onAdd={() => show("add")}
                      onCommit={commitEdit}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                </>
              )
            ) : (
              <div className="empty-state">没有匹配的皮肤包。</div>
            )}
          </section>
        </div>
      )}
      <PackDialogs
        dialog={dialog}
        row={row}
        skin={skin}
        busy={busy}
        error={error}
        name={name}
        setName={setName}
        importPath={importPath}
        setImportPath={setImportPath}
        sourceId={sourceId}
        setSourceId={setSourceId}
        sourceContents={sourceContents}
        indices={indices}
        setIndices={setIndices}
        sourceOptions={library.filter(
          (pack) => pack.skins > 0 && pack.id !== row?.id,
        )}
        fileInput={fileInput}
        onClose={() => setDialog(null)}
        onCreate={createPack}
        onImportPath={importByPath}
        onImportFile={(file) => void importFile(file)}
        onRemoveSkin={removeSkinFromPack}
        onDelete={deletePack}
        onAdd={addSkins}
      />
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
