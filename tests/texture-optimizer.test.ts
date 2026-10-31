import { test } from "vitest";
import assert from "node:assert/strict";
import sharp from "sharp";
import { Document, NodeIO } from "@gltf-transform/core";
import { KHRTextureTransform } from "@gltf-transform/extensions";
import { optimizeTextures } from "../src/texture-optimizer.ts";
import { documentFixture } from "./fixtures.ts";
import type { IntermediateModel } from "../src/model.ts";

const model = (document: Document): IntermediateModel => ({
  document,
  source: {
    path: "generated",
    format: "gltf",
    units: "meters",
    coordinates: "right-handed-y-up",
    importer: "gltf-transform",
  },
  warnings: [],
});

async function fixture() {
  const doc = await documentFixture();
  const mesh = doc.getRoot().listMeshes()[0]!;
  const first = mesh.listPrimitives()[0]!;
  const second = first
    .clone()
    .setMaterial(
      doc
        .createMaterial("red")
        .setBaseColorFactor([1, 0, 0, 1])
        .setMetallicFactor(0),
    );
  mesh.addPrimitive(second);
  return model(doc);
}

function rgbaAt(data: Uint8Array, size: number, x: number, y: number) {
  return Array.from(data.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));
}

test("compact atlas crops disconnected used UV islands, shares equivalent materials and preserves sampled colors and rigid ownership", async () => {
  const doc = await documentFixture(),
    root = doc.getRoot(),
    mesh = root.listMeshes()[0]!,
    p = mesh.listPrimitives()[0]!;
  const pixels = Buffer.alloc(64 * 64 * 4);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      pixels.set(
        x < 32 ? [240, 20, 30, 255] : [10, 40, 220, 255],
        (y * 64 + x) * 4,
      );
  p.getMaterial()!.setAlphaMode("OPAQUE").setBaseColorFactor([1, 1, 1, 1]);
  p.getMaterial()!
    .getBaseColorTexture()!
    .setImage(
      await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } })
        .png()
        .toBuffer(),
    );
  p.setExtras({ _playerPart: "leftArm" });
  p.setAttribute(
    "TEXCOORD_0",
    doc
      .createAccessor()
      .setType("VEC2")
      .setArray(new Float32Array([0.1, 0.1, 0.2, 0.1, 0.1, 0.2]))
      .setBuffer(root.listBuffers()[0]!),
  );
  const second = p
    .clone()
    .setMaterial(p.getMaterial()!.clone())
    .setExtras({ _playerPart: "body" });
  mesh.addPrimitive(second);
  const third = p.clone().setAttribute(
    "TEXCOORD_0",
    doc
      .createAccessor()
      .setType("VEC2")
      .setArray(new Float32Array([0.8, 0.8, 0.9, 0.8, 0.8, 0.9]))
      .setBuffer(root.listBuffers()[0]!),
  );
  mesh.addPrimitive(third);
  const result = await optimizeTextures(model(doc), {
    compactSize: 128,
    padding: 1,
    filter: "nearest",
  });
  assert.equal(result.report.regions.length, 2); // shared material copy adds no duplicate crop
  // Two material objects share a display name but are distinct samplers: they
  // must report separately instead of collapsing into one name-keyed row.
  assert.equal(result.report.materials.length, 2);
  assert.equal(new Set(result.report.materials.map((entry) => entry.key)).size, 2);
  assert.ok(result.report.materials.every((entry) => entry.name === p.getMaterial()!.getName()));
  const coverage = result.report.materials[0]!;
  assert.ok(coverage.regions.length >= 1);
  assert.ok(result.report.materials.every((entry) => entry.pixels > 0));
  assert.ok(coverage.uvPixels! >= coverage.pixels);
  assert.ok(coverage.pixels > 0);

  assert.ok(
    result.report.regions.every(
      (r) => r.crop!.width < 16 && r.crop!.height < 16,
    ),
  );
  const areas = result.report.regions
    .map((r) => r.width * r.height)
    .sort((a, b) => b - a);
  // Allocation follows surface area monotonically, with a sublinear exponent so
  // one dominant chart cannot crowd out small face/eye/trim charts.
  assert.ok(areas[0]! / areas[1]! > 1.6 && areas[0]! / areas[1]! < 2);
  assert.equal(result.report.allocation, "surface-area");
  assert.equal(result.report.atlas.width, 128);
  const raw = await sharp(result.png).ensureAlpha().raw().toBuffer();
  const parts = result.model.document
    .getRoot()
    .listMeshes()[0]!
    .listPrimitives();
  assert.equal(parts.length, 3);
  for (const part of parts) {
    const uv: number[] = [];
    part.getAttribute("TEXCOORD_0")!.getElement(0, uv);
    const color = rgbaAt(
      raw,
      128,
      Math.floor(uv[0]! * 128),
      Math.floor(uv[1]! * 128),
    );
    assert.ok(
      (color[0] === 240 && color[2] === 30) ||
        (color[0] === 10 && color[2] === 220),
    );
    assert.ok(
      ["body", "leftArm"].includes(part.getExtras()._playerPart as string),
    );
  }
  assert.equal(mesh.listPrimitives().length, 3); // input untouched
  assert.deepEqual(
    Array.from(p.getAttribute("TEXCOORD_0")!.getArray()!),
    Array.from(new Float32Array([0.1, 0.1, 0.2, 0.1, 0.1, 0.2])),
  );
});

