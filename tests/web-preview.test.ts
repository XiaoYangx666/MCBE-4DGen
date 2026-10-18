import { test } from "bun:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createPosePreview } from "../web/pose-preview.ts";
import { estimateTriangles } from "../web/estimate.ts";
import { triangleBudget } from "../web/estimate.ts";
import { preparePreviewMaterial } from "../web/preview-material.ts";

test("alpha-textured opaque clothing uses depth-writing cutouts while real translucency stays blended", () => {
  const clothing = new THREE.MeshStandardMaterial({ transparent: true, opacity: 1, depthWrite: false });
  preparePreviewMaterial(clothing);
  assert.equal(clothing.transparent, false);
  assert.equal(clothing.depthWrite, true);
  assert.equal(clothing.alphaTest, 0.5);
  const sheer = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 });
  preparePreviewMaterial(sheer);
  assert.equal(sheer.transparent, true);
  assert.equal(sheer.opacity, 0.4);
  assert.equal(sheer.depthWrite, false);
  const mask = new THREE.MeshStandardMaterial({ alphaTest: 0.7 });
  preparePreviewMaterial(mask);
  assert.equal(mask.alphaTest, 0.7);
});

test("triangle guidance uses documented Rin and accepted Shino counts without warning at 50k", () => {
  assert.equal(triangleBudget(30000).warning, "none");
  assert.equal(triangleBudget(35122).recommendedMax, 35122);
  assert.equal(triangleBudget(50000).warning, "none");
  assert.equal(triangleBudget(52106).warning, "none");
  assert.equal(triangleBudget(52107).warning, "above");
  assert.equal(triangleBudget(203145).warning, "above");
});
import { captureCameraView, restoreCameraView } from "../web/camera-state.ts";

test("camera view survives renderer replacement without sharing mutable vectors", () => {
  const position = new THREE.Vector3(8, 12, -6);
  const target = new THREE.Vector3(1, 5, 2);
  const up = new THREE.Vector3(0, 0, 1);
  const state = captureCameraView(position, target, up, 1.7);
  position.set(0, 0, 0);
  target.set(0, 0, 0);
  up.set(0, 1, 0);
  const camera = new THREE.PerspectiveCamera();
  const controls = { target: new THREE.Vector3(), update() {} };
  restoreCameraView(state, camera, controls);
  assert.deepEqual(camera.position.toArray(), [8, 12, -6]);
  assert.deepEqual(controls.target.toArray(), [1, 5, 2]);
  assert.deepEqual(camera.up.toArray(), [0, 0, 1]);
  assert.equal(camera.zoom, 1.7);
});

function rig() {
  const root = new THREE.Group(),
    hips = new THREE.Bone();
  hips.name = "hips";
  root.add(hips);
  const left = new THREE.Bone(),
    right = new THREE.Bone(),
    lh = new THREE.Bone(),
    rh = new THREE.Bone();
  left.name = "leftUpperArm";
  right.name = "rightUpperArm";
  lh.name = "leftHand";
  rh.name = "rightHand";
  left.position.set(-0.3, 2.3, 0);
  right.position.set(0.3, 2.3, 0);
  lh.position.set(-0.7, 0, 0);
  rh.position.set(0.7, 0, 0);
  hips.add(left, right);
  left.add(lh);
  right.add(rh);
  for (const b of [hips, left, right, lh, rh])
    b.userData._vrmHumanBone = b.name;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-0.3, 2.3, 0, -1, 2.3, 0, -1, 2.4, 0, 0.3, 2.3, 0, 1, 2.3, 0, 1, 2.4, 0],
      3,
    ),
  );
  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(
      [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0],
      4,
    ),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(
      Array.from({ length: 24 }, (_, i) => (i % 4 === 0 ? 1 : 0)),
      4,
    ),
  );
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([hips, left, right, lh, rh]));
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 3, 0.2),
    new THREE.MeshBasicMaterial(),
  );
  body.position.y = 1.5;
  root.add(body);
  return { root, left, right, lh, rh };
}

