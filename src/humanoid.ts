import type { Node } from "@gltf-transform/core";
import { cloneDocument } from "@gltf-transform/functions";
import { mat4, quat, vec3 } from "gl-matrix";
import type { IntermediateModel } from "./model.ts";
import type { V3 } from "./bedrock-types.ts";
import {
  createBoundsFitter,
  dominantHumanoidPart,
  HUMANOID_PART_ROLES,
  HUMANOID_PARTS,
  HUMANOID_REQUIRED_ROLES,
  partForHumanoidRole,
  type HumanoidPart,
} from "./humanoid-binding.ts";
import { measureFrozenBounds, prepareStaticModel } from "./prepare-model.ts";
import { optimizeTextures } from "./texture-optimizer.ts";
import { bindStatic } from "./bone-mapper.ts";
import { exportBedrockGeometry } from "./bedrock-exporter.ts";
import { validateGeometry } from "./geometry-validator.ts";
import { reduceRigidModel } from "./rigid-mesh-reducer.ts";

type Part = HumanoidPart;
export interface HumanoidProfile {
  /** Source orientation alignment before posing and fitting. */
  rotationYDegrees?: number;
  /** Explicit source node names for non-VRM rigs; no anatomical guessing. */
  boneMap?: Record<string, string>;
  /** Model-space units after fitting the requested height. */
  shoulderOutset?: number;
  /** Rest-arm angle away from vertical, in degrees. */
  armSpreadDegrees?: number;
  materialRules?: {
    material: string;
    mode: "body" | "arm-components" | "weighted-components";
    minArmWeight?: number;
    weldSeams?: boolean;
  }[];
}
const nodeRole = (node: Node): unknown =>
  node.getExtras()._humanoidRole ?? node.getExtras()._vrmHumanBone;
function partForJoint(node: Node): Part {
  for (
    let current: Node | null = node;
    current;
    current = current.getParentNode()
  ) {
    const part = partForHumanoidRole(nodeRole(current));
    if (part) return part;
  }
  return "body";
}

export interface PreparedHumanoid {
  model: IntermediateModel;
  pivots: Record<Part, V3>;
  classification: {material:string; mode:string; components:number; triangles:Record<string,number>}[];
  reduction: Awaited<ReturnType<typeof reduceRigidModel>>['report'] | null;
  profile: { shoulderOutset:number; armSpreadDegrees:number };
}

/** Rigid six-part player binding, using source rig weights, topology and explicit garment rules.
 * Bedrock poly_mesh cannot retain smooth skin weights, elbow/knee bends or VRM physics.
 */