test("flat base-color materials receive a single sampleable chart, not a surface-area share", async () => {
  const doc = await documentFixture(),
    root = doc.getRoot(),
    mesh = root.listMeshes()[0]!,
    textured = mesh.listPrimitives()[0]!;
  const flat = doc
    .createMaterial("flat")
    .setBaseColorFactor([0.2, 0.4, 0.8, 1])
    .setAlphaMode("OPAQUE");
  // Make the flat material dominate the model's surface area. It has no texture
  // detail, so allocating it by area would silently starve every textured chart.
  for (let i = 0; i < 12; i++) {
    mesh.addPrimitive(textured.clone().setMaterial(flat));
  }
  const result = await optimizeTextures(model(doc), {
    compactSize: 128,
    padding: 1,
    filter: "nearest",
  });
  const flatRegion = result.report.regions.find((r) =>
    r.materials.includes("flat"),
  )!;
  const texturedRegion = result.report.regions.find((r) =>
    r.materials.includes(textured.getMaterial()!.getName()),
  )!;
  assert.ok(flatRegion.width * flatRegion.height <= 9);
  assert.ok(
    texturedRegion.width * texturedRegion.height >
      flatRegion.width * flatRegion.height * 4,
  );
  assert.equal(result.report.atlas.sampledUtilization! > 0.1, true);
});

test("atlas metrics separate sampled UVs, transparent UVs, gutters and free space", async () => {
  const result = await optimizeTextures(model(await documentFixture()), {
    compactSize: 128,
    padding: 1,
    filter: "nearest",
  });
  const atlas = result.report.atlas;
  assert.ok(atlas.sampledUtilization !== undefined);
  assert.ok(atlas.uvUtilization !== undefined);
  assert.ok(atlas.sampledPixels !== undefined);
  assert.ok(atlas.uvPixels !== undefined);
  assert.ok(atlas.contentPixels !== undefined);
  assert.ok(atlas.allocatedPixels !== undefined);
  assert.ok(atlas.gutterPixels !== undefined);
  assert.ok(atlas.emptyPixels !== undefined);
  assert.ok(atlas.uvUtilization! >= atlas.sampledUtilization!);
  assert.ok(atlas.uvPixels! >= atlas.sampledPixels!);
  assert.equal(
    atlas.contentPixels! + atlas.gutterPixels! + atlas.emptyPixels!,
    128 * 128,
  );
  assert.equal(atlas.sampledPixels!, Math.round(atlas.sampledUtilization! * 128 * 128));
  assert.equal(atlas.uvPixels!, Math.round(atlas.uvUtilization! * 128 * 128));
  assert.ok(atlas.chartCoverage! > 0 && atlas.chartCoverage! <= 1.0001);
  assert.ok(atlas.gutterUtilization! >= 0);
  assert.ok(atlas.emptyUtilization! >= 0);
});

