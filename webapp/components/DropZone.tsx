import { useRef, useState, type DragEvent } from 'react';
import { Icon, type IconName } from '../../web/shared/Icons';

interface DropZoneProps {
  accept: string;
  multiple?: boolean;
  title: string;
  hint: string;
  icon: IconName;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function DropZone({
  accept, multiple, title, hint, icon, onFiles, disabled, compact,
}: DropZoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const receive = (files: FileList | null) => {
    if (!files?.length || disabled) return;
    onFiles([...files]);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    receive(event.dataTransfer.files);
  };

  return (
    <div
      className={`dropzone ${over ? 'over' : ''} ${compact ? 'compact' : ''} ${disabled ? 'disabled' : ''}`}
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <span className="dropzone-icon"><Icon name={icon} size={compact ? 22 : 30} /></span>
      <div>
        <strong>{title}</strong>
        <p>{hint}</p>
      </div>
      <span className="dropzone-action">{disabled ? '处理中…' : '选择文件'}</span>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        aria-label={title}
        onChange={(event) => {
          receive(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
