import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { importModel } from '../src/importer.ts';
import { buildPreviewGlb } from '../src/preview-asset.ts';
import { autoProfile } from '../src/auto-profile.ts';
import { exportHumanoid } from '../src/humanoid.ts';
import { listModelCandidates, modelFormatOf, modelDisplayName } from '../src/model-candidates.ts';
import { modelPattern } from '../server/model-files.ts';
import {
  buildYsmBoneMeshes,
  buildYsmImportPlan,
  buildYsmMesh,
  buildYsmRig,
  buildYsmScene,
  hiddenYsmBones,
  parseYsmGeometry,
  parseYsmManifest,
  selectYsmTexture,
  YSM_HUMANOID_ROLES,
} from '../src/ysm-model.ts';
import { resolveTexturePolicy } from '../src/texture-policy.ts';
import { optimizeTextures } from '../src/texture-optimizer.ts';
import { resolveDefaultReductionRatio, resolveInitialReductionRatio } from '../src/reduce-policy.ts';
import { assignParts } from '../src/parts.ts';

const PNG_64 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAvElEQVR4nOXOoQEAIAzAsOppNP9/yc6IQMSnOff9LB3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdAWB/yxHm1fJEsAAAAASUVORK5CYII=',
  'base64',
);

/** Minimal 32-bit bottom-left TGA (2×2 px). */
function tgaBytes(): Buffer {
  const bytes = Buffer.alloc(18 + 16);
  bytes[2] = 2; // uncompressed true-color
  bytes[12] = 2; bytes[13] = 0;
  bytes[14] = 2; bytes[15] = 0;
  bytes[16] = 32; bytes[17] = 0x08;
  for (let index = 0; index < 4; index++) {
    const offset = 18 + index * 4;
    bytes[offset] = 10 + index;
    bytes[offset + 1] = 20;
    bytes[offset + 2] = 30;
    bytes[offset + 3] = 255;
  }
  return bytes;
}

async function temporary(work: (dir: string) => Promise<void>) {
  const cache = resolve(dirname(fileURLToPath(import.meta.url)), '../.cache');
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, '4d-ysm-'));
  try { await work(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function manifest(textures = ['textures/default.png'], defaultTexture?: string) {
  return {
    spec: 2,
    metadata: { name: 'Test YSM', authors: [{ name: 'Author' }], license: { type: 'CC0' } },
    properties: { ...(defaultTexture ? { default_texture: defaultTexture } : {}) },
    files: {
      player: {
        model: { main: 'models/main.json', arm: 'models/arm.json' },
        texture: textures,
      },
    },
  };
}

function cubeGeometry(cube: Record<string, unknown>) {
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { identifier: 'geometry.test', texture_width: 64, texture_height: 64 },
      bones: [{ name: 'Body', pivot: [0, 0, 0], cubes: [cube] }],
    }],
  };
}

function humanoidGeometry(includeHands = true) {
  const box = (origin: number[], size: number[]) => ({ origin, size, uv: [0, 0] });
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { identifier: 'geometry.test', texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'Root', pivot: [0, 0, 0] },
        { name: 'AllBody', parent: 'Root', pivot: [0, 12, 0], cubes: [box([-2, 12, -1], [4, 12, 2])] },
        { name: 'Head', parent: 'AllBody', pivot: [0, 24, 0], cubes: [box([-4, 24, -4], [8, 8, 8])] },
        { name: 'Hair', parent: 'Head', pivot: [0, 30, 0], cubes: [box([-4, 30, -4], [8, 4, 8])] },
        { name: 'LeftArm', parent: 'AllBody', pivot: [-4, 22, 0], cubes: [box([-6, 14, -1], [2, 8, 2])] },
        { name: 'LeftForeArm', parent: 'LeftArm', pivot: [-4, 14, 0], cubes: [box([-6, 10, -1], [2, 4, 2])] },
        ...(includeHands ? [{ name: 'LeftHand', parent: 'LeftForeArm', pivot: [-4, 10, 0] }] : []),
        { name: 'RightArm', parent: 'AllBody', pivot: [4, 22, 0], cubes: [box([4, 14, -1], [2, 8, 2])] },
        { name: 'RightForeArm', parent: 'RightArm', pivot: [4, 14, 0], cubes: [box([4, 10, -1], [2, 4, 2])] },
        ...(includeHands ? [{ name: 'RightHand', parent: 'RightForeArm', pivot: [4, 10, 0] }] : []),
        { name: 'LeftLeg', parent: 'AllBody', pivot: [-2, 12, 0], cubes: [box([-3, 0, -1], [2, 12, 2])] },
        { name: 'LeftLowerLeg', parent: 'LeftLeg', pivot: [-2, 6, 0], cubes: [box([-3, 0, -1], [2, 6, 2])] },
        { name: 'RightLeg', parent: 'AllBody', pivot: [2, 12, 0], cubes: [box([1, 0, -1], [2, 12, 2])] },
        { name: 'RightLowerLeg', parent: 'RightLeg', pivot: [2, 6, 0], cubes: [box([1, 0, -1], [2, 6, 2])] },
      ],
    }],
  };
}