test("different materials sharing a texture are not merged when their UV areas do not coincide", async () => {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const texture = doc
    .createTexture("shared")
    .setImage(
      await sharp({
        create: { width: 64, height: 64, channels: 4, background: "#d08060" },
      })
        .png()
        .toBuffer(),
    )
    .setMimeType("image/png");
  const face = doc
    .createMaterial("face")
    .setBaseColorTexture(texture)
    .setBaseColorFactor([1, 1, 1, 1])
    .setAlphaMode("OPAQUE");
  const eyelash = doc
    .createMaterial("eyelash")
    .setBaseColorTexture(texture)
    .setBaseColorFactor([1, 1, 1, 1])
    .setAlphaMode("OPAQUE");
  const primitive = (material: typeof face, uv: number[]) => {
    const position = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buffer);
    const normal = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]))
      .setBuffer(buffer);
    return doc
      .createPrimitive()
      .setAttribute("POSITION", position)
      .setAttribute("NORMAL", normal)
      .setAttribute(
        "TEXCOORD_0",
        doc
          .createAccessor()
          .setType("VEC2")
          .setArray(new Float32Array(uv))
          .setBuffer(buffer),
      )
      .setIndices(
        doc
          .createAccessor()
          .setType("SCALAR")
          .setArray(new Uint16Array([0, 1, 2]))
          .setBuffer(buffer),
      )
      .setMaterial(material);
  };
  // The face fills most of the texture; the eyelash is a small island just below
  // it. Their joined box grows only ~8%, so an area-only merge would accept it.
  const mesh = doc
    .createMesh("face+lashes")
    .addPrimitive(
      primitive(face, [0, 0, 1, 0, 0.5, 0.9]),
    )
    .addPrimitive(
      primitive(eyelash, [0.4, 0.92, 0.6, 0.92, 0.5, 0.99]),
    );
  const node = doc.createNode("model").setMesh(mesh);
  doc.getRoot().setDefaultScene(doc.createScene("main").addChild(node));
  const result = await optimizeTextures(model(doc), {
    compactSize: 128,
    padding: 1,
    filter: "nearest",
  });
  assert.equal(result.report.regions.length, 2);
  assert.ok(
    result.report.regions.every(
      (r) => !(r.materials.includes("face") && r.materials.includes("eyelash")),
    ),
  );
});

test("atlas packs distinct materials, remaps UV and keeps source/alpha intact", async () => {
  const input = await fixture();
  const original = input.document
    .getRoot()
    .listMeshes()[0]!
    .listPrimitives()[0]!
    .getAttribute("TEXCOORD_0")!;
  const {
    model: output,
    png,
    report,
  } = await optimizeTextures(input, {
    atlasSize: 32,
    maxTextureSize: 8,
    filter: "nearest",
  });
  assert.equal(output.document.getRoot().listTextures().length, 1);
  assert.equal(input.document.getRoot().listTextures()[0]!.getName(), "rgba");
  assert.deepEqual(Array.from(original.getArray()!), [0, 0, 1, 0, 0, 1]);
  const pixels = await sharp(png).raw().toBuffer();
  const primitives = output.document
    .getRoot()
    .listMeshes()[0]!
    .listPrimitives();
  for (const [i, p] of primitives.entries()) {
    const region = report.regions[i]!;
    const uv: number[] = [];
    p.getAttribute("TEXCOORD_0")!.getElement(0, uv);
    const color = rgbaAt(pixels, 32, region.x, region.y);
    if (i === 0) {
      assert.deepEqual(color, [40, 160, 80, 64]); // Original alpha ~128 �� material alpha 0.5.
      assert.equal(uv[0], region.x / 32);
      assert.equal(uv[1], region.y / 32);
    } else assert.deepEqual(color, [255, 0, 0, 255]);
    assert.equal(p.getMaterial()!.getBaseColorTextureInfo()!.getTexCoord(), 0);
    assert.deepEqual(p.getMaterial()!.getBaseColorFactor(), [1, 1, 1, 1]);
  }
  const a = report.regions[0]!,
    b = report.regions[1]!;
  assert.ok(
    a.x + a.width + 2 <= b.x - 2 ||
      b.x + b.width + 2 <= a.x - 2 ||
      a.y + a.height + 2 <= b.y - 2 ||
      b.y + b.height + 2 <= a.y - 2,
  );
  const glb = await new NodeIO().writeBinary(output.document);
  const reread = await new NodeIO().readBinary(glb);
  assert.equal(reread.getRoot().listTextures().length, 1);
});

