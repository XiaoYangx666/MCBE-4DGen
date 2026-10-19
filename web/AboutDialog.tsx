import { useEffect, useState } from "react";
import { api } from "./api";

type AboutData = {
  dataRoot: string;
  version: string;
  runtime: {
    electron: string | null;
    node: string;
    chrome: string | null;
  };
};

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<AboutData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api("/api/settings")
      .then((value) => {
        if (active) setData(value as AboutData);
      })
      .catch((loadError) => {
        if (active) setError(String(loadError));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const runtime = data?.runtime;

  return (
    <div
      className="pick-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-title"
    >
      <div className="pick-box about-dialog">
        <div className="card-top">
          <div>
            <span className="eyebrow">ABOUT</span>
            <h2 id="about-title">关于 4DGen</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="about-lead">本地模型与皮肤工作台</p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : !data ? (
          <p className="about-note">正在读取版本信息…</p>
        ) : (
          <>
            <dl className="about-facts">
              <div>
                <dt>版本</dt>
                <dd>{data.version}</dd>
              </div>
              <div>
                <dt>运行环境</dt>
                <dd>
                  {runtime?.electron
                    ? `Electron ${runtime.electron} · Node ${runtime.node}`
                    : `Node ${runtime?.node ?? "—"}`}
                  {runtime?.chrome ? ` · Chromium ${runtime.chrome}` : ""}
                </dd>
              </div>
              <div>
                <dt>数据目录</dt>
                <dd className="mono">{data.dataRoot}</dd>
              </div>
            </dl>
            <p className="about-note">
              将模型转换为 Minecraft Bedrock
              皮肤包，支持静态与人形绑定、减面、图集和可恢复的皮肤包管理。所有文件在本地环境处理。
            </p>
          </>
        )}
        <div className="pick-actions">
          <a
            className="button-link"
            href="https://github.com/XiaoYangx666/4DTest"
            target="_blank"
            rel="noreferrer"
          >
            项目主页
          </a>
          <button className="primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