function bounds(mesh: ReturnType<typeof buildYsmMesh>) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of mesh.parts) {
    for (let index = 0; index < part.positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = part.positions[index + axis]!;
        min[axis] = Math.min(min[axis]!, value);
        max[axis] = Math.max(max[axis]!, value);
      }
    }
  }
  return { min, max };
}

test('YSM manifest resolves the default texture by file stem', () => {
  const parsed = parseYsmManifest(manifest(['textures/blue.png', 'textures/skin.png'], 'skin'));
  assert.equal(parsed.mainModel, 'models/main.json');
  assert.equal(parsed.armModel, 'models/arm.json');
  assert.equal(selectYsmTexture(parsed).uv, 'textures/skin.png');
  assert.equal(selectYsmTexture(parseYsmManifest(manifest(['textures/blue.png', 'textures/skin.png']))).uv, 'textures/blue.png');
  assert.deepEqual(parsed.authors, ['Author']);
  assert.equal(parsed.license, 'CC0');
  const withAnimation = {
    ...manifest(),
    files: {
      player: {
        ...manifest().files.player,
        animation: { main: 'animations/main.animation.json' },
      },
    },
  };
  assert.equal(parseYsmManifest(withAnimation).mainAnimation, 'animations/main.animation.json');
});

test('YSM pre_parallel animations hide GUI bones and their descendants', () => {
  const parsed = parseYsmGeometry({
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'Root', pivot: [0, 0, 0] },
        { name: 'Body', parent: 'Root', pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] },
        { name: 'Backgrounds', parent: 'Root', pivot: [0, 0, 0] },
        { name: 'gui', parent: 'Backgrounds', pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] },
        { name: 'curtain', parent: 'gui', pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] },
      ],
    }],
  });
  const hidden = hiddenYsmBones({ animations: { pre_parallel4: { bones: { gui: { scale: 0 } } } } });
  assert.deepEqual(hidden, ['gui']);
  const mesh = buildYsmMesh(parsed.geometry, { hiddenBones: hidden });
  assert.deepEqual(mesh.parts.map((part) => part.name), ['Body']);
  assert.ok(mesh.diagnostics.some((item) => item.code === 'hidden-bones' && item.names.length === 2));
});

test('YSM rig maps head, body, arms and legs onto the six player parts', () => {
  const parsed = parseYsmGeometry(humanoidGeometry());
  const rig = buildYsmRig(parsed.geometry);
  assert.equal(rig.complete, true);
  assert.deepEqual(rig.parts.Head, 'head');
  assert.deepEqual(rig.parts.Hair, 'head');
  assert.deepEqual(rig.parts.LeftForeArm, 'leftArm');
  assert.deepEqual(rig.parts.LeftLowerLeg, 'leftLeg');
  assert.deepEqual(rig.parts.AllBody, 'body');
  assert.equal(rig.roles.hips?.[1], 12 / 16);
  assert.equal(rig.roles.head?.[1], 24 / 16);
  assert.equal(rig.roles.leftUpperArm?.[0], 4 / 16);
  assert.equal(rig.roles.leftHand?.[1], 10 / 16);
  assert.equal(rig.roles.leftUpperLeg?.[0], 2 / 16);
});

test('YSM rig falls back to the forearm when a hand bone is missing', () => {
  const parsed = parseYsmGeometry(humanoidGeometry(false));
  const rig = buildYsmRig(parsed.geometry);
  assert.equal(rig.complete, true);
  assert.ok(rig.diagnostics.some((item) => item.code === 'hand-fallback' && item.side === 'left'));
  assert.equal(rig.roles.leftHand?.[1], 14 / 16);
});

test('YSM rig stays incomplete without arms and legs', () => {
  const parsed = parseYsmGeometry({
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'Root', pivot: [0, 0, 0] },
        { name: 'Body', parent: 'Root', pivot: [0, 12, 0], cubes: [{ origin: [-2, 0, -1], size: [4, 24, 2], uv: [0, 0] }] },
        { name: 'Head', parent: 'Body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }] },
      ],
    }],
  });
  const rig = buildYsmRig(parsed.geometry);
  assert.equal(rig.complete, false);
  assert.ok(rig.diagnostics.some((item) => item.code === 'incomplete-rig'));
});

