import type { MouseEvent, ReactNode } from "react";

/** Shared behaviour for selectable list rows with rename and context menus. */
export function SelectableRow({
  className,
  selected = false,
  title,
  onSelect,
  onRename,
  onMenu,
  children,
}: {
  className: string;
  selected?: boolean;
  title?: string;
  onSelect: () => void;
  onRename?: () => void;
  onMenu?: (event: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      className={className + (selected ? " selected" : "")}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      onDoubleClick={onRename}
      onContextMenu={
        onMenu
          ? (event) => {
              event.preventDefault();
              onSelect();
              onMenu(event);
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
