import type { PersonaProfileRecipe } from "../src/persona-recipe";

function kindLabel(kind: PersonaProfileRecipe["kind"]) {
  if (kind === "classic") return "经典皮肤";
  if (kind === "persona") return "角色创建器";
  return "空槽位";
}

export function PersonaRecipePanel({
  profile,
}: {
  profile: PersonaProfileRecipe;
}) {
  const number = profile.slot.replace("personaProfile", "");
  return (
    <div className="persona-recipe-panel">
      <div className="persona-profile-head">
        <div>
          <h3>
            角色 {number}
            {profile.lastUsed && (
              <span className="preset-title-badge">当前使用</span>
            )}
          </h3>
          <span>
            {kindLabel(profile.kind)} · {profile.pieces.length} 个部件
          </span>
        </div>
      </div>

      <div className="persona-base">
        <span
          className="persona-color"
          style={{ background: profile.base.skinColor ?? "transparent" }}
        />
        <div>
          <b>基础</b>
          <p>
            {kindLabel(profile.kind)} · {profile.base.arm ?? "—"} ·{" "}
            {profile.base.skinColor ?? "—"}
          </p>
        </div>
      </div>

      <div className="persona-pieces">
        <div className="pane-caption">部件配方</div>
        {profile.pieces.length ? (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>预览</th>
                <th>部件</th>
                <th>类型</th>
                <th>颜色</th>
              </tr>
            </thead>
            <tbody>
              {profile.pieces.map((piece, index) => (
                <tr key={piece.id + index}>
                  <td>{index + 1}</td>
                  <td>
                    {piece.thumbnail ? (
                      <img
                        className="persona-piece-thumb"
                        src={`/api/persona/piece-icon?name=${encodeURIComponent(
                          piece.thumbnail,
                        )}`}
                        alt=""
                      />
                    ) : piece.thumbnailUrl ? (
                      <img
                        className="persona-piece-thumb"
                        src={`/api/persona/marketplace-icon?url=${encodeURIComponent(
                          piece.thumbnailUrl,
                        )}`}
                        alt=""
                        onError={(event) => {
                          event.currentTarget.style.visibility = "hidden";
                        }}
                      />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <b>{piece.name ?? "未知 / Marketplace"}</b>
                    <code className="persona-piece-id">{piece.id}</code>
                  </td>
                  <td>{piece.type ?? "—"}</td>
                  <td>
                    <div className="persona-piece-colors">
                      {piece.colors?.length ? (
                        piece.colors.map((color, colorIndex) => (
                          <span
                            key={colorIndex}
                            className="persona-piece-color"
                            style={{ background: color }}
                            title={color}
                          />
                        ))
                      ) : (
                        <span className="muted">默认</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">空槽位，没有部件。</p>
        )}
      </div>

    </div>
  );
}
