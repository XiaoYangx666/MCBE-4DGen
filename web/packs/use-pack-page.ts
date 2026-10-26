import { useEffect, useRef, useState } from "react";
import { api, post } from "../lib/api";
import { saveZip } from "../lib/save-file";
import {
  findActivePack,
  isPackFullyInstalled,
  isPackOutdated,
  isSkinInstalled,
} from "./pack-state";
import { buildPackMenu, type PackMenuActions } from "./pack-menu";
import type { Contents, Packs, SkinItem } from "./pack-types";
import {
  gameSlotName,
  type InlineEdit,
  type MenuState,
  type PackDialogKind,
  type PackRow,
} from "./pack-ui";

type SourceModel = { id: string; name: string; path: string; packIds?: string[] };

/**
 * Page controller for the skin-pack screen: data loading, selection, dialogs,
 * inline editing and every mutation. `PackPage` only renders the view.
 */
export function usePackPage() {
  const [view, setView] = useState(
    location.hash.startsWith("#/game") ? "game" : "library",
  );
  const [data, setData] = useState<Packs | null>(null);
  const [selected, setSelected] = useState(
    new URLSearchParams(location.hash.split("?")[1]).get("pack") ??
      (location.hash.startsWith("#/game") ? "@custom" : ""),
  );
  const [models, setModels] = useState<SourceModel[]>([]);
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
      api<Packs>("/api/packs"),
      api<SourceModel[]>("/api/models"),
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
  const gamePending = !!gameState?.pending;
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
    if (dialog !== "add") return;
    setSourceContents(null);
    setIndices([]);
    if (!sourceId) return;
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
    if (dialog === "export" && contents)
      setIndices(contents.skins.map((item) => item.index));
  }, [dialog, contents]);

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
    if (kind === "export") {
      setIndices(contents?.skins.map((item) => item.index) ?? []);
      setName(row ? `${row.name} 导出`.slice(0, 120) : "");
    }
  }
  function closeDialog() {
    setDialog(null);
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
  function installSkin(index: number) {
    if (!row) return;
    void run(
      "正在安装…",
      () =>
        post("/api/packs/enable", {
          slot: gameSlotName,
          id: row.id,
          skins: [index],
        }),
      "已安装到游戏",
    );
  }
  function recoverGame() {
    void run(
      "正在恢复…",
      () => post("/api/packs/recover", { slot: gameSlotName }),
      "已恢复中断的操作",
    );
  }

  async function exportGamePack() {
    if (!row?.preset || !contents || !indices.length) return;
    setBusy("正在导出…");
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ skins: indices.join(",") });
      if (name.trim()) params.set("name", name.trim());
      const response = await fetch(`${baseUrl}/export?${params}`, {
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw Error(body?.error ?? `导出失败（${response.status}）`);
      }
      const result = await saveZip(
        new Uint8Array(await response.arrayBuffer()),
        name.trim() || row.name,
      );
      if (!result.saved) {
        setNotice("已取消保存");
        return;
      }
      setDialog(null);
      setNotice(result.path ? `已保存到 ${result.path}` : "已开始下载");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
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
      if (pack.preset) {
        setSelected(pack.key);
        show("export");
        return;
      }
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

  function menuItemsFor(target: MenuState) {
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

  return {
    view,
    data,
    query,
    setQuery,
    contents,
    skinIndex,
    setSkinIndex,
    setSelected,
    busy,
    error,
    notice,
    dialog,
    name,
    setName,
    importPath,
    setImportPath,
    sourceId,
    setSourceId,
    sourceContents,
    indices,
    setIndices,
    recipeBusy,
    recipePath,
    menu,
    setMenu,
    editing,
    setEditing,
    fileInput,
    library,
    gameRows,
    local,
    visible,
    row,
    baseUrl,
    state,
    locked,
    skin,
    sourceModel,
    gameReady,
    gamePending,
    skinInstalled,
    packOutdated,
    isGameActive,
    personaInUse,
    presetSourceIds,
    refresh,
    exportRecipes,
    exportGamePack,
    run,
    selectPack,
    show,
    closeDialog,
    editPack,
    editSkin,
    commitEdit,
    importFile,
    createPack,
    importByPath,
    removeSkinFromPack,
    deletePack,
    addSkins,
    installSkin,
    recoverGame,
    menuActions,
    menuItemsFor,
    openPack,
  };
}