test("compact allocation resamples the entire crop without cover-cropping its edges", async () => {
  const input = model(await documentFixture()),
    m = input.document.getRoot().listMaterials()[0]!;
  const bytes = Buffer.alloc(8 * 4 * 4);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 8; x++)
      bytes.set(
        x < 2 ? [255, 0, 0, 255] : x > 5 ? [0, 0, 255, 255] : [0, 255, 0, 255],
        (y * 8 + x) * 4,
      );
  m.setAlphaMode("OPAQUE").setBaseColorFactor([1, 1, 1, 1]);
  m.getBaseColorTexture()!.setImage(
    await sharp(bytes, { raw: { width: 8, height: 4, channels: 4 } })
      .png()
      .toBuffer(),
  );
  const result = await optimizeTextures(input, {
    compactSize: 64,
    padding: 1,
    filter: "nearest",
  });
  const r = result.report.regions[0]!,
    raw = await sharp(result.png).ensureAlpha().raw().toBuffer();
  assert.deepEqual(rgbaAt(raw, 64, r.x, r.y), [255, 0, 0, 255]);
  assert.deepEqual(rgbaAt(raw, 64, r.x + r.width - 1, r.y), [0, 0, 255, 255]);
  assert.ok(r.width / r.height > 0.9 && r.width / r.height < 4.2); // Keep crop density proportional, rather than stretch into all free gaps.
  // Packing may adjust the aspect slightly, but never by more than the 1.2
  // width factor (1.44x aspect) that keeps source detail from visibly stretching.
  const aspect = (r.width / r.height) / ((r.crop!.width / r.crop!.height) || 1);
  assert.ok(aspect > 1 / 1.5 && aspect < 1.5);
  assert.ok(
    Math.abs(
      result.report.atlas.sampledUtilization! -
        (r.width * r.height) / 2 / (64 * 64),
    ) < 0.02,
  );
});

test("resize preserves aspect ratio and transparent channel for nearest/lanczos", async () => {
  for (const filter of ["nearest", "lanczos3"] as const) {
    const result = await optimizeTextures(model(await documentFixture()), {
      maxTextureSize: 4,
      filter,
    });
    assert.deepEqual(result.report.regions[0]!.resized, {
      width: 4,
      height: 2,
    });
    const meta = await sharp(result.png).metadata();
    assert.equal(meta.hasAlpha, true);
  }
});

test("Original retains image resolution; explicit insufficient atlas refuses data loss", async () => {
  assert.deepEqual(
    (await optimizeTextures(await fixture())).report.regions[0]!.resized,
    { width: 8, height: 4 },
  );
  await assert.rejects(
    optimizeTextures(await fixture(), { atlasSize: 8 }),
    /capacity exceeded.*Increase atlasSize/,
  );
  for (const options of [
    { atlasSize: 0 },
    { maxTextureSize: 1.5 },
    { padding: -1 },
  ])
    await assert.rejects(optimizeTextures(await fixture(), options));
});

test("base-color factor is applied in linear RGB and alpha modes obey glTF", async () => {
  const input = model(await documentFixture());
  const material = input.document.getRoot().listMaterials()[0]!;
  material
    .setBaseColorTexture(null)
    .setBaseColorFactor([0.5, 0.5, 0.5, 0.2])
    .setAlphaMode("OPAQUE");
  const opaque = await optimizeTextures(input);
  const r = opaque.report.regions[0]!,
    size = opaque.report.atlas.width;
  const data = await sharp(opaque.png).raw().toBuffer();
  assert.deepEqual(rgbaAt(data, size, r.x, r.y), [188, 188, 188, 255]);
  material.setAlphaMode("MASK").setAlphaCutoff(0.5);
  const mask = await optimizeTextures(input);
  const mr = mask.report.regions[0]!;
  assert.equal(
    rgbaAt(
      await sharp(mask.png).raw().toBuffer(),
      mask.report.atlas.width,
      mr.x,
      mr.y,
    )[3],
    0,
  );
});

