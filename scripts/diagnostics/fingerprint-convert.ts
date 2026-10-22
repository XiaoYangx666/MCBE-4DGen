/**
 * Fingerprint the conversion output so a performance change can be shown to be
 * behaviour-preserving. Saves geometry JSON hash, PNG hash and mesh statistics.
 *
 * Usage: node scripts/diagnostics/fingerprint-convert.ts --model sample-b --out outputs/bench/before.json
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { importModel } from "../../src/importer.ts";
import { exportHumanoid } from "../../src/humanoid.ts";
import type { HumanoidProfile } from "../../src/humanoid.ts";
import { buildSkinPack } from "../../src/skin-pack.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const presets: Record<string, { cache: string; profile: string; excluded: string[] }> = {
  'sample-b': {
    cache: ".cache/models/sample-b/diagnostic-source.glb",
    profile: "profiles/sample-b.json",
    excluded: ["表情"],
  },
  'sample-a': {
    cache: ".cache/models/sample-a/diagnostic-source.glb",
    profile: "profiles/sample-a.json",
    excluded: [],
  },
};

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};

const presetName = arg("model", "sample-b");
const preset = presets[presetName];
if (!preset) throw new Error(`Unknown model ${presetName}`);
const out = resolve(root, arg("out", `outputs/bench/${presetName}.json`));

const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

const model = await importModel(resolve(root, preset.cache));
for (const mesh of model.document.getRoot().listMeshes())
  for (const primitive of [...mesh.listPrimitives()])
    if (preset.excluded.includes(primitive.getMaterial()?.getName() ?? "")) {
      mesh.removePrimitive(primitive);
      primitive.dispose();
    }
for (const mesh of [...model.document.getRoot().listMeshes()])
  if (!mesh.listPrimitives().length) {
    for (const node of model.document.getRoot().listNodes())
      if (node.getMesh() === mesh) node.setMesh(null);
    mesh.dispose();
  }
const profile = JSON.parse(await readFile(resolve(root, preset.profile), "utf8")) as HumanoidProfile;

const exported = await exportHumanoid(model, {
  height: 32,
  textureSize: 256,
  profile,
  reduction: { ratio: 0.2, maxError: 0.03 },
});

// Fingerprint every position/uv/normal block too: a settled-but-different atlas
// would still show up as mismatched geometry or PNG hashes.
const geometryText = JSON.stringify(exported.file);
const bones = exported.file["geometry.skin0"]!.bones;
// buildSkinPack stamps random UUIDs per call, so only the deterministic files
// are comparable between runs.
const pack = buildSkinPack({
  geometry: exported.file,
  png: exported.png,
  identifier: "geometry.skin0",
  packName: "fingerprint",
});
const packFiles: Record<string, string> = {};
for (const [name, value] of Object.entries(pack))
  if (/^(geometry\.json|skin0\.png|texts\/.*)$/.test(name))
    packFiles[name] = hash(typeof value === "string" ? value : (value as Uint8Array));

const record = {
  model: presetName,
  geometrySha256: hash(geometryText),
  pngSha256: hash(exported.png),
  pngBytes: exported.png.byteLength,
  bones: bones.map((b) => ({ name: b.name, pivot: b.pivot })),
  parts: exported.binding.parts,
  packFiles,
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2).slice(0, 1200));
console.log(`\nwritten ${out}`);
