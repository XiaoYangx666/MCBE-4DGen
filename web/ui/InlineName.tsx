import { useRef, useState } from "react";

/** A compact, self-contained inline editor. Enter or blur commits; Escape cancels. */
export function InlineName({
  initial,
  className = "",
  onCommit,
  onCancel,
}: {
  initial: string;
  className?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const settled = useRef(false);
  const cancelled = useRef(false);

  function commit() {
    if (settled.current) return;
    settled.current = true;
    onCommit(value);
  }
  return (
    <input
      className={"inline-name " + className}
      autoFocus
      maxLength={120}
      size={Math.max(6, Math.min(60, value.length))}
      value={value}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (cancelled.current) return;
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          onCancel();
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}
