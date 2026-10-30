import { ContextMenu } from "../ui/ContextMenu";
import { GameSkinsPanel } from "../packs/GameSkinsPanel";
import { PackDialogs } from "../packs/PackDialogs";
import { PackHeader } from "../packs/PackHeader";
import { PackSidebar } from "../packs/PackSidebar";
import { SkinDetail } from "../packs/SkinDetail";
import { SkinList } from "../packs/SkinList";
import { usePackPage } from "../packs/use-pack-page";

export function PackPage() {
  const page = usePackPage();
  const {
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
    reattachGame,
    menuActions,
    menuItemsFor,
    openPack,
  } = page;

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
            data={{
              rows: visible,
              selectedKey: row?.key,
              query,
              editing,
              personaInUse,
            }}
            runtime={{ isGameActive }}
            actions={{
              onQueryChange: setQuery,
              onSelect: selectPack,
              onRename: (pack) => editPack(pack, "list"),
              onMenu: (event, pack) =>
                setMenu({
                  x: event.clientX,
                  y: event.clientY,
                  pack,
                  scope: "list",
                }),
              onCommit: commitEdit,
              onCancel: () => setEditing(null),
            }}
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
                  {gamePending && (
                    <div className="pack-message error">
                      上次写入游戏未完成，已暂停新的安装和更新。
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={recoverGame}
                      >
                        恢复中断的操作
                      </button>
                    </div>
                  )}
                  <PackHeader
                    pack={{ row, contents }}
                    runtime={{ busy, locked, editing }}
                    actions={{
                      onRename: () => editPack(row, "detail"),
                      onAdd: () => show("add"),
                      onExport: () => show("export"),
                      onMenu: (event) => {
                        const box =
                          event.currentTarget.getBoundingClientRect();
                        setMenu({
                          x: box.left,
                          y: box.bottom + 4,
                          pack: row,
                          scope: "detail",
                        });
                      },
                      onCommit: commitEdit,
                      onCancel: () => setEditing(null),
                    }}
                  />
                  {state?.changedOutsideManager && (
                    <div className="pack-message error">
                      游戏目录和记录不一致（常见于游戏更新），已暂停写入。
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => reattachGame()}
                      >
                        重新写回
                      </button>
                    </div>
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
                      pack={{
                        row,
                        skins: contents ? contents.skins : null,
                        selectedIndex: skinIndex,
                        editing,
                      }}
                      runtime={{
                        busy,
                        gameReady,
                        installed: (index) => skinInstalled(row.id, index),
                        outdated: packOutdated(row),
                      }}
                      actions={{
                        onSelect: setSkinIndex,
                        onRename: (target) => editSkin(row, target, "list"),
                        onMenu: (event, target) => {
                          setSelected(row.key);
                          setSkinIndex(target.index);
                          setMenu({
                            x: event.clientX,
                            y: event.clientY,
                            pack: row,
                            skin: target,
                            scope: "list",
                          });
                        },
                        onInstall: installSkin,
                        onUpdate: () => menuActions.updatePack(row),
                        onCommit: commitEdit,
                        onCancel: () => setEditing(null),
                      }}
                    />
                    <SkinDetail
                      pack={{
                        row,
                        contents,
                        baseUrl,
                        state,
                        presetSourceIds,
                        library,
                      }}
                      skinView={{ item: skin, index: skinIndex, sourceModel }}
                      runtime={{
                        busy,
                        locked,
                        gameReady,
                        installed: !!skin && skinInstalled(row.id, skin.index),
                        outdated: packOutdated(row),
                        editing,
                      }}
                      actions={{
                        onRename: () => {
                          if (skin) editSkin(row, skin, "detail");
                        },
                        onMenu: (event) => {
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
                        },
                        onInstall: () => {
                          if (skin) menuActions.installSkin(row, skin);
                        },
                        onUpdate: () => menuActions.updatePack(row),
                        onOpenPack: openPack,
                        onAdd: () => show("add"),
                        onCommit: commitEdit,
                        onCancel: () => setEditing(null),
                      }}
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
        state={{ kind: dialog, row, skin, busy, error }}
        form={{
          name,
          setName,
          importPath,
          setImportPath,
          sourceId,
          setSourceId,
          sourceContents,
          contents,
          indices,
          setIndices,
          sourceOptions: library.filter(
            (pack) => pack.skins > 0 && pack.id !== row?.id,
          ),
          fileInput,
        }}
        actions={{
          onClose: closeDialog,
          onCreate: createPack,
          onImportPath: importByPath,
          onImportFile: (file) => void importFile(file),
          onRemoveSkin: removeSkinFromPack,
          onDelete: deletePack,
          onAdd: addSkins,
          onExport: () => void exportGamePack(),
        }}
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
