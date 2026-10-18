import type { Node } from '@gltf-transform/core';
import { cloneDocument } from '@gltf-transform/functions';
import { mat4, quat, vec3 } from 'gl-matrix';
import type { IntermediateModel } from './model.ts';
import type { V3 } from './bedrock-types.ts';
import { prepareStaticModel } from './prepare-model.ts';
import { optimizeModel } from './optimizer.ts';
import { bindStatic } from './bone-mapper.ts';
import type { PlayerBone } from './bone-mapper.ts';
import { exportBedrockGeometry } from './bedrock-exporter.ts';
import { validateGeometry } from './geometry-validator.ts';

const roles = { body: 'hips', head: 'head', leftArm: 'leftUpperArm', rightArm: 'rightUpperArm',
  leftLeg: 'leftUpperLeg', rightLeg: 'rightUpperLeg' } as const;
type Part = keyof typeof roles;
export interface HumanoidProfile {
  /** Model-space units after fitting the requested height. */
  shoulderOutset?: number;
  /** Rest-arm angle away from vertical, in degrees. */
  armSpreadDegrees?: number;
  materialRules?: { material: string; mode: 'body' | 'arm-components'; minArmWeight?: number }[];
}
function partForJoint(node: Node): Part {
  for (let current: Node | null = node; current; current = current.getParentNode()) {
    const role = current.getExtras()._vrmHumanBone;
    for (const [part, human] of Object.entries(roles)) if (role === human) return part as Part;
    if (role === 'neck') return 'head';
  }
  return 'body';
}

/** Rigid six-part player binding, using source rig weights, topology and explicit garment rules.
 * Bedrock poly_mesh cannot retain smooth skin weights, elbow/knee bends or VRM physics.
 */
