import { useRef, type ReactNode } from "react";
import { useDialogDismiss } from "../shared/useDialogDismiss";

/** Shared dialog shell: overlay, title, close button and Escape handling. */
export function Modal({
  title,
  label,
  eyebrow,
  className = "",
  busy = false,
  closeLabel = "关闭弹窗",
  closeOnBackdrop = false,
  autoFocusClose = false,
  onClose,
  children,
}: {
  title: ReactNode;
  label: string;
  eyebrow?: string;
  className?: string;
  busy?: boolean;
  closeLabel?: string;
  closeOnBackdrop?: boolean;
  autoFocusClose?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const { backdropProps } = useDialogDismiss({
    onDismiss: onClose,
    enabled: !busy,
    closeOnBackdrop,
    initialFocus: autoFocusClose ? closeButton : undefined,
  });

  return (
    <div
      className="pick-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      {...backdropProps}
    >
      <div className={"pick-box " + className}>
        <div className="card-top">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
          </div>
          <button
            ref={closeButton}
            type="button"
            disabled={busy}
            aria-label={closeLabel}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