test('YSM humanoid import defaults to six-part binding and exports all parts', async () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../.cache/ysm-humanoid-test');
  await rm(dir, { recursive: true, force: true });
  const modelDir = join(dir, 'humanoid_ysm');
  try {
    await mkdir(join(modelDir, 'models'), { recursive: true });
    await mkdir(join(modelDir, 'textures'), { recursive: true });
    await writeFile(join(modelDir, 'ysm.json'), JSON.stringify(manifest()));
    await writeFile(join(modelDir, 'models', 'main.json'), JSON.stringify(humanoidGeometry()));
    await writeFile(join(modelDir, 'textures', 'default.png'), PNG_64);
    const model = await importModel(join(modelDir, 'ysm.json'));
    const profile = autoProfile(model.document);
    assert.ok(profile);
    const root = model.document.getRoot();
    const role = root.listNodes().find((node) => node.getExtras()._humanoidRole === 'leftUpperArm');
    const armBone = root.listNodes().find((node) => node.getName() === 'LeftArm');
    const armMesh = root.listNodes().find((node) => node.getExtras()._playerPart === 'leftArm' && node.getMesh());
    assert.ok(role);
    assert.ok(armBone);
    assert.ok(armMesh);
    assert.equal(armBone.getParentNode(), role);
    assert.equal(armMesh.getParentNode(), armBone);
    const io = new NodeIO();
    const preview = await io.readBinary(await buildPreviewGlb(model.document, io));
    assert.ok(preview.getRoot().listNodes().some((node) => node.getName() === '__ysm_leftHand'));
    const result = await exportHumanoid(model, { height: 32, textureSize: 64, profile });
    assert.deepEqual(Object.keys(result.binding.parts).sort(), ['body', 'head', 'leftArm', 'leftLeg', 'rightArm', 'rightLeg']);
    for (const count of Object.values(result.binding.parts)) assert.ok(count > 0);
    const bones = result.file['geometry.skin0']!.bones.map((bone) => bone.name);
    for (const part of ['body', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']) assert.ok(bones.includes(part));
    const spread = await exportHumanoid(model, { height: 32, textureSize: 64, profile: { ...profile, armSpreadDegrees: 30 } });
    const restArm = result.file['geometry.skin0']!.bones.find((bone) => bone.name === 'leftArm')!.poly_mesh!.positions;
    const spreadArm = spread.file['geometry.skin0']!.bones.find((bone) => bone.name === 'leftArm')!.poly_mesh!.positions;
    assert.notDeepEqual(restArm, spreadArm);
    const preserved = await exportHumanoid(model, { height: 32, textureSize: 256, profile });
    assert.equal(preserved.file['geometry.skin0']!.texturewidth, 64);
    assert.equal(preserved.file['geometry.skin0']!.textureheight, 64);
    assert.equal(preserved.binding.texture.atlas.width, 64);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('YSM bone pivots stay in meters when ancestor bones are rotated', () => {
  const geometry = humanoidGeometry();
  const bones = geometry['minecraft:geometry'][0]!.bones as Array<Record<string, unknown>>;
  bones.find((bone) => bone.name === 'LeftArm')!.rotation = [0, 0, -20];
  const parsed = parseYsmGeometry(geometry);
  const rig = buildYsmRig(parsed.geometry);
  const set = buildYsmBoneMeshes(parsed.geometry);
  // Bone nodes and the synthetic role pivots must agree, otherwise arm spread
  // and the workbench pose preview rotate the mesh around a bogus pivot.
  for (const role of YSM_HUMANOID_ROLES) {
    const bone = set.bones.find((item) => item.role === role);
    assert.ok(bone, `missing ${role} bone`);
    const expected = rig.roles[role]!;
    const distance = Math.hypot(
      bone.pivot[0] - expected[0],
      bone.pivot[1] - expected[1],
      bone.pivot[2] - expected[2],
    );
    assert.ok(distance < 1e-5, `${role} pivot ${bone.pivot} != ${expected}`);
  }
});

test('YSM duplicate bones merge cubes instead of dropping a #2 part', () => {
  const parsed = parseYsmGeometry({
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'Rotated', pivot: [0, 0, 0], rotation: [0, 0, 90] },
        { name: 'Body', pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [8, 1, 1], uv: [0, 0] }] },
        { name: 'Body', parent: 'Rotated', pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [8, 1, 1], uv: [0, 0] }] },
      ],
    }],
  });
  const scene = buildYsmScene(parsed.geometry);
  const mesh = buildYsmMesh(parsed.geometry);
  assert.equal(scene.bones.length, 2);
  assert.equal(scene.bones.find((bone) => bone.name === 'Body')!.mesh!.indices.length, 72);
  assert.equal(scene.roots.filter((node) => node.name === 'Body').length, 1);
  assert.ok(scene.diagnostics.some((item) => item.code === 'duplicate-bone'));
  assert.ok(mesh.diagnostics.some((item) => item.code === 'duplicate-bone-conflict'));
  assert.ok(!scene.roots.some((node) => node.name.startsWith('Body#')));
  // The conflicting duplicate keeps its own source hierarchy/rotation instead
  // of being silently placed under the first bone's identity transform.
  assert.ok(bounds(mesh).min[1]! < -0.4);
});

test('YSM scene description owns role nodes, hierarchy and mesh offsets', () => {
  const parsed = parseYsmGeometry(humanoidGeometry());
  const plan = buildYsmImportPlan(parseYsmManifest(manifest()), parsed.geometry);
  assert.equal(plan.scene.humanoid, true);
  assert.equal(plan.textureHint.preserve, true);
  assert.equal(plan.textureHint.maxSize, 256);
  // Eight roles, but each hand role is nested under its upper-arm role.
  assert.equal(plan.scene.roots.filter((node) => node.role).length, 6);
  const arm = plan.scene.roots.find((node) => node.role === 'leftUpperArm')!;
  const hand = arm.children.find((node) => node.role === 'leftHand')!;
  const expected = [
    plan.scene.roles.leftHand![0] - plan.scene.roles.leftUpperArm![0],
    plan.scene.roles.leftHand![1] - plan.scene.roles.leftUpperArm![1],
    plan.scene.roles.leftHand![2] - plan.scene.roles.leftUpperArm![2],
  ];
  for (let index = 0; index < 3; index++)
    assert.ok(Math.abs(hand.translation[index]! - expected[index]!) < 1e-6);
  const headRole = plan.scene.roots.find((node) => node.role === 'head')!;
  const head = headRole.children.find((node) => node.name === 'Head')!;
  assert.deepEqual(head.translation, [0, 0, 0]);
  const headMesh = head.children.find((node) => node.mesh)!;
  assert.deepEqual(headMesh.translation.map((value) => Number(value.toFixed(4))), [
    -plan.scene.bones.find((bone) => bone.name === 'Head')!.pivot[0],
    -plan.scene.bones.find((bone) => bone.name === 'Head')!.pivot[1],
    -plan.scene.bones.find((bone) => bone.name === 'Head')!.pivot[2],
  ].map((value) => Number(value.toFixed(4))));
});

