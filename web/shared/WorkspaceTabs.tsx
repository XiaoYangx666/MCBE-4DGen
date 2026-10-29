export type StudioWorkspace = 'model' | 'texture' | 'export';

export interface WorkspaceTab {
  key: StudioWorkspace;
  label: string;
  /** Short helper shown under the label on wide layouts. */
  hint: string;
  /** Small badge, e.g. a material count or a stale marker. */
  badge?: string | number | null;
  /** Draw attention to the tab (stale result, pending preview). */
  attention?: boolean;
}

export const STUDIO_WORKSPACES: readonly WorkspaceTab[] = [
  { key: 'model', label: '模型', hint: '预览、部件与转换参数' },
  { key: 'texture', label: '纹理', hint: '材质、清晰度与图集' },
  { key: 'export', label: '导出', hint: '结果检查与皮肤包' },
];

/**
 * Top-level workspace navigation for a model editing session. The tabs are
 * intentionally controlled by the host: switching them must never remount the
 * session, only reveal another part of the same state.
 */
export function WorkspaceTabs({
  value,
  onChange,
  tabs = STUDIO_WORKSPACES,
  disabled = false,
  className,
}: {
  value: StudioWorkspace;
  onChange: (workspace: StudioWorkspace) => void;
  tabs?: readonly WorkspaceTab[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <nav
      className={`workspace-tabs${className ? ` ${className}` : ''}`}
      aria-label="编辑工作区"
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={value === tab.key ? 'active' : ''}
          aria-current={value === tab.key ? 'page' : undefined}
          disabled={disabled}
          onClick={() => onChange(tab.key)}
        >
          <span className="workspace-tab-label">{tab.label}</span>
          <small>{tab.hint}</small>
          {tab.badge !== undefined && tab.badge !== null && tab.badge !== '' && (
            <i className={tab.attention ? 'attention' : undefined}>{tab.badge}</i>
          )}
        </button>
      ))}
    </nav>
  );
}