test("live source posing updates skinned arm direction, fitted shoulder units, orientation and restores source", () => {
  const r = rig(),
    apply = createPosePreview(r.root);
  apply({ height: 32, humanoid: true, profile: { armSpreadDegrees: 0 } });
  const start = r.left.getWorldPosition(new THREE.Vector3());
  apply({
    height: 32,
    humanoid: true,
    profile: { armSpreadDegrees: 20, shoulderOutset: 0.3 },
  });
  const delta = r.lh
    .getWorldPosition(new THREE.Vector3())
    .sub(r.left.getWorldPosition(new THREE.Vector3()))
    .normalize();
  assert.ok(Math.abs(delta.x + Math.sin((20 * Math.PI) / 180)) < 1e-6);
  assert.ok(Math.abs(delta.y + Math.cos((20 * Math.PI) / 180)) < 1e-6);
  assert.ok(
    Math.abs(r.left.getWorldPosition(new THREE.Vector3()).x - start.x + 0.3) <
      1e-6,
  );
  const before = r.lh.getWorldPosition(new THREE.Vector3());
  apply({
    height: 32,
    humanoid: true,
    profile: { armSpreadDegrees: 20, shoulderOutset: 0.3 },
  });
  assert.ok(
    before.distanceTo(r.lh.getWorldPosition(new THREE.Vector3())) < 1e-6,
  );
  apply({
    height: 32,
    humanoid: true,
    profile: { rotationYDegrees: 180, armSpreadDegrees: 15 },
  });
  assert.ok(r.left.getWorldPosition(new THREE.Vector3()).x > 0);
  apply({ height: 32, humanoid: false, profile: null });
  const original = r.lh
    .getWorldPosition(new THREE.Vector3())
    .sub(r.left.getWorldPosition(new THREE.Vector3()))
    .normalize();
  assert.ok(original.distanceTo(new THREE.Vector3(-1, 0, 0)) < 1e-6);
});

test("live preview requires explicit source bone roles rather than guessing names", () => {
  const r = rig();
  for (const o of [r.left, r.right, r.lh, r.rh]) o.userData = {};
  const apply = createPosePreview(r.root);
  assert.throws(
    () => apply({ height: 32, humanoid: true, profile: {} }),
    /骨骼映射/,
  );
  assert.doesNotThrow(() =>
    apply({
      height: 32,
      humanoid: true,
      profile: {
        boneMap: {
          leftUpperArm: r.left.name,
          rightUpperArm: r.right.name,
          leftHand: r.lh.name,
          rightHand: r.rh.name,
        },
      },
    }),
  );
});

test("face target includes duplicated backfaces, exclusions and transparent-shell reduction", () => {
  const materials = [
    {
      name: "clothes",
      triangles: 100,
      alpha: 1,
      doubleSided: true,
      transparent: true,
    },
    {
      name: "skin",
      triangles: 50,
      alpha: 1,
      doubleSided: false,
      transparent: false,
    },
    {
      name: "outline",
      triangles: 200,
      alpha: 0,
      doubleSided: true,
      transparent: true,
    },
  ];
  assert.deepEqual(estimateTriangles(materials, [], 0.2, "humanoid"), {
    source: 250,
    target: 50,
  });
  assert.deepEqual(estimateTriangles(materials, ["clothes"], 0.2, "humanoid"), {
    source: 50,
    target: 10,
  });
  assert.deepEqual(estimateTriangles(materials, [], 0.2, "static"), {
    source: 650,
    target: 130,
  });
});

test("live orientation fits actual rotated vertices rather than an oversized rotated bounding rectangle", () => {
  const root = new THREE.Group(),
    g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 1, 1], 3),
  );
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  root.add(mesh);
  createPosePreview(root)({
    height: 32,
    humanoid: false,
    profile: { rotationYDegrees: 35 },
  });
  const box = new THREE.Box3();
  for (let i = 0; i < 3; i++)
    box.expandByPoint(
      mesh
        .getVertexPosition(i, new THREE.Vector3())
        .applyMatrix4(mesh.matrixWorld),
    );
  assert.ok(Math.abs(box.min.y) < 1e-6);
  assert.ok(Math.abs(box.max.y - 32) < 1e-6);
  assert.ok(Math.abs(box.min.x + box.max.x) < 1e-6);
  assert.ok(Math.abs(box.min.z + box.max.z) < 1e-6);
});