export async function exportHumanoid(
  input: IntermediateModel,
  options: {
    height: number;
    textureSize: number;
    atlas?: number;
    /** Gutter in pixels per side; 0 by default (Bedrock uses nearest sampling). */
    atlasPadding?: number;
    materialWeights?: Record<string, number>;
    /** Opt-in shared texel-budget planner; legacy compact stays the default. */
    atlasBudget?: 'texel-density' | 'texel-retention';
    atlasSharing?: boolean;
    profile?: HumanoidProfile;
    reduction?: { ratio: number; maxError: number };
    onStage?: (phase: string) => void;
    prepared?: PreparedHumanoid;
    onPrepared?: (prepared: PreparedHumanoid) => void;
  },
) {
  if (options.prepared) return textureHumanoid(options.prepared, options);
  const timings: Record<string, number> = {};
  let phaseName = "rig",
    phaseStart = performance.now();
  const phase = (name: string) => {
    timings[phaseName] = Math.round(performance.now() - phaseStart);
    phaseName = name;
    phaseStart = performance.now();
    options.onStage?.(name);
  };
  options.onStage?.("rig");
  const shoulderOutset = options.profile?.shoulderOutset ?? 0;
  const spread = options.profile?.armSpreadDegrees ?? 0;
  const materialRules = options.profile?.materialRules ?? [];
  if (!Array.isArray(materialRules))
    throw new Error("Humanoid materialRules must be an array");
  const matchedRules = new Set<string>();
  for (const rule of materialRules) {
    if (
      !rule ||
      typeof rule.material !== "string" ||
      !rule.material ||
      !["body", "arm-components", "weighted-components"].includes(rule.mode) ||
      (rule.minArmWeight !== undefined &&
        (!Number.isFinite(rule.minArmWeight) ||
          rule.minArmWeight <= 0 ||
          rule.minArmWeight > 1))
    )
      throw new Error("Invalid humanoid material rule");
  }
  if (
    new Set(materialRules.map((r) => r.material)).size !== materialRules.length
  )
    throw new Error("Duplicate humanoid material rule");
  if (
    !Number.isFinite(shoulderOutset) ||
    shoulderOutset < 0 ||
    shoulderOutset > options.height / 4
  )
    throw new Error("Invalid humanoid shoulderOutset");
  if (!Number.isFinite(spread) || spread < 0 || spread > 45)
    throw new Error("Invalid humanoid armSpreadDegrees");
  const model = {
    ...input,
    document: cloneDocument(input.document),
    warnings: [...input.warnings],
  };
  const root = model.document.getRoot();
  const rotationY = options.profile?.rotationYDegrees ?? 0;
  if (!Number.isFinite(rotationY))
    throw new Error("Invalid humanoid rotationYDegrees");
  if (rotationY) {
    const scene = root.getDefaultScene();
    if (!scene) throw new Error("Humanoid source requires a default scene");
    const children = [...scene.listChildren()];
    const orientation = model.document
      .createNode("4DGen_source_orientation")
      .setRotation(
        Array.from(
          quat.setAxisAngle(
            quat.create(),
            [0, 1, 0],
            (rotationY * Math.PI) / 180,
          ),
        ) as [number, number, number, number],
      );
    for (const child of children) {
      scene.removeChild(child);
      orientation.addChild(child);
    }
    scene.addChild(orientation);
  }
  const boneMap = options.profile?.boneMap;
  if (boneMap) {
    if (typeof boneMap !== "object" || Array.isArray(boneMap))
      throw new Error("Invalid humanoid boneMap");
    for (const [role, name] of Object.entries(boneMap)) {
      if (typeof name !== "string" || !name)
        throw new Error("Invalid boneMap node name");
      const matches = root
        .listNodes()
        .filter((node) => node.getName() === name);
      if (matches.length !== 1)
        throw new Error(
          `boneMap ${role} requires exactly one source node named ${name}`,
        );
      matches[0]!.setExtras({
        ...matches[0]!.getExtras(),
        _humanoidRole: role,
      });
    }
  }
  const roleNodes = new Map<string, Node>();
  for (const node of root.listNodes()) {
    const role = nodeRole(node);
    if (typeof role === "string") {
      if (roleNodes.has(role))
        throw new Error("Duplicate humanoid role: " + role);
      roleNodes.set(role, node);
    }
  }
  for (const role of HUMANOID_REQUIRED_ROLES) {
    if (!roleNodes.has(role))
      throw new Error(
        "Humanoid binding requires source role (VRM metadata or boneMap): " +
          role,
      );
  }
  const classification: {
    material: string;
    mode: string;
    components: number;
    triangles: Record<string, number>;
  }[] = [];
  const used = new Set<object>();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (used.has(mesh))
      throw new Error("Humanoid binding requires unique mesh instances");
    used.add(mesh);
    const skin = node.getSkin();
    const sourceJoints = skin?.listJoints() ?? [];
    const jointParts = skin ? sourceJoints.map(partForJoint) : undefined;
    for (const primitive of [...mesh.listPrimitives()]) {
      const indices =
        primitive.getIndices()?.getArray() ??
        Uint32Array.from(
          { length: primitive.getAttribute("POSITION")!.getCount() },
          (_, i) => i,
        );
      const sets = primitive
        .listSemantics()
        .filter((s) => /^JOINTS_\d+$/.test(s))
        .map((s) => ({
          joints: primitive.getAttribute(s)!,
          weights: primitive.getAttribute(s.replace("JOINTS_", "WEIGHTS_"))!,
        }));
      const rule = materialRules.find(
        (r) => r.material === primitive.getMaterial()?.getName(),
      );
      if (rule) matchedRules.add(rule.material);
      const vertexScores = (index: number, garment: boolean) => {
        const scores = new Map<Part, number>();
        if (jointParts)
          for (const set of sets) {
            const js: number[] = [],
              ws: number[] = [];
            set.joints.getElement(index, js);
            set.weights.getElement(index, ws);
            for (let j = 0; j < js.length; j++) {
              const joint = sourceJoints[js[j]!]!;
              const role = nodeRole(joint);
              const part =
                garment && role === "leftShoulder"
                  ? "leftArm"
                  : garment && role === "rightShoulder"
                    ? "rightArm"
                    : (jointParts[js[j]!] ?? "body");
              scores.set(part, (scores.get(part) ?? 0) + ws[j]!);
            }
          }
        return scores;
      };
      const componentPart = new Map<number, Part | undefined>();
      const parents = Array.from(
        { length: primitive.getAttribute("POSITION")!.getCount() },
        (_, i) => i,
      );
      const find = (i: number): number => {
        while (parents[i] !== i) {
          parents[i] = parents[parents[i]!]!;
          i = parents[i]!;
        }
        return i;
      };
      if (
        rule?.mode === "arm-components" ||
        rule?.mode === "weighted-components"
      ) {
        if (rule.weldSeams) {
          const canonical = new Map<string, number>();
          for (const index of new Set(indices)) {
            const position: number[] = [];
            primitive.getAttribute("POSITION")!.getElement(index, position);
            const signature = [...position.map((v) => Math.round(v * 1e6))];
            for (const set of sets) {
              const js: number[] = [],
                ws: number[] = [];
              set.joints.getElement(index, js);
              set.weights.getElement(index, ws);
              signature.push(...js, ...ws.map((w) => Math.round(w * 1e6)));
            }
            const key = signature.join(",");
            if (canonical.has(key))
              parents[find(index)] = find(canonical.get(key)!);
            else canonical.set(key, index);
          }
        }
        for (let i = 0; i < indices.length; i += 3) {
          const r = find(indices[i]!);
          parents[find(indices[i + 1]!)] = r;
          parents[find(indices[i + 2]!)] = r;
        }
        const scores = new Map<number, Map<Part, number>>();
        for (const index of new Set(indices)) {
          const r = find(index);
          if (!scores.has(r)) scores.set(r, new Map());
          for (const [part, weight] of vertexScores(index, true))
            scores.get(r)!.set(part, (scores.get(r)!.get(part) ?? 0) + weight);
        }
        for (const [r, totals] of scores) {
          const total = [...totals.values()].reduce((a, b) => a + b, 0);
          const arm: Part =
            (totals.get("leftArm") ?? 0) > (totals.get("rightArm") ?? 0)
              ? "leftArm"
              : "rightArm";
          const dominant = [...totals].sort((a, b) => b[1] - a[1])[0];
          componentPart.set(
            r,
            rule.mode === "weighted-components"
              ? dominant && total > 0 && dominant[1] / total >= 0.8
                ? dominant[0]
                : undefined
              : total > 0 &&
                  (totals.get(arm) ?? 0) / total >= (rule.minArmWeight ?? 0.35)
                ? arm
                : "body",
          );
        }
      }
      const grouped = new Map<Part, number[]>();
      for (let i = 0; i < indices.length; i += 3) {
        const scores = new Map<Part, number>();
        for (let c = 0; c < 3; c++)
          for (const [part, weight] of vertexScores(indices[i + c]!, false))
            scores.set(part, (scores.get(part) ?? 0) + weight);
        const weightedPart = dominantHumanoidPart(scores);
        const part: Part =
          rule?.mode === "body"
            ? "body"
            : rule?.mode === "arm-components" ||
                rule?.mode === "weighted-components"
              ? (componentPart.get(find(indices[i]!)) ?? weightedPart)
              : weightedPart;
        if (!grouped.has(part)) grouped.set(part, []);
        grouped.get(part)!.push(indices[i]!, indices[i + 1]!, indices[i + 2]!);
      }
      if (rule)
        classification.push({
          material: rule.material,
          mode: rule.mode,
          components: componentPart.size,
          triangles: Object.fromEntries(
            [...grouped].map(([part, values]) => [part, values.length / 3]),
          ),
        });
      for (const [part, values] of grouped) {
        const p = primitive
          .clone()
          .setExtras({ ...primitive.getExtras(), _playerPart: part });
        p.setIndices(
          model.document
            .createAccessor()
            .setType("SCALAR")
            .setArray(Uint32Array.from(values))
            .setBuffer(root.listBuffers()[0] ?? model.document.createBuffer()),
        );
        mesh.addPrimitive(p);
      }
      mesh.removePrimitive(primitive);
      primitive.dispose();
    }
  }
  for (const rule of materialRules)
    if (!matchedRules.has(rule.material))
      throw new Error("Humanoid material not found: " + rule.material);
  phase("pose");
  // Pose the SOURCE rig first. Mixed chest/shoulder/arm weights are evaluated by
  // prepareStaticModel, rather than moving already cut rigid pieces apart.
  // Only the fitted height scale is needed here, so measure the frozen bounds
  // instead of building (and immediately discarding) a whole snapshot document.
  const frozen = measureFrozenBounds(model);
  const sourceHeight = frozen.max[1] - frozen.min[1];
  if (!(sourceHeight > 0)) throw new Error("Cannot set height on a zero-height model");
  const initial = { report: { heightScale: options.height / sourceHeight } };
  for (const [armRole, handRole] of [
    ["leftUpperArm", "leftHand"],
    ["rightUpperArm", "rightHand"],
  ]) {
    const arm = roleNodes.get(armRole!)!,
      hand = roleNodes.get(handRole!)!;
    const pivot = arm.getWorldTranslation();
    const direction = vec3.normalize(
      vec3.create(),
      vec3.subtract(vec3.create(), hand.getWorldTranslation(), pivot),
    );
    const side = Math.sign(direction[0]);
    if (!side || !Number.isFinite(side))
      throw new Error("Humanoid arm direction is not lateral");
    const radians = (spread * Math.PI) / 180;
    const delta = quat.rotationTo(quat.create(), direction, [
      side * Math.sin(radians),
      -Math.cos(radians),
      0,
    ]);
    const worldRotation = quat.multiply(
      quat.create(),
      delta,
      arm.getWorldRotation(),
    );
    const parent = arm.getParentNode();
    const parentRotation = parent?.getWorldRotation() ?? [0, 0, 0, 1];
    const localRotation = quat.multiply(
      quat.create(),
      quat.invert(quat.create(), parentRotation),
      worldRotation,
    );
    arm.setRotation(
      Array.from(localRotation) as [number, number, number, number],
    );
    const moved = vec3.fromValues(
      pivot[0] + (side * shoulderOutset) / initial.report.heightScale,
      pivot[1],
      pivot[2],
    );
    if (parent) {
      const inverse = mat4.invert(mat4.create(), parent.getWorldMatrix());
      if (!inverse) throw new Error("Singular humanoid arm parent transform");
      vec3.transformMat4(moved, moved, inverse);
    }
    arm.setTranslation(Array.from(moved) as V3);
  }
  const points = new Map(
    [...roleNodes].map(([role, node]) => [role, node.getWorldTranslation()]),
  );
  const prepared = await prepareStaticModel(model, {
    height: options.height,
    center: "ground",
  });
  const { before, heightScale } = prepared.report;
  const fit = createBoundsFitter(before, heightScale);
  const pivots = Object.fromEntries(
    Object.entries(HUMANOID_PART_ROLES).map(([part, role]) => {
      const point = points.get(role)!;
      return [part, fit(point[0]!, point[1]!, point[2]!)];
    }),
  ) as Record<Part, V3>;
  phase("reduction");
  const reduced = options.reduction
    ? await reduceRigidModel(prepared.model, options.reduction)
    : null;
  phase("atlas");
  const state: PreparedHumanoid = {model:reduced?.model ?? prepared.model, pivots, classification, reduction:reduced?.report ?? null, profile:{shoulderOutset, armSpreadDegrees:spread}};
  options.onPrepared?.(state);
  return textureHumanoid(state, options, timings);
}