test('YSM hierarchy diagnostics repair missing parents and cycles', () => {
  const cube = { origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] };
  const parsed = parseYsmGeometry({
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'Orphan', parent: 'Missing', pivot: [0, 0, 0], cubes: [cube] },
        { name: 'A', parent: 'B', pivot: [0, 0, 0], cubes: [cube] },
        { name: 'B', parent: 'A', pivot: [0, 0, 0] },
      ],
    }],
  });
  const scene = buildYsmScene(parsed.geometry);
  assert.ok(scene.diagnostics.some((item) => item.code === 'missing-parent' && item.parent === 'Missing'));
  assert.ok(scene.diagnostics.some((item) => item.code === 'cyclic-bone'));
  // Every repaired bone must remain reachable from a root, and the effective
  // parent map must be acyclic.
  const names = new Set<string>();
  const walk = (node: import('../src/ysm-model.ts').YsmSceneNode) => {
    names.add(node.name);
    for (const child of node.children) walk(child);
  };
  for (const root of scene.roots) walk(root);
  for (const name of ['A', 'B', 'Orphan']) assert.ok(names.has(name), `missing ${name}`);
  const parents = new Map(scene.bones.map((bone) => [bone.name, bone.parent]));
  for (const bone of scene.bones) {
    const seen = new Set<string>();
    let current: string | undefined = bone.name;
    while (current) {
      assert.ok(!seen.has(current), `cycle at ${current}`);
      seen.add(current);
      current = parents.get(current);
    }
  }
});

test('YSM box-UV cube becomes 12 triangles in converter space', () => {
  const parsed = parseYsmGeometry(cubeGeometry({ origin: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0] }));
  const mesh = buildYsmMesh(parsed.geometry);
  assert.equal(mesh.parts.length, 1);
  assert.equal(mesh.parts[0]!.name, 'Body');
  assert.equal(mesh.parts[0]!.indices.length, 36);
  const box = bounds(mesh);
  assert.deepEqual(box.min.map((value) => Number(value.toFixed(4))), [-0.25, 0, -0.25]);
  assert.deepEqual(box.max.map((value) => Number(value.toFixed(4))), [0.25, 0.5, 0.25]);
  for (const uv of mesh.parts[0]!.uvs) assert.ok(uv >= 0 && uv <= 1);
});

test('YSM per-face UV and mirrored layout keep UVs normalized', () => {
  const face = (uv: number[], uv_size: number[]) => ({ uv, uv_size });
  const parsed = parseYsmGeometry(cubeGeometry({
    origin: [-2, 0, -1],
    size: [4, 6, 2],
    mirror: true,
    uv: {
      north: face([1, 2], [4, 6]),
      south: face([6, 2], [4, 6]),
      east: face([10, 2], [2, 6]),
      west: face([12, 2], [2, 6]),
      up: face([1, 1], [4, 2]),
      down: face([1, 8], [4, -2]),
    },
  }));
  const mesh = buildYsmMesh(parsed.geometry);
  assert.equal(mesh.parts[0]!.indices.length, 36);
  for (const uv of mesh.parts[0]!.uvs) assert.ok(uv >= 0 && uv <= 1);
  const box = bounds(mesh);
  assert.deepEqual(box.min.map((value) => Number(value.toFixed(4))), [-0.125, 0, -0.0625]);
  assert.deepEqual(box.max.map((value) => Number(value.toFixed(4))), [0.125, 0.375, 0.0625]);
});

test('YSM bone rotation moves child cubes around the bone pivot', () => {
  const parsed = parseYsmGeometry({
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'Root', pivot: [0, 0, 0] },
        { name: 'Arm', parent: 'Root', pivot: [0, 0, 0], rotation: [0, 0, -90], cubes: [{ origin: [0, 0, 0], size: [4, 1, 1], uv: [0, 0] }] },
      ],
    }],
  });
  const mesh = buildYsmMesh(parsed.geometry);
  const box = bounds(mesh);
  // Mirroring puts the cube on -X; a -90° bone rotation lifts it onto +Y.
  assert.ok(Math.abs(box.max[1]! - 0.25) < 1e-4);
  assert.ok(Math.abs(box.min[0]!) < 1e-4);
  assert.ok(Math.abs(box.max[0]! - 0.0625) < 1e-4);
});

