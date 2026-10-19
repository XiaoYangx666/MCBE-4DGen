import type { Result, Session } from "./types";

export function WorkflowStrip({
  result,
  stale,
  busy,
  dirty,
  session,
  onSave,
}: {
  result: Result | null;
  stale: boolean;
  busy: boolean;
  dirty: boolean;
  session: Session | null;
  onSave: () => void;
}) {
  return (
    <div className="workflow-strip">
      <a href="#/models">01 源模型</a>
      <span>→</span>
      <b>02 调整与生成</b>
      <span>→</span>
      <button disabled={!result || stale || busy} onClick={onSave}>
        03 保存皮肤
      </button>
      <span>→</span>
      <a href="#/packs">04 整理与使用</a>
      <small>
        {busy
          ? "正在生成，请稍候"
          : dirty
            ? "编辑配置未保存"
            : session
              ? "配置已保存"
              : "先选择一个源模型"}
      </small>
    </div>
  );
}
