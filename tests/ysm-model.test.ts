import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { importModel } from '../src/importer.ts';
import { autoProfile } from '../src/auto-profile.ts';
import { exportHumanoid } from '../src/humanoid.ts';
import { modelFormatOf, modelDisplayName } from '../src/model-candidates.ts';
import { modelPattern } from '../server/model-files.ts';
import {
  buildYsmBoneMeshes,
  buildYsmMesh,
  buildYsmRig,
  hiddenYsmBones,
  parseYsmGeometry,
  parseYsmManifest,
  selectYsmTexture,
  YSM_HUMANOID_ROLES,
} from '../src/ysm-model.ts';

const PNG_64 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAvElEQVR4nOXOoQEAIAzAsOppNP9/yc6IQMSnOff9LB3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdDSAS0d0NIBLR3Q0gEtHdAWB/yxHm1fJEsAAAAASUVORK5CYII=',
  'base64',
);

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
  assert.ok(mesh.warnings.some((warning) => warning.includes('Excluded 2 YSM bone')));
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
  assert.ok(rig.warnings.some((warning) => warning.includes('no hand bone')));
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
  assert.ok(rig.warnings.some((warning) => warning.includes('six-part binding is unavailable')));
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
    const result = await exportHumanoid(model, { height: 32, textureSize: 64, profile });
    assert.deepEqual(Object.keys(result.binding.parts).sort(), ['body', 'head', 'leftArm', 'leftLeg', 'rightArm', 'rightLeg']);
    for (const count of Object.values(result.binding.parts)) assert.ok(count > 0);
    const bones = result.file['geometry.skin0']!.bones.map((bone) => bone.name);
    for (const part of ['body', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']) assert.ok(bones.includes(part));
    const spread = await exportHumanoid(model, { height: 32, textureSize: 64, profile: { ...profile, armSpreadDegrees: 30 } });
    const restArm = result.file['geometry.skin0']!.bones.find((bone) => bone.name === 'leftArm')!.poly_mesh!.positions;
    const spreadArm = spread.file['geometry.skin0']!.bones.find((bone) => bone.name === 'leftArm')!.poly_mesh!.positions;
    assert.notDeepEqual(restArm, spreadArm);
    const preserved = await exportHumanoid(model, { height: 32, textureSize: 256, profile, preserveTexture: true });
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
  assert.equal(model.document.getRoot().listMeshes().length, 1);
  assert.equal(model.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getIndices()!.getCount(), 36);
  assert.equal(model.document.getRoot().listTextures().length, 1);
  assert.equal(model.document.getRoot().listNodes()[0]!.getName(), 'Body');
  assert.ok(model.warnings.some((warning) => warning.includes('arm model is ignored')));
  assert.ok(model.warnings.some((warning) => warning.includes('animations')));
}));

test('YSM manifests are recognised as model candidates', () => {
  assert.equal(modelFormatOf('models/char/ysm.json'), 'ysm');
  assert.equal(modelFormatOf('C:\\models\\char\\ysm.json'), 'ysm');
  assert.equal(modelDisplayName('C:\\models\\char\\ysm.json'), 'char');
  assert.equal(modelFormatOf('models/main.json'), null);
  assert.ok(modelPattern.test('C:\\models\\char\\ysm.json'));
  assert.ok(modelPattern.test('/models/char/ysm.json'));
  assert.ok(!modelPattern.test('/models/char/main.json'));
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
    const extracted = extractModel(loaded.scene, { rig });
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
    assert.equal(loaded.scene.getObjectByName('Gui')?.children.length, 0);
    assert.ok(warnings.some((warning) => warning.includes('Excluded 1 YSM bone')));
  } finally {
    prototype.loadAsync = original;
  }
});
