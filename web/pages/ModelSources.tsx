import { Modal } from "../ui/Modal";

const sites = [
  {
    name: "模之屋",
    url: "https://www.aplaybox.com/",
    tag: "PMX / MMD",
    description: "中文模型创作与分享社区，适合找角色、服装和游戏官方配布模型。",
  },
  {
    name: "VRoid Hub",
    url: "https://hub.vroid.com/",
    tag: "VRM",
    description: "VRoid 角色展示平台，可寻找作者开放下载的 VRM 人形模型。",
  },
  {
    name: "BowlRoll",
    url: "https://bowlroll.net/",
    tag: "MMD 配布",
    description: "常见 MMD 文件配布平台，下载方式及密码见作者的配布说明。",
  },
  {
    name: "BOOTH",
    url: "https://booth.pm/en/browse/3D%20Models",
    tag: "原创角色 / 3D 素材",
    description:
      "原创角色与 3D 素材商店。下载前确认文件格式，Unity 项目包需先导出模型。",
  },
];

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
      <p>选择网站，在新标签页中打开。下载后回到这里导入。</p>
        <div className="source-sites">
          {sites.map((site) => (
            <a
              key={site.name}
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div>
                <b>{site.name}</b>
                <span>{site.tag}</span>
              </div>
              <p>{site.description}</p>
              <small>{new URL(site.url).hostname} ↗</small>
            </a>
          ))}
        </div>
        <p className="source-format-hint">
          优先下载 ZIP、PMX、VRM 或 GLB；保留模型与贴图的目录结构。
        </p>
    </Modal>
  );
}
