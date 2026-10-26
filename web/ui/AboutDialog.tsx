import { useEffect, useState } from "react";
import { Changelog } from "../shared/Changelog";
import { BUILD_LABEL } from "../shared/build-log";
import { api } from "../lib/api";
import { Modal } from "./Modal";

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

  const runtime = data?.runtime;

  return (
    <Modal
      title={
        <>
          关于 4DGen
          <span className="version-badge">{BUILD_LABEL}</span>
        </>
      }
      label="关于 4DGen"
      eyebrow="ABOUT"
      className="about-dialog"
      onClose={onClose}
      closeLabel="关闭"
    >
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
                <dt>作者</dt>
                <dd>XiaoYangX666</dd>
              </div>
              <div>
                <dt>版本</dt>
                <dd>{BUILD_LABEL}</dd>
              </div>
              <div>
                <dt>许可证</dt>
                <dd>GPL-3.0</dd>
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
              皮肤包，支持静态与人形绑定、减面、图集和可恢复的皮肤包管理。所有文件在本机处理。
            </p>
          </>
        )}
        <div className="pick-actions">
          <Changelog compact />
          <a
            className="button-link"
            href="https://github.com/XiaoYangx666/MCBE-4DGen"
            target="_blank"
            rel="noreferrer"
          >
            项目主页
          </a>
          <button className="primary" onClick={onClose}>
            关闭
          </button>
        </div>
    </Modal>
  );
}
