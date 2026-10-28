import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../web/shared/Icons';
import { useSkinPack } from '../lib/pack-context';
import { DEFAULT_PACK_NAME, type StoredSkin } from '../lib/pack-types';
import { formatBytes } from '../../web/shared/format';
import { SKIN_NAME_MAX_LENGTH } from '../../src/skin-pack-files.ts';

// three.js is only downloaded when someone opens a 3D preview.
const SkinPreviewDialog = lazy(async () => {
  const module = await import('./SkinPreview');
  return { default: module.SkinPreviewDialog };
});

export function PackStudio() {
  const {
    pack, loading, busy, error,
    createPack, importPack, renamePack, renameSkin, removeSkin, clearPack, exportPack,
  } = useSkinPack();
  const [newName, setNewName] = useState(DEFAULT_PACK_NAME);
  const [packName, setPackName] = useState(pack?.name ?? DEFAULT_PACK_NAME);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [previewSkin, setPreviewSkin] = useState<StoredSkin | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const closePreview = useCallback(() => setPreviewSkin(null), []);

  useEffect(() => {
    setPackName(pack?.name ?? DEFAULT_PACK_NAME);
  }, [pack?.name]);

  const importZip = async (file: File) => {
    setActionError('');
    setMessage('');
    try {
      const result = await importPack(file);
      setMessage(
        `${result.createdPack ? '已创建皮肤包并' : ''}导入 ${result.imported} 个皮肤` +
        (result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''),
      );
      if (result.skipped.length) setActionError(result.skipped.slice(0, 3).join('；'));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const importButton = (
    <>
      <input
        ref={importInput}
        type="file"
        accept=".zip,.mcpack,application/zip,application/octet-stream"
        className="file-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importZip(file);
        }}
      />
      <button
        type="button"
        className="button-link pack-import"
        disabled={busy}
        onClick={() => importInput.current?.click()}
      >
        <Icon name="upload" size={14} /> 导入皮肤包
      </button>
    </>
  );

  const stats = useMemo(() => {
    if (!pack) return { triangles: 0, bytes: 0 };
    const encoder = new TextEncoder();
    return {
      triangles: pack.skins.reduce((sum, skin) => sum + skin.triangles, 0),
      bytes: pack.skins.reduce(
        (sum, skin) => sum + skin.png.byteLength + encoder.encode(JSON.stringify(skin.geometry)).byteLength,
        0,
      ),
    };
  }, [pack]);

  if (loading) {
    return (
      <div className="panel-loading">
        <span className="spinner" /> 正在读取本地皮肤包…
      </div>
    );
  }

  if (!pack) {
    return (
      <div className="studio-layout">
        <section className="studio-settings">
          <div className="settings-body">
            <div className="template-icon"><Icon name="cube" size={30} /></div>
            <h2>新建皮肤包</h2>
            <p>网页版只保留一个皮肤包。</p>
            <label className="field-label">
              皮肤包名称
              <input
                value={newName}
                maxLength={SKIN_NAME_MAX_LENGTH}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={DEFAULT_PACK_NAME}
              />
            </label>
          </div>
          <div className="settings-footer">
            {(error || actionError) && (
              <p className="error-message" role="alert"><Icon name="alert" size={15} />{error || actionError}</p>
            )}
            {message && <p className="pack-message">{message}</p>}
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                setActionError('');
                setMessage('');
                void createPack(newName)
                  .then(() => setMessage('皮肤包已创建'))
                  .catch((cause) => setActionError(cause instanceof Error ? cause.message : String(cause)));
              }}
            >
              <Icon name={busy ? 'reset' : 'cube'} size={15} className={busy ? 'spin' : undefined} />
              {busy ? '正在创建…' : '创建皮肤包'}
            </button>
            {importButton}
          </div>
        </section>
        <section className="studio-result">
          <div className="empty-state">
            <Icon name="cube" size={42} />
            <h2>单包模式</h2>
            <p>创建后，把生成的皮肤加进来。</p>
          </div>
        </section>
      </div>
    );
  }

  const commitPackName = () => {
    const name = packName.trim();
    if (!name || name === pack.name) {
      setPackName(pack.name);
      return;
    }
    setActionError('');
    void renamePack(name)
      .then(() => setMessage('皮肤包名称已保存'))
      .catch((cause) => {
        setActionError(cause instanceof Error ? cause.message : String(cause));
        setPackName(pack.name);
      });
  };

  const exportCurrent = () => {
    setActionError('');
    setMessage('');
    void exportPack()
      .then((result) => setMessage(`已导出 ${result.file} · ${formatBytes(result.bytes)}`))
      .catch((cause) => setActionError(cause instanceof Error ? cause.message : String(cause)));
  };

  const clearCurrent = () => {
    if (!confirm('清空后会删除这个皮肤包里的所有皮肤和包身份，且不能恢复。确定继续吗？')) return;
    setActionError('');
    setMessage('');
    void clearPack()
      .then(() => setMessage('皮肤包已清空'))
      .catch((cause) => setActionError(cause instanceof Error ? cause.message : String(cause)));
  };

  return (
    <div className="studio-layout">
      <section className="studio-settings">
        <div className="settings-body">
          <div className="template-icon"><Icon name="cube" size={30} /></div>
          <h2>皮肤包设置</h2>
          <p>所有皮肤共用一个包身份。</p>

          <label className="field-label">
            皮肤包名称
            <input
              value={packName}
              maxLength={SKIN_NAME_MAX_LENGTH}
              onChange={(event) => setPackName(event.target.value)}
              onBlur={commitPackName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
              }}
            />
          </label>

          <div className="pack-facts">
            <div><span>皮肤</span><b>{pack.skins.length}</b></div>
            <div><span>三角面</span><b>{stats.triangles.toLocaleString('zh-CN')}</b></div>
            <div><span>体积</span><b>{formatBytes(stats.bytes)}</b></div>
          </div>
        </div>

        <div className="settings-footer">
          {(error || actionError) && (
            <p className="error-message" role="alert"><Icon name="alert" size={15} />{error || actionError}</p>
          )}
          {message && <p className="pack-message">{message}</p>}
          <button type="button" className="primary" disabled={busy || !pack.skins.length} onClick={exportCurrent}>
            <Icon name={busy ? 'reset' : 'download'} size={15} className={busy ? 'spin' : undefined} />
            {busy ? '正在打包…' : '下载皮肤包 .zip'}
          </button>
          <button type="button" className="text-danger pack-clear" disabled={busy} onClick={clearCurrent}>
            清空皮肤包
          </button>
        </div>
      </section>

      <section className="studio-result pack-result">
        <div className="result-header">
          <div>
            <h2>{pack.name}</h2>
            <p>
              {pack.skins.length} 个皮肤 · 更新于 {new Date(pack.updatedAt).toLocaleString('zh-CN')}
            </p>
          </div>
          <div className="pack-header-actions">
            {importButton}
            <span className="badge">ZIP</span>
          </div>
        </div>

        {pack.skins.length ? (
          <div className="result-body pack-body">
            <div className="skin-grid">
              {pack.skins.map((skin) => (
                <SkinCard
                  key={skin.id}
                  skin={skin}
                  disabled={busy}
                  onPreview={setPreviewSkin}
                  onRename={renameSkin}
                  onRemove={(id) => {
                    if (!confirm(`从皮肤包移除「${skin.name}」？`)) return;
                    setActionError('');
                    void removeSkin(id).catch((cause) =>
                      setActionError(cause instanceof Error ? cause.message : String(cause)));
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <Icon name="cube" size={42} />
            <h2>皮肤包还是空的</h2>
            <p>先生成一张皮肤，再加入这里。</p>
            <div className="pack-empty-actions">
              <a className="button-link" href="#image">图片皮肤</a>
              <a className="button-link" href="#model">3D 模型</a>
            </div>
          </div>
        )}
      </section>

      {previewSkin && (
        <Suspense
          fallback={(
            <div
              className="dialog-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closePreview();
              }}
            >
              <div className="preview-dialog preview-dialog-loading" role="status">
                <span className="spinner" /> 正在加载三维预览…
              </div>
            </div>
          )}
        >
          <SkinPreviewDialog skin={previewSkin} onClose={closePreview} />
        </Suspense>
      )}
    </div>
  );
}

interface SkinCardProps {
  skin: StoredSkin;
  disabled: boolean;
  onPreview: (skin: StoredSkin) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onRemove: (id: string) => void;
}

function SkinCard({ skin, disabled, onPreview, onRename, onRemove }: SkinCardProps) {
  const [name, setName] = useState(skin.name);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const copy = skin.png.slice();
    const buffer = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer;
    const next = URL.createObjectURL(new Blob([buffer], { type: 'image/png' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [skin.png]);

  useEffect(() => {
    setName(skin.name);
  }, [skin.name]);

  const commit = () => {
    const value = name.trim();
    if (!value || value === skin.name) {
      setName(skin.name);
      return;
    }
    setError('');
    void onRename(skin.id, value).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      setName(skin.name);
    });
  };

  return (
    <article className="skin-card">
      <div className="skin-card-image">
        {url ? <img src={url} alt={skin.name} /> : <span className="spinner" />}
        <span className="skin-source">
          {skin.source === 'image' ? '图片' : skin.source === 'model' ? '模型' : '导入'}
        </span>
        <button
          type="button"
          className="skin-preview-button"
          title={`3D 预览 ${skin.name}`}
          aria-label={`3D 预览 ${skin.name}`}
          onClick={() => onPreview(skin)}
        >
          <Icon name="cube" size={12} /> 3D
        </button>
      </div>
      <input
        value={name}
        maxLength={SKIN_NAME_MAX_LENGTH}
        disabled={disabled}
        aria-label="皮肤名称"
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
        }}
      />
      <div className="skin-card-meta">
        <small>{skin.triangles.toLocaleString('zh-CN')} 三角面</small>
        <button type="button" className="text-danger" disabled={disabled} onClick={() => onRemove(skin.id)}>
          移除
        </button>
      </div>
      {error && <p className="skin-card-error">{error}</p>}
    </article>
  );
}
