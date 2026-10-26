import type { Dispatch, RefObject, SetStateAction } from "react";
import { Modal } from "../ui/Modal";
import type { Contents, LibraryPack, SkinItem } from "./pack-types";
import type { PackDialogKind, PackRow } from "./pack-ui";

const titles: Record<Exclude<PackDialogKind, null>, string> = {
  create: "新建皮肤包",
  import: "导入皮肤包",
  "remove-skin": "移除这个皮肤？",
  delete: "删除皮肤包？",
  add: "添加皮肤",
  export: "导出游戏皮肤包",
};

export function PackDialogs({
  state,
  form,
  actions,
}: {
  state: {
    kind: PackDialogKind;
    row: PackRow | undefined;
    skin: SkinItem | undefined;
    busy: string;
    error: string;
  };
  form: {
    name: string;
    setName: Dispatch<SetStateAction<string>>;
    importPath: string;
    setImportPath: Dispatch<SetStateAction<string>>;
    sourceId: string;
    setSourceId: Dispatch<SetStateAction<string>>;
    sourceContents: Contents | null;
    contents: Contents | null;
    indices: number[];
    setIndices: Dispatch<SetStateAction<number[]>>;
    sourceOptions: LibraryPack[];
    fileInput: RefObject<HTMLInputElement | null>;
  };
  actions: {
    onClose: () => void;
    onCreate: () => void;
    onImportPath: () => void;
    onImportFile: (file?: File) => void;
    onRemoveSkin: () => void;
    onDelete: () => void;
    onAdd: () => void;
    onExport: () => void;
  };
}) {
  const { kind: dialog, row, skin, busy, error } = state;
  const {
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
    sourceOptions,
    fileInput,
  } = form;
  const {
    onClose,
    onCreate,
    onImportPath,
    onImportFile,
    onRemoveSkin,
    onDelete,
    onAdd,
    onExport,
  } = actions;
  if (!dialog) return null;
  return (
    <Modal
      title={titles[dialog]}
      label={titles[dialog]}
      className="pack-operation-dialog"
      busy={!!busy}
      onClose={onClose}
    >
      {dialog === "create" && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onCreate();
            }}
          >
            <label>
              名称
              <input
                aria-label="名称"
                autoFocus
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p>先创建一个空包，再选择要放进去的皮肤。</p>
            <div className="pick-actions">
              <button type="button" disabled={!!busy} onClick={onClose}>
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
              onChange={(event) => {
                onImportFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <label className="import-path-label">
              也可以输入本地路径
              <input
                aria-label="皮肤包本地路径"
                placeholder="E:/下载/角色.mcpack"
                value={importPath}
                onChange={(event) => setImportPath(event.target.value)}
              />
            </label>
            <div className="pick-actions">
              <button disabled={!!busy} onClick={onClose}>
                取消
              </button>
              <button
                disabled={!!busy || !importPath.trim()}
                onClick={onImportPath}
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
              <button disabled={!!busy} onClick={onClose}>
                取消
              </button>
              <button
                className="danger-button"
                disabled={!!busy}
                onClick={onRemoveSkin}
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
              <button disabled={!!busy} onClick={onClose}>
                取消
              </button>
              <button
                className="danger-button"
                disabled={!!busy}
                onClick={onDelete}
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
                onChange={(event) => setSourceId(event.target.value)}
              >
                <option value="">请选择</option>
                {sourceOptions.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.name}（{pack.skins} 套）
                  </option>
                ))}
              </select>
            </label>
            {sourceContents && (
              <div className="skin-copy-list">
                {sourceContents.skins.map((item) => (
                  <label key={item.index}>
                    <input
                      type="checkbox"
                      checked={indices.includes(item.index)}
                      disabled={!!busy}
                      onChange={(event) =>
                        setIndices((current) =>
                          event.target.checked
                            ? [...current, item.index]
                            : current.filter((index) => index !== item.index),
                        )
                      }
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            )}
            {!sourceOptions.length && (
              <p>没有可添加的本地皮肤。先导入皮肤包，或在工作台生成皮肤。</p>
            )}
            <div className="pick-actions">
              <button disabled={!!busy} onClick={onClose}>
                取消
              </button>
              <button
                className="primary"
                disabled={!!busy || !sourceId || !indices.length}
                onClick={onAdd}
              >
                添加 {indices.length || ""} 套皮肤
              </button>
            </div>
          </>
        )}
        {dialog === "export" && row && (
          <>
            <p>
              勾选要导出的游戏皮肤，默认全选。ZIP 只包含勾选的皮肤，不会修改游戏目录。
            </p>
            <label>
              皮肤包名称
              <input
                aria-label="皮肤包名称"
                autoFocus
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="skin-copy-list">
              <label>
                <input
                  type="checkbox"
                  checked={
                    !!contents?.skins.length &&
                    indices.length === contents.skins.length
                  }
                  disabled={!!busy || !contents?.skins.length}
                  onChange={(event) =>
                    setIndices(
                      event.target.checked
                        ? (contents?.skins.map((item) => item.index) ?? [])
                        : [],
                    )
                  }
                />
                <b>全选</b>
                <span className="muted">
                  {indices.length} / {contents?.skins.length ?? 0} 套
                </span>
              </label>
              {contents?.skins.map((item) => (
                <label key={item.index}>
                  <input
                    type="checkbox"
                    checked={indices.includes(item.index)}
                    disabled={!!busy}
                    onChange={(event) =>
                      setIndices((current) =>
                        event.target.checked
                          ? [...current, item.index]
                          : current.filter((index) => index !== item.index),
                      )
                    }
                  />
                  {item.name}
                </label>
              ))}
              {!contents?.skins.length && (
                <p className="muted">游戏中还没有可导出的皮肤。</p>
              )}
            </div>
            <p className="muted">
              保存时会先选择文件夹；请选择桌面、文档、下载等当前用户可写的文件夹。
            </p>
            <div className="pick-actions">
              <button disabled={!!busy} onClick={onClose}>
                取消
              </button>
              <button
                className="primary"
                disabled={!!busy || !indices.length || !name.trim()}
                onClick={onExport}
              >
                选择文件夹并保存…
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
    </Modal>
  );
}