test("texture transform, alternate UV set and repeated span are baked without modulo seams", async () => {
  const input = model(await documentFixture());
  const doc = input.document,
    p = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  p.setAttribute("TEXCOORD_1", p.getAttribute("TEXCOORD_0")!.clone());
  const ext = doc.createExtension(KHRTextureTransform);
  p.getMaterial()!
    .getBaseColorTextureInfo()!
    .setExtension(
      "KHR_texture_transform",
      ext.createTransform().setScale([2, 1]).setOffset([-1, 0]).setTexCoord(1),
    );
  const result = await optimizeTextures(input, { atlasSize: 32 });
  assert.deepEqual(result.report.regions[0]!.tiles, [2, 1]);
  const values = Array.from(
    result.model.document
      .getRoot()
      .listMeshes()[0]!
      .listPrimitives()[0]!
      .getAttribute("TEXCOORD_0")!
      .getArray()!,
  );
  assert.equal(values[2]! - values[0]!, 16 / 32);
  assert.equal(
    result.model.document
      .getRoot()
      .listMaterials()[0]!
      .getBaseColorTextureInfo()!
      .getExtension("KHR_texture_transform"),
    null,
  );
  p.getMaterial()!
    .getBaseColorTextureInfo()!
    .getExtension<import("@gltf-transform/extensions").Transform>(
      "KHR_texture_transform",
    )!
    .setRotation(Math.PI / 2)
    .setOffset([0, -1]);
  const rotated = await optimizeTextures(input, { atlasSize: 32 });
  assert.deepEqual(rotated.report.regions[0]!.tiles, [1, 2]);
  const compact = await optimizeTextures(input, {
    compactSize: 64,
    padding: 1,
  });
  const cr = compact.report.regions[0]!;
  assert.ok(cr.crop && cr.crop.width <= 12 && cr.crop.height <= 12);
  const remapped = compact.model.document
    .getRoot()
    .listMeshes()[0]!
    .listPrimitives()[0]!
    .getAttribute("TEXCOORD_0")!;
  const origin = remapped.getElement(0, []),
    tip = remapped.getElement(1, []);
  assert.ok(
    Math.abs(tip[1]! - origin[1]! - ((2 / cr.tiles[1]) * cr.height) / 64) <
      1e-6,
  );
});

test("gutters use repeat/mirror/clamp sampler behavior and prevent adjacent material bleed", async () => {
  const input = model(await documentFixture());
  const material = input.document.getRoot().listMaterials()[0]!;
  const image = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]), {
    raw: { width: 2, height: 1, channels: 4 },
  })
    .png()
    .toBuffer();
  material.getBaseColorTexture()!.setImage(Uint8Array.from(image));
  material.setBaseColorFactor([1, 1, 1, 1]).setAlphaMode("OPAQUE");
  for (const wrap of [10497, 33648, 33071] as const) {
    material.getBaseColorTextureInfo()!.setWrapS(wrap);
    const result = await optimizeTextures(input, {
      atlasSize: 16,
      filter: "nearest",
    });
    const r = result.report.regions[0]!,
      bytes = await sharp(result.png).raw().toBuffer();
    assert.deepEqual(
      rgbaAt(bytes, 16, r.x - 1, r.y),
      wrap === 10497 ? [0, 0, 255, 255] : [255, 0, 0, 255],
    );
    assert.deepEqual(
      rgbaAt(bytes, 16, r.x + 2, r.y),
      wrap === 10497 ? [255, 0, 0, 255] : [0, 0, 255, 255],
    );
  }
});

test("missing UV, unsupported vertex colors and excessive repeat ranges fail explicitly", async () => {
  const input = model(await documentFixture()),
    doc = input.document;
  const p = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const uv = p.getAttribute("TEXCOORD_0")!;
  p.setAttribute("TEXCOORD_0", null);
  await assert.rejects(optimizeTextures(input), /missing TEXCOORD/);
  p.setAttribute("TEXCOORD_0", uv);
  uv.setArray(new Float32Array([0, 0, 100, 0, 0, 1]));
  await assert.rejects(optimizeTextures(input), /exceeds 16 tiles/);
  p.setAttribute(
    "COLOR_0",
    doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array(9))
      .setBuffer(doc.getRoot().listBuffers()[0]!),
  );
  await assert.rejects(optimizeTextures(input), /COLOR_0/);
});