test('YSM geometry without usable faces is rejected', () => {
  const parsed = parseYsmGeometry(cubeGeometry({ origin: [0, 0, 0], size: [1, 1, 1] }));
  assert.throws(() => buildYsmMesh(parsed.geometry), /no renderable geometry/);
});

test('importModel reads a YSM folder through ysm.json', () => temporary(async (dir) => {
  const modelDir = join(dir, 'my_ysm_model');
  await mkdir(join(modelDir, 'models'), { recursive: true });
  await mkdir(join(modelDir, 'textures'), { recursive: true });
  await writeFile(join(modelDir, 'ysm.json'), JSON.stringify(manifest()));
  await writeFile(join(modelDir, 'models', 'main.json'), JSON.stringify(cubeGeometry({ origin: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0] })));
  await writeFile(join(modelDir, 'models', 'arm.json'), JSON.stringify(cubeGeometry({ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] })));
  await writeFile(join(modelDir, 'textures', 'default.png'), await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  }).png().toBuffer());
  const model = await importModel(join(modelDir, 'ysm.json'));
  assert.equal(model.source.format, 'ysm');
  assert.equal(model.source.importer, 'ysm');
  assert.equal(model.source.reductionHint?.retainBelowTriangles, 10_000);
  assert.equal(model.document.getRoot().listMeshes().length, 1);
  assert.equal(model.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getIndices()!.getCount(), 36);
  assert.equal(model.document.getRoot().listTextures().length, 1);
  assert.equal(model.document.getRoot().listNodes()[0]!.getName(), 'Body');
  assert.ok(model.warnings.some((warning) => warning.includes('arm model is ignored')));
  assert.ok(model.warnings.some((warning) => warning.includes('animations')));
}));

test('YSM parts expose semantic FOX and Hair groups', async () => temporary(async (dir) => {
  const modelDir = join(dir, 'grouped_ysm');
  await mkdir(join(modelDir, 'models'), { recursive: true });
  await mkdir(join(modelDir, 'textures'), { recursive: true });
  await writeFile(join(modelDir, 'ysm.json'), JSON.stringify(manifest()));
  await writeFile(join(modelDir, 'models', 'main.json'), JSON.stringify({
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'Root', pivot: [0, 0, 0] },
        { name: 'AllBody', parent: 'Root', pivot: [0, 12, 0], cubes: [{ origin: [-2, 12, -1], size: [4, 12, 2], uv: [0, 0] }] },
        { name: 'Head', parent: 'AllBody', pivot: [0, 24, 0] },
        { name: 'Hair', parent: 'Head', pivot: [0, 27, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 4, 8], uv: [0, 0] }] },
        { name: 'FOX', parent: 'Root', pivot: [0, 0, 0] },
        { name: 'FoxBody', parent: 'FOX', pivot: [0, 0, 0], cubes: [{ origin: [-2, 0, -2], size: [4, 4, 4], uv: [0, 0] }] },
      ],
    }],
  }));
  await writeFile(join(modelDir, 'textures', 'default.png'), PNG_64);
  const model = await importModel(join(modelDir, 'ysm.json'));
  const parts = assignParts(model.document, true);
  assert.ok(parts.some((part) => part.group === 'FOX' && part.triangles > 0));
  assert.ok(parts.some((part) => part.group === 'Hair' && part.triangles > 0));
}));

test('YSM TGA and PNG textures are normalized to PNG and preserved', async () => temporary(async (dir) => {
  for (const [name, bytes] of [
    ['default.tga', tgaBytes()],
    ['default.png', PNG_64],
  ] as const) {
    const modelDir = join(dir, `tex_${name.replace('.', '_')}`);
    await mkdir(join(modelDir, 'models'), { recursive: true });
    await mkdir(join(modelDir, 'textures'), { recursive: true });
    await writeFile(join(modelDir, 'ysm.json'), JSON.stringify(manifest([`textures/${name}`])));
    await writeFile(join(modelDir, 'models', 'main.json'), JSON.stringify(cubeGeometry({
      origin: [-4, 0, -4],
      size: [8, 8, 8],
      uv: [0, 0],
    })));
    await writeFile(join(modelDir, 'textures', name), bytes);
    const model = await importModel(join(modelDir, 'ysm.json'));
    const texture = model.document.getRoot().listTextures()[0]!;
    assert.equal(texture.getMimeType(), 'image/png');
    const optimized = await optimizeTextures(model, {});
    assert.equal(optimized.preserved, true);
    assert.equal(optimized.png[0], 137);
    assert.equal(optimized.png[1], 80);
    assert.ok(optimized.report.atlas.uvUtilization! < 1);
    assert.ok(optimized.report.atlas.sampledUtilization! <= optimized.report.atlas.uvUtilization!);
  }
}));

