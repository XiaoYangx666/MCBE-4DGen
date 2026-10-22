import { useEffect, type ReactNode } from "react";

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
  useEffect(() => {
    if (busy) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, onClose]);

  return (
    <div
      className="pick-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div className={"pick-box " + className}>
        <div className="card-top">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            autoFocus={autoFocusClose}
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
