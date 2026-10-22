import * as THREE from "three";
import type { HumanoidProfile } from "../../src/humanoid.ts";

/** Pose the original source skeleton; preserve mixed weights through GPU skinning.
 * Mirrors exportHumanoid's world-to-local arm rotation and fitted shoulder units.
 */
export function createPosePreview(container: THREE.Group) {
  const initial = new Map<
    THREE.Object3D,
    {
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      scale: THREE.Vector3;
    }
  >();
  container.traverse((o) => {
    if (o !== container)
      initial.set(o, {
        position: o.position.clone(),
        quaternion: o.quaternion.clone(),
        scale: o.scale.clone(),
      });
  });
  function updateSkeletons() {
    container.updateMatrixWorld(true);
    container.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) o.skeleton.update();
    });
  }
  function bounds(excluded: string[]) {
    updateSkeletons();
    const box = new THREE.Box3();
    container.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      if (materials.every((m) => excluded.includes(m.name))) return;
      const local = new THREE.Box3(),
        point = new THREE.Vector3();
      const positions = o.geometry.getAttribute("position");
      if (!positions) return;
      for (let i = 0; i < positions.count; i++) {
        o.getVertexPosition(i, point);
        local.expandByPoint(point);
        box.expandByPoint(point.applyMatrix4(o.matrixWorld));
      }
      if (o instanceof THREE.SkinnedMesh) o.boundingBox = local;
    });
    return box;
  }
  let restHeight: { key: string; height: number } | null = null;
  return ({
    profile,
    height,
    humanoid,
    excluded = [],
  }: {
    profile: HumanoidProfile | null;
    height: number;
    humanoid: boolean;
    excluded?: string[];
  }) => {
    for (const [o, t] of initial) {
      o.position.copy(t.position);
      o.quaternion.copy(t.quaternion);
      o.scale.copy(t.scale);
    }
    container.position.set(0, 0, 0);
    container.scale.setScalar(1);
    container.rotation.set(
      0,
      ((profile?.rotationYDegrees ?? 0) * Math.PI) / 180,
      0,
    );
    const key = JSON.stringify([...excluded].sort());
    const before =
      humanoid && restHeight?.key === key ? null : bounds(excluded);
    const initialHeight = before
      ? before.max.y - before.min.y
      : restHeight!.height;
    if (before) restHeight = { key, height: initialHeight };
    if (!Number.isFinite(initialHeight) || initialHeight <= 0)
      throw Error("当前保留材质没有可预览的高度");
    if (humanoid) {
      const nodes = new Map<string, THREE.Object3D>();
      for (const o of initial.keys()) {
        const name = o.userData.sourceName ?? o.name;
        const role = o.userData._humanoidRole ?? o.userData._vrmHumanBone;
        if (typeof role === "string") nodes.set(role, o);
        for (const [key, value] of Object.entries(profile?.boneMap ?? {}))
          if (value === name) nodes.set(key, o);
      }
      const spread = profile?.armSpreadDegrees ?? 0,
        outset = profile?.shoulderOutset ?? 0;
      if (
        !Number.isFinite(spread) ||
        spread < 0 ||
        spread > 45 ||
        !Number.isFinite(outset) ||
        outset < 0 ||
        outset > height / 4
      )
        throw Error("姿势参数超出范围");
      for (const [armRole, handRole] of [
        ["leftUpperArm", "leftHand"],
        ["rightUpperArm", "rightHand"],
      ]) {
        const arm = nodes.get(armRole!),
          hand = nodes.get(handRole!);
        if (!arm || !hand)
          throw Error(
            "人形姿势预览需要骨骼映射：" + armRole + " / " + handRole,
          );
        updateSkeletons();
        const pivot = arm.getWorldPosition(new THREE.Vector3()),
          direction = hand
            .getWorldPosition(new THREE.Vector3())
            .sub(pivot)
            .normalize(),
          side = Math.sign(direction.x);
        if (!side) throw Error("手臂骨骼方向无效");
        const radians = (spread * Math.PI) / 180;
        const delta = new THREE.Quaternion().setFromUnitVectors(
          direction,
          new THREE.Vector3(side * Math.sin(radians), -Math.cos(radians), 0),
        );
        const world = delta.multiply(
          arm.getWorldQuaternion(new THREE.Quaternion()),
        );
        arm.quaternion.copy(
          arm.parent
            ? arm.parent
                .getWorldQuaternion(new THREE.Quaternion())
                .invert()
                .multiply(world)
            : world,
        );
        const moved = pivot
          .clone()
          .add(
            new THREE.Vector3((side * outset) / (height / initialHeight), 0, 0),
          );
        arm.position.copy(arm.parent ? arm.parent.worldToLocal(moved) : moved);
      }
    }
    const posed = humanoid ? bounds(excluded) : before!,
      scale = height / (posed.max.y - posed.min.y);
    container.scale.setScalar(scale);
    container.position.set(
      (-(posed.min.x + posed.max.x) / 2) * scale,
      -posed.min.y * scale,
      (-(posed.min.z + posed.max.z) / 2) * scale,
    );
    updateSkeletons();
  };
}