test('YSM texture hint caps large atlases but explicit user sizes win', async () => temporary(async (dir) => {
  const modelDir = join(dir, 'large_ysm');
  await mkdir(join(modelDir, 'models'), { recursive: true });
  await mkdir(join(modelDir, 'textures'), { recursive: true });
  await writeFile(join(modelDir, 'ysm.json'), JSON.stringify(manifest()));
  await writeFile(join(modelDir, 'models', 'main.json'), JSON.stringify(cubeGeometry({
    origin: [-4, 0, -4],
    size: [8, 8, 8],
    uv: [0, 0],
  })));
  await writeFile(join(modelDir, 'textures', 'default.png'), await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  }).png().toBuffer());
  const model = await importModel(join(modelDir, 'ysm.json'));
  const hinted = await optimizeTextures(model, {});
  assert.equal(hinted.preserved, true);
  assert.equal(hinted.report.atlas.width, 256);
  assert.equal(hinted.report.atlas.height, 256);
  const explicit = await optimizeTextures(model, { maxTextureSize: 1024, maxTextureSizeExplicit: true });
  assert.equal(explicit.report.atlas.width, 1024);
  const forcedAtlas = await optimizeTextures(model, { forceAtlas: true, compactSize: 128 });
  assert.equal(forcedAtlas.preserved, false);
  assert.equal(forcedAtlas.report.atlas.width, 128);
}));

test('texture policy keeps importer defaults below explicit user settings', () => {
  assert.deepEqual(resolveTexturePolicy({ preserve: true, maxSize: 256 }), {
    preserve: true,
    maxTextureSize: 256,
  });
  assert.deepEqual(resolveTexturePolicy({ preserve: true, maxSize: 256 }, { maxTextureSize: 512 }), {
    preserve: true,
    maxTextureSize: 256,
  });
  assert.deepEqual(resolveTexturePolicy(
    { preserve: true, maxSize: 256 },
    { maxTextureSize: 512, maxTextureSizeExplicit: true },
  ), { preserve: true, maxTextureSize: 512 });
  assert.deepEqual(resolveTexturePolicy({ preserve: true, maxSize: 256 }, { forceAtlas: true }), {
    preserve: false,
    maxTextureSize: 256,
  });
  assert.deepEqual(resolveTexturePolicy(undefined, { maxTextureSize: 128 }), {
    preserve: false,
    maxTextureSize: 128,
  });
});

test('YSM small models default to 100% retention without overriding user settings', () => {
  const hint = { retainBelowTriangles: 10_000 };
  assert.equal(resolveDefaultReductionRatio(hint, 9_999), 1);
  assert.equal(resolveDefaultReductionRatio(hint, 10_000), 0.2);
  assert.equal(resolveDefaultReductionRatio(hint, 30_000), 0.2);
  assert.equal(resolveDefaultReductionRatio(undefined, 2_000), 0.2);
  assert.equal(resolveInitialReductionRatio(undefined, hint, 9_999), 1);
  // Legacy entries saved the generic 20% default automatically.
  assert.equal(resolveInitialReductionRatio(0.2, hint, 9_999), 1);
  // A real user choice is authoritative.
  assert.equal(resolveInitialReductionRatio(0.5, hint, 9_999), 0.5);
  assert.equal(resolveInitialReductionRatio(1, hint, 12_000), 1);
});

test('YSM manifests are recognised as model candidates', () => {
  assert.equal(modelFormatOf('models/char/ysm.json'), 'ysm');
  assert.equal(modelFormatOf('C:\\models\\char\\ysm.json'), 'ysm');
  assert.equal(modelDisplayName('C:\\models\\char\\ysm.json'), 'char');
  assert.equal(modelFormatOf('models/main.json'), null);
  assert.ok(modelPattern.test('C:\\models\\char\\ysm.json'));
  assert.ok(modelPattern.test('/models/char/ysm.json'));
  assert.ok(!modelPattern.test('/models/char/main.json'));
  const candidate = listModelCandidates([{ path: 'models/char/ysm.json' }])[0];
  assert.equal(candidate?.name, 'char');
  assert.equal(candidate?.format, 'ysm');
});

