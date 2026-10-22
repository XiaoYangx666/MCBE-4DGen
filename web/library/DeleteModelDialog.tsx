import { useState } from "react";
import { post } from "../lib/api";
import { Modal } from "../ui/Modal";
import { errorMessage, type Model } from "./model-types";

export type DeleteTarget =
  | { kind: "model"; model: Model }
  | { kind: "version"; id: string };

export function DeleteModelDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: DeleteTarget;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [deleteSource, setDeleteSource] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deletingModel = target.kind === "model";
  const id = target.kind === "model" ? target.model.id : target.id;

  return (
    <Modal
      title={deletingModel ? "删除源模型？" : "删除皮肤版本？"}
      label="确认删除"
      busy={busy}
      onClose={onClose}
    >
      <p>
        {target.kind === "model"
          ? `删除「${target.model.name}」的模型管理记录和编辑配置，已生成的皮肤包保留。`
          : "此皮肤版本将从本地存储中永久删除。"}
      </p>
      <div>
        {deletingModel && (
          <label className="delete-source-choice">
            <input
              type="checkbox"
              checked={deleteSource}
              onChange={(event) => setDeleteSource(event.target.checked)}
            />
            同时删除程序归档的源文件与独占贴图（原始下载文件保留）
          </label>
        )}
      </div>
      <div className="pick-actions">
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="danger-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void post(
              deletingModel ? "/api/models/delete" : "/api/packs/delete",
              { id, deleteSource: deletingModel && deleteSource },
            )
              .then(onDeleted)
              .catch((reason) => setError(errorMessage(reason)))
              .finally(() => setBusy(false));
          }}
        >
          确认删除
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
