import { useEffect, type Dispatch, type SetStateAction } from "react";

export function HoldOriginalButton({ onChange }: {
  onChange: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    const release = () => onChange(false);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("blur", release);
      release();
    };
  }, [onChange]);
  return (
    <button
      title="按住对照原始姿势和朝向，松开恢复调整；材质筛选保持不变"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        onChange(true);
      }}
      onPointerUp={() => onChange(false)}
      onPointerCancel={() => onChange(false)}
      onLostPointerCapture={() => onChange(false)}
      onBlur={() => onChange(false)}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          onChange(true);
        }
      }}
      onKeyUp={() => onChange(false)}
    >按住看原始</button>
  );
}