export async function exportHumanoid(input: IntermediateModel, options: { height: number; textureSize: number; atlas?: number; profile?: HumanoidProfile }) {
  const shoulderOutset = options.profile?.shoulderOutset ?? 0;
  const spread = options.profile?.armSpreadDegrees ?? 0;
  const materialRules = options.profile?.materialRules ?? [];
  if (!Array.isArray(materialRules)) throw new Error('Humanoid materialRules must be an array');
  const matchedRules = new Set<string>();
  for (const rule of materialRules) {
    if (!rule || typeof rule.material !== 'string' || !rule.material || !['body', 'arm-components'].includes(rule.mode) ||
      (rule.minArmWeight !== undefined && (!Number.isFinite(rule.minArmWeight) || rule.minArmWeight <= 0 || rule.minArmWeight > 1))) throw new Error('Invalid humanoid material rule');
  }
  if (new Set(materialRules.map((r) => r.material)).size !== materialRules.length) throw new Error('Duplicate humanoid material rule');
  if (!Number.isFinite(shoulderOutset) || shoulderOutset < 0 || shoulderOutset > options.height / 4) throw new Error('Invalid humanoid shoulderOutset');
  if (!Number.isFinite(spread) || spread < 0 || spread > 45) throw new Error('Invalid humanoid armSpreadDegrees');
  const model = { ...input, document: cloneDocument(input.document), warnings: [...input.warnings] };
  const root = model.document.getRoot();
  const roleNodes = new Map<string, Node>();
  for (const node of root.listNodes()) {
    const role = node.getExtras()._vrmHumanBone;
    if (typeof role === 'string') {
      if (roleNodes.has(role)) throw new Error('Duplicate humanoid role: ' + role);
      roleNodes.set(role, node);
    }
  }
  for (const role of [...Object.values(roles), 'leftHand', 'rightHand']) {
    if (!roleNodes.has(role)) throw new Error('Humanoid binding requires VRM role: ' + role);
  }
  const classification: { material: string; mode: string; components: number; triangles: Record<string, number> }[] = [];
  const used = new Set<object>();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    if (used.has(mesh)) throw new Error('Humanoid binding requires unique mesh instances');
    used.add(mesh);
    const skin = node.getSkin();
    const sourceJoints = skin?.listJoints() ?? [];
    const jointParts = skin ? sourceJoints.map(partForJoint) : undefined;
    for (const primitive of [...mesh.listPrimitives()]) {
      const indices = primitive.getIndices()?.getArray() ??
        Uint32Array.from({ length: primitive.getAttribute('POSITION')!.getCount() }, (_, i) => i);
      const sets = primitive.listSemantics().filter((s) => /^JOINTS_\d+$/.test(s)).map((s) => ({
        joints: primitive.getAttribute(s)!, weights: primitive.getAttribute(s.replace('JOINTS_', 'WEIGHTS_'))!,
      }));
      const rule = materialRules.find((r) => r.material === primitive.getMaterial()?.getName());
      if (rule) matchedRules.add(rule.material);
      const vertexScores = (index: number, garment: boolean) => {
        const scores = new Map<Part, number>();
        if (jointParts) for (const set of sets) {
          const js: number[] = [], ws: number[] = [];
          set.joints.getElement(index, js); set.weights.getElement(index, ws);
          for (let j = 0; j < js.length; j++) {
            const joint = sourceJoints[js[j]!]!;
            const role = joint.getExtras()._vrmHumanBone;
            const part = garment && role === 'leftShoulder' ? 'leftArm' :
              garment && role === 'rightShoulder' ? 'rightArm' : jointParts[js[j]!] ?? 'body';
            scores.set(part, (scores.get(part) ?? 0) + ws[j]!);
          }
        }
        return scores;
      };
      const componentPart = new Map<number, Part>();
      const parents = Array.from({ length: primitive.getAttribute('POSITION')!.getCount() }, (_, i) => i);
      const find = (i: number): number => { while (parents[i] !== i) { parents[i] = parents[parents[i]!]!; i = parents[i]!; } return i; };
      if (rule?.mode === 'arm-components') {
        for (let i = 0; i < indices.length; i += 3) {
          const r = find(indices[i]!); parents[find(indices[i + 1]!)] = r; parents[find(indices[i + 2]!)] = r;
        }
        const scores = new Map<number, Map<Part, number>>();
        for (const index of new Set(indices)) {
          const r = find(index); if (!scores.has(r)) scores.set(r, new Map());
          for (const [part, weight] of vertexScores(index, true)) scores.get(r)!.set(part, (scores.get(r)!.get(part) ?? 0) + weight);
        }
        for (const [r, totals] of scores) {
          const total = [...totals.values()].reduce((a, b) => a + b, 0);
          const arm: Part = (totals.get('leftArm') ?? 0) > (totals.get('rightArm') ?? 0) ? 'leftArm' : 'rightArm';
          componentPart.set(r, total > 0 && (totals.get(arm) ?? 0) / total >= (rule.minArmWeight ?? 0.35) ? arm : 'body');
        }
      }
      const grouped = new Map<Part, number[]>();
      for (let i = 0; i < indices.length; i += 3) {
        const scores = new Map<Part, number>();
        for (let c = 0; c < 3; c++) for (const [part, weight] of vertexScores(indices[i + c]!, false)) scores.set(part, (scores.get(part) ?? 0) + weight);
        const part: Part = rule?.mode === 'body' ? 'body' : rule?.mode === 'arm-components' ? componentPart.get(find(indices[i]!))! :
          [...scores].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'body';
        if (!grouped.has(part)) grouped.set(part, []);
        grouped.get(part)!.push(indices[i]!, indices[i + 1]!, indices[i + 2]!);
      }
      if (rule) classification.push({ material: rule.material, mode: rule.mode, components: componentPart.size,
        triangles: Object.fromEntries([...grouped].map(([part, values]) => [part, values.length / 3])) });
      for (const [part, values] of grouped) {
        const p = primitive.clone().setExtras({ ...primitive.getExtras(), _playerPart: part });
        p.setIndices(model.document.createAccessor().setType('SCALAR').setArray(Uint32Array.from(values))
          .setBuffer(root.listBuffers()[0] ?? model.document.createBuffer()));
        mesh.addPrimitive(p);
      }
      mesh.removePrimitive(primitive); primitive.dispose();
    }
  }
  for (const rule of materialRules) if (!matchedRules.has(rule.material)) throw new Error('Humanoid material not found: ' + rule.material);
  // Pose the SOURCE rig first. Mixed chest/shoulder/arm weights are evaluated by
  // prepareStaticModel, rather than moving already cut rigid pieces apart.
  const initial = await prepareStaticModel(model, { height: options.height, center: 'ground' });
  for (const [armRole, handRole] of [['leftUpperArm', 'leftHand'], ['rightUpperArm', 'rightHand']]) {
    const arm = roleNodes.get(armRole!)!, hand = roleNodes.get(handRole!)!;
    const pivot = arm.getWorldTranslation();
    const direction = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), hand.getWorldTranslation(), pivot));
    const side = Math.sign(direction[0]);
    if (!side || !Number.isFinite(side)) throw new Error('Humanoid arm direction is not lateral');
    const radians = spread * Math.PI / 180;
    const delta = quat.rotationTo(quat.create(), direction, [side * Math.sin(radians), -Math.cos(radians), 0]);
    const worldRotation = quat.multiply(quat.create(), delta, arm.getWorldRotation());
    const parent = arm.getParentNode();
    const parentRotation = parent?.getWorldRotation() ?? [0, 0, 0, 1];
    const localRotation = quat.multiply(quat.create(), quat.invert(quat.create(), parentRotation), worldRotation);
    arm.setRotation(Array.from(localRotation) as [number, number, number, number]);
    const moved = vec3.fromValues(pivot[0] + side * shoulderOutset / initial.report.heightScale, pivot[1], pivot[2]);
    if (parent) {
      const inverse = mat4.invert(mat4.create(), parent.getWorldMatrix());
      if (!inverse) throw new Error('Singular humanoid arm parent transform');
      vec3.transformMat4(moved, moved, inverse);
    }
    arm.setTranslation(Array.from(moved) as V3);
  }
  const points = new Map([...roleNodes].map(([role, node]) => [role, node.getWorldTranslation()]));
  const prepared = await prepareStaticModel(model, { height: options.height, center: 'ground' });
  const { before, heightScale } = prepared.report;
  const fit = (point: number[]): V3 => [(point[0]! - (before.min[0] + before.max[0]) / 2) * heightScale,
    (point[1]! - before.min[1]) * heightScale, (point[2]! - (before.min[2] + before.max[2]) / 2) * heightScale];
  const pivots = Object.fromEntries(Object.entries(roles).map(([part, role]) => [part, fit(points.get(role)!)])) as Record<Part, V3>;
  const optimized = await optimizeModel(prepared.model, { mesh: { preset: 'original' },
    texture: { maxTextureSize: options.textureSize, ...(options.atlas ? { atlasSize: options.atlas } : {}) } });
  const full = await exportBedrockGeometry(bindStatic(optimized.model), { identifier: 'geometry.skin0', skinTextureSize: 128 });
  const geometry = full.file['geometry.skin0']!;
  for (const bone of geometry.bones) delete bone.poly_mesh;
  const counts: Record<string, number> = {};
  for (const part of Object.keys(roles) as Part[]) {
    const document = cloneDocument(optimized.model.document);
    let count = 0;
    for (const mesh of [...document.getRoot().listMeshes()]) {
      for (const p of [...mesh.listPrimitives()]) {
        if (p.getExtras()._playerPart !== part) { mesh.removePrimitive(p); p.dispose(); }
        else count += p.getIndices()!.getCount() / 3;
      }
      if (!mesh.listPrimitives().length) {
        for (const node of [...document.getRoot().listNodes()]) if (node.getMesh() === mesh) node.dispose();
        mesh.dispose();
      }
    }
    if (!count) throw new Error('Humanoid part has no triangles: ' + part);
    const binding = bindStatic({ ...optimized.model, document }, { bone: part as PlayerBone });
    const result = await exportBedrockGeometry(binding, { identifier: 'geometry.skin0', skinTextureSize: 128 });
    const bone = geometry.bones.find((b) => b.name === part)!;
    bone.poly_mesh = result.file['geometry.skin0']!.bones.find((b) => b.name === part)!.poly_mesh!;
    const pivot = pivots[part]; bone.pivot = [-pivot[0], pivot[1], pivot[2]];
    counts[part] = count;
  }
  const waist = geometry.bones.find((b) => b.name === 'waist')!;
  waist.pivot = [...geometry.bones.find((b) => b.name === 'body')!.pivot!];
  full.report.validation = validateGeometry(full.file, { expectedIdentifier: 'geometry.skin0', atlasUVs: true }).geometries[0]!;
  full.report.warnings.push('Humanoid rigid binding: the source rig and mixed weights evaluate the rest pose before freezing; source material rules can override triangle ownership. Runtime smooth deformation, elbows, knees and hair/cloth physics are not retained.');
  return { ...full, binding: { parts: counts, pivots, classification, profile: { shoulderOutset, armSpreadDegrees: spread } } };
}
