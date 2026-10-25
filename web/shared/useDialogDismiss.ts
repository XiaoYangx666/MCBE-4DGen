import { useEffect, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

interface DialogDismissOptions {
  /** Called for Escape and for a click on the backdrop itself. */
  onDismiss: () => void;
  /** Disable both Escape and backdrop dismissal, e.g. while a dialog is busy. */
  enabled?: boolean;
  closeOnBackdrop?: boolean;
  /** Element focused when the dialog mounts. */
  initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * Shared dialog dismissal behaviour: Escape closes, clicking the backdrop
 * (not its content) closes, and the close control receives initial focus.
 * The caller keeps ownership of its own overlay markup and classes.
 */
export function useDialogDismiss({
  onDismiss,
  enabled = true,
  closeOnBackdrop = true,
  initialFocus,
}: DialogDismissOptions) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    initialFocus?.current?.focus({ preventScroll: true });
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, initialFocus, onDismiss]);

  return {
    backdropProps: {
      onMouseDown: (event: ReactMouseEvent<HTMLElement>) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onDismiss();
      },
    },
  };
}
