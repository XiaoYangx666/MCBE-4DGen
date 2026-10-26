import * as THREE from "three";

export interface PreviewOrientationOptions {
  /** `1` points along +Z, `-1` along -Z. */
  direction?: 1 | -1;
  /** Sprite label; set false to skip the canvas (useful in Node tests). */
  label?: string | false;
  color?: number;
  /**
   * `center` keeps the arrow under the model like the workbench. `side`
   * offsets it beside the model, which suits previews whose camera sits on the
   * same side as the forward direction.
   */
  offset?: "center" | "side";
  /** Height within the model bounds, 0 = base, 1 = top. Defaults to 0.01. */
  elevation?: number;
}

export interface PreviewOrientation {
  object: THREE.Group;
  /** Position the arrow and label around `object`'s bounds. */
  fit(object: THREE.Object3D): boolean;
  dispose(): void;
}

/**
 * A small in-scene "this way is the front" marker shared by the workbench,
 * the desktop pack preview and the browser preview. It only draws an arrow and
 * an optional text sprite; the caller owns the scene and camera.
 */
export function createPreviewOrientation(
  options: PreviewOrientationOptions = {},
): PreviewOrientation {
  const direction = options.direction ?? -1;
  const color = options.color ?? 0xa8dfb8;
  const offset = options.offset ?? "center";
  const elevation = options.elevation ?? 0.01;
  const object = new THREE.Group();
  object.name = "PreviewOrientation";

  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, direction),
    new THREE.Vector3(),
    18,
    color,
    3,
    1.5,
  );
  object.add(arrow);

  let label: THREE.Sprite | null = null;
  let labelTexture: THREE.CanvasTexture | null = null;
  if (options.label !== false) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 80;
    const context = canvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
      context.font = "32px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(options.label ?? "正面", canvas.width / 2, canvas.height / 2);
    }
    labelTexture = new THREE.CanvasTexture(canvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: labelTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    label = new THREE.Sprite(material);
    object.add(label);
  }

  const fit = (target: THREE.Object3D) => {
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return false;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const length = Math.max(size.x, size.y, size.z, 1) * 0.6;
    const x = offset === "side" ? box.max.x + size.x * 0.12 : center.x;
    const y = box.min.y + size.y * elevation + 0.1;

    arrow.position.set(x, y, center.z);
    arrow.setDirection(new THREE.Vector3(0, 0, direction));
    arrow.setLength(length, length * 0.167, length * 0.083);

    if (label) {
      label.position.set(x, y + length * 0.08, center.z + direction * length * 1.25);
      label.scale.set(length, length * 0.155, 1);
    }
    return true;
  };

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    object.removeFromParent();
    // ArrowHelper reuses module-level line/cone geometries; only its own
    // materials belong to this instance.
    (arrow.line.material as THREE.Material).dispose();
    (arrow.cone.material as THREE.Material).dispose();
    if (label) {
      const material = label.material as THREE.SpriteMaterial;
      material.map = null;
      material.dispose();
    }
    labelTexture?.dispose();
  };

  return { object, fit, dispose };
}
