import {
  Color,
  type Scene,
  type GridHelper,
  type LineBasicMaterial,
} from "three";

export function bindViewportAppearance(
  scene: Scene,
  grid: GridHelper,
  request: () => void,
) {
  const update = () => {
    const style = getComputedStyle(document.documentElement);
    scene.background = new Color(style.getPropertyValue("--viewport").trim());
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
    request();
  };
  update();
  window.addEventListener("appearancechange", update);
  return () => window.removeEventListener("appearancechange", update);
}