test("compact crops negative repeat/mirror/clamp UVs and samples the source without copying a full texture", async () => {
  for (const wrap of [10497, 33648, 33071] as const) {
    const doc = await documentFixture(),
      p = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!,
      m = p.getMaterial()!;
    const bytes = Buffer.alloc(64 * 64 * 4);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++)
        bytes.set(
          x < 32 && y < 32 ? [255, 0, 0, 255] : [0, 0, 255, 255],
          (y * 64 + x) * 4,
        );
    m.setBaseColorFactor([1, 1, 1, 1]).setAlphaMode("OPAQUE");
    m.getBaseColorTexture()!.setImage(
      await sharp(bytes, { raw: { width: 64, height: 64, channels: 4 } })
        .png()
        .toBuffer(),
    );
    m.getBaseColorTextureInfo()!.setWrapS(wrap).setWrapT(wrap);
    p.getAttribute("TEXCOORD_0")!.setArray(
      new Float32Array([-0.8, -0.8, -0.7, -0.8, -0.8, -0.7]),
    );
    const result = await optimizeTextures(model(doc), {
      compactSize: 64,
      padding: 1,
      filter: "nearest",
    });
    const r = result.report.regions[0]!;
    assert.ok(r.crop!.width <= 10 && r.crop!.height <= 10);
    const mapped = result.model.document
      .getRoot()
      .listMeshes()[0]!
      .listPrimitives()[0]!
      .getAttribute("TEXCOORD_0")!;
    const uv = [0, 1, 2].map((i) => mapped.getElement(i, []));
    const x = Math.floor((uv.reduce((s, t) => s + t[0]!, 0) / 3) * 64),
      y = Math.floor((uv.reduce((s, t) => s + t[1]!, 0) / 3) * 64);
    assert.deepEqual(
      rgbaAt(await sharp(result.png).raw().toBuffer(), 64, x, y),
      wrap === 33648 ? [0, 0, 255, 255] : [255, 0, 0, 255],
    );
  }
});

test("compact crops a UV seam just above one without clamping away its repeat sampling", async () => {
  const doc = await documentFixture(),
    p = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!,
    m = p.getMaterial()!;
  const bytes = Buffer.alloc(64 * 64 * 4);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      bytes.set(x < 32 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 64 + x) * 4);
  m.setBaseColorFactor([1, 1, 1, 1]).setAlphaMode("OPAQUE");
  m.getBaseColorTexture()!.setImage(
    await sharp(bytes, { raw: { width: 64, height: 64, channels: 4 } })
      .png()
      .toBuffer(),
  );
  p.getAttribute("TEXCOORD_0")!.setArray(
    new Float32Array([0.99, 0.4, 1.05, 0.4, 0.99, 0.5]),
  );
  const r = await optimizeTextures(model(doc), {
    compactSize: 128,
    padding: 1,
    filter: "nearest",
  });
  assert.ok(r.report.regions[0]!.crop!.width < 8);
  const mapped = r.model.document
    .getRoot()
    .listMeshes()[0]!
    .listPrimitives()[0]!
    .getAttribute("TEXCOORD_0")!;
  const raw = await sharp(r.png).raw().toBuffer();
  // Interior points on both sides of the seam must retain different source colors.
  const vs = [0, 1, 2].map((i) => mapped.getElement(i, []));
  for (const [weights, expected] of [
    [
      [0.8, 0.1, 0.1],
      [0, 0, 255, 255],
    ],
    [
      [0.1, 0.8, 0.1],
      [255, 0, 0, 255],
    ],
  ] as const) {
    const xy = [0, 1].map((k) =>
      Math.floor(vs.reduce((sum, t, i) => sum + t[k]! * weights[i]!, 0) * 128),
    );
    assert.deepEqual(rgbaAt(raw, 128, xy[0]!, xy[1]!), expected);
  }
});

