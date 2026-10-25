import {
  Color,
  type Scene,
  type GridHelper,
  type LineBasicMaterial,
} from "three";

/**
 * Apply the host theme's viewport colour and grid tint, and keep them in sync
 * when the user switches theme. `grid` may be null for previews without a grid.
 */
export function bindViewportAppearance(
  scene: Scene,
  grid: GridHelper | null,
  request: () => void,
) {
  const update = () => {
    const style = getComputedStyle(document.documentElement);
    scene.background = new Color(style.getPropertyValue("--viewport").trim());
    if (grid) {
      const materials = Array.isArray(grid.material)
        ? grid.material
        : [grid.material];
      materials.forEach((material) => {
        const line = material as LineBasicMaterial;
        line.vertexColors = false;
        line.color.set(style.getPropertyValue("--muted").trim());
        line.transparent = true;
        line.opacity = 0.24;
        line.needsUpdate = true;
      });
    }
    request();
  };
  update();
  window.addEventListener("appearancechange", update);
  return () => window.removeEventListener("appearancechange", update);
}
