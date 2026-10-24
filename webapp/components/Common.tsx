import { useState } from 'react';
import { downloadBlob, safeFilename } from '../lib/download';
import { zipSkinPack } from '../lib/convert';
import { Icon } from './Icons';

interface DownloadButtonsProps {
  files: Record<string, Uint8Array>;
  name: string;
  compact?: boolean;
}

export function DownloadButtons({ files, name, compact }: DownloadButtonsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadPack = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await zipSkinPack(files);
      downloadBlob(blob, `${safeFilename(name)}.mcpack`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const downloadTexture = () => {
    const png = files['skin0.png'];
    if (!png) return;
    const buffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
    downloadBlob(new Blob([buffer], { type: 'image/png' }), `${safeFilename(name)}-skin0.png`);
  };

  return (
    <div className={`download-buttons ${compact ? 'compact' : ''}`}>
      <button type="button" className="primary" disabled={busy} onClick={() => void downloadPack()}>
        <Icon name={busy ? 'reset' : 'download'} size={15} className={busy ? 'spin' : undefined} />
        {busy ? '正在打包…' : '下载 .mcpack'}
      </button>
      <button type="button" className="button-link" onClick={downloadTexture}>
        <Icon name="pixel" size={14} /> 下载 128×128 贴图
      </button>
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}

export function InstallHelp() {
  return (
    <details className="install-help inline-note">
      <summary>怎么导入 Minecraft？</summary>
      <ol>
        <li>下载 <code>.mcpack</code> 文件。</li>
        <li>双击文件，或右键选择「用 Minecraft 打开」。</li>
        <li>进入游戏 → 更衣室 → 经典皮肤，选择刚导入的皮肤。</li>
      </ol>
      <p>只支持 Minecraft 基岩版（Windows / 手机 / 主机）。Java 版不支持 4D 皮肤。</p>
    </details>
  );
}

export function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="warning-list">
      {warnings.map((warning) => (
        <li key={warning}>
          <Icon name="alert" size={14} />
          <span>{warning}</span>
        </li>
      ))}
    </ul>
  );
}
