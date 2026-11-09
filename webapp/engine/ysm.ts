import * as THREE from 'three';
import {
  buildYsmImportPlan,
  parseYsmGeometry,
  parseYsmManifest,
  type YsmDiagnostic,
  type YsmSceneNode,
} from '../../src/ysm-model.ts';
import type { TextureHint } from '../../src/texture-policy.ts';
import type { ReductionHint } from '../../src/reduce-policy.ts';
import type { ResourceIndex } from './resources.ts';

export interface LoadedYsmScene {
  scene: THREE.Group;
  name: string;
  /** Synthetic player-role pivots, when the model exposes a complete rig. */
  humanoidRoles?: Record<string, THREE.Object3D>;
  textureHint: TextureHint;
  reductionHint: ReductionHint;
}

async function readJson(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}

/** Chinese wording for shared YSM diagnostics; Node has its own formatter. */
function ysmWarning(diagnostic: YsmDiagnostic): string {
  switch (diagnostic.code) {
    case 'cube-not-object':
      return `已忽略方块 ${diagnostic.cube}：不是对象。`;
    case 'cube-without-uv':
      return `已忽略方块 ${diagnostic.cube}：没有可用的 UV。`;
    case 'face-uv-rotation-ignored':
      return 'YSM 逐面 UV 旋转暂不支持，已忽略。';
    case 'multiple-geometries':
      return `YSM 模型包含 ${diagnostic.count} 组几何，仅导入第一组。`;
    case 'bone-not-object':
      return `已忽略骨骼 ${diagnostic.bone}：不是对象。`;
    case 'bone-without-name':
      return `已忽略骨骼 ${diagnostic.bone}：缺少名称。`;
    case 'duplicate-bone':
      return `YSM 骨骼重名「${diagnostic.name}」，已按名称合并。`;
    case 'duplicate-bone-conflict':
      return `YSM 骨骼「${diagnostic.name}」重名但 pivot/rotation/parent 不同；已保留各自几何的源变换，但共用第一根骨骼的层级。`;
    case 'cyclic-bone':
      return `YSM 骨骼层级在「${diagnostic.name}」处形成循环，已按无父骨骼处理。`;
    case 'missing-parent':
      return `YSM 骨骼「${diagnostic.name}」引用了不存在的父骨骼「${diagnostic.parent}」，已按无父骨骼处理。`;
    case 'hidden-bones':
      return `已排除默认动画隐藏的 ${diagnostic.names.length} 根 YSM 骨骼：${diagnostic.names.join('、')}。`;
    case 'missing-role':
      return `YSM 六部位绑定缺少 ${diagnostic.role} 骨骼。`;
    case 'hand-fallback':
      return `YSM ${diagnostic.side === 'left' ? '左' : '右'}臂没有手部骨骼，已使用「${diagnostic.name}」作为手部轴心。`;
    case 'incomplete-rig':
      return 'YSM 模型没有完整的头/身/左右臂/左右腿骨骼，六部位绑定不可用。';
    case 'humanoid-mapped':
      return 'YSM 骨骼已映射到头、身体、左右臂、左右腿六部位；尾巴、头发等次级骨骼会跟随最近的身体部位。';
    case 'missing-part-geometry':
      return `YSM 模型没有 ${diagnostic.parts.join('、')} 的几何，网页版将使用静态整体绑定。`;
    case 'static-binding':
      return 'YSM 模型没有完整的头/身/左右臂/左右腿骨骼，网页版将使用静态整体绑定。';
    case 'pbr-textures-ignored':
      return 'YSM PBR 法线/高光贴图未导入，仅使用基础色贴图。';
    case 'default-texture-missing':
      return `YSM 默认贴图「${diagnostic.wanted}」不存在，已使用「${diagnostic.used}」。`;
    case 'multiple-textures':
      return `YSM 模型包含 ${diagnostic.count} 套贴图，网页版仅导入默认贴图「${diagnostic.used}」。`;
    case 'arm-model-ignored':
      return 'YSM 手臂模型未导入，仅导入玩家主体。';
    case 'animations-not-evaluated':
      return 'YSM 动画、动画控制器、定位器与 Molang 表达式未评估，按模型静态姿势导入。';
    case 'imported-texture':
      return `YSM 模型「${diagnostic.model}」已使用默认贴图「${diagnostic.texture}」导入。`;
  }
}

function instantiateYsmNode(
  descriptor: YsmSceneNode,
  material: THREE.Material,
  parent: THREE.Object3D,
  roleNodes: Map<string, THREE.Object3D>,
): void {
  const node = new THREE.Object3D();
  node.name = descriptor.name;
  node.position.fromArray(descriptor.translation);
  if (descriptor.role) {
    node.userData._humanoidRole = descriptor.role;
    roleNodes.set(descriptor.role, node);
  }
  if (descriptor.part) node.userData._playerPart = descriptor.part;
  parent.add(node);
  if (descriptor.mesh) {
    const mesh = descriptor.mesh;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const item = new THREE.Mesh(geometry, material);
    item.name = descriptor.name;
    if (descriptor.part) item.userData._playerPart = descriptor.part;
    node.add(item);
  }
  for (const child of descriptor.children)
    instantiateYsmNode(child, material, node, roleNodes);
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
  let animation: unknown;
  if (manifest.mainAnimation) {
    const animationFile = index.find(manifest.mainAnimation);
    if (animationFile) {
      try {
        animation = await readJson(animationFile);
      } catch {
        warnings.push(`YSM 动画文件「${manifest.mainAnimation}」读取失败，未排除默认隐藏的 GUI/表情部件。`);
      }
    } else {
      warnings.push(`YSM 动画文件「${manifest.mainAnimation}」不存在，未排除默认隐藏的 GUI/表情部件。`);
    }
  }
  const plan = buildYsmImportPlan(manifest, parsed.geometry, animation);
  for (const diagnostic of [...parsed.diagnostics, ...plan.diagnostics])
    warnings.push(ysmWarning(diagnostic));
  const textureFile = index.find(plan.texture.uv);
  if (!textureFile) throw new Error(`YSM 模型缺少贴图：${plan.texture.uv}`);

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
  warnings.push(ysmWarning({
    code: 'imported-texture',
    model: group.name,
    texture: plan.textureName,
  }));

  const roleNodes = new Map<string, THREE.Object3D>();
  for (const descriptor of plan.scene.roots)
    instantiateYsmNode(descriptor, material, group, roleNodes);
  const humanoidRoles = plan.scene.humanoid
    ? Object.fromEntries(roleNodes) as Record<string, THREE.Object3D>
    : undefined;
  return {
    scene: group,
    name: group.name,
    ...(humanoidRoles ? { humanoidRoles } : {}),
    textureHint: plan.textureHint,
    reductionHint: plan.reductionHint,
  };
}
