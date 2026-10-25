import { useRef } from 'react';
import { SourceDirectory } from '../../web/shared/SourceDirectory';
import { useDialogDismiss } from '../../web/shared/useDialogDismiss';
import { Icon } from './Icons';

export function ModelSourcesDialog({ onClose }: { onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const { backdropProps } = useDialogDismiss({
    onDismiss: onClose,
    initialFocus: closeButton,
  });

  return (
    <div className="dialog-backdrop" {...backdropProps}>
      <div
        className="sources-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sources-title"
      >
        <header className="sources-header">
          <div>
            <h2 id="sources-title">获取模型</h2>
            <p>从常用站点下载模型，再回到这里导入。</p>
          </div>
          <button
            ref={closeButton}
            type="button"
            className="icon-button"
            aria-label="关闭获取模型"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <SourceDirectory
          allLabel="全部"
          searchPlaceholder="搜索网站、格式或地区"
          note={<>网页版推荐 GLB / glTF / VRM / OBJ；PMX 请使用桌面版。</>}
        />
      </div>
    </div>
  );
}
