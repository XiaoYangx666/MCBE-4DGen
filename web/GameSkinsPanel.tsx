import { useCallback, useEffect, useState } from "react";
import type {
  PersonaProfileRecipe,
  PersonaRecipe,
} from "../src/persona-recipe";
import { api, post } from "./api";
import type {
  GameSkinBackup,
  GameSkinBackupReason,
  GameSkinBackupsResponse,
} from "./game-skins-types";
import { PersonaRecipePanel } from "./PersonaRecipePanel";

function kindLabel(kind: PersonaProfileRecipe["kind"]) {
  if (kind === "classic") return "经典皮肤";
  if (kind === "persona") return "角色创建器";
  return "空槽位";
}

function reasonLabel(reason: GameSkinBackupReason) {
  const labels: Record<GameSkinBackupReason, string> = {
    "custom:enable": "加入自定义",
    "custom:disable": "移出自定义",
    "custom:restore": "恢复初始",
    "custom:apply-update": "更新到游戏",
    "custom:edit": "编辑游戏包",
    manual: "手动备份",
  };
  return labels[reason] ?? reason;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

export function GameSkinsPanel({
  recipe,
  error,
  exportPath,
  busy,
  onExport,
  onRefresh,
}: {
  recipe?: PersonaRecipe;
  error?: string;
  exportPath: string;
  busy: boolean;
  onExport: () => void;
  onRefresh: () => Promise<void>;
}) {
  const profiles = recipe?.profiles ?? [];
  const [selectedSlot, setSelectedSlot] = useState("");
  const [backups, setBackups] = useState<GameSkinBackup[]>([]);
  const [backupBusy, setBackupBusy] = useState("");
  const [backupError, setBackupError] = useState("");
  const [notice, setNotice] = useState("");

  const loadBackups = useCallback(async () => {
    try {
      const result = (await api(
        "/api/persona/backups",
      )) as GameSkinBackupsResponse;
      setBackups(result.backups ?? []);
      setBackupError("");
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const selected =
    profiles.find((profile) => profile.slot === selectedSlot) ??
    profiles.find((profile) => profile.lastUsed) ??
    profiles[0];

  async function backupNow() {
    setBackupBusy("正在备份…");
    setBackupError("");
    setNotice("");
    try {
      const result = (await post(
        "/api/persona/backup",
        {},
      )) as GameSkinBackup;
      setNotice(
        result.deduplicated
          ? "配方没有变化，已跳过重复备份"
          : "已创建手动备份",
      );
      await loadBackups();
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackupBusy("");
    }
  }

  async function removeBackup(id: string) {
    if (!window.confirm("删除这个游戏皮肤备份？")) return;
    setBackupBusy("正在删除备份…");
    setBackupError("");
    setNotice("");
    try {
      await post("/api/persona/backups/delete", { id });
      setNotice("备份已删除");
      await loadBackups();
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackupBusy("");
    }
  }

  async function refreshAll() {
    setBackupBusy("正在刷新…");
    setBackupError("");
    try {
      await onRefresh();
      await loadBackups();
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackupBusy("");
    }
  }

  return (
    <div className="game-skins-panel">
      <div className="pack-detail-bar">
        <div>
          <h2>
            游戏皮肤
            <span className="preset-title-badge">只读</span>
          </h2>
          <span>
            {profiles.length} 个角色
            {selected?.lastUsed
              ? ` · 当前使用角色 ${selected.slot.replace("personaProfile", "")}`
              : ""}
          </span>
        </div>
        <div className="pack-detail-actions">
          <button
            disabled={!!backupBusy || busy}
            onClick={() => void backupNow()}
          >
            立即备份
          </button>
          <button disabled={!!backupBusy || busy} onClick={onExport}>
            {busy ? "正在导出…" : "导出配方"}
          </button>
          <button
            disabled={!!backupBusy}
            onClick={() => void refreshAll()}
          >
            刷新
          </button>
        </div>
      </div>

      {error && <p className="inline-note game-skins-note">{error}</p>}
      {notice && <p className="inline-note game-skins-note">{notice}</p>}
      {backupError && (
        <p className="inline-note game-skins-note error">{backupError}</p>
      )}
      {exportPath && (
        <p className="inline-note game-skins-note">
          已导出：<code>{exportPath}</code>
        </p>
      )}

      <div className="game-skins-body">
        <div className="pane-caption game-skins-role-caption">角色档案</div>
        <div className="game-skins-role-tabs">
          {profiles.map((profile) => {
            const number = profile.slot.replace("personaProfile", "");
            return (
              <button
                key={profile.slot}
                className={
                  "game-skins-role-tab" +
                  (selected?.slot === profile.slot ? " selected" : "")
                }
                onClick={() => setSelectedSlot(profile.slot)}
              >
                <span className="game-skins-role-number">{number}</span>
                <span>
                  <b>角色 {number}</b>
                  <small>
                    {kindLabel(profile.kind)} · {profile.pieces.length} 个部件
                  </small>
                </span>
                {profile.lastUsed && (
                  <span className="pack-game-badge">当前使用</span>
                )}
              </button>
            );
          })}
          {!profiles.length && (
            <p className="muted game-skins-empty">
              {error || "没有角色创建器档案。"}
            </p>
          )}
        </div>
        <div className="game-skins-detail">
          {selected ? (
            <PersonaRecipePanel profile={selected} />
          ) : (
            <div className="empty-state">
              <h2>没有可显示的角色</h2>
              <p>请先启动一次 Minecraft，让角色创建器写入档案。</p>
            </div>
          )}
        </div>

        <div className="game-skins-backups">
          <div className="pane-caption">备份记录（{backups.length}）</div>
          {backups.length ? (
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>原因</th>
                  <th>角色</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.id}>
                    <td>{formatTime(backup.created)}</td>
                    <td>{backup.kind === "auto" ? "自动" : "手动"}</td>
                    <td>
                      {reasonLabel(backup.reason)}
                      {backup.label ? ` · ${backup.label}` : ""}
                    </td>
                    <td>{backup.profiles.length}</td>
                    <td>
                      <div className="game-skins-backup-actions">
                        <a
                          href={`/api/persona/backups/${encodeURIComponent(
                            backup.id,
                          )}`}
                          download
                        >
                          查看/下载
                        </a>
                        <button
                          className="danger-button"
                          disabled={!!backupBusy}
                          onClick={() => void removeBackup(backup.id)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              还没有备份。修改自定义皮肤时会自动备份，也可以点击「立即备份」。
            </p>
          )}
          {backupBusy && (
            <p role="status" className="inline-note">
              {backupBusy}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