test("compact budget follows world surface area and manual weight, independently of source resolution", async () => {
  const doc = await documentFixture(),
    root = doc.getRoot(),
    p = root.listMeshes()[0]!.listPrimitives()[0]!,
    eye = p.getMaterial()!;
  root
    .listNodes()
    .find((n) => n.getName() === "parent")!
    .setScale([1, 1, 1]);
  root
    .listNodes()
    .find((n) => n.getName() === "other")!
    .setMesh(null);
  eye.setName("eye").setBaseColorFactor([1, 1, 1, 1]).setAlphaMode("OPAQUE");
  eye.getBaseColorTexture()!.setImage(
    await sharp({
      create: { width: 256, height: 256, channels: 4, background: "#ff0000" },
    })
      .png()
      .toBuffer(),
  );
  const cloth = eye
    .clone()
    .setName("clothes")
    .setBaseColorTexture(
      doc
        .createTexture()
        .setImage(
          await sharp({
            create: {
              width: 16,
              height: 16,
              channels: 4,
              background: "#00ff00",
            },
          })
            .png()
            .toBuffer(),
        )
        .setMimeType("image/png"),
    );
  const q = p.clone().setMaterial(cloth);
  const mesh = doc.createMesh().addPrimitive(q),
    node = doc.createNode().setMesh(mesh).setScale([2, 2, 2]);
  root.listScenes()[0]!.addChild(node);
  const input = model(doc);
  const base = await optimizeTextures(input, { compactSize: 128, padding: 1 });
  const pixels = (r: typeof base, name: string) => {
    const a = r.report.regions.find((r) => r.materials.includes(name))!;
    return a.width * a.height;
  };
  // Four times the rendered surface area receives 4^0.85 ≈ 3.25x the pixels.
  assert.ok(pixels(base, "clothes") / pixels(base, "eye") > 2.8);
  assert.ok(pixels(base, "clothes") / pixels(base, "eye") < 3.7);
  const boosted = await optimizeTextures(input, {
    compactSize: 128,
    padding: 1,
    materialWeights: { eye: 8 },
  });
  assert.ok(
    Math.abs(pixels(boosted, "eye") / pixels(boosted, "clothes") - 2) < 0.25,
  );
  assert.equal(root.listMeshes().length, 2);
  assert.deepEqual(node.getScale(), [2, 2, 2]);
  const zero = await optimizeTextures(input, {
    compactSize: 128,
    padding: 1,
    materialWeights: { eye: 0 },
  });
  assert.equal(pixels(zero, "eye"), 9);
  assert.ok(
    zero.model.document
      .getRoot()
      .listMeshes()
      .flatMap((m) => m.listPrimitives())
      .some((p) => p.getMaterial()?.getName() === "eye"),
  );
  const allZero = await optimizeTextures(input, {
    compactSize: 128,
    padding: 1,
    materialWeights: { eye: 0, clothes: 0 },
  });
  assert.equal(pixels(allZero, "eye"), 9);
  assert.equal(pixels(allZero, "clothes"), 9);
  await assert.rejects(
    optimizeTextures(input, {
      compactSize: 128,
      materialWeights: { eye: -0.01 },
    }),
    /Material weights/,
  );
});

test("overlapping UV bounding boxes do not merge sparse disconnected garment islands into a whole-image crop", async () => {
  const doc = await documentFixture(),
    root = doc.getRoot(),
    mesh = root.listMeshes()[0]!,
    p = mesh.listPrimitives()[0]!;
  p.getAttribute("TEXCOORD_0")!.setArray(
    new Float32Array([0.1, 0.1, 0.7, 0.1, 0.1, 0.7]),
  );
  const q = p.clone().setAttribute(
    "TEXCOORD_0",
    doc
      .createAccessor()
      .setType("VEC2")
      .setArray(new Float32Array([0.4, 0.4, 0.9, 0.4, 0.9, 0.9]))
      .setBuffer(root.listBuffers()[0]!),
  );
  mesh.addPrimitive(q);
  const r = await optimizeTextures(model(doc), {
    compactSize: 128,
    padding: 1,
  });
  assert.equal(r.report.regions.length, 2);
  assert.equal(
    r.model.document
      .getRoot()
      .listMeshes()[0]!
      .listPrimitives()
      .reduce((n, p) => n + p.getIndices()!.getCount() / 3, 0),
    2,
  );
});