test('webapp ZIP expansion keeps YSM json sidecars', async () => {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('char/ysm.json', JSON.stringify(manifest()));
  zip.file('char/models/main.json', '{}');
  zip.file('char/textures/default.png', new Uint8Array([137, 80, 78, 71]));
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const archive = new File([bytes as Uint8Array<ArrayBuffer>], 'model.zip', { type: 'application/zip' });
  const { expandModelArchives } = await import('../webapp/engine/model-zip.ts');
  const expanded = await expandModelArchives([archive]);
  const paths = expanded.files.map((file) => (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name);
  assert.ok(paths.includes('char/ysm.json'));
  assert.ok(paths.includes('char/models/main.json'));
  assert.ok(paths.includes('char/textures/default.png'));
});

test('webapp YSM loader exposes a complete six-part rig', async () => {
  const THREE = await import('three');
  const { indexResources } = await import('../webapp/engine/resources.ts');
  const { loadYsmScene } = await import('../webapp/engine/ysm.ts');
  const { detectHumanoidRig } = await import('../webapp/engine/humanoid.ts');
  const files = [
    ['char/ysm.json', JSON.stringify(manifest())],
    ['char/models/main.json', JSON.stringify(humanoidGeometry())],
  ].map(([path, text]) => {
    const file = new File([text!], path!.slice(path!.lastIndexOf('/') + 1), { type: 'application/json' });
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    return file;
  });
  const texture = new File([new Uint8Array([137, 80, 78, 71])], 'default.png', { type: 'image/png' });
  Object.defineProperty(texture, 'webkitRelativePath', { value: 'char/textures/default.png' });
  files.push(texture);

  const prototype = THREE.Loader.prototype as unknown as { loadAsync: () => Promise<unknown> };
  const original = prototype.loadAsync;
  prototype.loadAsync = async () => new THREE.Texture();
  try {
    const warnings: string[] = [];
    const loaded = await loadYsmScene(
      indexResources(files, 'char/ysm.json'),
      'char/ysm.json',
      new THREE.LoadingManager(),
      warnings,
    );
    assert.ok(loaded.humanoidRoles);
    assert.equal(loaded.reductionHint.retainBelowTriangles, 10_000);
    assert.deepEqual(Object.keys(loaded.humanoidRoles!).sort(), [
      'head', 'hips', 'leftHand', 'leftUpperArm', 'leftUpperLeg', 'rightHand', 'rightUpperArm', 'rightUpperLeg',
    ].sort());
    const headRole = loaded.scene.getObjectByName('__ysm_head');
    const headMesh = loaded.scene.getObjectByName('Head');
    assert.equal(headMesh?.parent, headRole);
    const armRole = loaded.scene.getObjectByName('__ysm_leftUpperArm');
    const armBone = loaded.scene.getObjectByName('LeftArm');
    const forearm = loaded.scene.getObjectByName('LeftForeArm');
    assert.equal(armBone?.parent, armRole);
    assert.equal(forearm?.parent, armBone);
    assert.equal(forearm?.userData._playerPart, 'leftArm');
    const rig = detectHumanoidRig(loaded.scene, loaded.humanoidRoles);
    assert.ok(rig);
    const { armRigFromHumanoid, applyArmPose } = await import('../webapp/engine/pose.ts');
    const armRig = armRigFromHumanoid(rig);
    assert.ok(armRig);
    const before = forearm!.getWorldPosition(new THREE.Vector3()).toArray();
    applyArmPose(armRig, 30);
    loaded.scene.updateMatrixWorld(true);
    const after = forearm!.getWorldPosition(new THREE.Vector3()).toArray();
    assert.notDeepEqual(before, after);
    const { extractModel } = await import('../webapp/engine/extract.ts');
    const { PART_CODE } = await import('../webapp/engine/types.ts');
    const extracted = extractModel(loaded.scene, { rig, semanticGroups: true });
    assert.ok(extracted.batches.some((batch) =>
      batch.sourcePartTable?.some((part) => part.name === 'Hair' && part.subtree === 'Hair')));
    const codes = new Set(extracted.batches.flatMap((batch) => Array.from(batch.parts ?? [])));
    for (const part of ['body', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const)
      assert.ok(codes.has(PART_CODE[part]), `missing ${part} triangles`);
    const { humanoidPivots } = await import('../webapp/engine/humanoid.ts');
    const { buildBedrockGeometry } = await import('../webapp/engine/bedrock.ts');
    const built = buildBedrockGeometry(extracted.batches, {
      height: 32,
      doubleSided: 'source',
      rig: humanoidPivots(rig),
    });
    assert.deepEqual(Object.keys(built.report.parts!).sort(), ['body', 'head', 'leftArm', 'leftLeg', 'rightArm', 'rightLeg']);
    for (const count of Object.values(built.report.parts!)) assert.ok(count > 0);
  } finally {
    prototype.loadAsync = original;
  }
});

test('webapp import lists a YSM folder as a model candidate', async () => {
  const { prepareModelInput } = await import('../webapp/engine/model-job.ts');
  const files = [
    new File([JSON.stringify(manifest())], 'ysm.json', { type: 'application/json' }),
    new File(['{}'], 'main.json', { type: 'application/json' }),
    new File([new Uint8Array([137, 80, 78, 71])], 'default.png', { type: 'image/png' }),
  ];
  const paths = ['char/ysm.json', 'char/models/main.json', 'char/textures/default.png'];
  files.forEach((file, index) => Object.defineProperty(file, 'webkitRelativePath', { value: paths[index] }));
  const prepared = await prepareModelInput(files);
  assert.equal(prepared.candidates.length, 1);
  assert.equal(prepared.candidates[0]?.format, 'ysm');
  assert.equal(prepared.candidates[0]?.path, 'char/ysm.json');
});

test('Node and webapp instantiate the same YSM scene graph', async () => temporary(async (dir) => {
  const modelDir = join(dir, 'shared_ysm');
  await mkdir(join(modelDir, 'models'), { recursive: true });
  await mkdir(join(modelDir, 'textures'), { recursive: true });
  const manifestJson = JSON.stringify(manifest());
  const geometryJson = JSON.stringify(humanoidGeometry());
  await writeFile(join(modelDir, 'ysm.json'), manifestJson);
  await writeFile(join(modelDir, 'models', 'main.json'), geometryJson);
  await writeFile(join(modelDir, 'textures', 'default.png'), PNG_64);
  const nodeModel = await importModel(join(modelDir, 'ysm.json'));

  const THREE = await import('three');
  const { indexResources } = await import('../webapp/engine/resources.ts');
  const { loadYsmScene } = await import('../webapp/engine/ysm.ts');
  const entries: Array<[string, string | Uint8Array]> = [
    ['char/ysm.json', manifestJson],
    ['char/models/main.json', geometryJson],
    ['char/textures/default.png', PNG_64],
  ];
  const files = entries.map(([path, content]) => {
    const file = new File(
      [content instanceof Uint8Array ? content as Uint8Array<ArrayBuffer> : content],
      path.slice(path.lastIndexOf('/') + 1),
      { type: path.endsWith('.png') ? 'image/png' : 'application/json' },
    );
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    return file;
  });
  const prototype = THREE.Loader.prototype as unknown as { loadAsync: () => Promise<unknown> };
  const original = prototype.loadAsync;
  prototype.loadAsync = async () => new THREE.Texture();
  try {
    const loaded = await loadYsmScene(
      indexResources(files, 'char/ysm.json'),
      'char/ysm.json',
      new THREE.LoadingManager(),
      [],
    );
    type Entry = {
      path: string;
      translation: number[];
      role: string | undefined;
      part: string | undefined;
      mesh: boolean;
    };
    const nodeEntries: Entry[] = [];
    const nodeScene = nodeModel.document.getRoot().getDefaultScene()!;
    const walkNode = (node: import('@gltf-transform/core').Node, path: string[]) => {
      const extras = node.getExtras();
      nodeEntries.push({
        path: [...path, node.getName()].join('/'),
        translation: node.getTranslation(),
        role: typeof extras._humanoidRole === 'string' ? extras._humanoidRole : undefined,
        part: typeof extras._playerPart === 'string' ? extras._playerPart : undefined,
        mesh: !!node.getMesh(),
      });
      for (const child of node.listChildren()) walkNode(child, [...path, node.getName()]);
    };
    for (const child of nodeScene.listChildren()) walkNode(child, []);
    const webEntries: Entry[] = [];
    const walkWeb = (object: import('three').Object3D, path: string[]) => {
      if ((object as import('three').Mesh).isMesh) return;
      webEntries.push({
        path: [...path, object.name].join('/'),
        translation: object.position.toArray(),
        role: typeof object.userData._humanoidRole === 'string' ? object.userData._humanoidRole : undefined,
        part: typeof object.userData._playerPart === 'string' ? object.userData._playerPart : undefined,
        mesh: object.children.some((child) => (child as import('three').Mesh).isMesh),
      });
      for (const child of object.children) walkWeb(child, [...path, object.name]);
    };
    for (const child of loaded.scene.children) walkWeb(child, []);
    assert.equal(nodeEntries.length, webEntries.length);
    for (let index = 0; index < nodeEntries.length; index++) {
      const node = nodeEntries[index]!;
      const web = webEntries[index]!;
      assert.equal(web.path, node.path);
      assert.deepEqual(web.translation.map((value) => Number(value.toFixed(6))), node.translation.map((value) => Number(value.toFixed(6))));
      assert.equal(web.role, node.role);
      assert.equal(web.part, node.part);
      assert.equal(web.mesh, node.mesh);
    }
  } finally {
    prototype.loadAsync = original;
  }
}));

test('webapp YSM loader builds one mesh per visible bone', async () => {
  const THREE = await import('three');
  const { indexResources } = await import('../webapp/engine/resources.ts');
  const { loadYsmScene } = await import('../webapp/engine/ysm.ts');
  const ysmManifest = {
    ...manifest(),
    files: {
      player: {
        ...manifest().files.player,
        animation: { main: 'animations/main.animation.json' },
      },
    },
  };
  const geometry = {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'Body', pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [4, 8, 4], uv: [0, 0] }] },
        { name: 'Gui', pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [4, 8, 4], uv: [0, 0] }] },
      ],
    }],
  };
  const animation = { format_version: '1.8.0', animations: { pre_parallel4: { bones: { Gui: { scale: 0 } } } } };
  const entries: Array<[string, string]> = [
    ['char/ysm.json', JSON.stringify(ysmManifest)],
    ['char/models/main.json', JSON.stringify(geometry)],
    ['char/animations/main.animation.json', JSON.stringify(animation)],
  ];
  const files = entries.map(([path, text]) => {
    const file = new File([text], path.slice(path.lastIndexOf('/') + 1), { type: 'application/json' });
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    return file;
  });
  const texture = new File([new Uint8Array([137, 80, 78, 71])], 'default.png', { type: 'image/png' });
  Object.defineProperty(texture, 'webkitRelativePath', { value: 'char/textures/default.png' });
  files.push(texture);

  const prototype = THREE.Loader.prototype as unknown as { loadAsync: () => Promise<unknown> };
  const original = prototype.loadAsync;
  prototype.loadAsync = async () => new THREE.Texture();
  try {
    const warnings: string[] = [];
    const loaded = await loadYsmScene(
      indexResources(files, 'char/ysm.json'),
      'char/ysm.json',
      new THREE.LoadingManager(),
      warnings,
    );
    assert.equal(loaded.name, 'Test YSM');
    assert.ok(loaded.scene.getObjectByName('Body'));
    assert.equal(loaded.scene.getObjectByName('Gui'), undefined);
    assert.ok(warnings.some((warning) => warning.includes('已排除默认动画隐藏的 1 根 YSM 骨骼')));
  } finally {
    prototype.loadAsync = original;
  }
});
