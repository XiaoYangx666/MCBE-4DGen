import { useState } from "react";
import type { SourceSite } from "../../src/source-sites";
import { copyTextToClipboard } from "../shared/clipboard";
import { SourceDirectory } from "../shared/SourceDirectory";
import { Modal } from "../ui/Modal";

function SiteIcon({ site }: { site: SourceSite }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="source-icon-fallback">
        {site.name.replace(/[【】]/g, "").slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={`/api/source-icon?domain=${encodeURIComponent(site.domain)}`}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth < 8) setFailed(true);
      }}
    />
  );
}

async function copySiteLink(text: string) {
  if (window.desktop?.copyText) {
    await window.desktop.copyText(text);
    return;
  }
  await copyTextToClipboard(text);
}

export function ModelSources({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="获取模型"
      label="获取模型"
      className="model-sources"
      closeLabel="关闭获取模型"
      closeOnBackdrop
      autoFocusClose
      onClose={onClose}
    >
      <SourceDirectory
        lead={
          <>
            从常用站点找模型，下载后回到「源模型」导入。优先选择 ZIP、PMX、VRM
            或 GLB，并保留模型与贴图的目录结构。
          </>
        }
        note={
          <>
            提示：UnityPackage 需要先在 Unity 中导出 FBX/VRM；MMD
            配布站的部分文件需要作者说明中的密码。下载后请保留模型、贴图和
            MMD 动作文件的相对目录。
          </>
        }
        icon={(site) => <SiteIcon site={site} />}
        copyText={copySiteLink}
      />
    </Modal>
  );
}
