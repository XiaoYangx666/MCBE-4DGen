import { useState } from 'react';
import { safeFilename, saveOrShare } from '../lib/download';
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
      await saveOrShare(blob, `${safeFilename(name)}.zip`, name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`download-buttons ${compact ? 'compact' : ''}`}>
      <button type="button" className="primary" disabled={busy} onClick={() => void downloadPack()}>
        <Icon name={busy ? 'reset' : 'download'} size={15} className={busy ? 'spin' : undefined} />
        {busy ? '正在打包…' : '下载皮肤包 .zip'}
      </button>
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}

export function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <details className="warning-list">
      <summary>
        <Icon name="alert" size={14} />
        <span>转换提示 {warnings.length} 条</span>
      </summary>
      <ul>
        {warnings.map((warning) => (
          <li key={warning}>
            <Icon name="alert" size={14} />
            <span>{warning}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
