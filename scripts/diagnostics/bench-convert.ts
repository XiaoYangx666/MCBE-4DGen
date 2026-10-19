/**
 * Conversion benchmark. Mirrors the local workbench cold path:
 * import (cached GLB or PMX through Assimp) -> humanoid export -> skin pack.
 *
 * Usage:
 *   node scripts/diagnostics/bench-convert.ts [--model sample-b|shino] [--runs 3]
 *
 * Reports per-phase timings plus end-to-end wall time. Read-only apart from
 * writing nothing: no skin pack is installed and no game directory is touched.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { importModel } from "../../src/importer.ts";
import { exportHumanoid } from "../../src/humanoid.ts";
import type { HumanoidProfile } from "../../src/humanoid.ts";
import { buildSkinPack } from "../../src/skin-pack.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const presets: Record<string, { source: string; cache: string; profile: string; excluded: string[] }> = {
  sample-b: {
    source: ".cache/models/sample-b/样本 Bfashion2/样本 Bfasion2.pmx",
    cache: ".cache/models/sample-b/diagnostic-source.glb",
    profile: "profiles/sample-b.json",
    excluded: ["表情"],
  },
  sample-a: {
    source: ".cache/models/sample-a/样本 A.pmx",
    cache: ".cache/models/sample-a/diagnostic-source.glb",
    profile: "profiles/sample-a.json",
    excluded: [],
  },
} ;

type PresetName = string;

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 ? process.argv[index + 1]! : fallback;
}

const presetName = argument("model", "sample-b");
const found = presets[presetName];
if (!found) throw new Error(`Unknown model ${presetName}: choose ${Object.keys(presets).join(" or ")}`);
const preset = found;
const runs = Number(argument("runs", "3"));
const useCache = !process.argv.includes("--no-cache");
const keepGeometry = process.argv.includes("--keep-geometry");

function timing() {
  let start = performance.now();
  const marks: Record<string, number> = {};
  return {
    mark(name: string) {
      const now = performance.now();
      marks[name] = Math.round(now - start);
      start = now;
      return marks[name]!;
    },
    marks,
  };
}

async function importOnce() {
  const path = resolve(root, useCache && preset.cache ? preset.cache : preset.source);
  return importModel(path);
}

async function main() {
  const profile = JSON.parse(await readFile(resolve(root, preset.profile), "utf8")) as HumanoidProfile;
  const results: { importMs: number; exportMs: number; packMs: number; totalMs: number; timings: Record<string, number>; triangles: number }[] = [];

  // Warm up module-level state (meshoptimizer, sharp) so run 0 is not measured cold.
  await importOnce();

  for (let run = 0; run < runs; run++) {
    const t = timing();
    const model = await importOnce();
    const importMs = t.mark("import");
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
    t.mark("exclude");

    let phase = "";
    const phases: Record<string, number> = {};
    let phaseStart = performance.now();
    const exported = await exportHumanoid(model, {
      height: 32,
      textureSize: 256,
      profile,
      reduction: { ratio: 0.2, maxError: 0.03 },
      onStage(next) {
        const now = performance.now();
        if (phase) phases[phase] = Math.round(now - phaseStart);
        phase = next;
        phaseStart = now;
      },
    });
    const exportMs = t.mark("export");

    buildSkinPack({
      geometry: exported.file,
      png: exported.png,
      identifier: "geometry.skin0",
      packName: presetName + " / bench",
    });
    const packMs = t.mark("pack");

    const totalMs = importMs + exportMs + packMs;
    const triangles = Object.values(exported.binding.parts as Record<string, number>).reduce((a, b) => a + b, 0);
    results.push({ importMs, exportMs, packMs, totalMs, timings: exported.binding.timings as Record<string, number>, triangles });
    console.log(
      `run ${run}: import=${importMs}ms export=${exportMs}ms pack=${packMs}ms total=${totalMs}ms triangles=${triangles} rss=${Math.round(process.memoryUsage().rss / 1048576)}MB`,
    );
    console.log("  humanoid phases: " + JSON.stringify(exported.binding.timings));
    console.log("  internal phases: " + JSON.stringify(phases));

    // Each iteration leaves a cloned document behind. Without releasing it the
    // heap (and therefore GC cost) grows with every run, which made later runs
    // progressively slower and the medians unreliable.
    model.document.getRoot().listBuffers().forEach((buffer) => buffer.dispose());
    (exported as unknown as { model?: { document?: { getRoot(): any } } }).model?.document
      ?.getRoot()
      .listBuffers()
      .forEach((buffer: any) => buffer.dispose());
    (globalThis as { gc?: (full?: boolean) => void }).gc?.(true);
  }

  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      min: sorted[0]!,
      median: sorted[Math.floor(sorted.length / 2)]!,
      max: sorted[sorted.length - 1]!,
    };
  };
  console.log("\nsummary (" + runs + " runs; report min and median, the machine is noisy):");
  for (const key of ["importMs", "exportMs", "packMs", "totalMs"] as const) {
    const s = stats(results.map((r) => r[key]));
    console.log(`  ${key.replace("Ms", "").padEnd(8)} min ${s.min}ms  median ${s.median}ms  max ${s.max}ms`);
  }
  for (const phase of Object.keys(results[0]!.timings)) {
    const s = stats(results.map((r) => r.timings[phase] ?? 0));
    console.log(`    ${phase.padEnd(10)} min ${s.min}ms  median ${s.median}ms  max ${s.max}ms`);
  }
  if (!keepGeometry) console.log("\n(set --keep-geometry to force full geometry serialization before measuring)");
}

await main();
