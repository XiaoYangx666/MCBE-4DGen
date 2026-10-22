import { useState } from "react";
import { post } from "../lib/api";
import { Modal } from "../ui/Modal";
import { errorMessage, type Model } from "./model-types";

export function RenameModelDialog({
  model,
  onClose,
  onSaved,
}: {
  model: Model;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(model.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Modal
      title="重命名模型"
      label="重命名模型"
      busy={busy}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          void post("/api/models/update", { id: model.id, name: name.trim() })
            .then(onSaved)
            .then(onClose)
            .catch((reason) => setError(errorMessage(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <input
          autoFocus
          aria-label="模型名称"
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="pick-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy || !name.trim()}>
            保存名称
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  );
}
