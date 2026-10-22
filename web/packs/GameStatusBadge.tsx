export function GameStatusBadge({
  kind,
  inUse = false,
}: {
  kind: "pack" | "persona" | "skin";
  inUse?: boolean;
}) {
  if (kind === "persona")
    return (
      <span className="pack-game-badge persona">
        {inUse ? "当前使用" : "角色创建器"}
      </span>
    );
  return (
    <span
      className={kind === "skin" ? "skin-installed-badge" : "pack-game-badge installed"}
    >
      游戏中
    </span>
  );
}
