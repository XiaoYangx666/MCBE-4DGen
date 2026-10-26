import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogDismiss } from './useDialogDismiss.ts';
import {
  BUILD_LABEL,
  CHANGELOG,
  CHANGELOG_NOTE,
  CURRENT_BUILD,
} from './build-log.ts';

/**
 * Shared build badge and changelog dialog. Both the desktop workbench and the
 * browser web app render the same trigger and history; only placement differs.
 */
export function Changelog({
  compact = false,
  drawer = false,
  className = '',
  onOpen,
}: {
  compact?: boolean;
  drawer?: boolean;
  className?: string;
  /** Called before the dialog opens, e.g. to close a mobile drawer. */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const show = () => {
    onOpen?.();
    setOpen(true);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={[
          'changelog-trigger',
          compact ? 'compact' : '',
          drawer ? 'drawer' : '',
          className,
        ].filter(Boolean).join(' ')}
        title={`更新日志 · ${BUILD_LABEL}`}
        aria-label={`更新日志，当前 ${BUILD_LABEL}`}
        aria-haspopup="dialog"
        onClick={show}
      >
        {drawer ? (
          <>
            <span className="changelog-trigger-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <path d="M10 3.2a6.8 6.8 0 1 1-6.1 3.8M3.2 3.2v4.2h4.2" />
                <path d="M10 6.4V10l2.6 1.6" />
              </svg>
            </span>
            <span className="changelog-trigger-copy">
              <b>更新日志</b>
              <small>{BUILD_LABEL}</small>
            </span>
            <span className="changelog-trigger-arrow" aria-hidden="true">›</span>
          </>
        ) : (
          <>
            <span className="changelog-pill-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <path d="M10 3.2a6.8 6.8 0 1 1-6.1 3.8M3.2 3.2v4.2h4.2" />
                <path d="M10 6.4V10l2.6 1.6" />
              </svg>
            </span>
            <span className="changelog-beta">BETA</span>
            <span className="changelog-build">{CURRENT_BUILD.build}</span>
          </>
        )}
      </button>
      {open && createPortal(
        <ChangelogDialog
          onClose={() => {
            setOpen(false);
            if (!drawer) trigger.current?.focus({ preventScroll: true });
          }}
        />,
        document.body,
      )}
    </>
  );
}

function ChangelogDialog({ onClose }: { onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const { backdropProps } = useDialogDismiss({
    onDismiss: onClose,
    initialFocus: closeButton,
  });

  return (
    <div
      className="changelog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="更新日志"
      {...backdropProps}
    >
      <div className="changelog-dialog">
        <header className="changelog-head">
          <div>
            <span className="changelog-eyebrow">BUILD LOG</span>
            <h2>
              更新日志
              <span className="changelog-current-build">{BUILD_LABEL}</span>
            </h2>
          </div>
          <button
            ref={closeButton}
            type="button"
            className="changelog-close"
            aria-label="关闭更新日志"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <p className="changelog-note">{CHANGELOG_NOTE}</p>

        <div className="changelog-list">
          {CHANGELOG.map((entry, index) => (
            <article
              key={entry.build}
              className={`changelog-entry${index === 0 ? ' current' : ''}`}
            >
              <div className="changelog-entry-meta">
                <span className="changelog-entry-build">{entry.build}</span>
                {index === 0 && <span className="changelog-live">当前构建</span>}
                <time dateTime={entry.date}>{entry.date}</time>
              </div>
              <h3>{entry.title}</h3>
              <ul>
                {entry.changes.map((change) => (
                  <li key={change.text}>
                    {change.tag && <em>{change.tag}</em>}
                    <span>{change.text}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <footer className="changelog-foot">
          <span>4DGen · GPL-3.0</span>
          <button type="button" className="primary" onClick={onClose}>关闭</button>
        </footer>
      </div>
    </div>
  );
}
