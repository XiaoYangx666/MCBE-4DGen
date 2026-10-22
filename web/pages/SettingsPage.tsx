import {
  getPalette,
  setPalette,
  type Palette,
  getAppearance,
  setAppearance,
  type Appearance,
} from "../lib/appearance";
import { useEffect, useState } from "react";
import { api, post } from "../lib/api";

type SettingsData = {
  dataRoot: string;
  gameRoot: string;
  environment: boolean;
  pendingDataRoot: string | null;
  gameConfigured: boolean;
  managerError: string;
  version?: string;
  runtime?: {
    electron: string | null;
    node: string;
    chrome: string | null;
  };
};

type UsageData = {
  categories: Record<string, { bytes: number; files: number }>;
  bytes: number;
  files: number;
  skipped: number;
  disk: { availableBytes: number; totalBytes: number } | null;
};

const USAGE_LABELS: Record<string, string> = {
  sources: "源文件、图片",
  models: "模型、编辑配置",
  skins: "皮肤包、备份",
  cache: "预览缓存",
  other: "其他文件",
};

const APPEARANCES = [
  ["system", "跟随系统"],
  ["light", "浅色"],
  ["dark", "深色"],
] as const;

const PALETTES = [
  ["graphite", "中性灰", "干净、克制"],
  ["ocean", "海盐蓝", "清爽、低饱和"],
  ["sand", "暖砂", "柔和、暖色调"],
  ["rose", "玫瑰灰", "温润、淡玫瑰"],
  ["violet", "蓝紫", "原有蓝紫配色"],
] as const;

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toLocaleString("zh-CN", {
    maximumFractionDigits: index ? 1 : 0,
  })} ${units[index]}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SettingsPage({ onAbout }: { onAbout: () => void }) {
  const [palette, updatePalette] = useState(getPalette);
  const [appearance, updateAppearance] = useState(getAppearance);
  const [data, setData] = useState<SettingsData | null>(null);
  const [game, setGame] = useState("");
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [usageError, setUsageError] = useState("");

  async function scan() {
    setScanning(true);
    setUsageError("");
    try {
      setUsage((await api("/api/settings/storage-usage")) as UsageData);
    } catch (scanError) {
      setUsageError(String(scanError));
    } finally {
      setScanning(false);
    }
  }

  async function choose(kind: "game" | "data") {
    setBusy("choose-" + kind);
    setError("");
    try {
      if (!window.desktop)
        throw Error("系统目录选择请使用桌面应用，网页模式可手动输入路径");
      const result = await window.desktop.chooseDirectory(
        kind,
        kind === "game" ? game : directory,
      );
      if (result.path) {
        if (kind === "game") setGame(result.path);
        else setDirectory(result.path);
      }
    } catch (chooseError) {
      setError(errorMessage(chooseError));
    } finally {
      setBusy("");
    }
  }

  async function load() {
    const value = (await api("/api/settings")) as SettingsData;
    setData(value);
    setGame(value.gameRoot);
    setDirectory(value.pendingDataRoot ?? value.dataRoot);
  }

  useEffect(() => {
    void load().catch((loadError) => setError(String(loadError)));
    void scan();
  }, []);

  async function save(kind: "game" | "data") {
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      const result = await post(
        kind === "game" ? "/api/settings/game-directory" : "/api/storage",
        { path: (kind === "game" ? game : directory).trim() },
      );
      setNotice(result.message);
      await load();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="page-content">
      <div className="settings-page">
      {error && (
        <p className="pack-message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="pack-message" role="status">
          {notice}
        </p>
      )}
      {!data ? (
        <p>正在读取设置…</p>
      ) : (
        <div className="settings-sections">
          <section>
            <h2>外观</h2>
            <p>选择你喜欢的界面明暗，立即生效并自动保存。</p>
            <div
              className="appearance-options"
              role="group"
              aria-label="界面主题"
            >
              {APPEARANCES.map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={appearance === value}
                  onClick={() => {
                    void setAppearance(value as Appearance)
                      .then(() => updateAppearance(value))
                      .catch((appearanceError) =>
                        setError(String(appearanceError)),
                      );
                  }}
                >
                  <span className={"theme-swatch " + value} />
                  {label}
                </button>
              ))}
            </div>
            <h3 className="palette-heading">配色</h3>
            <div className="palette-options" role="group" aria-label="界面配色">
              {PALETTES.map(([value, label, description]) => (
                <button
                  key={value}
                  aria-pressed={palette === value}
                  onClick={() => {
                    void setPalette(value as Palette)
                      .then(() => updatePalette(value))
                      .catch((paletteError) => setError(String(paletteError)));
                  }}
                >
                  <span className={"palette-preview " + value}>
                    <i />
                    <i />
                    <i />
                  </span>
                  <b>{label}</b>
                  <small>{description}</small>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2>游戏目录</h2>
            <p>
              选择 Minecraft 的 skin_packs
              文件夹。切换目录保留各安装位置的备份和管理状态，本地皮肤包共用。
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save("game");
              }}
            >
              <label htmlFor="game-root">skin_packs 绝对路径</label>
              <div className="directory-input">
                <input
                  id="game-root"
                  placeholder="D:/Minecraft/Content/data/skin_packs"
                  value={game}
                  onChange={(event) => setGame(event.target.value)}
                />
                <button
                  type="button"
                  disabled={!!busy || !window.desktop}
                  title={window.desktop ? "选择文件夹" : "请在桌面应用中使用"}
                  onClick={() => void choose("game")}
                >
                  {busy === "choose-game" ? "请选择…" : "选择文件夹…"}
                </button>
              </div>
              <div className="settings-save">
                <span>
                  {data.gameConfigured ? "已连接" : "尚未配置游戏目录"}
                </span>
                <button
                  className="primary"
                  disabled={
                    !!busy || !game.trim() || game.trim() === data.gameRoot
                  }
                >
                  {busy === "game" ? "正在保存…" : "保存游戏目录"}
                </button>
              </div>
            </form>
          </section>

          <section>
            <h2>数据目录</h2>
            <p>
              源模型、贴图、编辑配置、皮肤包与备份保存在这里。更改后重启服务，自动复制现有数据，旧目录保留。
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save("data");
              }}
            >
              <label htmlFor="data-root">数据目录绝对路径</label>
              <div className="directory-input">
                <input
                  id="data-root"
                  value={directory}
                  disabled={data.environment}
                  onChange={(event) => setDirectory(event.target.value)}
                />
                <button
                  type="button"
                  disabled={!!busy || data.environment || !window.desktop}
                  title={window.desktop ? "选择文件夹" : "请在桌面应用中使用"}
                  onClick={() => void choose("data")}
                >
                  {busy === "choose-data" ? "请选择…" : "选择文件夹…"}
                </button>
              </div>
              <div className="settings-save">
                <span>
                  {data.environment
                    ? "由 FOURDGEN_DATA_DIR 环境变量管理"
                    : data.pendingDataRoot
                      ? "等待重启迁移"
                      : "选择新的空目录"}
                </span>
                <button
                  className="primary"
                  disabled={
                    !!busy ||
                    data.environment ||
                    !directory.trim() ||
                    directory.trim() === (data.pendingDataRoot ?? data.dataRoot)
                  }
                >
                  {busy === "data" ? "正在保存…" : "保存，重启后生效"}
                </button>
              </div>
            </form>
            {data.pendingDataRoot && window.desktop && (
              <button
                type="button"
                onClick={() => void window.desktop?.restart()}
              >
                重启应用，完成迁移
              </button>
            )}
            <div className="storage-usage">
              <div className="usage-heading">
                <div>
                  <span>当前数据目录占用</span>
                  <strong>
                    {usage
                      ? formatSize(usage.bytes)
                      : scanning
                        ? "正在统计…"
                        : "—"}
                  </strong>
                  {usage && (
                    <small>
                      {usage.files.toLocaleString("zh-CN")} 个文件
                      {usage.disk
                        ? ` · 所在磁盘可用 ${formatSize(usage.disk.availableBytes)}`
                        : ""}
                    </small>
                  )}
                </div>
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => void scan()}
                >
                  {scanning ? "正在统计…" : "刷新占用"}
                </button>
              </div>
              {usage && (
                <>
                  <div className="usage-meter" aria-hidden="true">
                    {Object.keys(USAGE_LABELS).map((key) => (
                      <span
                        key={key}
                        className={"usage-" + key}
                        style={{
                          width: `${usage.bytes ? (usage.categories[key]!.bytes / usage.bytes) * 100 : 0}%`,
                        }}
                      />
                    ))}
                  </div>
                  <div className="usage-breakdown">
                    {Object.entries(USAGE_LABELS)
                      .filter(
                        ([key]) =>
                          key !== "other" || usage.categories[key]!.bytes > 0,
                      )
                      .map(([key, label]) => (
                        <div key={key}>
                          <span>
                            <i className={"usage-" + key} />
                            {label}
                          </span>
                          <b>{formatSize(usage.categories[key]!.bytes)}</b>
                        </div>
                      ))}
                  </div>
                  {!!usage.skipped && (
                    <p className="help">
                      {usage.skipped}{" "}
                      项无法读取或在统计时发生变化，当前占用可能不完整。
                    </p>
                  )}
                  <p className="help">
                    按文件大小统计，不包含链接目标。显示当前正在使用的目录
                    {data.pendingDataRoot ? "，迁移完成后可重新统计" : ""}。
                  </p>
                </>
              )}
              {usageError && (
                <p className="error" role="alert">
                  {usageError}
                </p>
              )}
            </div>
          </section>

          <section>
            <h2>关于</h2>
            <p>
              4DGen 本地模型与皮肤工作台。查看版本、运行环境和数据目录。
            </p>
            <div className="settings-save">
              <span>
                {data.version ? `版本 ${data.version}` : "本地模型与皮肤工作台"}
              </span>
              <button type="button" onClick={onAbout}>
                关于 4DGen
              </button>
            </div>
          </section>
        </div>
      )}
      </div>
    </main>
  );
}