async function textureHumanoid(state: PreparedHumanoid, options: {textureSize:number; atlas?:number; atlasPadding?:number; materialWeights?:Record<string,number>; atlasBudget?:'texel-density'|'texel-retention'; atlasSharing?:boolean; onStage?:(phase:string)=>void}, timings:Record<string,number> = {}) {
  const {pivots, classification} = state;
  let phaseName = 'atlas', phaseStart = performance.now();
  const phase = (name:string) => {timings[phaseName] = Math.round(performance.now()-phaseStart); phaseName=name; phaseStart=performance.now(); options.onStage?.(name);};
  options.onStage?.('atlas');
  const texture = await optimizeTextures(state.model, {
    maxTextureSize:options.textureSize,
    ...(options.materialWeights ? {materialWeights:options.materialWeights} : {}),
    ...(options.atlasBudget ? {atlasBudget:options.atlasBudget} : {}),
    ...(options.atlasSharing ? {atlasSharing:true} : {}),
    ...(options.atlas ? {atlasSize:options.atlas} : {compactSize:128,padding:options.atlasPadding ?? 0}),
  });
  const optimized = {model:texture.model, report:{texture:texture.report}};
  phase("export");
  const full = await exportBedrockGeometry(bindStatic(optimized.model), {
    identifier: "geometry.skin0",
    skinTextureSize: 128,
    playerParts: true,
  });
  const geometry = full.file["geometry.skin0"]!;
  const counts: Record<string, number> = {};
  for (const part of HUMANOID_PARTS) {
    const count = optimized.model.document
      .getRoot()
      .listMeshes()
      .flatMap((m) => m.listPrimitives())
      .filter((p) => p.getExtras()._playerPart === part)
      .reduce((n, p) => n + p.getIndices()!.getCount() / 3, 0);
    if (!count) throw new Error("Humanoid part has no triangles: " + part);
    const bone = geometry.bones.find((b) => b.name === part)!;
    const pivot = pivots[part];
    bone.pivot = [-pivot[0], pivot[1], pivot[2]];
    counts[part] = count;
  }
  const waist = geometry.bones.find((b) => b.name === "waist")!;
  waist.pivot = [...geometry.bones.find((b) => b.name === "body")!.pivot!];
  full.report.validation = validateGeometry(full.file, {
    expectedIdentifier: "geometry.skin0",
    atlasUVs: true,
  }).geometries[0]!;
  full.report.warnings.push(
    "Humanoid rigid binding: the source rig and mixed weights evaluate the rest pose before freezing; source material rules can override triangle ownership. Runtime smooth deformation, elbows, knees and hair/cloth physics are not retained.",
  );
  phase("done");
  return {
    ...full,
    binding: {
      timings,
      parts: counts,
      pivots,
      classification,
      texture: optimized.report.texture,
      reduction: state.reduction,
      profile: state.profile,
    },
  };
}
