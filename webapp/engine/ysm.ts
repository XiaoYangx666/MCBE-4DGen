import * as THREE from 'three';
import { HUMANOID_PART_ROLES, HUMANOID_PARTS, type HumanoidPart } from '../../src/humanoid-binding.ts';
import {
  buildYsmBoneMeshes,
  buildYsmRig,
  hiddenYsmBones,
  parseYsmGeometry,
  parseYsmManifest,
  selectYsmTexture,
  ysmTextureName,
} from '../../src/ysm-model.ts';
import type { ResourceIndex } from './resources.ts';

export interface LoadedYsmScene {
  scene: THREE.Group;
  name: string;
  /** Synthetic player-role pivots, when the model exposes a complete rig. */
  humanoidRoles?: Record<string, THREE.Object3D>;
}

async function readJson(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}

/**
 * Load a folder-format YSM model in the browser. The manifest path is the
 * selected `ysm.json`; `index` resolves the geometry and texture relative to
 * that file, so archives with an extra wrapper folder keep working.
 */
export async function loadYsmScene(
  index: ResourceIndex,
  mainPath: string,
  manager: THREE.LoadingManager,
  warnings: string[],
): Promise<LoadedYsmScene> {
  const manifestFile = index.find(mainPath);
  if (!manifestFile) throw new Error('找不到 YSM 模型清单 ysm.json。');
  const manifest = parseYsmManifest(await readJson(manifestFile));
  const geometryFile = index.find(manifest.mainModel);
  if (!geometryFile) throw new Error(`YSM 模型缺少几何文件：${manifest.mainModel}`);
  const parsed = parseYsmGeometry(await readJson(geometryFile));
  warnings.push(...parsed.warnings);
  let hiddenBones: string[] = [];
  if (manifest.mainAnimation) {
    const animationFile = index.find(manifest.mainAnimation);
    if (animationFile) {
      try {
        hiddenBones = hiddenYsmBones(await readJson(animationFile));
      } catch {
        warnings.push(`YSM 动画文件「${manifest.mainAnimation}」读取失败，未排除默认隐藏的 GUI/表情部件。`);
      }
    }
  }
  const boneSet = buildYsmBoneMeshes(parsed.geometry, { hiddenBones });
  warnings.push(...boneSet.warnings);
  const rig = buildYsmRig(parsed.geometry);
  warnings.push(...rig.warnings);
  const partGeometry = new Set<HumanoidPart>();
  for (const bone of boneSet.bones) if (bone.mesh) partGeometry.add(bone.part);
  const missingParts = HUMANOID_PARTS.filter((part) => !partGeometry.has(part));
  const humanoid = rig.complete && missingParts.length === 0;
  if (humanoid)
    warnings.push('YSM 骨骼已映射到头、身体、左右臂、左右腿六部位；尾巴、头发等次级骨骼会跟随最近的身体部位。');
  else if (rig.complete && missingParts.length)
    warnings.push(`YSM 模型没有 ${missingParts.join('、')} 的几何，网页版将使用静态整体绑定。`);
  else
    warnings.push('YSM 模型没有完整的头/身/左右臂/左右腿骨骼，网页版将使用静态整体绑定。');
  const textureEntry = selectYsmTexture(manifest);
  if (textureEntry.normal || textureEntry.specular)
    warnings.push('YSM PBR 法线/高光贴图未导入，仅使用基础色贴图。');
  const textureFile = index.find(textureEntry.uv);
  if (!textureFile) throw new Error(`YSM 模型缺少贴图：${textureEntry.uv}`);
  if (manifest.defaultTexture && ysmTextureName(textureEntry.uv).toLowerCase() !== manifest.defaultTexture.toLowerCase())
    warnings.push(`YSM 默认贴图「${manifest.defaultTexture}」不存在，已使用「${ysmTextureName(textureEntry.uv)}」。`);
  if (manifest.textures.length > 1)
    warnings.push(`YSM 模型包含 ${manifest.textures.length} 套贴图，网页版仅导入默认贴图「${ysmTextureName(textureEntry.uv)}」。`);
  if (manifest.armModel) warnings.push('YSM 手臂模型未导入，仅导入玩家主体。');
  warnings.push('YSM 动画、动画控制器、定位器与 Molang 表达式未评估，按模型静态姿势导入。');

  const textureUrl = URL.createObjectURL(textureFile);
  let texture: THREE.Texture;
  try {
    texture = await new THREE.TextureLoader(manager).loadAsync(textureUrl);
  } finally {
    URL.revokeObjectURL(textureUrl);
  }
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    metalness: 0,
    roughness: 1,
    side: THREE.DoubleSide,
    alphaTest: 0.5,
  });
  const group = new THREE.Group();
  const folder = mainPath.replaceAll('\\', '/').replace(/\/[^/]*$/, '');
  const fallback = folder.slice(folder.lastIndexOf('/') + 1);
  group.name = manifest.name || fallback || 'YSM 模型';

  const roleNodes = new Map<string, THREE.Object3D>();
  if (humanoid) {
    for (const [role, pivot] of Object.entries(rig.roles)) {
      if (!pivot) continue;
      const node = new THREE.Object3D();
      node.name = `__ysm_${role}`;
      node.position.fromArray(pivot);
      node.userData._humanoidRole = role;
      group.add(node);
      roleNodes.set(role, node);
    }
    for (const side of ['left', 'right'] as const) {
      const armRole = `${side}UpperArm`;
      const handRole = `${side}Hand`;
      const arm = roleNodes.get(armRole)!;
      const hand = roleNodes.get(handRole)!;
      const armPivot = rig.roles[armRole as 'leftUpperArm' | 'rightUpperArm']!;
      const handPivot = rig.roles[handRole as 'leftHand' | 'rightHand']!;
      group.remove(hand);
      hand.position.set(
        handPivot[0] - armPivot[0],
        handPivot[1] - armPivot[1],
        handPivot[2] - armPivot[2],
      );
      arm.add(hand);
    }
  }
  const bones = new Map<string, THREE.Object3D>();
  const byName = new Map(boneSet.bones.map((bone) => [bone.name, bone]));
  for (const bone of boneSet.bones) {
    const node = new THREE.Object3D();
    node.name = bone.name;
    node.userData._playerPart = bone.part;
    bones.set(bone.name, node);
    if (!bone.mesh) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(bone.mesh.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(bone.mesh.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(bone.mesh.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(bone.mesh.indices, 1));
    const item = new THREE.Mesh(geometry, material);
    item.name = bone.name;
    item.position.set(-bone.pivot[0], -bone.pivot[1], -bone.pivot[2]);
    item.userData._playerPart = bone.part;
    node.add(item);
  }
  for (const bone of boneSet.bones) {
    const node = bones.get(bone.name)!;
    const parent = bone.parent ? byName.get(bone.parent) : undefined;
    const role = humanoid ? HUMANOID_PART_ROLES[bone.part] : undefined;
    if (humanoid && role && (!parent || parent.part !== bone.part)) {
      const pivot = rig.roles[role]!;
      node.position.set(
        bone.pivot[0] - pivot[0],
        bone.pivot[1] - pivot[1],
        bone.pivot[2] - pivot[2],
      );
      roleNodes.get(role)!.add(node);
    } else if (parent) {
      node.position.set(
        bone.pivot[0] - parent.pivot[0],
        bone.pivot[1] - parent.pivot[1],
        bone.pivot[2] - parent.pivot[2],
      );
      bones.get(parent.name)!.add(node);
    } else {
      node.position.fromArray(bone.pivot);
      group.add(node);
    }
  }
  const humanoidRoles = humanoid
    ? Object.fromEntries(roleNodes) as Record<string, THREE.Object3D>
    : undefined;
  return {
    scene: group,
    name: group.name,
    ...(humanoidRoles ? { humanoidRoles } : {}),
  };
}
