import { nextFrame } from './frame.ts';

/** One step shown while a conversion runs. */
export interface TaskProgress {
  /** Headline, e.g. `减面 3/12`; keep it short enough for the button. */
  label: string;
  /** Secondary line with the current item or a summary. */
  detail?: string;
}

export type ProgressHandler = (progress: TaskProgress) => void;

export type Reporter = (label: string, detail?: string) => void;

/** Wrap an optional handler so callers can report steps unconditionally. */
export function reporter(handler: ProgressHandler | undefined): Reporter {
  return (label, detail) => {
    handler?.({ label, ...(detail ? { detail } : {}) });
  };
}

let lastYield = 0;

/**
 * Repaint at most every `intervalMs`. Long synchronous loops call this so the
 * current stage keeps moving instead of looking hung.
 */
export async function yieldToBrowser(intervalMs = 40) {
  // Hidden tabs have nothing to repaint; yielding would only slow the job down.
  if (typeof document !== 'undefined' && document.hidden) return;
  const now = performance.now();
  if (now - lastYield < intervalMs) return;
  lastYield = now;
  await nextFrame();
}
