import { useEffect, useState } from "react";
import { api, post } from "./api";
import type { Packs } from "./pack-types";

/** Saving a conversion never writes to the game directory. */
export function SaveSkinDialog({
  jobId,
  modelName,
  onClose,
  onSaved,
}: {
  jobId: string;
  modelName: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(modelName);
  const [target, setTarget] = useState("");
  const [packs, setPacks] = useState<Packs | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api("/api/packs")
      .then((p) => {
        if (active) setPacks(p);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  const presets = new Set(
    packs?.status?.flatMap((s) => s.presetSources ?? []) ?? [],
  );
  const choices =
    packs?.library?.filter((p) => !p.removed && !presets.has(p.id)) ?? [];
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await post("/api/packs/install", {
        job: jobId,
        label: name.trim(),
        ...(target ? { target } : {}),
      });
      onSaved(result.pack.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="pick-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-skin-title"
    >
      <form
        className="pick-box save-skin-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="card-top">
          <div>
            <span className="eyebrow">保存转换结果</span>
            <h2 id="save-skin-title">保存皮肤</h2>
          </div>
          <button
            type="button"
            disabled={busy}
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p>保留当前皮肤和转换参数，之后可以再次编辑或加入游戏。</p>
        <label>
          皮肤名称
          <input
            autoFocus
            maxLength={120}
            required
            disabled={busy}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          保存位置
          <select
            disabled={busy || !packs?.configured}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">新建独立皮肤包</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                添加到：{p.name}（{p.skins} 套）
              </option>
            ))}
          </select>
        </label>
        {target && (
          <p className="inline-note">
            直接保存到所选皮肤包，不会另外创建独立包。
          </p>
        )}
        {packs && !packs.configured && (
          <p role="alert" className="error">
            请先按皮肤包管理配置说明设置本地管理路径。仍可下载本次结果。
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="pick-actions">
          <a
            className="button-link"
            href={`/api/job/${jobId}/download`}
            download
          >
            下载 .zip
          </a>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={busy || !name.trim() || !packs?.configured}
          >
            {busy ? "正在保存…" : "保存并查看"}
          </button>
        </div>
      </form>
    </div>
  );
}
