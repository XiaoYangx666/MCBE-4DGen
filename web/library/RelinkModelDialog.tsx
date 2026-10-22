import { useState } from "react";
import { post } from "../lib/api";
import { Modal } from "../ui/Modal";
import { errorMessage, type Model } from "./model-types";

export function RelinkModelDialog({
  model,
  onClose,
  onSaved,
}: {
  model: Model;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [sourcePath, setSourcePath] = useState(model.path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Modal
      title="重新定位源文件"
      label="重新定位源文件"
      busy={busy}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          void post("/api/models/relink", {
            id: model.id,
            path: sourcePath.trim(),
          })
            .then(onSaved)
            .then(onClose)
            .catch((reason) => setError(errorMessage(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <p>
          选择同一个模型的新位置，编辑配置和历史版本会保留。贴图需随模型一起移动。
        </p>
        <label>
          模型文件绝对路径
          <input
            autoFocus
            value={sourcePath}
            onChange={(event) => setSourcePath(event.target.value)}
          />
        </label>
        <div className="pick-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={busy || !sourcePath.trim()}
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
    </Modal>
  );
}
